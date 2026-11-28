'use strict';
const {requestedPeriod}=require('../banking/assistant-period');
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{inflateSync}=require('node:zlib');
const {fixture}=require('./dft-helpers');
const finance=require('../banking/finance-reports'),{pdf}=require('../banking/finance-pdf');
const {createAgents,toolSchema,argumentsFor}=require('../banking/agents');
const {relevanceIssue}=require('../banking/agents/evidence');
const NOW=Date.parse('2026-11-10T04:00:00Z'),now=()=>NOW;
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);

test('Month comparisons and calendar quarters retain all requested months in Singapore time',()=>{
 const now=()=>Date.parse('2026-11-27T05:00:00Z');
 for(const wording of ['in September and October 2026','between September and October 2026','from September to October 2026','September 2026 through October 2026'])assert.deepEqual(requestedPeriod(wording,{now}),{from:'2026-09-01',to:'2026-10-31'});
 assert.deepEqual(requestedPeriod('Compare December 2025 and January 2026',{now}),{from:'2025-12-01',to:'2026-01-31'});
 assert.deepEqual(requestedPeriod('Compare October and November 2026',{now}),{from:'2026-10-01',to:'2026-11-27'});
 assert.deepEqual(requestedPeriod('my activity this quarter',{now}),{from:'2026-10-01',to:'2026-11-27'});
 assert.deepEqual(requestedPeriod('my activity last quarter',{now}),{from:'2026-07-01',to:'2026-09-30'});
 assert.equal(require('../banking/assistant-period').isDateReply('this quarter'),true);
 const boundary=()=>Date.parse('2026-12-31T16:30:00Z');
 assert.deepEqual(requestedPeriod('current quarter',{now:boundary}),{from:'2027-01-01',to:'2027-01-01'});
 assert.deepEqual(requestedPeriod('previous quarter',{now:boundary}),{from:'2026-10-01',to:'2026-12-31'});
 assert.deepEqual(requestedPeriod('Show May Logistics activity in October 2026',{now}),{from:'2026-10-01',to:'2026-10-31'});
 for(const wording of ['What about October instead?','October instead, please.','How about October please?'])assert.deepEqual(requestedPeriod(wording,{now}),{from:'2026-10-01',to:'2026-10-31'});
 assert.deepEqual(requestedPeriod('Show payments about May Logistics',{now}),{});
 for(const wording of ['October and September 2026','July and August and September 2026'])assert.throws(()=>requestedPeriod(wording,{now}),e=>e.status===400);
});

