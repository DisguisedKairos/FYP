'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./dft-helpers'),risk=require('../banking/counterparty-risk'),cases=require('../scripts/fixtures/sector-companies');
const {seedSectorCompanies,EMAIL,PASSWORD}=require('../scripts/seed-sector-companies');
const {createOpenAIModel}=require('../banking/agents/openai');
const news=require('../banking/counterparty-news'),publicResearch=require('../banking/public-research');
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn),MODEL='gpt-6-luna';
const actor=async db=>(await db.query('SELECT * FROM users WHERE email=$1',[EMAIL])).rows[0];
function reply(input){
 const dimension=(company,d)=>{
  const facts=company.facts.filter(f=>f.impacts.includes(d)),flag=facts.find(f=>f.severity==='elevated')||facts.find(f=>f.severity==='review')||facts[0];
  return {level:flag.severity==='elevated'?'elevated':flag.severity==='review'?'review':'insufficient_evidence',evidenceIds:[flag.id],summary:flag.severity==='context'?'The supplied scope is limited and does not establish safety.':'The supplied concern requires independent verification and human review.'};
 };
 return {role:'assistant',tool_calls:[{function:{name:'submit_counterparty_assessment',arguments:{assessments:input.companies.map(c=>({companyKey:c.companyKey,reputation:dimension(c,'reputation'),financial:dimension(c,'financial'),checks:['verify_legal_identity','consult_compliance']}))}}}],modelResponse:{provider:'openai',model:MODEL,responseId:'resp_counterparty_risk'}};
}
const controlled=()=>({mode:'openai',model:MODEL,inspect:async()=>({available:true}),chat:async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Review the scenario distinctions and recorded exposure before arranging independent checks [E1].'}:{role:'assistant',content:'',tool_calls:[{function:{name:'assess_counterparty_risk',arguments:{}}}]},assessCounterparties:async input=>risk.validateEvaluation(reply(input),input)});
const simpleInput=()=>({checkedAt:new Date(0).toISOString(),period:{days:90},totalCompanyCount:1,omittedCompanyCount:0,scope:'Owned scope',companies:[{companyKey:'C1',company:'GLDB Demo Example Pte. Ltd.',sector:'Technology',demo:true,exposure:{paidCents:10000,receivedCents:0,netOutflowCents:10000,pendingOutgoingCents:0,completedPaidUnderReviewCents:0,completedCount:1,openReviewCount:0},facts:[{id:'C1-F0',description:'Fictional case; identity remains unverified.',severity:'context',impacts:['reputation','financial'],source:'fictional_scenario'}]}]});
async function financial(db){return {accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT id,amount_cents,status FROM transactions ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows,cases:(await db.query('SELECT * FROM fraud_cases ORDER BY id')).rows};}
test('Sector fixtures are distinct fictional inputs across different industries without stored AI verdicts',()=>{
 assert.equal(cases.length,8);assert.equal(new Set(cases.map(c=>c.sector)).size,8);
 for(const c of cases){assert.match(c.name,/^GLDB Demo /);assert.ok(Number.isSafeInteger(c.paidCents));assert.doesNotMatch(JSON.stringify(c),/"(?:riskScore|probability|assessment|verdict)"\s*:/);}
 assert.ok(cases.some(c=>!c.flags.length));assert.ok(cases.some(c=>c.flags.some(f=>f.code==='possible_name_match')));
 assert.equal(risk.requested('Evaluate demo companies across sectors'),true);assert.equal(risk.requested('Assess reputation and money risk of flagged companies'),true);assert.equal(risk.requested('What is my balance?'),false);
});
test('AI company assessments reject invented identities, foreign evidence, unsupported grades, losses and payment actions',()=>{
 const input=simpleInput();assert.equal(risk.validateEvaluation(reply(input),input).assessments[0].reputation.level,'insufficient_evidence');
 const changes=[
  r=>r.tool_calls[0].function.arguments.assessments[0].companyKey='C9',
  r=>r.tool_calls[0].function.arguments.assessments[0].financial.evidenceIds=['C9-F0'],
  r=>r.tool_calls[0].function.arguments.assessments[0].financial.level='elevated',
  r=>r.tool_calls[0].function.arguments.assessments[0].financial.summary='The company will lose SGD 90000.',
  r=>r.tool_calls[0].function.arguments.assessments[0].reputation.summary='The company is sanctioned.',
  r=>r.tool_calls[0].function.arguments.assessments[0].checks=['approve_payment'],
  r=>r.tool_calls[0].function.arguments.assessments=[],
  r=>r.tool_calls[0].function.arguments.assessments[0].reputation.probability=0.9,
 ];
 for(const change of changes){const r=reply(input);change(r);assert.throws(()=>risk.validateEvaluation(r,input),e=>e.status===503);}
});
test('Configured OpenAI risk evaluation uses only a strict private function schema and never web search',async()=>{
 const input=simpleInput();let captured;
 const model=createOpenAIModel({model:MODEL,apiKey:'test-only-sector-provider-fixture-credential',fetchImpl:async(_url,options)=>{
  captured=JSON.parse(options.body);return new Response(JSON.stringify({id:'resp_risk',model:MODEL,status:'completed',output:[{type:'function_call',call_id:'call_risk',name:'submit_counterparty_assessment',arguments:JSON.stringify(reply(input).tool_calls[0].function.arguments)}]}));
 }});
 assert.equal((await model.assessCounterparties(input)).status,'completed');assert.equal(captured.store,false);assert.equal(captured.tool_choice,'required');assert.equal(captured.max_output_tokens,4000);assert.equal(captured.tools.length,1);assert.equal(captured.tools[0].type,'function');assert.equal(captured.tools[0].strict,true);assert.equal(captured.tools[0].parameters.properties.assessments.items.additionalProperties,false);
});
pg('Sector setup is idempotent, preserves existing accounts and reconciles every sample cent',async t=>{
 const f=await fixture(t,{http:false}),before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 const first=await seedSectorCompanies(f.db),owner=await actor(f.db);
 assert.equal(first.newProfiles,8);assert.ok(first.newReceipts>16);
 const account=(await f.db.query('SELECT * FROM accounts WHERE user_id=$1',[owner.id])).rows[0];
 assert.equal((await f.db.query('SELECT opening_balance_cents+COALESCE(sum(t.amount_cents),0) AS balance FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.status=$2 WHERE a.id=$1 GROUP BY a.id',[account.id,'completed'])).rows[0].balance,account.balance_cents);
 const saved=await financial(f.db),second=await seedSectorCompanies(f.db);assert.equal(second.newProfiles,0);assert.equal(second.newReceipts,0);assert.deepEqual(await financial(f.db),saved);
 for(const row of before)assert.equal((await f.db.query('SELECT balance_cents FROM accounts WHERE id=$1',[row.id])).rows[0].balance_cents,row.balance_cents);
 assert.equal(owner.role,'customer');assert.equal((await f.db.query('SELECT count(*)::int AS n FROM demo_counterparties WHERE user_id=$1',[owner.id])).rows[0].n,8);
});
pg('Sector setup refuses an unrelated pre-existing identity and leaves its records intact',async t=>{
 const f=await fixture(t,{http:false});
 await f.db.query("INSERT INTO users(name,email,password_hash,created_at) SELECT 'Unrelated operator',$1,password_hash,now() FROM users LIMIT 1",[EMAIL]);
 const before=await financial(f.db);await assert.rejects(seedSectorCompanies(f.db),/unrelated identity/);assert.deepEqual(await financial(f.db),before);assert.equal((await f.db.query('SELECT count(*)::int AS n FROM demo_counterparties')).rows[0].n,0);
});
pg('Owned sector preparation calculates cash exposure while preserving demo provenance and company privacy',async t=>{
 const f=await fixture(t,{http:false});await seedSectorCompanies(f.db);const owner=await actor(f.db);
 const prepared=await risk.prepare(f.db,owner,{},'Evaluate reputation and financial risk of my demo companies');assert.equal(prepared.companies.length,8);assert.ok(prepared.companies.every(c=>c.demo));
 const logistics=prepared.companies.find(c=>c.sector==='Logistics');assert.equal(logistics.exposure.paidCents,2400000);assert.equal(logistics.exposure.receivedCents,400000);assert.equal(logistics.exposure.netOutflowCents,2000000);assert.ok(logistics.facts.some(f=>f.source==='fictional_scenario'&&f.severity==='review'));
 const other=(await f.db.query("SELECT * FROM users WHERE email='jamie@greenlink.demo'")).rows[0];
 await assert.rejects(risk.prepare(f.db,other,{company:logistics.company},'Evaluate company risk for '+logistics.company),e=>e.status===404);
 await assert.rejects(risk.prepare(f.db,owner,{company:logistics.company},'Evaluate a different company risk'),e=>e.status===400);
 const body=JSON.stringify(prepared);assert.doesNotMatch(body,/1099007001|authorizationPassword|password_hash|accountNumber/);
});
pg('Fictional companies are never included in live sanctions/news requests',async t=>{
 const f=await fixture(t,{http:false});await seedSectorCompanies(f.db);const owner=await actor(f.db),scan=await news.prepare(f.db,owner,{},'Scan my counterparties for sanctions and news');
 assert.equal(scan.companies.length,0);assert.equal(scan.fictionalCompaniesExcluded,8);assert.deepEqual(news.requestsFor(scan),[]);
 assert.throws(()=>publicResearch.requestFor('company',{companyName:cases[0].name},'Research '+cases[0].name),e=>e.status===400);
});
pg('Assistant evaluates both risk dimensions with current ownership, CSRF and audit while leaving money and cases untouched',async t=>{
 const f=await fixture(t,{agentModel:controlled()});await seedSectorCompanies(f.db);const client=f.client();await client.login(EMAIL,PASSWORD);const before=await financial(f.db);
 assert.equal((await client.request('/api/agents/assistant',{method:'POST',body:{message:'Evaluate reputation and financial risk of my sector companies'},csrf:false})).status,403);
 const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Evaluate reputation and financial risk of my sector companies'}});
 assert.equal(result.status,200);assert.equal(result.data.counterpartyRisk.assessments.length,8);assert.equal(result.data.narrativeWithheld,undefined);assert.equal(result.data.actions.length,0);
 const baseline=result.data.counterpartyRisk.assessments.find(c=>c.sector==='Professional services');assert.equal(baseline.reputation.level,'insufficient_evidence');assert.equal(baseline.financial.level,'insufficient_evidence');assert.deepEqual(await financial(f.db),before);
 assert.equal((await f.db.query("SELECT count(*)::int AS n FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'phase'='counterparty_risk_evaluation' AND metadata->>'status'='completed'")).rows[0].n,1);
 assert.equal((await client.request('/api/ai-audit')).status,403);
});
pg('A missing AI evaluator never returns static or substitute scenario grades',async t=>{
 const model=controlled();delete model.assessCounterparties;const f=await fixture(t,{agentModel:model});await seedSectorCompanies(f.db);const client=f.client();await client.login(EMAIL,PASSWORD);
 const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Evaluate reputation and money risk of my demo companies'}});assert.equal(result.status,503);assert.equal(result.data.counterpartyRisk,undefined);
});
pg('Authorization revoked during AI company evaluation prevents a completed report',async t=>{
 const model=controlled(),f=await fixture(t,{agentModel:model});await seedSectorCompanies(f.db);const owner=await actor(f.db),client=f.client();await client.login(EMAIL,PASSWORD);
 model.assessCounterparties=async input=>{await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[owner.id]);return risk.validateEvaluation(reply(input),input);};
 const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Evaluate reputation risk of my demo companies'}});
 assert.ok([401,409].includes(result.status));assert.equal((await f.db.query("SELECT count(*)::int AS n FROM agent_runs WHERE status='completed' AND user_id=$1",[owner.id])).rows[0].n,0);
});
test('Risk cards explain fictional inputs and historical exposure without exposing actions or unsafe HTML',()=>{
 const report=risk.validateEvaluation(reply(simpleInput()),simpleInput());report.assessments[0].company='<img src=x onerror=alert(1)>';
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const source=fs.readFileSync(path.join(__dirname,'../public/js/counterparty-risk.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const context={esc,fullDate:v=>v,money:v=>'SGD '+v/100};vm.runInNewContext(source+';globalThis.render=counterpartyRiskHtml;',context);
 const html=context.render({counterpartyRisk:report});assert.match(html,/Fictional company and scenario/);assert.match(html,/not losses/);assert.match(html,/Insufficient evidence/);assert.match(html,/SGD 100/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|<button|data-action|View AI audit/);
});

pg('Recorded payment reviews and pending requests remain distinct from completed cash exposure',async t=>{
 let score=2;const {modelStub}=require('./dft-helpers'),f=await fixture(t,{assessModel:input=>modelStub(score)(input)});await seedSectorCompanies(f.db);const owner=await actor(f.db),client=f.client();await client.login(EMAIL,PASSWORD);const source=(await client.dashboard()).accounts[0];
 const pay=async amount=>{const result=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'SECTOR-EXPOSURE',amount,requestId:require('node:crypto').randomUUID()}});assert.equal(result.status,200);return result.data.transaction;};
 const settled=await pay('25.00');assert.equal(settled.status,'completed');score=80;
 await require('../banking/fraud-cases').scan(f.db,f.riskClient,{force:true,transactionId:settled.id});
 const pending=await pay('40.00');assert.equal(pending.status,'pending_review');const before=await financial(f.db);
 const input=await risk.prepare(f.db,owner,{company:settled.counterparty},'Evaluate reputation and financial risk for '+settled.counterparty),company=input.companies[0];
 assert.equal(company.demo,false);assert.equal(company.exposure.paidCents,2500);assert.equal(company.exposure.pendingOutgoingCents,4000);assert.equal(company.exposure.completedPaidUnderReviewCents,2500);assert.equal(company.exposure.openReviewCount,1);
 const report=risk.validateEvaluation(reply(input),input);assert.equal(report.assessments[0].reputation.level,'review');assert.equal(report.assessments[0].financial.level,'review');assert.deepEqual(await financial(f.db),before);
});

