'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const news=require('../banking/news-insights'),{createOpenAIModel}=require('../banking/agents/openai'),{createAgents}=require('../banking/agents');
const {fixture}=require('./dft-helpers'),{relevanceIssue}=require('../banking/agents/evidence');
const NOW=Date.parse('2026-11-12T04:00:00Z'),now=()=>NOW,modelName='gpt-6-luna';
const TEXT='An official industry advisory describes a cyber incident affecting supplier operations. Its publication date needs independent confirmation. Company source';
function report(kind='market'){return {status:'ready',kind,title:'Industry news: technology and software',checkedAt:new Date(NOW).toISOString(),parts:[{text:TEXT,annotations:[{url:'https://www.csa.gov.sg/',title:'Official cyber advisory',start:TEXT.indexOf('Company source'),end:TEXT.length}]}],sources:[{url:'https://www.csa.gov.sg/',title:'Official cyber advisory'}]};}
function reply(input,{flag='human_review'}={}){return {tool_calls:[{function:{name:'submit_news_advisory',arguments:{summary:'Review the operational implications and source limitations before deciding on next steps.',insights:[{headline:'Supplier cyber disruption deserves attention',category:'cybersecurity',flag,why:'The retrieved advisory describes an operational concern. A human should confirm the affected entity and current source before applying it to the business.',evidence:[{partId:input.parts[0].partId,quote:'a cyber incident affecting supplier operations'}],actions:['verify_source','verify_identity','review_cybersecurity']}]}}}],modelResponse:{provider:'openai',model:modelName}};}
function provider({failOfficial=false,failAdvice=false,firstTool='get_market_insights',afterAdvice}={}){return {mode:'openai',model:modelName,inspect:async()=>({available:true}),chat:async messages=>{
 const calls=messages.filter(m=>m.role==='tool');
 if(calls.some(m=>m.tool_name==='analyze_news_insights'))return {role:'assistant',content:'Review the sourced business implications and independent checks [E2].'};
 const name=calls.length?'analyze_news_insights':firstTool;
 return {role:'assistant',content:'',tool_calls:[{function:{name,arguments:name==='get_market_insights'?{topic:'industry'}:{}}}]};
 },research:async request=>{if(failOfficial&&request.kind==='counterparty_sanctions')throw Error('Controlled official-search failure');return {...report(request.kind),title:request.title};},assessNews:async input=>{if(failAdvice)throw Error('Controlled provider outage');const result=news.validate(reply(input),input);await afterAdvice?.();return result;}};}
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async db=>(await db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];
async function financial(db){return {accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT id,status,amount_cents FROM transactions ORDER BY id')).rows,cases:(await db.query('SELECT * FROM fraud_cases ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows};}