test('Currency values and account numbers never become calendar dates in a natural payment enquiry',()=>{
 for(const message of ['Could you put together the review form to move SGD 10.00 from 1099100101 to 1099100201?','How much is available in account 1099100101?','What would S$100.50 mean for my available balance?'])assert.deepEqual(requestedPeriod(message,{now}),{});
 assert.deepEqual(requestedPeriod('Show transactions in account 1099100101 between 2026-10-01 and 2026-10-31 for SGD 10.00',{now}),{from:'2026-10-01',to:'2026-10-31'});
 assert.throws(()=>requestedPeriod('Show transactions from 1 to date',{now}),e=>e.status===400);
});
test('Named quarters and month-only date clarifications never silently use a default period',()=>{
 const now=()=>Date.parse('2026-11-28T04:00:00Z');
 for(const wording of ['Q3 2026','the third quarter of 2026','3rd quarter 2026'])assert.deepEqual(requestedPeriod(wording,{now}),{from:'2026-07-01',to:'2026-09-30'});
 assert.deepEqual(requestedPeriod('Q4 2026',{now}),{from:'2026-10-01',to:'2026-11-28'});
 for(const wording of ['Q5 2026','Q10 2026','Q10 2026 activity summary','for Q00','for Q12 instead'])assert.throws(()=>requestedPeriod(wording,{now}),e=>e.status===400,wording);
 for(const wording of ['October','October please','1 to 25 October 2026','Q3 2026','the third quarter of 2026'])assert.equal(require('../banking/assistant-period').isDateReply(wording),true);
 assert.equal(require('../banking/assistant-period').isDateReply('October Trading Ltd.'),false);
 assert.deepEqual(requestedPeriod('Show payments to Q3 Logistics',{now}),{});
});
const actor=async(db,email='alex@greenlink.demo')=>(await db.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
async function row(db,{email='alex@greenlink.demo',amount=-100,status='completed',at='2026-01-15T00:00:00Z',requested=at,internal=false,label='Test Supplier',description='Finance test payment',reference='FINANCE-TEST'}={}){
  const account=(await db.query('SELECT a.id FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email=$1 ORDER BY a.id LIMIT 1',[email])).rows[0];
  const id=randomUUID();
  await db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $7='completed' THEN nextval('settlement_sequence') END)",[id,account.id,amount>0?'credit':'transfer',description,amount,label,status,reference,internal,at,requested,status==='completed'?at:null]);
  if(status==='completed')await db.query("UPDATE accounts SET opening_balance_cents=opening_balance_cents+CASE WHEN $3::timestamptz<created_at THEN 10000000 ELSE 0 END,balance_cents=balance_cents+$2+CASE WHEN $3::timestamptz<created_at THEN 10000000 ELSE 0 END,created_at=LEAST(created_at,$3::timestamptz-interval '1 day') WHERE id=$1",[account.id,amount,at]);
  return id;
}
function pdfText(buffer){
  const source=buffer.toString('latin1');let text='';
  for(const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)){
    let stream;try{stream=inflateSync(Buffer.from(match[1],'latin1')).toString('latin1');}catch{continue;}
    text+=[...stream.matchAll(/<([a-f\d]+)>/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join('');
  }
  return text;
}
pg('Finance reports read current committed balances and completed external flow without counting own transfers twice',async t=>{
  const f=await fixture(t,{now}),alex=f.client(),jamie=f.client();await alex.login();await jamie.login('jamie@greenlink.demo');
  const a=(await alex.dashboard()).accounts,j=(await jamie.dashboard()).accounts[0],user=await actor(f.db);
  const before=await finance.create(f.db,user,new URLSearchParams(),{now});
  for(const [client,from,to,amount] of [[alex,a[0],j,'2.34'],[jamie,j,a[0],'1.23'],[alex,a[0],a[1],'1.00']]){
    const result=await client.request('/api/transfers',{method:'POST',body:{fromAccountId:from.id,toAccountNumber:to.number,amount,description:'Finance freshness',requestId:randomUUID()}});assert.equal(result.status,200,JSON.stringify(result.data));
  }
  assert.equal((await alex.request('/api/payments',{method:'POST',body:{fromAccountId:a[0].id,billerId:'pub',reference:'FINANCE-LIVE-001',amount:'0.01',requestId:randomUUID()}})).status,200);
  const financialState=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const after=await finance.create(f.db,user,new URLSearchParams(),{now});
  assert.equal(after.totals.incomeCents,before.totals.incomeCents+123);assert.equal(after.totals.outgoingCents,before.totals.outgoingCents+235);
  assert.equal(after.totals.netCents,before.totals.netCents-112);assert.equal(after.totals.balanceCents,before.totals.balanceCents-112);
  assert.equal(after.period.from,'2026-11-01');assert.equal(after.generatedAt,new Date(NOW).toISOString());
  assert.ok(finance.csv(after).content.includes('FINANCE-LIVE-001'));await pdf(after);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),financialState);
});
pg('Finance settlement dates use Singapore boundaries and pending, rejected and opening funds stay out of completed cash flow',async t=>{
  const f=await fixture(t,{http:false,now}),user=await actor(f.db);
  await row(f.db,{amount:1000,at:'2026-01-14T16:00:00Z',requested:'2026-01-12T00:00:00Z'});
  await row(f.db,{amount:-200,at:'2026-01-15T15:59:59.999Z'});
  await row(f.db,{amount:-300,at:'2026-01-15T16:00:00Z'});
  await row(f.db,{amount:-400,status:'pending_review',requested:'2026-01-15T02:00:00Z'});
  await row(f.db,{amount:-500,status:'rejected'});
  await row(f.db,{amount:9999,internal:true});
  await row(f.db,{amount:8888,description:'Opening balance'});
  await row(f.db,{amount:7777,email:'jamie@greenlink.demo',label:'Private Other Business'});
  const report=await finance.create(f.db,user,new URLSearchParams({from:'2026-01-15',to:'2026-01-15'}),{now});
  assert.equal(report.totals.incomeCents,1000);assert.equal(report.totals.outgoingCents,200);assert.equal(report.totals.netCents,800);
  assert.equal(report.totals.pendingOutgoingCents,400);assert.equal(report.totals.rejectedOutgoingCents,500);assert.equal(report.totals.completedCount,4);
  assert.equal(report.transactions.length,6);assert.equal(report.companies.length,1);assert.equal(report.companies[0].netCents,800);
  assert.equal(JSON.stringify(report).includes('Private Other Business'),false);
});
pg('Authenticated CSV and PDF downloads remain owned, uncached and readable, while spreadsheet formulas are neutralized',async t=>{
  const f=await fixture(t,{now}),client=f.client();assert.equal((await client.request('/api/reports/finance')).status,401);await client.login();
  const id=await row(f.db,{amount:-123,description:'=SUM(A1:A2)',reference:'+sensitive-reference',label:'\u516c\u53f8 Supplier'});
  await row(f.db,{email:'jamie@greenlink.demo',description:'PRIVATE-JAMIE-FINANCE'});
  const range='from=2026-01-15&to=2026-01-15';
  const csv=await client.request('/api/reports/finance?'+range+'&format=csv',{responseType:'text'});
  assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/^text\/csv/);assert.equal(csv.headers.get('cache-control'),'no-store');assert.match(csv.headers.get('content-disposition'),/attachment;.*\.csv"/);
  assert.ok(csv.data.includes('"\'=SUM(A1:A2)"'));assert.ok(csv.data.includes('"\'+sensitive-reference"'));assert.ok(csv.data.includes(',-1.23,'));assert.ok(csv.data.includes('\u516c\u53f8 Supplier'));assert.equal(csv.data.includes('PRIVATE-JAMIE-FINANCE'),false);
  const report=await finance.create(f.db,await actor(f.db),new URLSearchParams(range),{now}),output=await pdf(report);
  assert.match(output.content.toString('latin1'),/^%PDF-/);assert.match(output.content.toString('latin1'),/%%EOF\s*$/);
  const text=pdfText(output.content);assert.match(text,/Business finance activity report/);assert.ok(text.includes(id));assert.ok(text.includes('SGD -1.23'));assert.ok(text.includes('[U+516C][U+53F8] Supplier'));assert.ok(!text.includes('PRIVATE-JAMIE-FINANCE'));
  const endpoint=await client.request('/api/reports/finance?'+range+'&format=pdf',{responseType:'text'});
  assert.equal(endpoint.status,200);assert.match(endpoint.headers.get('content-type'),/^application\/pdf/);assert.match(endpoint.headers.get('content-disposition'),/attachment;.*\.pdf"/);assert.match(endpoint.data,/^%PDF-/);
});
pg('Finance reports reject invalid ranges, caller ownership overrides, duplicate formats and revoked sessions',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();
  for(const query of ['from=2026-02-30','from=2026-11-10&to=2026-11-01','from=2020-01-01','to=2099-01-01','from=2026-01-01&from=2026-01-02','format=html','format=csv&format=pdf','userId=2','accountId=1']){
    const result=await client.request('/api/reports/finance?'+query);assert.equal(result.status,400,query+': '+JSON.stringify(result.data));
  }
  const user=await actor(f.db);await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id]);
  await assert.rejects(finance.create(f.db,user,new URLSearchParams(),{now}),e=>e.status===409);
  assert.equal((await client.request('/api/reports/finance')).status,401);
});
test('Finance report periods are derived from user text and the model cannot supply filters or account ownership',()=>{
  for(const [message,expected] of [['today',{from:'2026-11-10',to:'2026-11-10'}],['yesterday',{from:'2026-11-09',to:'2026-11-09'}],['last 7 days',{from:'2026-11-04',to:'2026-11-10'}],['last month',{from:'2026-10-01',to:'2026-10-31'}],['from 2026-01-01 to 2026-01-31',{from:'2026-01-01',to:'2026-01-31'}]]){
    assert.deepEqual(Object.fromEntries(finance.paramsForMessage('Download a finance report '+message,{now})),expected);
  }
  assert.throws(()=>finance.paramsForMessage('A finance report last year',{now}),e=>e.status===400);
  assert.throws(()=>argumentsFor('get_finance_report',{userId:'2'}),e=>e.status===400);
  assert.deepEqual(Object.keys(toolSchema('get_finance_report').function.parameters.properties),['reusePrevious']);
  assert.equal(toolSchema('get_finance_report').function.parameters.properties.reusePrevious.type,'boolean');
  for(const key of ['from','to','accountId','userId'])assert.throws(()=>argumentsFor('get_finance_report',{[key]:'untrusted'}),e=>e.status===400);
  assert.ok(relevanceIssue('Download a finance report',[{tool:'get_accounts'}]));
  assert.equal(relevanceIssue('Finance report with balances and cash flow',[{tool:'get_finance_report'}]),null);
  assert.ok(relevanceIssue('Can I afford future payments?',[{tool:'get_finance_report'}]),'A current activity snapshot cannot replace a future liquidity scenario.');
});

