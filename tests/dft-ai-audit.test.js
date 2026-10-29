'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const audit=require('../banking/ai-audit');
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const controlled={mode:'openai',model:'audit-openai',inspect:async()=>({available:true}),chat:async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Inspect your owned account balances before authorizing a payment [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'get_accounts',arguments:{}}}]}};
async function clients(f){const own=f.client(),peer=f.client(),staff=f.client();await f.db.query("INSERT INTO users(name,email,password_hash,role) SELECT 'Audit peer','peer@audit.test',password_hash,'customer' FROM users WHERE email='jamie@greenlink.demo'");await own.login('jamie@greenlink.demo');await peer.login('peer@audit.test');await staff.login('reviewer@greenlink.demo');return {own,peer,staff};}
const get=(client,kind,id)=>client.request('/api/ai-audit/'+kind+'/'+id);
const post=(client,message)=>client.request('/api/agents/assistant',{method:'POST',body:{message}});
async function payment(client){const source=(await client.dashboard()).accounts[0];const r=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'AI-AUDIT',amount:'1.00',requestId:randomUUID()}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.transaction.id;}
async function balances(db){return JSON.stringify((await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);}
pg('AI audit requires authentication, validates filters and exposes no mutation endpoint',async t=>{
 const f=await fixture(t),anonymous=f.client();assert.equal((await anonymous.request('/api/ai-audit')).status,401);
 const {own}=await clients(f);
 for(const filter of ['type=unknown','page=0','pageSize=101','days=91','q='+('x'.repeat(151)),'type=agent&type=payment','userId=1','page=1e2'])assert.equal((await own.request('/api/ai-audit?'+filter)).status,400,filter);
 assert.equal((await get(own,'unknown',randomUUID())).status,400);
 assert.equal((await own.request('/api/ai-audit',{method:'POST',body:{status:'completed'}})).status,404);
 const result=await own.request('/api/ai-audit?q='+encodeURIComponent("%' OR 1=1 --"));assert.equal(result.status,200);assert.equal(result.data.pagination.total,0);
});
pg('Assistant audit links actual request attempts to owned evidence and excludes raw chat and other users',async t=>{
 const f=await fixture(t,{agentModel:controlled}),{own,peer,staff}=await clients(f),before=await balances(f.db);
 const response=await post(own,'Check my balance AUDIT-PRIVATE-QUESTION');assert.equal(response.status,200,JSON.stringify(response.data));
 const id=response.data.runId,r=await get(own,'agent',id);assert.equal(r.status,200,JSON.stringify(r.data));
 const d=r.data.record;assert.equal(d.modelCalls.length,2);assert.ok(d.modelCalls.every(c=>c.model==='audit-openai'&&c.executed&&c.durationMs>=0&&c.promptSha256.length===64));
 assert.deepEqual(d.modelCalls[0].toolNames,['get_accounts']);assert.equal(d.evidence.tools[0].tool,'get_accounts');assert.equal(d.evidence.tools[0].result.accounts.length,1);assert.equal(d.evidence.guardrails.narrative,'validated_evidence');
 assert.doesNotMatch(JSON.stringify(d),/AUDIT-PRIVATE-QUESTION|context_json|password|thinking|<think>/i);
 for(const other of [peer,staff]){assert.equal((await get(other,'agent',id)).status,404);assert.equal((await other.request('/api/ai-audit?type=agent')).data.pagination.total,0);}
 const page=await own.request('/api/ai-audit?type=agent&pageSize=1');assert.equal(page.status,200);assert.equal(page.data.entries[0].id,id);assert.equal(page.data.pagination.total,1);
 assert.equal(await balances(f.db),before);
});
pg('Payment audit shows bound input, policy, scores and real model provenance to its owner and staff only',async t=>{
 const f=await fixture(t),{own,peer,staff}=await clients(f),id=await payment(own),before=await balances(f.db);
 for(const permitted of [own,staff]){const r=await get(permitted,'payment',id);assert.equal(r.status,200,JSON.stringify(r.data));const d=r.data.record;assert.equal(d.evidence.transactionId,id);assert.equal(d.evidence.guardrails.payloadBinding,true);assert.equal(d.evidence.decisionSummary.aiScore,2);assert.equal(d.evidence.decisionSummary.decision,'allow');assert.equal(d.modelCalls.length,1);assert.equal(d.modelCalls[0].modelIdentitySha256,require('../banking/ai-provider').identity('controlled-openai'));assert.ok(d.evidence.policySnapshot.rules.length);}
 assert.equal((await get(peer,'payment',id)).status,404);assert.equal((await peer.request('/api/ai-audit?type=payment')).data.pagination.total,0);
 const filtered=await staff.request('/api/ai-audit?type=payment&q='+id);assert.equal(filtered.data.entries[0].id,id);assert.equal(await balances(f.db),before);
});
pg('Failed availability and inference attempts remain inspectable without fabricated success or raw errors',async t=>{
 let ready=false;const model={...controlled,inspect:async()=>({available:ready}),chat:async()=>{throw Error('UNSAFE-RAW-ERROR password=NeverStoreThis');}};
 const f=await fixture(t,{agentModel:model}),{own,peer,staff}=await clients(f);
 assert.equal((await post(own,'test')).status,503);ready=true;assert.equal((await post(own,'Check my balance')).status,503);
 const result=await own.request('/api/ai-audit?type=failure');assert.equal(result.status,200);assert.equal(result.data.pagination.total,2);
 let flags=[];for(const row of result.data.entries){const d=(await get(own,'failure',row.id)).data.record;flags.push(d.modelCalls[0].executed);assert.equal(d.evidence.guardrails.status,'failed');assert.doesNotMatch(JSON.stringify(d),/UNSAFE-RAW-ERROR|NeverStoreThis|password=/);for(const other of [peer,staff])assert.equal((await get(other,'failure',row.id)).status,404);}
 assert.deepEqual(flags.sort(),[false,true]);assert.equal((await staff.request('/api/ai-audit?type=failure')).data.pagination.total,0);
 const failedRun=(await own.request('/api/ai-audit?type=agent')).data.entries[0];const d=(await get(own,'agent',failedRun.id)).data.record;assert.equal(d.evidence.status,'failed');assert.equal(d.evidence.errorCode,'AGENT_FAILED');
});
pg('Monitoring audit and failed scan requests remain staff-only even when the payment belongs to a customer',async t=>{
 const f=await fixture(t),{own,staff}=await clients(f),transactionId=await payment(own),id=randomUUID(),detector='audit-detector';
 await f.db.query('INSERT INTO fraud_screenings(id,transaction_id,detector_version,evidence_json,created_at) VALUES($1,$2,$3,$4,now())',[id,transactionId,detector,{flagged:true,signals:['An unusual payment pattern needs independent review.'],model:{provider:'openai',modelName:'audit-openai',score:72,reasons:[{code:'new_payee',message:'First recorded payee.'}]}}]);
 const user=(await f.db.query('SELECT user_id FROM fraud_assessments WHERE id=$1',[transactionId])).rows[0].user_id;
 await audit.record(f.db,{kind:'monitoring',subjectId:transactionId,userId:user,model:'audit-openai',phase:'fraud_scoring',status:'failed',durationMs:12,errorCode:'HTTP_503',detectorVersion:detector});
 assert.equal((await get(own,'monitoring',id)).status,403);assert.equal((await own.request('/api/ai-audit?type=monitoring')).data.pagination.total,0);assert.equal((await own.request('/api/ai-audit?type=failure')).data.pagination.total,0);
 const d=(await get(staff,'monitoring',id)).data.record;assert.equal(d.evidence.guardrails.flagged,true);assert.equal(d.modelCalls.length,1);assert.equal((await staff.request('/api/ai-audit?type=failure')).data.pagination.total,1);
});
pg('Historical evidence is readable without Ollama and metadata uses an explicit privacy allowlist',async t=>{
 const f=await fixture(t,{agentModel:{...controlled,inspect:async()=>({available:false})}}),{own}=await clients(f),user=(await f.db.query("SELECT id,auth_version FROM users WHERE email='jamie@greenlink.demo'")).rows[0],id=randomUUID();
 await f.db.query("INSERT INTO agent_runs(id,user_id,auth_version,kind,engine,status,report_json,created_at,completed_at) VALUES($1,$2,$3,'assistant','ollama','completed',$4,now(),now())",[id,user.id,user.auth_version,{title:'Historical account enquiry',reply:'See the saved account evidence.'}]);
 const old=(await get(own,'agent',id)).data.record;assert.equal(old.modelCalls.length,0);assert.match(old.provenanceNote,/not recorded/);assert.equal(old.evidence.guardrails.narrative,'historical_outcome');
 await audit.record(f.db,{kind:'agent',subjectId:id,userId:user.id,actorId:user.id,model:'audit-openai',phase:'banking_task',status:'completed',durationMs:4,toolNames:['get_accounts','invalid name'],prompt:'PRIVATE-PROMPT',thinking:'HIDDEN-THOUGHTS',password:'RAW-PASSWORD',modelSha256:'not-a-digest'});
 const saved=(await get(own,'agent',id)).data.record;assert.deepEqual(saved.modelCalls[0].toolNames,['get_accounts']);assert.equal(saved.modelCalls[0].modelSha256,undefined);assert.doesNotMatch(JSON.stringify(saved),/PRIVATE-PROMPT|HIDDEN-THOUGHTS|RAW-PASSWORD/);
});

pg('AI audit distinguishes human-review scores from financial rules and fails closed when metadata cannot persist',async t=>{
 const {modelStub}=require('./dft-helpers'),f=await fixture(t,{assessModel:modelStub(80)}),client=f.client();await client.login('jamie@greenlink.demo');
 await f.db.query("UPDATE fraud_rules SET threshold=50 WHERE id='high_value'");
 const source=(await client.dashboard()).accounts[0],before=await balances(f.db);
 const result=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'HUMAN-REVIEW',amount:'100.00',requestId:randomUUID()}});assert.equal(result.status,200);assert.equal(result.data.transaction.status,'pending_review');
 const d=(await get(client,'payment',result.data.transaction.id)).data.record;assert.equal(d.evidence.decisionSummary.aiScore,80);assert.equal(d.evidence.decisionSummary.decision,'review');assert.equal(d.evidence.decisionSummary.aiReasons[0].code,'test_model');assert.ok(d.evidence.decisionSummary.ruleMatches.some(r=>r.code==='rule:high_value'));assert.equal(await balances(f.db),before);
 const count=(await f.db.query('SELECT count(*) FROM transactions')).rows[0].count;
 await f.db.query("ALTER TABLE audit_log ADD CONSTRAINT test_ai_audit_failure CHECK(event_type<>'ai.model_call') NOT VALID");
 const refused=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'NO-AUDIT-NO-PAYMENT',amount:'1.00',requestId:randomUUID()}});assert.equal(refused.status,503);assert.equal(await balances(f.db),before);assert.equal((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count,count);
});
pg('Unsafe model prose records the rejected narrative outcome and bounded repair attempt',async t=>{
 const model={...controlled,chat:async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Your balance is SGD 999999 [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'get_accounts',arguments:{}}}]}};
 const f=await fixture(t,{agentModel:model}),client=f.client();await client.login('jamie@greenlink.demo');
 const r=await post(client,'What is my balance?');assert.equal(r.status,200);assert.equal(r.data.narrativeWithheld,true);
 const d=(await get(client,'agent',r.data.runId)).data.record;assert.equal(d.evidence.guardrails.narrative,'withheld');assert.ok(d.evidence.guardrails.reason);assert.ok(d.modelCalls.some(c=>c.phase==='narrative_repair'));assert.doesNotMatch(JSON.stringify(d),/999999/);assert.equal(d.evidence.tools[0].tool,'get_accounts');
});

