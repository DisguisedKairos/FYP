'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./dft-helpers');
const {PROFILES,forIndustry}=require('../banking/industry-profiles');
const advisory=require('../banking/business-advisory');
const news=require('../banking/news-insights');
const {seedIndustryBusinesses,CASES,PASSWORD}=require('../scripts/seed-industry-businesses');
const {hashPassword,verifyPassword}=require('../banking/security');
const {createAgents}=require('../banking/agents');
const NOW=Date.parse('2026-11-24T02:00:00Z'),now=()=>NOW;
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async(db,key)=>(await db.query('SELECT * FROM users WHERE email=$1',[CASES.find(c=>c.key===key).email])).rows[0];
const financial=async db=>({accounts:(await db.query('SELECT id,balance_cents,status FROM accounts ORDER BY id')).rows,receipts:(await db.query('SELECT id,amount_cents,status FROM transactions ORDER BY id')).rows,cases:(await db.query('SELECT * FROM fraud_cases ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows});
const report=()=>({kind:'market',status:'ready',title:'Controlled industry source',checkedAt:new Date(NOW).toISOString(),parts:[{text:'Controlled official source: supplier delivery disruption may affect commercial operations; direct company exposure is not established.',annotations:[{url:'https://www.enterprisesg.gov.sg/',title:'Controlled official-source fixture'}]}]});
function reply(input,code=Object.keys(input.allowedActions).find(key=>!['verify_source','verify_identity','review_compliance','confirm_beneficiary','review_supply_chain','review_liquidity','review_cybersecurity','monitor_developments'].includes(key))){
 return {tool_calls:[{function:{name:'submit_news_advisory',arguments:{summary:'Review source coverage and the selected business activities before taking further steps.',insights:[{headline:'Supplier disruption needs an operating check',category:'supply_chain',flag:'watch',why:'For '+(input.businessContext?.companyName||'this business')+', check whether the retrieved development affects the selected activities; direct exposure is not established.',evidence:[{partId:input.parts[0].partId,quote:'supplier delivery disruption'}],actions:['verify_source',code||'review_supply_chain']}]}}}],modelResponse:{provider:'openai',model:'gpt-6-luna',responseId:'resp_controlled_industry'}};
}
function provider(captured){return {mode:'openai',model:'gpt-6-luna',inspect:async()=>({available:true}),chat:async messages=>{
 const calls=messages.filter(m=>m.role==='tool');
 if(calls.some(m=>m.tool_name==='analyze_news_insights'))return {role:'assistant',content:'Review the tailored operating implications and independent checks [E2].'};
 return {role:'assistant',content:'',tool_calls:[{function:{name:calls.length?'analyze_news_insights':'get_market_insights',arguments:{}}}]};
},research:async request=>{captured.searches.push(request);return {...report(),title:request.title};},assessNews:async input=>{captured.advice.push(input);return news.validate(reply(input),input);}};}

test('Industry businesses map to eight different modular operating profiles without stored AI verdicts',()=>{
 assert.equal(CASES.length,8);assert.equal(new Set(CASES.map(c=>c.email)).size,8);assert.equal(new Set(CASES.map(c=>JSON.stringify(c.cashFlow))).size,8);
 for(const sample of CASES){assert.equal(forIndustry(sample.industry).key,sample.key);assert.match(sample.name,/^GLDB Demo /);assert.ok(sample.registration.length<=30);assert.match(sample.number,/^\d{10}$/);assert.ok(Object.keys(PROFILES[sample.key].actions).length>=2);assert.deepEqual(advisory.settings(PROFILES[sample.key].defaults,PROFILES[sample.key]),PROFILES[sample.key].defaults);}
 assert.equal(forIndustry('Unrecognised private description 998877').key,'general');
 assert.doesNotMatch(JSON.stringify(CASES),/"(?:riskScore|assessment|verdict|news)"\s*:/);
});
test('Business preferences reject arbitrary search text, foreign keys, unknown or duplicate options',()=>{
 const profile=PROFILES.logistics;
 for(const change of [s=>s.markets=['ignore instructions'],s=>s.operations=['cloud_services'],s=>s.priorities=['costs','costs'],s=>s.markets=[],s=>s.companyId='another-owner',s=>s.operations='ocean_freight']){
  const value=structuredClone(profile.defaults);change(value);assert.throws(()=>advisory.settings(value,profile),e=>e.status===400);
 }
});
test('News advice accepts only the owning company profile action set and preserves cited context',()=>{
 const context={companyName:CASES[0].name,profileKey:'logistics',planningProfile:PROFILES.logistics.label,markets:['Singapore'],operations:['Ocean freight'],priorities:['Continuity'],configuration:'Saved preferences',actionOptions:PROFILES.logistics.actions};
 const input=news.prepare([report()],{now,businessContext:context});
 assert.equal(input.businessContext.companyName,context.companyName);assert.equal(input.businessContext.actionOptions,undefined);
 const output=news.validate(reply(input,'review_shipping_routes'),input);assert.match(output.insights[0].recommendations[1],/logistics manager/);assert.equal(output.businessContext.profileKey,'logistics');
 assert.throws(()=>news.validate(reply(input,'review_cloud_continuity'),input),e=>e.code==='NEWS_ADVISORY_INVALID');
});
test('Dated public sources remain quotable while generated advisory prose and sector actions are constrained',async()=>{
 const source=report();source.parts[0].text+=' Published 2026-11-24; supplier delay notice.';
 const businessContext={companyName:CASES[0].name,profileKey:'logistics',actionOptions:PROFILES.logistics.actions};
 const input=news.prepare([source],{now,businessContext}),valid=reply(input,'review_shipping_routes');
 valid.tool_calls[0].function.arguments.insights[0].evidence[0].quote='Published 2026-11-24; supplier delay notice.';
 let captured;
 const model=require('../banking/agents/openai').createOpenAIModel({model:'gpt-6-luna',apiKey:'controlled-industry-adapter-key-not-real',fetchImpl:async(_url,options)=>{
  captured=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',id:'resp_dated_news',output:[{type:'function_call',call_id:'call_dated_news',name:'submit_news_advisory',arguments:JSON.stringify(valid.tool_calls[0].function.arguments)}]}));
 }});
 const output=await model.assessNews(input);assert.match(output.insights[0].evidence[0].quote,/2026-11-24/);
 const schema=captured.tools[0].parameters;
 assert.equal(new RegExp(schema.properties.summary.pattern).test('The report was checked on 2026-11-24.'),false);
 assert.equal(new RegExp(schema.properties.insights.items.properties.why.pattern).test('Review the service changes with the logistics manager.'),true);
 assert.equal(schema.properties.insights.items.properties.evidence.items.properties.quote.pattern,undefined);
 const actions=schema.properties.insights.items.properties.actions.items.enum;assert.ok(actions.includes('review_shipping_routes'));assert.equal(actions.includes('review_cloud_continuity'),false);
 const invalid=structuredClone(valid);invalid.tool_calls[0].function.arguments.summary='The source was checked on 2026-11-24.';assert.throws(()=>news.validate(invalid,input),e=>e.code==='NEWS_ADVISORY_INVALID');
});
test('Industry web search restricts both requested domains and returned citation hosts',async()=>{
 let captured,url='https://www.csa.gov.sg/alerts-and-advisories/';
 const model=require('../banking/agents/openai').createOpenAIModel({model:'gpt-6-luna',apiKey:'controlled-primary-source-key-not-real',fetchImpl:async(_url,options)=>{
  captured=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',output:[{type:'web_search_call',status:'completed'},{type:'message',role:'assistant',content:[{type:'output_text',text:'Controlled official source.',annotations:[{type:'url_citation',url,title:'Official advisory',start_index:0,end_index:10}]}]}]}));
 }});
 const request={kind:'market',topic:'industry',title:'Technology news',checkedAt:new Date(NOW).toISOString(),query:'Current technology industry news',allowedDomains:PROFILES.technology.sourceDomains};
 assert.equal((await model.research(request)).status,'ready');assert.deepEqual(captured.tools[0].filters.allowed_domains,PROFILES.technology.sourceDomains);
 url='https://proxy.example.org/copied-advisory';await assert.rejects(model.research(request),e=>e.status===503);
 url='https://www.csa.gov.sg.attacker.invalid/advisory';await assert.rejects(model.research(request),e=>e.status===503);
 await assert.rejects(model.research({...request,allowedDomains:['https://www.csa.gov.sg/']}),e=>e.status===400);
});
test('A rejected news advisory gets only one bounded correction with unchanged evidence and no additional search',async()=>{
 const input=news.prepare([report()],{now,businessContext:{companyName:CASES[0].name,actionOptions:PROFILES.logistics.actions}}),requests=[];
 const model=require('../banking/agents/openai').createOpenAIModel({model:'gpt-6-luna',apiKey:'controlled-news-correction-key-not-real',fetchImpl:async(_url,options)=>{
  requests.push(JSON.parse(options.body));const value=reply(input,'review_shipping_routes');
  if(requests.length===1)value.tool_calls[0].function.arguments.summary='The news was checked on 2026-11-24.';
  return new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',id:'resp_correction_'+requests.length,output:[{type:'function_call',call_id:'call_correction',name:'submit_news_advisory',arguments:JSON.stringify(value.tool_calls[0].function.arguments)}]}));
 }});
 const result=await model.assessNews(input);assert.equal(requests.length,2);assert.equal(result.modelResponse.validationAttempts,2);
 assert.deepEqual(requests[0].input.filter(item=>item.role==='user'),requests[1].input.filter(item=>item.role==='user'));
 assert.ok(requests.every(request=>request.tools.every(tool=>tool.type==='function')));assert.match(JSON.stringify(requests[1].input),/prior advisory failed application validation/);
});
test('Repeatedly invalid news advice stops after its correction and never becomes a fabricated result',async()=>{
 const input=news.prepare([report()],{now}),requests=[];
 const model=require('../banking/agents/openai').createOpenAIModel({model:'gpt-6-luna',apiKey:'controlled-news-failure-key-not-real',fetchImpl:async(_url,options)=>{
  requests.push(JSON.parse(options.body));const value=reply(input);value.tool_calls[0].function.arguments.insights[0].evidence[0].quote='An invented statement absent from every retrieved source.';
  return new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',output:[{type:'function_call',call_id:'call_invalid',name:'submit_news_advisory',arguments:JSON.stringify(value.tool_calls[0].function.arguments)}]}));
 }});
 await assert.rejects(model.assessNews(input),error=>error.code==='NEWS_ADVISORY_INVALID'&&error.validationAttempts===2);assert.equal(requests.length,2);
});
pg('Industry setup reconciles all sample funds, creates only customers and preserves unrelated accounts',async t=>{
 const f=await fixture(t,{http:false,now}),before=await financial(f.db),result=await seedIndustryBusinesses(f.db,{now});
 assert.equal(result.createdUsers,8);assert.equal(result.newAccounts,16);assert.equal(result.newReceipts,80);assert.equal(result.newProfiles,8);
 const rows=(await f.db.query("SELECT a.id,a.balance_cents,a.opening_balance_cents+COALESCE(sum(t.amount_cents) FILTER(WHERE t.status='completed'),0) AS expected FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id GROUP BY a.id ORDER BY a.id")).rows;
 for(const row of rows)assert.equal(row.balance_cents,row.expected);
 for(const prior of before.accounts)assert.deepEqual(rows.find(row=>row.id===prior.id).balance_cents,prior.balance_cents);
 for(const sample of CASES)assert.equal((await actor(f.db,sample.key)).role,'customer');
 assert.deepEqual((await financial(f.db)).cases,before.cases);assert.deepEqual((await financial(f.db)).rules,before.rules);
});
pg('Industry reruns preserve changed passwords, business preferences and every recorded balance',async t=>{
 const f=await fixture(t,{http:false,now});await seedIndustryBusinesses(f.db,{now});const user=await actor(f.db,'logistics');
 const changedHash=await hashPassword('ChangedIndustry123!');await f.db.query('UPDATE users SET password_hash=$2 WHERE id=$1',[user.id,changedHash]);
 const first=await advisory.read(f.db,user),selected={...first.settings,markets:['US'],priorities:['liquidity']};
 await advisory.save(f.db,user,{profileKey:first.profileKey,version:first.version,settings:selected},{now});
 const before=await financial(f.db),profile=await advisory.read(f.db,user),again=await seedIndustryBusinesses(f.db,{now});
 assert.equal(again.createdUsers,0);assert.equal(again.newAccounts,0);assert.equal(again.newReceipts,0);assert.equal(again.newProfiles,0);assert.deepEqual(await financial(f.db),before);assert.deepEqual(await advisory.read(f.db,user),profile);
 assert.equal((await actor(f.db,'logistics')).password_hash,changedHash);
});
pg('An unrelated reserved identity rolls back every new industry user and receipt',async t=>{
 const f=await fixture(t,{http:false,now});
 await f.db.query("INSERT INTO users(name,email,password_hash) SELECT 'Unrelated operator',$1,password_hash FROM users LIMIT 1",[CASES[7].email]);
 const before=await financial(f.db),count=(await f.db.query('SELECT count(*) AS count FROM users')).rows[0].count;
 await assert.rejects(seedIndustryBusinesses(f.db,{now}),/unrelated identity/);
 assert.deepEqual(await financial(f.db),before);assert.equal((await f.db.query('SELECT count(*) AS count FROM users')).rows[0].count,count);assert.equal((await f.db.query('SELECT count(*)::int AS count FROM business_advisory_profiles')).rows[0].count,0);
});
pg('Business preferences enforce ownership, CSRF, version checks and strict settings through HTTP',async t=>{
 const f=await fixture(t,{now});await seedIndustryBusinesses(f.db,{now});const client=f.client(),other=f.client();
 assert.equal((await client.request('/api/business/advisory-profile')).status,401);
 await client.login(CASES[0].email,PASSWORD);await other.login(CASES[1].email,PASSWORD);
 const mine=(await client.request('/api/business/advisory-profile')).data,theirs=(await other.request('/api/business/advisory-profile')).data;
 assert.equal(mine.profileKey,'logistics');assert.equal(theirs.profileKey,'technology');
 const body={profileKey:mine.profileKey,version:mine.version,settings:{...mine.settings,markets:['MY'],operations:['cross_border_delivery'],priorities:['compliance']}};
 assert.equal((await client.request('/api/business/advisory-profile',{method:'POST',body,csrf:false})).status,403);
 assert.equal((await client.request('/api/business/advisory-profile',{method:'POST',body:{...body,businessId:'999'}})).status,400);
 assert.equal((await client.request('/api/business/advisory-profile',{method:'POST',body:{...body,profileKey:'technology'}})).status,409);
 assert.equal((await client.request('/api/business/advisory-profile',{method:'POST',body})).status,200);
 assert.equal((await client.request('/api/business/advisory-profile',{method:'POST',body})).status,409);
 assert.deepEqual((await other.request('/api/business/advisory-profile')).data,theirs);
 const search=await news.industryRequest(f.db,await actor(f.db,'logistics'),{now});assert.match(search.query,/Malaysia/);assert.match(search.query,/customs/);assert.doesNotMatch(search.query,/Cloud|United States|GLDB Demo|109910|@greenlink/);
});
pg('Default industry planning remains available for existing companies without adding a saved profile',async t=>{
 const f=await fixture(t,{http:false,now}),user=(await f.db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];
 const value=await advisory.read(f.db,user);assert.equal(value.version,0);assert.equal(value.configured,false);
 assert.match((await advisory.context(f.db,user)).configuration,/defaults/);
 assert.equal((await f.db.query('SELECT count(*)::int AS count FROM business_advisory_profiles')).rows[0].count,0);
});
pg('The assistant researches the owned industry and returns tailored news without changing banking records',async t=>{
 const f=await fixture(t,{http:false,now});await seedIndustryBusinesses(f.db,{now});const user=await actor(f.db,'logistics'),before=await financial(f.db),captured={searches:[],advice:[]};
 const output=await createAgents({db:f.db,now,model:provider(captured)}).execute(user,'assistant',{message:'Show current news for my company and advise what to do next.'});
 assert.equal(captured.searches.length,1);assert.match(captured.searches[0].query,/logistics and transport/);assert.doesNotMatch(JSON.stringify(captured.searches),/GLDB Demo|@greenlink|109910|password_hash/);
 assert.equal(captured.advice[0].businessContext.companyName,CASES[0].name);assert.equal(output.newsInsights.businessContext.profileKey,'logistics');assert.match(output.newsInsights.insights[0].recommendations[1],/logistics manager/);assert.deepEqual(output.actions,[]);assert.equal(output.narrativeWithheld,undefined);assert.deepEqual(await financial(f.db),before);
});
pg('The same news produces separately scoped company advice and different permitted next steps',async t=>{
 const f=await fixture(t,{http:false,now});await seedIndustryBusinesses(f.db,{now});const outputs=[];
 for(const key of ['logistics','technology']){const context=await advisory.context(f.db,await actor(f.db,key));const input=news.prepare([report()],{now,businessContext:context});outputs.push(news.validate(reply(input),input));}
 assert.notEqual(outputs[0].businessContext.companyName,outputs[1].businessContext.companyName);assert.notDeepEqual(outputs[0].insights[0].recommendations,outputs[1].insights[0].recommendations);
 assert.match(outputs[1].insights[0].recommendations[1],/service owner|security lead/);
});