test('Assistant reports parse named and Singapore numeric dates without silently using this month',()=>{
  for(const question of [
    'from 1 November 2026 to 9 November 2026','between 1 Nov and 9 Nov 2026',
    'from November 1, 2026 to November 9, 2026','from 01/11/2026 to 09/11/2026',
    'from 1.11.2026 to 9.11.2026','from 01-11-2026 to 09-11-2026',
    'from 2026-11-01 to 2026-11-09'
  ])assert.deepEqual(Object.fromEntries(finance.paramsForMessage('Generate a finance report '+question,{now})),{from:'2026-11-01',to:'2026-11-09'},question);
  for(const [question,period] of [
    ['last week',['2026-11-02','2026-11-08']],['this week',['2026-11-09','2026-11-10']],
    ['last 2 weeks',['2026-10-28','2026-11-10']],['October 2026',['2026-10-01','2026-10-31']],
    ['on 9 November 2026',['2026-11-09','2026-11-09']],['since 1 November 2026',['2026-11-01','2026-11-10']]
  ])assert.deepEqual(Object.fromEntries(finance.paramsForMessage(question,{now})),{from:period[0],to:period[1]},question);
  assert.deepEqual(Object.fromEntries(finance.paramsForMessage('May I generate a finance report?',{now})),{});
  for(const question of ['last November','between November and October','from date to date','between 1 November 2026 and date','from 1 Nov 2026 to','from 31/02/2026 to 02/03/2026','between 9 Nov 2026 and 1 Nov 2026','from 2026-11-01 to 2026-11-02 to 2026-11-03'])assert.throws(()=>finance.paramsForMessage(question,{now}),e=>e.status===400,question);
});

