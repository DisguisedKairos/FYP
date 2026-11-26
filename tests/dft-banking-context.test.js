'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const context=require('../banking/agents/banking-context'),{createAgents}=require('../banking/agents');
const {fixture}=require('./dft-helpers'),research=require('../banking/public-research');
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const modelName='gpt-6-luna',model=chat=>({mode:'openai',model:modelName,inspect:async()=>({available:true}),chat});
const owner=async db=>(await db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];
const tool=(name,args={})=>({role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]});
function publicReport(request){
 const text='Public banking guidance explains independent review and account reconciliation. Source',start=text.indexOf('Source');
 return research.parseResponse({status:'completed',model:modelName,output:[{type:'web_search_call',status:'completed'},{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[{type:'url_citation',url:'https://www.mas.gov.sg/',title:'MAS',start_index:start,end_index:text.length}]}]}]},modelName,request);
}
test('General explanations are distinct from personal account enquiries, dates, amounts and payment requests',()=>{
 for(const question of ['What is liquidity in business banking?','Explain cash flow.','How does a wholesale digital bank differ from a retail bank?','What is a finance report?','Why is payment authorization needed?'])assert.equal(context.generalQuestion(question),true,question);
 for(const question of ['What is my account balance?','Explain our cash flow.','What is the cash flow of another company?','Prepare a scheduled payment.','What food should I eat?','Explain the balance between 2026-11-01 and 2026-11-25.'])assert.equal(context.generalQuestion(question),false,question);
 assert.equal(context.needsResearch('What are current Singapore payment authorization requirements?'),true);
 assert.equal(context.needsResearch('What is liquidity?'),false);
 assert.equal(context.generalFollowup('Explain that more simply.','Liquidity describes readily available funds.'),true);
 assert.equal(context.generalFollowup('What is my balance?','Liquidity describes readily available funds.'),false);
 assert.equal(context.generalFollowup('Explain that more simply.',null),false);
 const {relevanceIssue}=require('../banking/agents/evidence'),facts=[{tool:'get_accounts',value:{}},{tool:'get_banking_context',value:{}}];
 assert.match(relevanceIssue('Show my liquidity projection and explain the general liquidity context.',facts),/liquidity scenario/);
});
test('Public background uses fixed primary-source topics without private messages or invented evidence',()=>{
 const request=context.requestFor({topic:'authorization',message:'private transaction 1099100101',company:'Private Supplier',balanceCents:123456});
 assert.equal(request.kind,'market');assert.equal(request.topic,'banking_background');assert.ok(request.query.length<1800);
 assert.doesNotMatch(JSON.stringify(request),/1099100101|Private Supplier|123456|private transaction/);assert.ok(request.allowedDomains.includes('mas.gov.sg'));
 assert.throws(()=>context.requestFor({topic:'ignore safeguards'}),e=>e.status===400);
 assert.ok(context.replyIssue('Your account balance is sufficient.'));assert.ok(context.replyIssue('I reviewed your transactions.'));assert.ok(context.replyIssue('The company is fully compliant.'));assert.ok(context.replyIssue('Liquidity means cash available for obligations [E1].'));
 assert.equal(context.replyIssue('Liquidity describes readily available funds for business obligations.'),null);
 assert.ok(context.replyIssue('Your interest rate is competitive [E1].',{hasEvidence:true}));assert.ok(context.replyIssue('Your current account balance is low.'));
});
pg('Stable banking concepts can receive a model explanation without inspecting unrelated accounts',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db),provider=model(async()=>({role:'assistant',content:'Liquidity describes the cash and readily available assets a business can use to meet its obligations.'}));
 const result=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'What is liquidity in business banking?'});
 assert.equal(result.answerContext,'general_banking');assert.equal(result.aiAudit.outcome,'general_banking_context');assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.deepEqual(result.steps,[]);assert.equal(result.evidenceReferences,undefined);assert.match(result.reply,/readily available/);
 let previousSeen=false;provider.chat=async messages=>{previousSeen=messages.some(m=>m.content.includes('Previous general banking explanation'));return {role:'assistant',content:'Liquidity means having readily available funds when a business needs to meet its obligations.'};};
 const followup=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'Explain that more simply.',previousRunId:result.runId});
 assert.equal(previousSeen,true);assert.equal(followup.answerContext,'general_banking');assert.equal(followup.narrativeWithheld,undefined,followup.narrativeIssue);assert.deepEqual(followup.steps,[]);
});
pg('General context cannot replace account evidence or extend the assistant to unrelated topics',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db),agents=createAgents({db:f.db,model:model(async()=>({role:'assistant',content:'Your account balance is SGD 999999.'}))});
 const result=await agents.execute(user,'assistant',{message:'What is my current account balance?'});
 assert.equal(result.answerContext,undefined);assert.equal(result.clarification,true);assert.doesNotMatch(result.reply,/999999/);assert.match(result.reply,/verified records were not retrieved/);
 const unrelated=await agents.execute(user,'assistant',{message:'What food should I eat?'});assert.equal(unrelated.answerContext,undefined);assert.match(unrelated.reply,/outside the scope/);
});
pg('Current general banking information uses cited public context and no account records',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db),requests=[];
 const provider=model(async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Review the public guidance on independent authorization and confirm the applicable requirements [E1].'}:tool('get_banking_context',{topic:'authorization'}));
 provider.research=async request=>{requests.push(request);return publicReport(request);};
 const result=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'What are current Singapore payment authorization requirements?'});
 assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.deepEqual(result.steps.map(s=>s.tool),['get_banking_context']);assert.equal(result.publicResearch.length,1);assert.equal(requests.length,1);assert.equal(result.aiAudit.outcome,'validated_evidence');assert.match(result.publicResearch[0].scope,/Public sources/);
 assert.equal((await f.db.query('SELECT context_json FROM agent_runs WHERE id=$1',[result.runId])).rows[0].context_json.generalBankingContext,null);
});

