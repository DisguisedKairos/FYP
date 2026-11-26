'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const response=require('../banking/agents/response'),{createOpenAIModel}=require('../banking/agents/openai');
const {createAgents}=require('../banking/agents'),{fixture}=require('./dft-helpers');
const tools=['get_accounts','get_schedules','get_banking_context','get_finance_report','search_transactions','project_liquidity','analyze_news_insights'];
const answer=(mode,reply,requiredTools=[],requiresResearch=false)=>response.parse(JSON.stringify({mode,reply,requiredTools,requiresResearch}),tools);
const call=(name,args={})=>({role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]});
const provider=chat=>({mode:'openai',model:'gpt-6-luna',inspect:async()=>({available:true}),chat});
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async db=>(await db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];

test('Semantic responses validate routing metadata without granting tools or accepting malformed output',()=>{
 const format=response.format(tools);assert.equal(format.strict,true);assert.equal(format.schema.additionalProperties,false);
 const base={mode:'banking_evidence',reply:'Review the owned records [E1].',requiredTools:['get_accounts'],requiresResearch:false};
 for(const value of [{...base,mode:'admin'},{...base,requiredTools:[]},{...base,requiredTools:['execute_payment']},{...base,requiredTools:['get_accounts','get_accounts']},{...base,mode:'general_banking'},{...base,mode:'clarification'},{...base,requiresResearch:'false'},{...base,permission:'admin'},{...base,reply:''},null,[]])assert.throws(()=>response.parse(JSON.stringify(value),tools),e=>e.status===503);
 assert.throws(()=>response.parse('not JSON',tools),e=>e.status===503);
 assert.equal(answer('general_banking','Available cash helps a business meet its obligations.').intent.mode,'general_banking');
});

test('Semantic task checks require every interpreted tool and current sources; explanations do not need private projections',()=>{
 const intent=answer('banking_evidence','Review the evidence.',['get_accounts','get_schedules']).intent;
 assert.match(response.issue(intent,[{tool:'get_accounts'}]),/get_schedules/);
 assert.equal(response.issue(intent,[{tool:'get_accounts'},{tool:'get_schedules'}]),null);
 assert.match(response.issue(answer('general_banking','Current requirements need sources.',[],true).intent,[]),/current public sources/);
 assert.match(response.issue(answer('general_banking','General banking background.').intent,[{tool:'get_accounts'}]),/private records/);
 const {relevanceIssue}=require('../banking/agents/evidence');
 assert.equal(relevanceIssue('Outline the cash flow implications of current industry news.',[{tool:'get_banking_context'}],answer('general_banking','Public background.',['get_banking_context'],true).intent),null);
 assert.match(relevanceIssue('How much is there and what is due?',[{tool:'get_accounts'}],intent),/get_schedules/);
 assert.deepEqual(response.readContext(['get_finance_report','prepare_payment_draft','get_finance_report','flag_transaction_for_review','get_banking_context']),['get_finance_report']);
 assert.deepEqual(response.readContext({tool:'get_accounts'}),[]);
 assert.deepEqual(response.readContext(['search_transactions','get_company_activity','assess_counterparty_risk','project_liquidity']),[]);
});

test('OpenAI uses the structured format alongside function calling and validates the final response',async()=>{
 let calls=0;
 const model=createOpenAIModel({apiKey:'test-only-openai-key-not-a-real-secret',fetchImpl:async(_url,options)=>{
  const body=JSON.parse(options.body);assert.deepEqual(body.text.format,response.format(tools));assert.equal(body.store,false);calls++;
  return new Response(JSON.stringify({id:'resp_intent',status:'completed',model:'gpt-6-luna',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({mode:'general_banking',requiresResearch:false,requiredTools:[],reply:'Cash availability describes funds ready for business obligations.'})}]}]}));
 }});
 const result=await model.chat([{role:'user',content:'cash availability confuses me'}],[],{answerFormat:response.format(tools)});
 assert.equal(calls,1);assert.equal(result.intent.mode,'general_banking');assert.match(result.content,/Cash availability/);assert.doesNotMatch(result.content,/requiredTools/);
 const bad=createOpenAIModel({apiKey:'test-only-openai-key-not-a-real-secret',fetchImpl:async()=>new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'A plain response without metadata.'}]}]}))});
 await assert.rejects(bad.chat([],[],{answerFormat:response.format(tools)}),e=>e.status===503);
});

pg('Unlisted general phrasings and conceptual follow-ups use semantic intent rather than phrase allowlists',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db),before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 let previousSeen=false;
 const model=provider(async messages=>{previousSeen=messages.some(m=>m.role==='assistant'&&m.content.includes('Previous general banking explanation'));return answer('general_banking','Ready cash helps a business meet obligations when they fall due.');});
 const agents=createAgents({db:f.db,model});let previousRunId;
 for(const message of ['I get mixed up about cash availability versus profitability, could you unpack it?','put it in everyday words for me now please','liqudity vs profit, whats the difference?']){
  const result=await agents.execute(user,'assistant',{message,...(previousRunId?{previousRunId}:{})});
  assert.equal(result.answerContext,'general_banking');assert.equal(result.clarification,undefined);assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.deepEqual(result.steps,[]);assert.equal(result.aiAudit.intent.mode,'general_banking');if(previousRunId)assert.equal(previousSeen,true);previousRunId=result.runId;
 }
 assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);
});