test('Shorthand named-date ranges retain both endpoints across assistant tools',()=>{
  for(const text of ['from 1 to 9 November 2026','between 1st and 9th Nov 2026','November 1-9, 2026','from November 1 to 9, 2026','from 1 November 2026 through 9']){
    assert.deepEqual(Object.fromEntries(finance.paramsForMessage('Generate a finance report '+text,{now})),{from:'2026-11-01',to:'2026-11-09'},text);
  }
  for(const text of ['from 31 to 32 November 2026','between 9 and 1 November 2026','from November 1 to 31, 2026'])assert.throws(()=>finance.paramsForMessage(text,{now}),e=>e.status===400,text);
  assert.deepEqual(Object.fromEntries(finance.paramsForMessage('from 1 November to 9 December 2026',{now})),{from:'2026-11-01',to:'2026-12-09'});
});

test('Written duration quantities preserve period limits and explicit projection horizons',()=>{
  for(const [text,from,to] of [
    ['last six months','2026-06-01','2026-11-10'],['previous three months','2026-09-01','2026-11-10'],
    ['past two weeks','2026-10-28','2026-11-10'],['last twenty-one days','2026-10-21','2026-11-10'],
    ['past one hundred days','2026-08-03','2026-11-10'],['last a month','2026-11-01','2026-11-10'],
  ])assert.deepEqual(Object.fromEntries(finance.paramsForMessage(text,{now})),{from,to},text);
  for(const text of ['past thirteen months','last zero days','past four hundred days'])assert.throws(()=>finance.paramsForMessage(text,{now}),e=>e.status===400,text);
  const {requestedHorizon}=require('../banking/agents/reports');
  assert.equal(requestedHorizon('Can I cover scheduled payments over the next seven days?'),7);
  assert.equal(requestedHorizon('Can I cover scheduled payments over the next two weeks?'),14);
  assert.throws(()=>requestedHorizon('Can I cover payments for ninety-one days?'),e=>e.status===400);
});