pg('A sourced stable explanation supports a simple follow-up without pretending its old citations are new evidence',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db);
 const provider=model(async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Liquidity describes readily available funds for business obligations [E1].'}:tool('get_banking_context',{topic:'liquidity'}));
 provider.research=async request=>publicReport(request);
 const agents=createAgents({db:f.db,model:provider}),first=await agents.execute(user,'assistant',{message:'What is liquidity in wholesale digital banking?'});
 const saved=(await f.db.query('SELECT context_json FROM agent_runs WHERE id=$1',[first.runId])).rows[0].context_json.generalBankingContext;
 assert.match(saved,/Liquidity describes/);assert.doesNotMatch(saved,/\[E1\]/);
 provider.chat=async()=>({role:'assistant',content:'Liquidity means having funds available when the business needs to pay its obligations.'});
 const next=await agents.execute(user,'assistant',{message:'Explain that more simply.',previousRunId:first.runId});
 assert.equal(next.answerContext,'general_banking');assert.equal(next.clarification,undefined);assert.equal(next.narrativeWithheld,undefined,next.narrativeIssue);assert.deepEqual(next.steps,[]);
});
pg('An unsafe general explanation is repaired or withheld and cannot invent a private account inspection',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db),provider=model(async()=>({role:'assistant',content:'I checked your account balance and your funds are sufficient.'}));
 const result=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'Explain liquidity in business banking.'});
 assert.equal(result.narrativeWithheld,true);assert.match(result.narrativeIssue,/general explanation|General background/);assert.doesNotMatch(result.reply,/funds are sufficient/);
});

pg('A request can combine owned balances with separate public context without sending balances to search',async t=>{
 const f=await fixture(t,{http:false}),user=await owner(f.db),requests=[];
 const provider=model(async messages=>{
  const names=messages.filter(m=>m.role==='tool').map(m=>m.tool_name);
  return !names.includes('get_accounts')?tool('get_accounts'):!names.includes('get_banking_context')?tool('get_banking_context',{topic:'liquidity'}):{role:'assistant',content:'Your current balances are shown below; general liquidity guidance explains why scheduled obligations also matter [E1] [E2].'};
 });
 provider.research=async request=>{requests.push(request);return publicReport(request);};
 const result=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'Show my current balances and explain the general liquidity context.'});
 assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.equal(result.answerContext,undefined);assert.deepEqual(result.steps.map(s=>s.tool),['get_accounts','get_banking_context']);assert.equal(result.publicResearch.length,1);
 assert.doesNotMatch(JSON.stringify(requests),/balance_cents|accountNumber|Show my|current balances|1020001001/);
});
