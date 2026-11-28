'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),{createAgents}=require('../banking/agents'),response=require('../banking/agents/response');
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const now=()=>Date.parse('2026-11-28T04:00:00Z');
const actor=async db=>(await db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];
const call=(name,args={})=>({tool_calls:[{function:{name,arguments:args}}]});
const provider=chat=>({mode:'openai',model:'controlled-openai',inspect:async()=>({available:true}),chat});
const reply=(name,text='The requested records are shown below [E1].')=>({content:text,intent:{mode:'banking_evidence',requiresResearch:false,requiredTools:[name]}});
function planner(selection){return provider(async messages=>messages.some(m=>m.role==='tool')?reply(selection().name):call(selection().name,selection().args));}

test('Compatible read conversions retain their date window and cannot discard search restrictions',()=>{
 const report={tool:'get_finance_report',arguments:{},period:{from:'2026-09-01',to:'2026-10-31'}};
 const chart=response.resolveEnquiry('get_company_activity',{reusePrevious:true},'Turn that into a bar chart for the same period.',report,{now});
 assert.deepEqual(require('../banking/assistant-period').requestedPeriod(chart.message,{now}),report.period);
 const changed=response.resolveEnquiry('get_company_activity',{reusePrevious:true},'Keep those dates and use a table.',{...report,tool:'get_company_activity'},{now});
 assert.deepEqual(require('../banking/assistant-period').requestedPeriod(changed.message,{now}),report.period);
 for(const args of [{q:'Harbour'},{accountId:'1'},{status:'rejected'},{type:'outgoing'}])assert.equal(response.compatibleEnquiry('get_company_activity',{...report,tool:'search_transactions',arguments:args}),null);
 assert.equal(response.compatibleEnquiry('get_finance_report',{...report,tool:'get_company_activity',arguments:{company:'Harbour Supplies'}}),null);
});

test('Saved chart positions use the displayed order and cannot select deleted or conflicting views',()=>{
 const first={id:'first-owned',title:'Suppliers'},second={id:'second-owned',title:'Receipts'},previous=[first,second],fresh=[second,first];
 assert.equal(response.requestedSavedDashboard('Open the first one.',fresh,previous).id,first.id);
 assert.equal(response.requestedSavedDashboard('Open dashboard number 2.',fresh,previous).id,second.id);
 assert.equal(response.requestedSavedDashboard('Open the last chart.',fresh,previous).id,second.id);
 assert.equal(response.requestedSavedDashboard('Open the first one.',[second],previous),null);
 assert.equal(response.requestedSavedDashboard('Open the first one, Receipts.',fresh,previous),null);
 assert.equal(response.requestedSavedDashboard('Open the third chart.',fresh,previous),null);
 assert.equal(response.requestedSavedDashboard('Reopen Receipts.',fresh,previous).id,second.id);
 assert.equal(response.requestedSavedDashboard('Open my only saved chart.',[first]).id,first.id);
 assert.equal(response.requestedSavedDashboard("I'd like to reopen my saved chart; it's useful.",[first]).id,first.id);
 assert.equal(response.requestedSavedDashboard('Reopen "Missing view".',[first]),null);
 const short={id:'short',title:'Operations'},long={id:'long',title:'Operations 2025'};
 assert.equal(response.requestedSavedDashboard('Open "Operations 2025".',[short,long]).id,long.id);
 assert.equal(response.requestedSavedDashboard('Open Wholesales.',[{id:'sales',title:'Sales'}]),null);
});

