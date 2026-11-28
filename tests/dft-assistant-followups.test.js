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

pg('A request for a money-in and money-out graph cannot be answered by a report without an actual chart',async t=>{
 const f=await fixture(t,{http:false,now}),user=await actor(f.db);let calls=0;
 const result=await createAgents({db:f.db,now,model:provider(async messages=>{
  calls++;
  if(calls===1)return call('get_finance_report');
  if(calls===2)return reply('get_finance_report','The requested bar graph compares recorded money in and money out [E1].');
  if(calls===3){assert.match(messages.at(-1).content,/dashboard|chart/);return call('get_company_activity',{chartType:'bar'});}
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