pg('Dated finance reports and balance enquiries use historical settled balances and inclusive Singapore boundaries',async t=>{
  const f=await fixture(t,{now}),user=await actor(f.db),client=f.client();await client.login();
  const account=(await f.db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance,created_at) VALUES($1,'Dated savings','9100008011',100000,100000,'seed','2026-01-01T00:00:00Z') RETURNING id",[user.id])).rows[0];
  const expected=[];
  for(const [amount,at,status] of [[1000,'2026-01-14T15:59:59.999Z','completed'],[2000,'2026-01-14T16:00:00Z','completed'],[-500,'2026-01-15T15:59:59.999Z','completed'],[-700,'2026-01-15T16:00:00Z','completed'],[-400,'2026-01-15T02:00:00Z','pending_review'],[-300,'2026-01-15T03:00:00Z','rejected']]){
    const id=randomUUID();await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,$3,'Dated activity',$4,'Dated Company',$5,$6,$6,CASE WHEN $5='completed' THEN $6::timestamptz END,CASE WHEN $5='completed' THEN nextval('settlement_sequence') END)",[id,account.id,amount>0?'credit':'transfer',amount,status,at]);
    if(status==='completed')await f.db.query('UPDATE accounts SET balance_cents=balance_cents+$2 WHERE id=$1',[account.id,amount]);
    if(at>='2026-01-14T16:00:00Z'&&at<'2026-01-15T16:00:00Z')expected.push(id);
  }
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const report=await finance.create(f.db,user,new URLSearchParams({from:'2026-01-15',to:'2026-01-15'}),{now});
  const a=report.accounts.find(a=>a.id===String(account.id));
  assert.equal(a.openingBalanceCents,101000);assert.equal(a.closingBalanceCents,102500);assert.equal(a.balanceCents,101800);
  assert.equal(report.totals.openingBalanceCents,101000);assert.equal(report.totals.closingBalanceCents,102500);assert.equal(report.totals.balanceChangeCents,1500);
  assert.match(finance.csv(report).content,/"Period opening balance",1010\.00/);assert.match(pdfText((await pdf(report)).content),/Period closing balance: SGD 1025\.00/);
  const balance=await client.request('/api/agents/assistant',{method:'POST',body:{message:'What were my balances between 15 January 2026 and 15 January 2026?'}});
  assert.equal(balance.status,200,JSON.stringify(balance.data));assert.equal(balance.data.narrativeWithheld,undefined);
  assert.equal(balance.data.items.find(i=>i.title==='Closing balance across your accounts').amountCents,102500);
  const search=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Show transactions from 15/01/2026 to 15/01/2026'}});
  assert.equal(search.status,200,JSON.stringify(search.data));assert.equal(search.data.narrativeWithheld,undefined);
  const data=(await f.db.query('SELECT result_json FROM agent_tool_calls WHERE run_id=$1 AND tool_name=$2',[search.data.runId,'search_transactions'])).rows[0].result_json;
  assert.deepEqual(data.transactions.map(t=>t.id).sort(),expected.sort());assert.equal(data.total,4);
  assert.deepEqual(search.data.actions[0].filters,{from:'2026-01-15',to:'2026-01-15'});
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  await f.db.query('UPDATE accounts SET balance_cents=balance_cents+1 WHERE id=$1',[account.id]);
  await assert.rejects(finance.create(f.db,user,new URLSearchParams({from:'2026-01-15',to:'2026-01-15'}),{now}),e=>e.status===409);
});