pg('Saved chart reopening never substitutes a sole remaining view for a missing requested target',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),views=require('../banking/dashboard-views');
 await views.save(f.db,user,{title:'Suppliers',definition:{scope:'all',company:'',period:{kind:'rolling',days:30}}},{now});
 let listOnly=false,staleId=null;
 const agents=createAgents({db:f.db,now,model:provider(async messages=>{
  const tools=messages.filter(m=>m.role==='tool');
  if(!tools.length)return call('list_saved_dashboards');
  if(listOnly)return reply('list_saved_dashboards','Your saved charts are listed below [E1].');
  if(tools.length===1)return call('open_saved_dashboard',{viewId:staleId||JSON.parse(tools[0].content).data.views[0].id});
  const result=JSON.parse(tools.at(-1).content).data;
  return reply('open_saved_dashboard',result.selectionRequired?'Please choose the saved chart you intend to reopen [E2].':'The selected saved chart is shown below [E2].');
 })});
 const missing=await agents.execute(user,'assistant',{message:'Reopen "Missing view".'});
 assert.equal(missing.companyDashboard,undefined);assert.equal((await agents.detail(user,missing.runId)).steps.at(-1).result.selectionRequired,true);
 const sole=await agents.execute(user,'assistant',{message:'Open my only saved chart.'});assert.ok(sole.companyDashboard);
 await views.save(f.db,user,{title:'Receipts',definition:{scope:'all',company:'',period:{kind:'rolling',days:60}}},{now});
 listOnly=true;const listed=await agents.execute(user,'assistant',{message:'List my saved charts.'}),prior=(await agents.detail(user,listed.runId)).steps[0].result.views;
 await f.db.query('DELETE FROM saved_dashboard_views WHERE id=$1',[prior[0].id]);
 listOnly=false;const deleted=await agents.execute(user,'assistant',{message:'Open the first one.',previousRunId:listed.runId});
 assert.equal(deleted.companyDashboard,undefined);assert.equal((await agents.detail(user,deleted.runId)).steps.at(-1).result.selectionRequired,true);
 staleId=prior[0].id;
 const stale=await agents.execute(user,'assistant',{message:'Open the first one.',previousRunId:listed.runId});
 assert.equal(stale.companyDashboard,undefined);assert.equal((await agents.detail(user,stale.runId)).steps.at(-1).result.selectionRequired,true);
});

pg('Relative reporting endpoints agree in finance reports, historical balances and receipt searches',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let selection={name:'get_finance_report',args:{}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)}),before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
 for(const name of ['get_finance_report','get_accounts','search_transactions']){
  selection.name=name;
  const result=await agents.execute(user,'assistant',{message:({get_finance_report:'Generate a finance report',get_accounts:'Show historical account balances',search_transactions:'List my receipts'})[name]+' from last month to today.'});
  assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);
  const value=(await agents.detail(user,result.runId)).steps[0].result;
  assert.equal(value.period.from,'2026-10-01');assert.equal(value.period.to,'2026-11-28');
 }
 assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);
});

test('Public research reaches the model beyond its opening paragraphs without cutting JSON or financial fields',()=>{
 const text='Company background. '.repeat(100)+'\n\nRecent dated business news: the company announced a new trade settlement service.';
 const report={kind:'company',parts:[{text,annotations:[{url:'https://company.example.org/news',start:1900,end:1910}]}],sources:[{title:'Company announcement',url:'https://company.example.org/news'}]};
 const complete=JSON.parse(response.toolEvidence(1,report));assert.equal(complete.data.parts[0].text,text);assert.equal(complete.contextTruncated,undefined);assert.equal(complete.data.parts[0].annotations,undefined);assert.deepEqual(complete.data.sources,report.sources);
 const large={reports:Array.from({length:12},()=>report),amountCents:123456,period:{from:'2026-10-01',to:'2026-10-31'},actions:[{type:'navigate'}]};
 const serialized=response.toolEvidence(2,large),bounded=JSON.parse(serialized);
 assert.ok(serialized.length<=18000);assert.equal(bounded.data.amountCents,123456);assert.deepEqual(bounded.data.period,large.period);assert.equal(bounded.data.actions,undefined);assert.equal(bounded.contextTruncated,true);assert.match(bounded.contextNote,/Do not infer omitted/);
 assert.equal(large.reports[0].parts[0].text,text);
});

