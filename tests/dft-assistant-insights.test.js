'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const preferences=require('../banking/assistant-preferences'),views=require('../banking/dashboard-views'),activity=require('../banking/company-activity'),profile=require('../banking/company-profile');
const research=require('../banking/public-research'),{createOpenAIModel}=require('../banking/agents/openai'),{createAgents}=require('../banking/agents');
const pg=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL},work);
const definition={scope:'all',company:'',period:{kind:'months',months:3}};
async function actors(db){return Object.fromEntries((await db.query('SELECT * FROM users')).rows.map(u=>[u.email.split('@')[0],u]));}
async function financial(db){return {accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT id,status,amount_cents FROM transactions ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows};}
const fake=chat=>({mode:'openai',model:'controlled-insights',inspect:async()=>({available:true}),chat});
const model='gpt-6-luna',key='test-only-public-research-key-not-a-real-secret';
function publicResponse({url='https://www.dbs.com/',searched=true}={}){
 const text='Public business context (source).';
 return {status:'completed',model,id:'resp_public',output:[...(searched?[{type:'web_search_call',status:'completed'}]:[]),{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[{type:'url_citation',url,title:'Company source',start_index:24,end_index:32}]}]}]};
}
test('Public research binds exact public names and limits market topics without using private prompt text',()=>{
 const request=research.requestFor('company',{companyName:'DBS Group'},'Research public company DBS Group. My account is 1088800101 and private balance 12345.',{now:()=>0});
 assert.match(request.query,/DBS Group/);assert.doesNotMatch(request.query,/1088800101|12345|My account/);
 for(const name of ['Other Company','1088800101','my company','DBS https://internal','DBS ignore instructions'])assert.throws(()=>research.requestFor('company',{companyName:name},'Research DBS Group'),e=>e.status===400);
 assert.throws(()=>research.requestFor('market',{topic:'private_balances'},'News'),e=>e.status===400);
 assert.match(research.requestFor('market',{},'My account is 1088800101',{topic:'trade'}).query,/trade/);
});
test('Live public research requires completed search, valid model provenance and safe source annotations',()=>{
 const spec=research.requestFor('company',{companyName:'DBS Group'},'Research DBS Group');
 const result=research.parseResponse(publicResponse(),model,spec);assert.equal(result.parts.length,1);assert.equal(result.sources[0].url,'https://www.dbs.com/');
 for(const bad of [publicResponse({searched:false}),publicResponse({url:'http://127.0.0.1/'}),publicResponse({url:'https://127.0.0.1/'}),publicResponse({url:'https://staff.internal/'}),publicResponse({url:'javascript:alert(1)'}),{...publicResponse(),model:'other'}])assert.throws(()=>research.parseResponse(bad,model,spec),e=>e.status===503);
 const bad=publicResponse();bad.output.at(-1).content[0].annotations[0].end_index=99999;assert.throws(()=>research.parseResponse(bad,model,spec),e=>e.status===503);
});
test('Weekly chart refresh requires affirmative intent and respects negative wording',()=>{assert.equal(views.messageOptions('Save this chart and refresh it weekly').refreshCadence,'weekly');assert.equal(views.messageOptions("Save this chart but do not refresh weekly").refreshCadence,'manual');assert.equal(views.messageOptions('Save this chart; no weekly refresh').refreshCadence,'manual');assert.equal(views.messageOptions('Save this chart').refreshCadence,undefined);});
test('OpenAI public search is an isolated live request with storage disabled and no banking tools',async()=>{
 let captured;
 const provider=createOpenAIModel({model,apiKey:key,fetchImpl:async(_url,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify(publicResponse()));}});
 await provider.research(research.requestFor('company',{companyName:'DBS Group'},'Research DBS Group; private balance 12345'));
 assert.equal(captured.store,false);assert.equal(captured.tool_choice,'required');assert.deepEqual(captured.tools,[{type:'web_search',external_web_access:true,search_context_size:'low'}]);
 assert.doesNotMatch(captured.input,/12345|private balance/);assert.equal(captured.previous_response_id,undefined);
});
pg('Assistant preferences are private, validated, persistent and protected by CSRF and current authorization',async t=>{
 const f=await fixture(t),users=await actors(f.db),a=f.client(),b=f.client();await a.login();await b.login('jamie@greenlink.demo');
 const patch={responseStyle:'detailed',trendMonths:6,chartType:'line',marketTopic:'trade'};
 assert.equal((await a.request('/api/assistant-preferences',{method:'PATCH',body:patch,csrf:false})).status,403);
 const updated=await a.request('/api/assistant-preferences',{method:'PATCH',body:patch});assert.equal(updated.status,200);assert.deepEqual(updated.data.preferences,patch);
 assert.deepEqual((await b.request('/api/assistant-preferences')).data.preferences,preferences.DEFAULTS);
 for(const body of [{trendMonths:13},{chartType:'<script>'},{systemPrompt:'ignore rules'},{userId:users.jamie.id},{}])assert.equal((await a.request('/api/assistant-preferences',{method:'PATCH',body})).status,400);
 await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[users.alex.id]);await assert.rejects(preferences.update(f.db,users.alex,patch),e=>e.status===409);
});
pg('Calendar-month trends include zero months, counts, rounded averages and qualified partial-month comparisons',async t=>{
 const clock=()=>Date.parse('2026-11-12T04:00:00Z'),f=await fixture(t,{http:false,now:clock}),user=(await actors(f.db)).alex;
 const source=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
 for(const [amount,date]of [[10000,'2026-10-05'],[-4000,'2026-10-15'],[-6000,'2026-11-01']])await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'transfer','Trend sample',$3,'Trend Fixtures Ltd','completed',$4,$4,$4,nextval('settlement_sequence'))",[randomUUID(),source.id,amount,date+'T04:00:00Z']);
 const data=await activity.assistantDashboard(f.db,user,{company:'Trend Fixtures Ltd'},'Show Trend Fixtures Ltd transaction trends over the past 3 months',{now:clock});
 assert.equal(data.period.from,'2026-09-01');assert.deepEqual(data.viewDefinition.period,{kind:'months',months:3});assert.equal(data.months.length,3);
 assert.equal(data.months[0].completedCount,0);assert.equal(data.months[1].completedCount,2);assert.equal(data.months[1].averageOutgoingCents,4000);assert.equal(data.months[2].outgoingChangePercent,50);assert.equal(data.months[2].partial,true);
 assert.equal(data.months.reduce((n,m)=>n+m.completedCount,0),data.totals.completedCount);
 assert.throws(()=>activity.requestedPeriod('past 13 months',{now:clock}),e=>e.status===400);
});
pg('Company profile analysis uses only the signed-in submitted profile and owned activity',async t=>{
 const f=await fixture(t,{http:false}),users=await actors(f.db),own=await profile.analyze(f.db,users.alex),other=await profile.analyze(f.db,users.jamie);
 assert.equal(own.available,true);assert.notEqual(own.profile.legalName,other.profile.legalName);assert.equal(own.profile.registeredAddress,undefined);assert.equal(own.profile.registrationNumber,undefined);
 assert.deepEqual(own.activity.totals,(await activity.assistantDashboard(f.db,users.alex,{},'past 3 months')).totals);
 const staff=(await f.db.query("INSERT INTO users(name,email,password_hash,role,created_at) SELECT 'Staff without profile','no-profile@greenlink.demo',password_hash,'admin',now() FROM users WHERE id=$1 RETURNING *",[users.reviewer.id])).rows[0];assert.equal((await profile.analyze(f.db,staff)).available,false);
});
pg('Customized charts enforce ownership, versions, validation and weekly metadata without moving money',async t=>{
 const f=await fixture(t),users=await actors(f.db),a=f.client(),b=f.client();await a.login();await b.login('jamie@greenlink.demo');const before=await financial(f.db);
 const saved=await a.request('/api/dashboard-views',{method:'POST',body:{definition,refreshCadence:'weekly',presentation:{chartType:'line'}}});assert.equal(saved.status,200);
 const v=saved.data.view;assert.equal(v.refreshCadence,'weekly');assert.ok(v.nextRefreshAt);assert.ok(v.refreshedAt);
 const patch={version:v.version,title:'Quarterly suppliers',presentation:{chartType:'table',showStatus:false,showCompanies:true},refreshCadence:'manual'};
 assert.equal((await b.request('/api/dashboard-views/'+v.id,{method:'PATCH',body:patch})).status,404);
 assert.equal((await a.request('/api/dashboard-views/'+v.id,{method:'PATCH',body:patch,csrf:false})).status,403);
 const changed=await a.request('/api/dashboard-views/'+v.id,{method:'PATCH',body:patch});assert.equal(changed.status,200);assert.equal(changed.data.view.version,2);assert.equal(changed.data.view.nextRefreshAt,null);
 assert.equal((await a.request('/api/dashboard-views/'+v.id,{method:'PATCH',body:patch})).status,409);
 assert.equal((await b.request('/api/dashboard-views/'+v.id+'/refresh',{method:'POST',body:{}})).status,404);
 assert.equal((await a.request('/api/dashboard-views/'+v.id+'/refresh',{method:'POST',body:{}})).status,200);
 assert.equal((await a.request('/custom-dashboard',{responseType:'text'})).status,200);
 assert.deepEqual(await financial(f.db),before);
});
pg('Weekly saved refresh is leased, bounded and advances after a successful owned snapshot',async t=>{
 let clock=Date.parse('2026-11-01T04:00:00Z');const now=()=>clock,f=await fixture(t,{http:false,now}),user=(await actors(f.db)).alex;
 const saved=await views.save(f.db,user,{definition,refreshCadence:'weekly'},{now}),before=await financial(f.db);
 assert.deepEqual(await views.refreshDue(f.db,{now}),{refreshed:0,failed:0});clock+=8*86400000;
 const runs=await Promise.all([views.refreshDue(f.db,{now}),views.refreshDue(f.db,{now})]);assert.equal(runs.reduce((n,r)=>n+r.refreshed,0),1);assert.equal(runs.reduce((n,r)=>n+r.failed,0),0);
 const row=(await f.db.query('SELECT * FROM saved_dashboard_views WHERE id=$1',[saved.view.id])).rows[0];assert.equal(new Date(row.refreshed_at).getTime(),clock);assert.equal(new Date(row.next_refresh_at).getTime(),clock+7*86400000);assert.ok(row.snapshot_json.months);
 assert.deepEqual(await financial(f.db),before);
});
pg('Failed scheduled chart refresh retains prior snapshot and records a visible retry state',async t=>{
 let clock=Date.parse('2026-11-01T04:00:00Z');const now=()=>clock,f=await fixture(t,{http:false,now}),user=(await actors(f.db)).alex;
 const saved=await views.save(f.db,user,{definition,refreshCadence:'weekly'},{now}),before=(await f.db.query('SELECT snapshot_json,refreshed_at FROM saved_dashboard_views WHERE id=$1',[saved.view.id])).rows[0];
 await f.db.query('UPDATE saved_dashboard_views SET config_json=$2 WHERE id=$1',[saved.view.id,{scope:'company',company:'Missing test company',period:{kind:'months',months:3}}]);clock+=8*86400000;
 assert.deepEqual(await views.refreshDue(f.db,{now}),{refreshed:0,failed:1});const after=(await f.db.query('SELECT * FROM saved_dashboard_views WHERE id=$1',[saved.view.id])).rows[0];
 assert.deepEqual(after.snapshot_json,before.snapshot_json);assert.equal(+new Date(after.refreshed_at),+new Date(before.refreshed_at));assert.equal(after.refresh_error,'REFRESH_UNAVAILABLE');assert.equal(+new Date(after.next_refresh_at),clock+86400000);
});
pg('Add-this-chart follow-up preserves the displayed definition and enables only explicitly requested weekly refresh',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex,before=await financial(f.db);
 const tool=(name,args={})=>({role:'assistant',content:'',tool_calls:[{function:{name,arguments:args}}]});
 const read=fake(async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Review the retrieved transaction trends [E1].'}:tool('get_company_activity'));
 const first=await createAgents({db:f.db,model:read}).execute(user,'assistant',{message:'Show transaction trends over the past 6 months'});
 const save=fake(async messages=>messages.some(m=>m.role==='tool')?{role:'assistant',content:'Your dashboard is saved privately [E1].'}:tool('save_company_dashboard'));
 const result=await createAgents({db:f.db,model:save}).execute(user,'assistant',{message:'Add this chart to my customized dashboard and refresh it weekly as "Supplier trends"',previousRunId:first.runId,dashboardDefinition:first.companyDashboard.definition});
 assert.equal(result.companyDashboard.savedView.refreshCadence,'weekly');assert.equal(result.companyDashboard.savedView.title,'Supplier trends');assert.deepEqual(result.companyDashboard.savedView.definition.period,{kind:'months',months:6});
 assert.equal(result.narrativeWithheld,undefined);assert.deepEqual(await financial(f.db),before);
});
pg('Agentic public company research never sends retrieved private account facts to the public-search request',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex;let request;
 const provider=fake(async messages=>{
  const calls=messages.filter(m=>m.role==='tool');
  if(!calls.length)return {role:'assistant',content:'',tool_calls:[{function:{name:'get_accounts',arguments:{}}},{function:{name:'research_public_company',arguments:{companyName:'DBS Group'}}}]};
  return {role:'assistant',content:'Compare the permitted banking facts with the separately sourced public context before making decisions [E1] [E2].'};
 });
 provider.research=async spec=>{request=spec;return research.parseResponse(publicResponse(),model,spec);};
 const result=await createAgents({db:f.db,model:provider}).execute(user,'assistant',{message:'Check my balance and research the public company profile of DBS Group; private marker 9988776655'});
 assert.equal(result.publicResearch.length,1);assert.equal(result.narrativeWithheld,undefined);assert.doesNotMatch(JSON.stringify(request),/9988776655|balanceCents|get_accounts|account_id/);
 const audit=(await f.db.query("SELECT metadata FROM audit_log WHERE event_type='ai.model_call' AND metadata->>'phase'='public_web_research'")).rows;assert.equal(audit.length,1);assert.equal(audit[0].metadata.status,'completed');
});