pg('Payment audit retains initial screening but reflects stricter controls applied before settlement',async t=>{
 const f=await fixture(t),{own,staff}=await clients(f),original=f.riskClient.assess,reviewer=(await f.db.query("SELECT id,role,auth_version FROM users WHERE email='reviewer@greenlink.demo'")).rows[0];
 f.riskClient.assess=async input=>{const result=await original(input);await f.riskClient.updateRule('high_value',{version:1,threshold:0.5,action:'block'},reviewer);return result;};
 const before=await balances(f.db),id=await payment(own);assert.equal(await balances(f.db),before);
 for(const client of [own,staff]){const d=(await get(client,'payment',id)).data.record;assert.equal(d.evidence.paymentStatus,'rejected');assert.equal(d.evidence.assessment.decision,'allow','The initial assessment must remain immutable evidence.');assert.equal(d.evidence.policySnapshot.version,1);assert.equal(d.evidence.decisionSummary.decision,'block');assert.equal(d.evidence.decisionSummary.combinedScore,95);assert.ok(d.evidence.decisionSummary.ruleMatches.some(r=>r.code==='rule:high_value'));assert.equal(d.evidence.paymentRisk.currentRuleVersion,2);assert.equal(d.evidence.guardrails.payloadBinding,true);
 const rows=(await client.request('/api/ai-audit?type=payment&q='+id)).data.entries;assert.equal(rows[0].decision,'block');}
});