pg('A saved-chart ordinal follow-up reopens its owned view from the displayed list after a fresh listing',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),views=require('../banking/dashboard-views');
 for(const [title,days] of [['Suppliers',30],['Receipts',60]])await views.save(f.db,user,{title,definition:{scope:'all',company:'',period:{kind:'rolling',days}}},{now});
 let selectedId=null;
 const agents=createAgents({db:f.db,now,model:provider(async messages=>{
  const tools=messages.filter(m=>m.role==='tool');
  if(!tools.length)return call('list_saved_dashboards');
  if(!selectedId)return reply('list_saved_dashboards','Your saved charts are listed below [E1].');
  if(tools.length===1)return call('open_saved_dashboard',{viewId:selectedId});
  return reply('open_saved_dashboard','The selected saved chart has been reopened with fresh records [E2].');
 })});
 const listed=await agents.execute(user,'assistant',{message:'Show my saved charts.'});
 const detail=await agents.detail(user,listed.runId);selectedId=detail.steps[0].result.views[0].id;
 const opened=await agents.execute(user,'assistant',{message:'Open the first one.',previousRunId:listed.runId});
 assert.equal(opened.narrativeWithheld,undefined,opened.narrativeIssue);assert.ok(opened.companyDashboard);
 assert.equal((await agents.detail(user,opened.runId)).steps.find(s=>s.tool==='open_saved_dashboard').result.view.id,selectedId);
});

pg('A request for a money-in and money-out graph cannot be answered by a report without an actual chart',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let calls=0;
 const result=await createAgents({db:f.db,now,model:provider(async messages=>{
  calls++;
  if(calls===1)return call('get_finance_report');
  if(calls===2)return reply('get_finance_report','The requested bar graph compares recorded money in and money out [E1].');
  if(calls===3){assert.match(messages.at(-1).content,/get_company_activity/);return call('get_company_activity',{chartType:'bar'});}
  return {content:'The requested comparison chart is shown below [E2].',intent:{mode:'banking_evidence',requiresResearch:false,requiredTools:['get_finance_report','get_company_activity']}};
 })}).execute(user,'assistant',{message:'Give me a bar graph comparing money in and money out over the past three months.'});
 assert.equal(result.narrativeWithheld,undefined,result.narrativeIssue);assert.ok(result.companyDashboard);assert.equal(result.companyDashboard.presentation.chartType,'bar');
 assert.equal(result.companyDashboard.data.period.from,'2026-09-01');
});

pg('Report-to-chart and table follow-ups preserve the requested dates and reread owned activity',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let selection={name:'get_company_activity',args:{company:'Harbour Supplies'}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)});
 const oldChart=await agents.execute(user,'assistant',{message:'Show my activity with Harbour Supplies for the last 30 days.'});
 selection={name:'get_finance_report',args:{}};
 const first=await agents.execute(user,'assistant',{message:'Give me a finance report for September and October 2026.',previousRunId:oldChart.runId});
 selection={name:'get_company_activity',args:{reusePrevious:true,chartType:'bar'}};
 const chart=await agents.execute(user,'assistant',{message:'Can you turn that into a bar graph for the same period?',previousRunId:first.runId});
 assert.equal(chart.narrativeWithheld,undefined,chart.narrativeIssue);assert.equal(chart.companyDashboard.data.scopeType,'all');assert.equal(chart.companyDashboard.data.period.from,'2026-09-01');assert.equal(chart.companyDashboard.data.period.to,'2026-10-31');
 selection.args.chartType='table';
 const table=await agents.execute(user,'assistant',{message:'Now show it as a table, keeping those dates.',previousRunId:chart.runId});
 assert.equal(table.companyDashboard.data.period.from,'2026-09-01');assert.equal(table.companyDashboard.data.period.to,'2026-10-31');assert.equal(table.companyDashboard.presentation.chartType,'table');
});