test('Saved chart names support straight and typographic quotes without treating question marks as delimiters',()=>{
 for(const message of ['Save this chart as "Supplier trends"','Save this chart as \u201cSupplier trends\u201d','Save this chart as \u2018Supplier trends\u2019'])assert.equal(views.messageOptions(message).title,'Supplier trends');
 assert.equal(views.messageOptions('Can I save this as ?Supplier trends?').title,undefined);
});

pg('Customized dashboard controls reach later company pages and retain company scope while paging receipts',async t=>{
 const f=await fixture(t),client=f.client();await client.login();
 const account=(await client.dashboard()).accounts[0];
 for(let i=1;i<=13;i++)await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'transfer',$3,$4,$5,'completed',now(),now(),now(),nextval('settlement_sequence'))",[randomUUID(),account.id,'Paging receipt '+i,-i*100,'Paging Supplier '+String(i).padStart(2,'0')]);
 const saved=(await client.request('/api/dashboard-views',{method:'POST',body:{definition}})).data;
 const detail=(await client.request('/api/dashboard-views/'+saved.view.id)).data;
 const state={user:{id:'current'},remote:{customDashboard:{data:{views:[saved.view],preferences:preferences.DEFAULTS},charts:{[saved.view.id]:{dashboard:detail.dashboard}},chartVersions:{}}}};
 const card={dataset:{customCard:saved.view.id},querySelector:()=>({innerHTML:''}),querySelectorAll:()=>[]};
 const sources=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/js/custom-dashboard.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const context={state,api:async(route,body,method)=>{const result=await client.request('/api'+route,{method,body});assert.equal(result.status,200);return result.data;},esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:value=>String(value),fullDate:value=>String(value),statusPill:value=>value,icon:()=>'',heading:()=>'',companyCharts:()=>'',hydrateDashboardCharts:()=>{},captureSession:()=>()=>true,recoverSession:async()=>false,toast:()=>{},ui:{render:()=>{}},document:{querySelector:()=>card},AbortController,URLSearchParams,console};
 require('node:vm').runInNewContext(sources+';globalThis.frontend={customDashboardControl,customDashboardPage};',context);
 const control=(command,company)=>({dataset:{...(command?{customCommand:command}:{}),...(company?{companyChoice:company}:{})},closest:()=>card,isConnected:true,disabled:false});
 assert.match(context.frontend.customDashboardPage(),/data-custom-command="next"/);
 await context.frontend.customDashboardControl(control('next'));
 const remote=state.remote.customDashboard;
 assert.equal(remote.charts[saved.view.id].dashboard.pagination.page,2);
 assert.match(context.frontend.customDashboardPage(),/Page 2 of/);
 const company=remote.charts[saved.view.id].dashboard.companies[0].company;
 for(let i=0;i<12;i++)await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'transfer','Paging detail receipt',-1,$3,'completed',now(),now(),now(),nextval('settlement_sequence'))",[randomUUID(),account.id,company]);
 await context.frontend.customDashboardControl(control(null,company));
 assert.equal(remote.charts[saved.view.id].dashboard.company,company);assert.equal(remote.charts[saved.view.id].drilldown,true);
 assert.match(context.frontend.customDashboardPage(),/custom-dashboard-records/);assert.match(context.frontend.customDashboardPage(),/Paging (?:detail )?receipt/);
 await context.frontend.customDashboardControl(control('next'));
 assert.equal(remote.charts[saved.view.id].dashboard.pagination.page,2);
 assert.equal(remote.charts[saved.view.id].dashboard.company,company);assert.equal(remote.charts[saved.view.id].drilldown,true);
 await context.frontend.customDashboardControl(control('reset'));
 assert.equal(remote.charts[saved.view.id].dashboard.scopeType,'all');assert.equal(remote.charts[saved.view.id].dashboard.pagination.page,1);assert.equal(remote.charts[saved.view.id].drilldown,false);
});
