'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers');
const views=require('../banking/dashboard-views'),company=require('../banking/company-activity');
const {createAgents}=require('../banking/agents');
const {narrativeIssue}=require('../banking/agents/evidence');
const pg=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL},work);
const definition={scope:'all',company:'',period:{kind:'rolling',days:90}};
async function actors(db){return Object.fromEntries((await db.query('SELECT * FROM users')).rows.map(u=>[u.email.split('@')[0],u]));}
async function financial(db){return {accounts:(await db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,transactions:(await db.query('SELECT * FROM transactions ORDER BY id')).rows,schedules:(await db.query('SELECT * FROM scheduled_payments ORDER BY id')).rows,rules:(await db.query('SELECT * FROM fraud_rules ORDER BY id')).rows};}
function model({save=true,followup=false,companyName}={}){return {mode:'openai',model:'controlled-saved-view-test',inspect:async()=>({available:true}),chat:async messages=>{
 const calls=messages.filter(m=>m.role==='tool');
 if(!calls.length)return {role:'assistant',content:'',tool_calls:[{function:{name:followup?'save_company_dashboard':'get_company_activity',arguments:!followup&&companyName?{company:companyName}:{}}}]};
 if(save && calls.at(-1).tool_name==='get_company_activity')return {role:'assistant',content:'',tool_calls:[{function:{name:'save_company_dashboard',arguments:{}}}]};
 return {role:'assistant',content:save?'Your dashboard is saved privately. Reopen it to refresh the company activity [E'+calls.length+'].':'Inspect your company activity in the dashboard [E1].'};
}};}
pg('All-company summary reconciles the full owned ledger and paginates company groups independently',async t=>{
 const f=await fixture(t),client=f.client();await client.login();
 const response=await client.request('/api/company-activity?scope=all&pageSize=2');assert.equal(response.status,200,JSON.stringify(response.data));const data=response.data.dashboard;
 assert.equal(data.scopeType,'all');assert.equal(data.totals.incomeCents,662780);assert.equal(data.totals.outgoingCents,25980);assert.equal(data.totals.netCents,636800);assert.equal(data.totals.completedCount,5);assert.equal(data.totals.companyCount,5);assert.equal(data.companies.length,2);assert.equal(data.pagination.totalPages,3);
 assert.equal(data.months.reduce((n,m)=>n+m.incomeCents,0),data.totals.incomeCents);assert.equal(data.months.reduce((n,m)=>n+m.outgoingCents,0),data.totals.outgoingCents);
 const jamie=f.client();await jamie.login('jamie@greenlink.demo');const theirs=(await jamie.request('/api/company-activity?scope=all')).data.dashboard;assert.equal(theirs.totals.companyCount,1);assert.equal(theirs.totals.incomeCents,8500);assert.equal(theirs.companies[0].company,'Meridian Logistics Pte. Ltd.');
});
pg('Saved dashboard definitions persist, deduplicate concurrent requests and never copy or mutate money',async t=>{
 const f=await fixture(t),user=(await actors(f.db)).alex,before=await financial(f.db),client=f.client();await client.login();
 const results=await Promise.all([views.save(f.db,user,{definition}),views.save(f.db,user,{definition})]);assert.equal(results.filter(r=>!r.alreadySaved).length,1);assert.equal(results[0].view.id,results[1].view.id);
 const saved=results[0].view;assert.deepEqual(saved.definition,definition);assert.equal((await views.list(f.db,user)).length,1);
 const detail=await views.detail(f.db,user,saved.id);assert.equal(detail.dashboard.scopeType,'all');assert.equal(detail.dashboard.totals.companyCount,5);
 const row=(await f.db.query('SELECT * FROM saved_dashboard_views WHERE id=$1',[saved.id])).rows[0];assert.equal(row.config_json.totals,undefined);assert.equal(row.config_json.transactions,undefined);
 assert.deepEqual(await financial(f.db),before);
 await client.request('/api/auth/logout',{method:'POST',body:{}});await client.login();assert.equal((await client.request('/api/dashboard-views')).data.views[0].id,saved.id);
});
pg('Rolling saved views refresh from new receipts and fixed ranges preserve their original period',async t=>{
 const nowValue=Date.parse('2026-10-31T01:00:00Z');let clock=nowValue;
 const f=await fixture(t,{http:false,now:()=>clock}),user=(await actors(f.db)).alex;
 const saved=await views.save(f.db,user,{definition:{...definition,period:{kind:'rolling',days:1}}},{now:()=>clock});
 const before=await views.detail(f.db,user,saved.view.id,{now:()=>clock});assert.equal(before.dashboard.totals.transactionCount,0);
 const account=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
 await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'credit','Invoice receipt',12500,'New Partner Ltd','completed',$3,$3,$3,nextval('settlement_sequence'))",[randomUUID(),account.id,new Date(clock).toISOString()]);
 const updated=await views.detail(f.db,user,saved.view.id,{now:()=>clock});assert.equal(updated.dashboard.totals.incomeCents,12500);assert.equal(updated.dashboard.companies[0].company,'New Partner Ltd');
 const fixed=await views.save(f.db,user,{definition:{...definition,period:{kind:'fixed',from:'2026-10-31',to:'2026-10-31'}}},{now:()=>clock});
 clock+=86400000;const tomorrow=await views.detail(f.db,user,saved.view.id,{now:()=>clock});assert.equal(tomorrow.dashboard.period.from,'2026-11-01');assert.equal(tomorrow.dashboard.totals.incomeCents,0);
 const old=await views.detail(f.db,user,fixed.view.id,{now:()=>clock});assert.equal(old.dashboard.period.from,'2026-10-31');assert.equal(old.dashboard.totals.incomeCents,12500);
});
pg('Saved views enforce ownership for customers and administrators, CSRF, deletion and revoked authorization',async t=>{
 const f=await fixture(t),users=await actors(f.db),alex=f.client(),jamie=f.client(),admin=f.client();await alex.login();await jamie.login('jamie@greenlink.demo');await admin.login('reviewer@greenlink.demo');
 const saved=await alex.request('/api/dashboard-views',{method:'POST',body:{title:'My company summary',definition}});assert.equal(saved.status,200);const id=saved.data.view.id;
 for(const client of [jamie,admin]){assert.deepEqual((await client.request('/api/dashboard-views')).data.views,[]);assert.equal((await client.request('/api/dashboard-views/'+id)).status,404);assert.equal((await client.request('/api/dashboard-views/'+id,{method:'DELETE',body:{}})).status,404);}
 assert.equal((await alex.request('/api/dashboard-views',{method:'POST',body:{definition},csrf:false})).status,403);
 assert.equal((await alex.request('/api/dashboard-views/'+id+'?page=0')).status,400);assert.equal((await alex.request('/api/dashboard-views/'+id+'?company=Acme')).status,400);
 assert.equal((await alex.request('/saved-dashboards',{responseType:'text'})).status,200);
 await assert.rejects(views.save(f.db,users.alex,{definition:{...definition,period:{kind:'rolling',days:30}}},{validateSession:async()=>{throw new (require('../models/errors').HttpError)(401,'Session ended.');}}),e=>e.status===401);
 assert.equal((await views.list(f.db,users.alex)).length,1);
 assert.equal((await alex.request('/api/dashboard-views/'+id,{method:'DELETE',body:{}})).status,200);assert.equal((await alex.request('/api/dashboard-views/'+id)).status,404);
 await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[users.alex.id]);await assert.rejects(views.list(f.db,users.alex),e=>e.status===409);
});
pg('Saved definitions refuse broadening, unknown fields, invalid dates and ambiguous company targets',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex;
 const invalid=[{...definition,userId:'2'},{...definition,scope:'bank'},{...definition,company:'Acme'},{scope:'company',company:'Acme',period:{kind:'rolling',days:90}},{...definition,period:{kind:'rolling',days:0}},{...definition,period:{kind:'rolling',days:366.5}},{...definition,period:{kind:'fixed',from:'2026-02-30',to:'2026-10-31'}},{...definition,period:{kind:'fixed',from:'2026-10-31',to:'2099-01-01'}}];
 for(const item of invalid)await assert.rejects(views.save(f.db,user,{definition:item}),e=>[400,409].includes(e.status));
 const first=await views.save(f.db,user,{definition:{scope:'company',company:'harbour supplies pte. ltd.',period:{kind:'rolling',days:90}}});
 const again=await views.save(f.db,user,{definition:{scope:'company',company:'Harbour Supplies Pte. Ltd.',period:{kind:'rolling',days:90}}});assert.equal(first.view.id,again.view.id);assert.equal(again.alreadySaved,true);
 assert.equal((await views.list(f.db,user)).length,1);
});
pg('Assistant summarizes all companies, saves only requested evidence and supports a save-this follow-up',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex,before=await financial(f.db);
 const agents=createAgents({db:f.db,model:model()});
 const result=await agents.execute(user,'assistant',{message:'Summarize my transactions with other companies in a dashboard and save it for future use.'});
 assert.equal(result.narrativeWithheld,undefined);assert.deepEqual(result.steps.map(s=>s.tool),['get_company_activity','save_company_dashboard']);assert.ok(result.actions.some(a=>a.filters?.savedView));assert.equal((await views.list(f.db,user)).length,1);
 const detail=await agents.detail(user,result.runId);assert.equal(detail.steps[0].result.scopeType,'all');assert.equal(detail.steps[1].result.saved,true);
 const read=await createAgents({db:f.db,model:model({save:false,companyName:'Harbour Supplies'})}).execute(user,'assistant',{message:'Show a dashboard with Harbour Supplies for the last 30 days'});
 assert.equal((await views.list(f.db,user)).length,1);
 const follow=await createAgents({db:f.db,model:model({followup:true})}).execute(user,'assistant',{message:'Save it as a dashboard view for future use',previousRunId:read.runId});assert.equal(follow.narrativeWithheld,undefined);assert.equal((await views.list(f.db,user)).length,2);
 const target=(await views.list(f.db,user)).find(v=>v.definition.scope==='company');assert.equal(target.definition.company,'Harbour Supplies Pte. Ltd.');assert.deepEqual(target.definition.period,{kind:'rolling',days:30});
 await assert.rejects(createAgents({db:f.db,model:model()}).execute(user,'assistant',{message:'Summarize my company transactions in a dashboard.'}),e=>e.status===400);
 await assert.rejects(createAgents({db:f.db,model:model({followup:true})}).execute(user,'assistant',{message:'Save a dashboard with Acme'}),e=>e.status===409);
 assert.deepEqual(await financial(f.db),before);
});
test('Saved-view intent and narrative checks reject unrequested or invented persistence claims',()=>{
 assert.equal(views.saveIntent('Summarize company transactions and save the dashboard'),true);assert.equal(views.followup('Save it as a dashboardview for future use'),true);
 assert.equal(views.saveIntent("Show a summary but don't save a dashboard"),false);assert.equal(views.saveIntent('How can I save a dashboard?'),false);assert.equal(views.saveIntent('Explain how to save a dashboard'),false);assert.equal(views.saveIntent('Save this dashboard, but not now'),false);assert.equal(views.saveIntent("Do not save this dashboard"),false);assert.equal(views.saveIntent('Don\u2019t save this dashboard'),false);
 assert.equal(views.followup('Save a dashboard with Acme'),false);assert.ok(narrativeIssue('I saved your dashboard.'));assert.ok(narrativeIssue('Your dashboard has been successfully saved.'));assert.ok(narrativeIssue('Saved your dashboard.'));
 assert.equal(require('../banking/agents/evidence').relevanceIssue('Save this company dashboard',[{tool:'get_company_activity',value:{status:'ambiguous'}}]),null);
 assert.equal(narrativeIssue('Your dashboard is saved privately [E1].',null,{results:[{tool:'save_company_dashboard',value:{saved:true}}]}),null);
});

pg('Saved views have a serialized per-user limit without preventing idempotent saves',async t=>{
 const f=await fixture(t,{http:false}),user=(await actors(f.db)).alex;
 const results=await Promise.allSettled(Array.from({length:22},(_,i)=>views.save(f.db,user,{definition:{...definition,period:{kind:'rolling',days:i+1}}})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,20);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.status===409).length,2);
 const saved=(await views.list(f.db,user))[0];assert.equal((await views.save(f.db,user,{definition:saved.definition})).alreadySaved,true);assert.equal((await views.list(f.db,user)).length,20);
});