pg('A chart receipt follow-up keeps exact company, external scope and settlement-date boundaries through Activity and export',async t=>{
 const f=await fixture(t,{now}),user=await actor(f.db),client=f.client();await client.login();
 const account=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0].id;
 const wanted=randomUUID(),outside=randomUUID(),nearMatch=randomUUID(),internal=randomUUID();
 for(const [id,company,settled,own,description] of [[wanted,'Harbour Supplies','2026-10-01T00:00:00Z',false,'Delivered supplies'],[outside,'Harbour Supplies','2026-11-01T00:00:00Z',false,'Other period'],[nearMatch,'Other Company','2026-10-01T00:00:00Z',false,'Harbour Supplies mention only'],[internal,'Harbour Supplies','2026-10-01T00:00:00Z',true,'Own funds']])await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'transfer',$3,-100,$4,'completed','FOLLOWUP',$5,'2026-09-30T00:00:00Z','2026-09-30T00:00:00Z',$6,nextval('settlement_sequence'))",[id,account,description,company,own,settled]);
 let selection={name:'get_company_activity',args:{company:'Harbour Supplies'}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)});
 const chart=await agents.execute(user,'assistant',{message:'Show my activity with Harbour Supplies for October 2026.'});
 selection={name:'search_transactions',args:{reusePrevious:true}};
 const receipts=await agents.execute(user,'assistant',{message:'Show the individual receipts behind that chart.',previousRunId:chart.runId});
 const detail=await agents.detail(user,receipts.runId),search=detail.steps.find(s=>s.tool==='search_transactions').result;
 assert.equal(search.period.from,'2026-10-01');assert.equal(search.filters.counterparty,'Harbour Supplies');assert.deepEqual(search.transactions.map(t=>t.id),[wanted]);
 const action=receipts.actions.find(a=>a.page==='activity'),params=new URLSearchParams(action.filters);
 const activity=await client.request('/api/transactions?'+params);assert.equal(activity.status,200);assert.deepEqual(activity.data.transactions.map(t=>t.id),[wanted]);
 const exported=await client.request('/api/transactions/export?'+params,{responseType:'text'});assert.equal(exported.status,200);assert.ok(exported.data.includes(wanted));for(const id of [outside,nearMatch,internal])assert.ok(!exported.data.includes(id));
 selection.args.status='rejected';
 const rejected=await agents.execute(user,'assistant',{message:'Only rejected payments.',previousRunId:receipts.runId});assert.equal((await agents.detail(user,rejected.runId)).steps[0].result.total,0);
 selection.args.status='all';
 const all=await agents.execute(user,'assistant',{message:'Include all statuses again.',previousRunId:rejected.runId});assert.deepEqual((await agents.detail(user,all.runId)).steps[0].result.transactions.map(t=>t.id),[wanted]);
});

pg('Completed funding checks support amount and deadline what-ifs without creating drafts or changing balances',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),source=(await f.db.query('SELECT id::text,number FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
 const before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;let selection={name:'check_payment_funds',args:{}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)});
 const first=await agents.execute(user,'assistant',{message:'Can I pay SGD 10 from '+source.number+' to Harbour Supplies by the end of this month?'});assert.equal(first.paymentReadiness.complete,true);
 selection.args.reusePrevious=true;
 const amount=await agents.execute(user,'assistant',{message:'What if it is SGD 20 instead?',previousRunId:first.runId});assert.equal(amount.paymentReadiness.complete,true);assert.equal(amount.paymentReadiness.amountCents,2000);assert.equal(amount.paymentReadiness.source.id,source.id);assert.equal(amount.paymentReadiness.company,'Harbour Supplies');
 const date=await agents.execute(user,'assistant',{message:'What if I need to pay them tomorrow instead?',previousRunId:amount.runId});assert.equal(date.paymentReadiness.complete,true);assert.equal(date.paymentReadiness.deadline.date,'2026-11-29');assert.equal(date.paymentReadiness.amountCents,2000);
 assert.deepEqual(date.actions,[]);assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);
 const stored=(await f.db.query('SELECT context_json FROM agent_runs WHERE id=$1',[date.runId])).rows[0].context_json.lastFundingEnquiry;
 assert.deepEqual(Object.keys(stored).sort(),['amountCents','company','deadlineDate','flowMonth','requiresCompany','sourceAccountId']);
});