pg('Fraud investigation and monitoring retain the recorded payment block after a later policy change',async t=>{
 const f=await fixture(t),{own}=await clients(f),original=f.riskClient.assess,reviewer=(await f.db.query("SELECT id,role,auth_version FROM users WHERE email='reviewer@greenlink.demo'")).rows[0];
 f.riskClient.assess=async input=>{const r=await original(input);await f.riskClient.updateRule('high_value',{version:1,threshold:0.5,action:'block'},reviewer);return r;};
 const id=await payment(own),brief=await require('../banking/agents/reports').investigation(f.db,reviewer,{transactionId:id});
 await f.riskClient.updateRule('high_value',{version:2,enabled:false},reviewer);
 const before=await balances(f.db);await require('../banking/fraud-cases').scan(f.db,f.riskClient,{actor:reviewer,force:true,transactionId:id});
 const analysis=await require('../banking/fraud-cases').analysis(f.db,reviewer,id);
 assert.deepEqual({investigationDecision:brief.assessment.decision,investigationPolicyVersion:brief.assessment.policyVersion,monitoringDecision:analysis.evidence.original.decision,recordedBlockFlag:analysis.evidence.signals.some(s=>s.code==='original_block'),flagged:analysis.evidence.flagged},{investigationDecision:'block',investigationPolicyVersion:2,monitoringDecision:'block',recordedBlockFlag:true,flagged:true});assert.equal(await balances(f.db),before);
});