test('News advice intent distinguishes public implications from private fraud checks and fictional sector cases',()=>{
 for(const text of ['Show current news for my industry and advise what to flag','What risks does the latest company news suggest?','Give me industry insights','Review news and recommendations for suppliers'])assert.equal(news.requested(text),true,text);
 for(const text of ['Hello','Show my balances','Check my transactions for fraud using daily market trends','Evaluate reputation and money risk of my demo companies across sectors','Show latest Singapore market news'])assert.equal(news.requested(text),false,text);
 assert.ok(relevanceIssue('Show industry news and advise what to flag',[{tool:'get_market_insights'}]));
 assert.equal(relevanceIssue('Show industry news and advise what to flag',[{tool:'get_market_insights'},{tool:'analyze_news_insights'}]),null);
});
test('Public news implications do not require private projections, while explicit account questions still do',()=>{
 const sources=[{tool:'get_market_insights'},{tool:'analyze_news_insights'}];
 for(const message of ['Show current industry news and advise on liquidity risks','Review current news and its cash flow implications','Review current news and its cash-flow effects','Explain news impacts on industry liquidity','Read news and explain implications for cash flow'])assert.equal(relevanceIssue(message,sources),null,message);
 for(const message of ['Read news and check my cash flow','Show current news and project my liquidity','Show news and assess my business liquidity risks','Read news and also show my balances','Explain news liquidity risks and project cash flow','Explain news cash flow implications and whether I can cover upcoming payments'])assert.ok(relevanceIssue(message,sources),message);
 assert.ok(relevanceIssue('Show liquidity risks',[{tool:'get_market_insights'}]));
 assert.equal(relevanceIssue('Read news and check my cash flow',[...sources,{tool:'get_finance_report'}]),null);
});
test('Chat-only news advice rejects invented staff notifications and review cases in every prose field',()=>{
 const input=news.prepare([report()],{now});
 for(const claim of ['I have notified the bank staff and opened a review case.','The staff case has been created and queued for investigation.','A review case was opened.','The compliance team has been notified.','I have alerted the reviewers.']){
  for(const field of ['summary','headline','why']){
   const value=reply(input),body=value.tool_calls[0].function.arguments;
   if(field==='summary')body.summary=claim;else body.insights[0][field]=claim;
   assert.throws(()=>news.validate(value,input),e=>e.code==='NEWS_ADVISORY_INVALID',field+': '+claim);
  }
 }
 const valid=reply(input);valid.tool_calls[0].function.arguments.summary='Ask your compliance team to review the source before deciding whether to open a case.';
 assert.equal(news.validate(valid,input).status,'completed');
});
test('News analysis uses only fresh cited public text and reports omitted parts and unavailable checks',()=>{
 const source={...report(),privateBalance:987654321,privateAccount:'1088800101'},input=news.prepare([source],{now,gaps:['counterparty_sanctions','private data']});
 assert.doesNotMatch(JSON.stringify(input),/987654321|1088800101|privateBalance|privateAccount/);assert.deepEqual(input.coverageGaps,['counterparty_sanctions']);assert.equal(input.parts.length,1);
 for(const changed of [{checkedAt:'bad'},{checkedAt:new Date(NOW-300001).toISOString()},{checkedAt:new Date(NOW+60001).toISOString()},{status:'unavailable'},{parts:[{text:TEXT,annotations:[]}]}])assert.throws(()=>news.prepare([{...report(),...changed}],{now}),e=>e.status===409);
 assert.throws(()=>news.prepare([],{now}),e=>e.status===409);
 const many={...report(),parts:Array.from({length:10},()=>report().parts[0])};const limited=news.prepare([many],{now});assert.equal(limited.parts.length,8);assert.equal(limited.omittedParts,2);
});
test('Advisory grades require exact retrieved evidence and supported independent checks, without safe-payment claims',()=>{
 const input=news.prepare([report()],{now});
 for(const flag of ['watch','human_review','insufficient_evidence']){const result=news.validate(reply(input,{flag}),input);assert.equal(result.insights[0].flag,flag);assert.deepEqual(result.actions,[]);assert.equal(result.insights[0].evidence[0].sources[0].url,'https://www.csa.gov.sg/');}
 for(const mutate of [r=>r.tool_calls[0].function.arguments.insights[0].evidence[0].quote='Invented source claim about a company',r=>r.tool_calls[0].function.arguments.insights[0].evidence[0].partId='R9P9',r=>r.tool_calls[0].function.arguments.insights[0].actions=['approve_payment'],r=>r.tool_calls[0].function.arguments.insights[0].flag='safe',r=>r.tool_calls[0].function.arguments.insights[0].why='The business is cleared and safe to pay.',r=>r.tool_calls[0].function.arguments.summary='I have approved the payment.',r=>r.tool_calls[0].function.arguments.insights[0].why='The expected loss is SGD 100.',r=>r.tool_calls[0].function.arguments.extra=true]){const value=reply(input);mutate(value);assert.throws(()=>news.validate(value,input),e=>e.code==='NEWS_ADVISORY_INVALID');}
});
test('The actual OpenAI adapter requests a strict isolated advisory schema with storage disabled',async()=>{
 const input=news.prepare([report()],{now});let captured;
 const model=createOpenAIModel({model:modelName,apiKey:'test-only-news-key-not-a-real-secret',fetchImpl:async(_url,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',model:modelName,id:'resp_news_advice',output:[{type:'function_call',call_id:'call_news',name:'submit_news_advisory',arguments:JSON.stringify(reply(input).tool_calls[0].function.arguments)}]}));}});
 const output=await model.assessNews(input);assert.equal(output.insights.length,1);assert.equal(captured.store,false);assert.equal(captured.tool_choice,'required');assert.equal(captured.tools[0].name,'submit_news_advisory');assert.equal(captured.tools[0].strict,true);assert.equal(captured.previous_response_id,undefined);assert.ok(captured.tools.every(t=>t.type==='function'));assert.equal(captured.tools[0].parameters.additionalProperties,false);
});
pg('Industry news maps only the signed-in profile to a generic sector without disclosing private details',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);
 await f.db.query("UPDATE businesses SET industry='Technology and software; private 9988776655' WHERE primary_user_id=$1",[user.id]);
 const request=await news.industryRequest(f.db,user,{now});assert.match(request.query,/technology and software/);assert.match(request.query,/2026-11-12/);assert.doesNotMatch(JSON.stringify(request),/9988776655|private|legalName|registeredAddress|balanceCents/);
 const sector=await news.industryRequest(f.db,(await f.db.query("SELECT * FROM users WHERE email='jamie@greenlink.demo'")).rows[0],{now});assert.doesNotMatch(sector.query,/9988776655/);
 assert.throws(()=>news.prepare([report()],{now:()=>NOW+300001}),e=>e.status===409);
});
pg('The assistant returns sourced chat-only advice, records model audit and does not alter payments or cases',async t=>{
 const f=await fixture(t,{now,agentModel:provider()}),client=f.client();await client.login();const before=await financial(f.db);
 const response=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Show current news for my industry and advise what to flag. Private marker 9988776655.'}});
 assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.newsInsights.status,'completed');assert.equal(response.data.newsInsights.insights[0].flag,'human_review');assert.equal(response.data.publicResearch.length,1);assert.equal(response.data.narrativeWithheld,undefined);assert.deepEqual(response.data.actions,[]);assert.deepEqual(await financial(f.db),before);
 const audits=(await f.db.query("SELECT metadata FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'phase'='news_advisory_evaluation'")).rows;assert.equal(audits.length,1);assert.equal(audits[0].metadata.status,'completed');
 assert.equal((await client.request('/api/agents/assistant',{method:'POST',csrf:false,body:{message:'Show industry insights'}})).status,403);
});
pg('Partial counterparty research preserves official-source gaps in advice without a second search',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),model=provider({firstTool:'scan_counterparty_news',failOfficial:true});let searches=0;const original=model.research;model.research=async request=>{searches++;return original(request);};
 const result=await createAgents({db:f.db,now,model}).execute(user,'assistant',{message:'Scan news for my counterparties and advise what concerns to flag'});
 assert.equal(searches,2);assert.equal(result.counterpartyScan.status,'partial');assert.deepEqual(result.newsInsights.coverageGaps,['counterparty_sanctions']);assert.equal(result.newsInsights.insights.length,1);
});
pg('Missing research and failed AI advice do not fabricate a briefing or mutate financial controls',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),before=await financial(f.db);
 await assert.rejects(createAgents({db:f.db,now,model:provider({firstTool:'analyze_news_insights'})}).execute(user,'assistant',{message:'Show industry news and advise what to flag'}),e=>e.status===409);
  const forbidden=provider();forbidden.chat=async()=>({role:'assistant',content:'',tool_calls:[{function:{name:'flag_transaction_for_review',arguments:{transactionId:'not-a-payment',signalCode:'recorded_risk'}}}]});
  await assert.rejects(createAgents({db:f.db,now,model:forbidden}).execute(user,'assistant',{message:'Read current news and advise whether suspicious payments should be flagged'}),e=>e.status===400&&/chat-only advisory/.test(e.message));
 await assert.rejects(createAgents({db:f.db,now,model:provider({failAdvice:true})}).execute(user,'assistant',{message:'Show industry news and advise what to flag'}));
 assert.deepEqual(await financial(f.db),before);assert.equal((await f.db.query("SELECT count(*)::int AS count FROM agent_runs WHERE status='completed'")).rows[0].count,0);
 assert.equal((await f.db.query("SELECT count(*)::int AS count FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'phase'='news_advisory_evaluation' AND metadata->>'status'='failed'")).rows[0].count,1);
});
pg('Revoked authorization during news advice cannot return a completed report',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),model=provider({afterAdvice:()=>f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id])});
 await assert.rejects(createAgents({db:f.db,now,model}).execute(user,'assistant',{message:'Show industry news and advise what to flag'}),e=>e.status===409);
 assert.equal((await f.db.query("SELECT count(*)::int AS count FROM agent_runs WHERE status='completed'")).rows[0].count,0);
});
test('Chat advisory cards show prominent citations, practical checks and escaped public text',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../public/js/public-research.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const context={esc,fullDate:v=>v,URL};vm.runInNewContext(source+';globalThis.render=publicResearchHtml;',context);
 const result=news.validate(reply(news.prepare([report()],{now})),news.prepare([report()],{now}));result.insights[0].headline='<img src=x onerror=alert(1)>';const html=context.render({newsInsights:result});assert.match(html,/Consider human review/);assert.match(html,/independent trusted|operational safeguards/);assert.match(html,/class="news-insight-source"/);assert.match(html,/https:\/\/www.csa.gov.sg\//);assert.match(html,/Chat-only advisory flags/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/noopener noreferrer/);
});