pg('Shorthand presentation questions use the same financial snapshots and filters as full dates',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();const user=await actor(f.db);
  const canonical=await finance.create(f.db,user,new URLSearchParams({from:'2026-11-01',to:'2026-11-09'}),{now});
  const before=(await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
  for(const message of ['Generate a finance report from 1 to 9 November 2026.','Generate a finance report from November 1 to 9, 2026.']){
    const r=await client.request('/api/agents/assistant',{method:'POST',body:{message}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.clarification,undefined);assert.equal(r.data.narrativeWithheld,undefined);
    assert.deepEqual(r.data.financeReport.period,canonical.period);
    const recorded=(await f.db.query("SELECT result_json FROM agent_tool_calls WHERE run_id=$1 AND tool_name='get_finance_report'",[r.data.runId])).rows[0].result_json;
    assert.deepEqual(recorded.totals,canonical.totals);
  }
  const b=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Show my opening and closing balances from 1 to 9 November 2026.'}});assert.equal(b.status,200,JSON.stringify(b.data));assert.equal(b.data.clarification,undefined);
  assert.match(b.data.items.find(i=>i.title==='Historical balance period').detail,/2026-11-01 to 2026-11-09/);
  assert.equal(b.data.items.find(i=>i.title==='Closing balance across your accounts').amountCents,canonical.totals.closingBalanceCents);
  const h=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Show my transactions from 1 to 9 November 2026.'}});assert.equal(h.status,200,JSON.stringify(h.data));assert.equal(h.data.clarification,undefined);
  assert.equal(h.data.actions.find(a=>a.page==='activity').filters.from,'2026-11-01');assert.equal(h.data.actions.find(a=>a.page==='activity').filters.to,'2026-11-09');
  assert.deepEqual((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows,before);
});

pg('Invalid assistant report periods ask for clarification without errors, invented periods or download buttons',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();
  for(const message of ['Generate a finance report from date to date','Generate a finance report from 31/02/2026 to 02/03/2026','Generate a finance report from 1 November 2026 to 30 November 2026']){
    const result=await client.request('/api/agents/assistant',{method:'POST',body:{message}});
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.clarification,true);assert.equal(result.data.narrativeWithheld,undefined);assert.equal(result.data.financeReport,undefined);
    assert.ok(result.data.items.some(i=>i.title==='Please clarify the report period'));assert.deepEqual(result.data.actions,[]);
  }
});

