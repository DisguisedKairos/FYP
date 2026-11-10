'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{inflateSync}=require('node:zlib');
const {fixture}=require('./dft-helpers');
const finance=require('../banking/finance-reports'),{pdf}=require('../banking/finance-pdf');
const {createAgents,toolSchema,argumentsFor}=require('../banking/agents');
const {relevanceIssue}=require('../banking/agents/evidence');
const NOW=Date.parse('2026-11-10T04:00:00Z'),now=()=>NOW;
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async(db,email='alex@greenlink.demo')=>(await db.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
async function row(db,{email='alex@greenlink.demo',amount=-100,status='completed',at='2026-01-15T00:00:00Z',requested=at,internal=false,label='Test Supplier',description='Finance test payment',reference='FINANCE-TEST'}={}){
  const account=(await db.query('SELECT a.id FROM accounts a JOIN users u ON u.id=a.user_id WHERE u.email=$1 ORDER BY a.id LIMIT 1',[email])).rows[0];
  const id=randomUUID();
  await db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $7='completed' THEN nextval('settlement_sequence') END)",[id,account.id,amount>0?'credit':'transfer',description,amount,label,status,reference,internal,at,requested,status==='completed'?at:null]);return id;
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
  assert.deepEqual(toolSchema('get_finance_report').function.parameters.properties,{});
  assert.ok(relevanceIssue('Download a finance report',[{tool:'get_accounts'}]));
  assert.equal(relevanceIssue('Finance report with balances and cash flow',[{tool:'get_finance_report'}]),null);
  assert.ok(relevanceIssue('Can I afford future payments?',[{tool:'get_finance_report'}]),'A current activity snapshot cannot replace a future liquidity scenario.');
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