pg('Immediate funding questions and missing-source replies retain a fresh read-only scenario',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),source=(await f.db.query('SELECT id::text,number FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
 const before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;let selection={name:'check_payment_funds',args:{}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)});
 const first=await agents.execute(user,'assistant',{message:'Can I afford SGD 10 from '+source.number+'?'});
 assert.equal(first.paymentReadiness?.complete,true);assert.equal(first.paymentReadiness.deadline.date,'2026-11-28');
 selection.args.reusePrevious=true;
 const changed=await agents.execute(user,'assistant',{message:'What about SGD 20 instead?',previousRunId:first.runId});
 assert.equal(changed.paymentReadiness.complete,true);assert.equal(changed.paymentReadiness.amountCents,2000);assert.equal(changed.paymentReadiness.source.id,source.id);
 selection.args={};
 const missing=await agents.execute(user,'assistant',{message:'Can I afford SGD 10?'});assert.equal(missing.paymentReadiness.complete,false);
 selection.args.reusePrevious=true;
 const filled=await agents.execute(user,'assistant',{message:source.number,previousRunId:missing.runId});
 assert.equal(filled.paymentReadiness.complete,true);assert.equal(filled.paymentReadiness.amountCents,1000);assert.equal(filled.paymentReadiness.source.id,source.id);
 assert.deepEqual(filled.actions,[]);assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);
});

pg('Immediate affordability checks include schedules due later today without requiring a date phrase',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db),source=(await f.db.query('SELECT id::text,number,balance_cents FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
 const amount=Number(source.balance_cents)-500,at='2026-11-28T05:00:00Z';
 await f.db.query("INSERT INTO scheduled_payments(id,user_id,type,payload_json,amount_cents,frequency,status,next_run_at,scheduled_at,authorization_json) VALUES($1,$2,'bill',$3,$4,'once','active',$5,$5,'{}'::jsonb)",[randomUUID(),user.id,{fromId:source.id,billerId:'pub',reference:'DUE-TODAY',amountCents:amount},amount,at]);
 const agents=createAgents({db:f.db,now,model:planner(()=>({name:'check_payment_funds',args:{}}))});
 const result=await agents.execute(user,'assistant',{message:'Can I afford SGD 10 from '+source.number+'?'});
 assert.equal(result.paymentReadiness.status,'needs_funding');assert.equal(result.paymentReadiness.scheduledCount,1);assert.equal(result.paymentReadiness.shortageCents,500);
 assert.equal(result.fundingWarnings[0].shortageCents,500);assert.deepEqual(result.actions,[]);
 assert.equal((await f.db.query('SELECT balance_cents FROM accounts WHERE id=$1',[source.id])).rows[0].balance_cents,source.balance_cents);
});

pg('An invalid report or company-chart period can be completed by replying with a month',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let selection={name:'get_finance_report',args:{}};
 const agents=createAgents({db:f.db,now,model:planner(()=>selection)});
 const first=await agents.execute(user,'assistant',{message:'Generate a finance report from date to date.'});assert.equal(first.clarification,true);
 const corrected=await agents.execute(user,'assistant',{message:'October',previousRunId:first.runId});assert.equal(corrected.financeReport.period.from,'2026-10-01');
 selection={name:'get_company_activity',args:{company:'Harbour Supplies'}};
 const chart=await agents.execute(user,'assistant',{message:'Show a chart for Harbour Supplies from date to date.'});assert.equal(chart.clarification,true);
 selection.args={};
 const fixed=await agents.execute(user,'assistant',{message:'October',previousRunId:chart.runId});assert.equal(fixed.companyDashboard.data.period.from,'2026-10-01');assert.equal(fixed.companyDashboard.data.company,'Harbour Supplies Pte. Ltd.');
});

pg('Balance placeholder text is repaired using the retrieved evidence rather than shown to the customer',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let calls=0;
 const result=await createAgents({db:f.db,now,model:provider(async()=>{
  if(++calls===1)return call('get_accounts');
  if(calls===2)return reply('get_accounts','The opening balance was S$[opening balance] [E1].');
  return {content:'Your current balances are shown in the account details below [E1].'};
 })}).execute(user,'assistant',{message:'Show my current balances.'});
 assert.equal(calls,3);assert.equal(result.narrativeWithheld,undefined);assert.doesNotMatch(result.reply,/opening balance\]/);
});