pg('Natural wording still retrieves owned account evidence and does not treat an earlier explanation as account facts',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db);
 const agents=createAgents({db:f.db,model:provider(async messages=>messages.some(m=>m.role==='tool')?answer('banking_evidence','The funds in your owned accounts are shown below [E1].',['get_accounts']):call('get_accounts'))});
 const result=await agents.execute(user,'assistant',{message:'How much have I got available right now?'});
 assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.equal(result.answerContext,undefined);assert.deepEqual(result.steps.map(s=>s.tool),['get_accounts']);assert.ok(result.items.some(i=>typeof i.amountCents==='number'));
});

pg('A paraphrased historical account enquiry uses the supplied dates even without the balance keyword',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db);
 const agents=createAgents({db:f.db,model:provider(async messages=>messages.some(m=>m.role==='tool')?answer('banking_evidence','The historical opening and closing positions are shown below [E1].',['get_accounts']):call('get_accounts'))});
 const result=await agents.execute(user,'assistant',{message:'How much did I have from 2026-11-01 to 2026-11-25?'});
 assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.ok(result.items.some(i=>i.title==='Historical balance period'&&i.detail.includes('2026-11-01 to 2026-11-25')));assert.ok(result.items.some(i=>i.title==='Closing balance across your accounts'));
});

pg('A natural read-only follow-up retrieves a fresh report rather than reusing old financial evidence',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db),now=()=>Date.parse('2026-11-27T05:00:00Z');let seen=false;
 const agents=createAgents({db:f.db,now,model:provider(async messages=>{
  seen=messages.some(m=>m.role==='assistant'&&m.content.startsWith('Previous read-only enquiry tools: get_finance_report.'));
  return messages.some(m=>m.role==='tool')?answer('banking_evidence','The requested period report is shown below [E1].',['get_finance_report']):call('get_finance_report');
 })});
 const first=await agents.execute(user,'assistant',{message:'Summarize money coming in and going out this month.'});assert.equal(first.financeReport.period.from,'2026-11-01');
 const next=await agents.execute(user,'assistant',{message:'and what about last month?',previousRunId:first.runId});
 assert.equal(seen,true);assert.equal(next.financeReport.period.from,'2026-10-01');assert.equal(next.financeReport.period.to,'2026-10-31');assert.deepEqual(next.steps.map(s=>s.tool),['get_finance_report']);
 const saved=(await f.db.query('SELECT context_json FROM agent_runs WHERE id=$1',[next.runId])).rows[0].context_json;
 assert.deepEqual(saved.lastReadTools,['get_finance_report']);assert.doesNotMatch(JSON.stringify(saved),/Summarize money|what about|balanceCents/);
});

pg('A semantic interpretation cannot finish a mixed enquiry with only some required evidence',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db);
 const agents=createAgents({db:f.db,model:provider(async messages=>messages.some(m=>m.role==='tool')?answer('banking_evidence','Your records are shown below [E1].',['get_accounts','get_schedules']):call('get_accounts'))});
 const result=await agents.execute(user,'assistant',{message:'What have I got available and what instructions are coming due?'});
 assert.equal(result.narrativeWithheld,true);assert.match(result.narrativeIssue,/get_schedules/);
});

pg('Clarifications ask for missing details in natural language while fabricated balances remain withheld',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db);
 const agents=createAgents({db:f.db,model:provider(async()=>answer('clarification','Which public company should I research? Please include its full name.'))});
 const result=await agents.execute(user,'assistant',{message:'Could you dig into a business for me?'});
 assert.equal(result.clarification,true);assert.match(result.reply,/Which public company/);assert.doesNotMatch(result.reply,/not retrieved|outside the scope/);
 const unsafe=createAgents({db:f.db,model:provider(async()=>answer('general_banking','Your current account balance is low.'))});
 const withheld=await unsafe.execute(user,'assistant',{message:'Help me understand ready cash.'});assert.equal(withheld.narrativeWithheld,true);assert.doesNotMatch(withheld.reply,/balance is low/);
 for(const prose of ['You have enough cash to pay.','Your business can afford the payment.'])assert.ok(require('../banking/agents/banking-context').replyIssue(prose));
});

pg('News advisory tools are available for natural requests without triggering a keyword pattern',async t=>{
 const f=await fixture(t,{http:false}),user=await actor(f.db);let available=false;
 const agents=createAgents({db:f.db,model:provider(async(_messages,schemas)=>{available=schemas.some(s=>s.function.name==='analyze_news_insights');return answer('clarification','Which development would you like me to research and relate to your business?');})});
 await agents.execute(user,'assistant',{message:'What does all that happening out there mean for us?'});assert.equal(available,true);
});