pg('Only operator-registered historical demo receipts are omitted from automatic monitoring',async t=>{
 const {modelStub}=require('./dft-helpers'),f=await fixture(t,{assessModel:modelStub(80)});await seedSectorCompanies(f.db);const owner=await actor(f.db),cases=require('../banking/fraud-cases');
 await cases.scan(f.db,f.riskClient,{force:true});
 assert.equal((await f.db.query('SELECT count(*)::int AS n FROM fraud_cases c JOIN transactions t ON t.id=c.transaction_id JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1',[owner.id])).rows[0].n,0);
 const client=f.client();await client.login(EMAIL,PASSWORD);const source=(await client.dashboard()).accounts[0];
 const paid=await client.request('/api/payments',{method:'POST',body:{fromAccountId:source.id,billerId:'pub',reference:'SECTOR-DEMO-real-payment',amount:'25',requestId:require('node:crypto').randomUUID()}});assert.equal(paid.status,200);
 await cases.scan(f.db,f.riskClient,{force:true});assert.equal((await f.db.query('SELECT count(*)::int AS n FROM fraud_cases WHERE transaction_id=$1',[paid.data.transaction.id])).rows[0].n,1);
 const receipt=(await f.db.query("SELECT t.id FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.amount_cents<0 ORDER BY t.insert_seq LIMIT 1",[owner.id])).rows[0];
 assert.equal((await cases.scan(f.db,f.riskClient,{force:true,transactionId:receipt.id})).checked,1);
});