pg('A dates-only follow-up resumes the pending read-only enquiry and unrelated questions discard it',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();
  for(const [message,tool] of [['Generate a finance report from date to date','get_finance_report'],['Show transactions from date to date','search_transactions'],['What were my balances from date to date?','get_accounts']]){
    const pending=await client.request('/api/agents/assistant',{method:'POST',body:{message}});
    assert.equal(pending.status,200,JSON.stringify(pending.data));assert.equal(pending.data.clarification,true);
    const completed=await client.request('/api/agents/assistant',{method:'POST',body:{message:'1 November 2026 to 9 November 2026',previousRunId:pending.data.runId}});
    assert.equal(completed.status,200,JSON.stringify(completed.data));assert.equal(completed.data.narrativeWithheld,undefined);assert.equal(completed.data.clarification,undefined);assert.equal(completed.data.steps[0].tool,tool);
    const context=(await f.db.query('SELECT context_json FROM agent_runs WHERE id=$1',[completed.data.runId])).rows[0].context_json;
    assert.equal(context.pendingDateEnquiry,null);
  }
  const pending=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Generate a finance report from date to date'}});
  const unrelated=await client.request('/api/agents/assistant',{method:'POST',body:{message:'What food should I eat on 1 November 2026?',previousRunId:pending.data.runId}});
  assert.equal(unrelated.status,200,JSON.stringify(unrelated.data));assert.equal(unrelated.data.financeReport,undefined);assert.equal(unrelated.data.steps.length,0);
});
pg('Assistant finance tool returns an owned live snapshot and download controls without storing exported files or changing money',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Pull a real time finance report for the last 30 days that I can download'}});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.narrativeWithheld,undefined);assert.equal(result.data.steps[0].tool,'get_finance_report');assert.equal(result.data.financeReport.period.from,'2026-10-12');
  assert.equal(result.data.financeReport.generatedAt,new Date(NOW).toISOString());assert.ok(result.data.items.some(item=>item.title==='Current account balances'));
  const recorded=(await f.db.query('SELECT result_json FROM agent_tool_calls WHERE run_id=$1',[result.data.runId])).rows[0].result_json;
  assert.equal(recorded.transactions,undefined);assert.equal(recorded.totals.balanceCents,result.data.items[0].amountCents);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  const other=f.client();await other.login('jamie@greenlink.demo');assert.equal((await other.request('/api/agents/runs/'+result.data.runId)).status,404);
  const agents=createAgents({db:f.db,now,model:{mode:'openai',model:'wrong-finance-tool',inspect:async()=>({available:true}),chat:async messages=>messages.some(m=>m.role==='tool')?{content:'Download your report below [E1].'}:{tool_calls:[{function:{name:'get_accounts',arguments:{}}}]}}});
  const wrong=await agents.execute(await actor(f.db),'assistant',{message:'Download a finance report'});
  assert.equal(wrong.narrativeWithheld,true);assert.equal(wrong.financeReport,undefined);
});
pg('Large finance exports fail explicitly instead of silently returning partial ledger data',async t=>{
  const f=await fixture(t,{http:false,now}),user=await actor(f.db),account=(await f.db.query('SELECT id FROM accounts WHERE user_id=$1 LIMIT 1',[user.id])).rows[0];
  await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq) SELECT 'finance-bulk-'||g,$1,'transfer','Bulk report entry',-1,'Supplier','completed','BULK',false,$2,$2,$2,nextval('settlement_sequence') FROM generate_series(1,10001) g",[account.id,'2026-01-15T00:00:00Z']);
  await assert.rejects(finance.create(f.db,user,new URLSearchParams({from:'2026-01-15',to:'2026-01-15'}),{now}),e=>e.status===413);
  await assert.rejects(pdf({transactions:Array(2001).fill({})}),e=>e.status===413);
});

pg('A payment committed during report generation cannot mix new ledger entries with an older balance snapshot',async t=>{
  const f=await fixture(t),alex=f.client(),jamie=f.client();await alex.login();await jamie.login('jamie@greenlink.demo');
  const user=await actor(f.db),recipient=(await alex.dashboard()).accounts[0],sender=(await jamie.dashboard()).accounts[0];
  const before=await finance.create(f.db,user);
  let committed=false;
  const wrapped={transaction:(work,options)=>f.db.transaction(client=>work({query:async(sql,values)=>{
    const result=await client.query(sql,values);
    if(!committed && sql.startsWith('SELECT id::text,name,number,status,balance_cents FROM accounts')){
      committed=true;const payment=await jamie.request('/api/transfers',{method:'POST',body:{fromAccountId:sender.id,toAccountNumber:recipient.number,amount:'0.01',description:'Concurrent finance snapshot',requestId:randomUUID()}});
      assert.equal(payment.status,200,JSON.stringify(payment.data));
    }
    return result;
  }}),options)};
  const during=await finance.create(wrapped,user),after=await finance.create(f.db,user);
  assert.equal(committed,true);
  assert.equal(during.totals.balanceCents,before.totals.balanceCents);assert.equal(during.totals.incomeCents,before.totals.incomeCents);assert.equal(during.transactions.length,before.transactions.length);
  assert.equal(after.totals.balanceCents,before.totals.balanceCents+1);assert.equal(after.totals.incomeCents,before.totals.incomeCents+1);assert.equal(after.transactions.length,before.transactions.length+1);
});
