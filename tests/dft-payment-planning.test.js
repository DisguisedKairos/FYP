'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),planning=require('../banking/payment-planning'),finance=require('../banking/finance-reports'),funds=require('../banking/agents/funds');
const {relevanceIssue,narrativeIssue}=require('../banking/agents/evidence'),{argumentsFor}=require('../banking/agents');
const NOW=Date.parse('2026-11-12T04:00:00Z'),now=()=>NOW;
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async db=>(await db.query("SELECT * FROM users WHERE email='alex@greenlink.demo'")).rows[0];
const accounts=async db=>(await db.query("SELECT id::text,name,number,balance_cents FROM accounts WHERE user_id=(SELECT id FROM users WHERE email='alex@greenlink.demo') ORDER BY id")).rows.map(a=>({...a,balanceCents:Number(a.balance_cents)}));
const message=(source,{amount='100.00',date='2026-11-20',company='Harbour Supplies Pte. Ltd.'}={})=>'Summarize inflow and outflow this month. Can I pay SGD '+amount+' to '+company+' from '+source.name+' by '+date+'?';
async function schedule(client,source,{amount='2.00',at='2026-11-20T15:59:59.999Z',target=null,frequency='once'}={}){
  const result=await client.request('/api/scheduled-payments',{method:'POST',body:{type:target?'transfer':'bill',fromAccountId:source.id,...(target?{toAccountNumber:target.number}:{billerId:'pub',reference:'DATED-PLANNING'}),amount,scheduledAt:at,frequency,requestId:randomUUID()}});
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data.schedule;
}
test('Payment deadlines use inclusive Singapore dates, calendar month ends and bounded explicit periods',()=>{
  for(const [text,expected] of [['by 2026-11-20','2026-11-20'],['before 2026-11-20','2026-11-19'],['this month','2026-11-30'],['next month','2026-12-31'],['by 2026-12','2026-12-31'],['by November 2026','2026-11-30'],['by 20 Nov 2026','2026-11-20'],['before 20 Nov 2026','2026-11-19'],['today','2026-11-12'],['tomorrow','2026-11-13']]){
    const d=planning.deadlineFor(text,NOW);assert.equal(d.date,expected,text);assert.equal(d.timeZone,'Asia/Singapore');assert.ok(d.until>NOW);
    assert.equal(new Date(d.until-1+8*3600000).toISOString().slice(0,10),expected);
  }
  assert.equal(planning.deadlineFor('this month',Date.parse('2026-11-30T16:00:00Z')).date,'2026-12-31');
  for(const text of ['2026-02-30','2026-11-11','2027-12-01','2026-13','by next week','by this date','by 2026-11-20 at 15:30','2026-11-20 and 2026-11-21','by 20 Nov 2026 or 21 Nov 2026','by November 2026 or December 2026','by 31 November 2026'])assert.ok(planning.deadlineFor(text,NOW).error,text);
});
test('Amounts and owned sources are derived from user text, and malformed or ambiguous details are never guessed',()=>{
  const own=[{id:'1',name:'Operating savings',number:'1020001001'},{id:'2',name:'Reserve',number:'1020001002'}];
  const input=planning.details(message(own[0],{amount:'1,234.56'}),own,NOW);
  assert.deepEqual(input.missing,[]);assert.equal(input.amountCents,123456);assert.equal(input.source.id,'1');assert.equal(input.company,'Harbour Supplies Pte. Ltd.');
  for(const amount of ['1e3','-1','1.234','12,34','0'])assert.ok(planning.details(message(own[0],{amount}),own,NOW).missing.length,amount);
  assert.ok(planning.details('Can I pay SGD 10 to Harbour by this month?',own,NOW).missing.some(s=>s.includes('source')));
  assert.ok(planning.details('Can I pay SGD 10 from Unowned account by this month?',[own[0]],NOW).missing.some(s=>s.includes('source')));
  assert.ok(planning.details(message(own[0]).replace('SGD','USD'),own,NOW).missing.length);
  assert.equal(planning.requested(message(own[0])),true);
  const named=message(own[0],{date:'November 2026'}).replace(' by ',' in ');assert.equal(planning.requested(named),true);assert.deepEqual(planning.details(named,own,NOW).missing,[]);
  assert.equal(planning.requested('Can I cover upcoming scheduled payments this month?'),false);
});
pg('A dated company check counts only schedules through the Singapore cutoff and never counts historical flow or future credits as new cash',async t=>{
  const f=await fixture(t,{now,poolMax:1}),client=f.client();await client.login();const user=await actor(f.db),own=await accounts(f.db),source=own[0];
  await schedule(client,source);await schedule(client,source,{amount:'40.00',at:'2026-11-20T16:00:00Z'});
  await schedule(client,own[1],{amount:'0.05',target:source});
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const result=await planning.assess(f.db,user,message(source,{amount:((source.balanceCents-199)/100).toFixed(2)}),{now}),p=result.paymentReadiness;
  assert.equal(p.status,'needs_funding');assert.equal(p.scheduledOutgoingCents,200);assert.equal(p.scheduledIncomingCents,5);assert.equal(p.shortageCents,1);assert.equal(p.afterPaymentCents,-1);assert.equal(p.deadline.date,'2026-11-20');assert.equal(p.company,'Harbour Supplies Pte. Ltd.');assert.equal(p.recipientVerified,false);
  const report=await finance.create(f.db,user,new URLSearchParams(),{now});
  assert.equal(p.flow.incomeCents,report.totals.incomeCents);assert.equal(p.flow.outgoingCents,report.totals.outgoingCents);
  assert.deepEqual(result.actions,[]);assert.equal(result.fundingWarnings[0].code,'dated_payment_shortfall');assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  const early=await planning.assess(f.db,user,message(source,{date:'2026-11-19',amount:(source.balanceCents/100).toFixed(2)}),{now});
  assert.equal(early.paymentReadiness.status,'covered');assert.equal(early.paymentReadiness.afterPaymentCents,0);assert.deepEqual(early.fundingWarnings,[]);
});
pg('Month-end planning expands recurring outflows only through the chosen calendar month',async t=>{
  const f=await fixture(t,{now}),client=f.client();await client.login();const source=(await accounts(f.db))[0];
  await schedule(client,source,{amount:'1.00',at:'2026-11-13T00:00:00Z',frequency:'weekly'});
  const result=await planning.assess(f.db,await actor(f.db),message(source,{date:'this month'}),{now});
  assert.equal(result.paymentReadiness.deadline.date,'2026-11-30');assert.equal(result.paymentReadiness.scheduledCount,3);assert.equal(result.paymentReadiness.scheduledOutgoingCents,300);
});
pg('Cash-flow summaries use settlement time and exclude pending, rejected, own-transfer and opening entries',async t=>{
  const f=await fixture(t,{http:false,now}),user=await actor(f.db),source=(await accounts(f.db))[0],before=await planning.assess(f.db,user,message(source).replace('this month.','last month.'),{now});
  for(const [amount,status,internal,description] of [[1000,'completed',false,'Invoice received'],[-200,'completed',false,'Supplier paid'],[-400,'pending_review',false,'Pending'],[-500,'rejected',false,'Rejected'],[600,'completed',true,'Own account'],[700,'completed',false,'Opening balance']]){
    await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,internal,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,$3,$4,$5,'Planning test',$6,$7,'2026-10-15T00:00:00Z','2026-10-01T00:00:00Z',CASE WHEN $6='completed' THEN '2026-10-15T00:00:00Z'::timestamptz END,CASE WHEN $6='completed' THEN nextval('settlement_sequence') END)",[randomUUID(),source.id,amount>0?'credit':'transfer',description,amount,status,internal]);
  }
  const after=(await planning.assess(f.db,user,message(source).replace('this month.','last month.'),{now})).paymentReadiness;
  assert.equal(after.flow.incomeCents,before.paymentReadiness.flow.incomeCents+1000);assert.equal(after.flow.outgoingCents,before.paymentReadiness.flow.outgoingCents+200);assert.equal(after.source.balanceCents,before.paymentReadiness.source.balanceCents);
  assert.equal(after.flow.period.from,'2026-10-01');assert.equal(after.flow.period.to,'2026-10-31');
});
pg('The assistant returns structured date-specific readiness without drafts, and ownership and revocation remain enforced',async t=>{
  const f=await fixture(t,{now}),client=f.client();assert.equal((await client.request('/api/agents/assistant',{method:'POST',body:{message:'Can I pay SGD 10 this month?'}})).status,401);
  await client.login();const source=(await accounts(f.db))[0],result=await client.request('/api/agents/assistant',{method:'POST',body:{message:message(source)}});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.steps[0].tool,'check_payment_funds');assert.equal(result.data.paymentReadiness.status,'covered');assert.equal(result.data.narrativeWithheld,undefined);assert.deepEqual(result.data.actions,[]);
  const other=f.client();await other.login('jamie@greenlink.demo');
  const privateResult=await other.request('/api/agents/assistant',{method:'POST',body:{message:message(source).replace(source.name,source.number)}});
  assert.equal(privateResult.status,200);assert.equal(privateResult.data.paymentReadiness.status,'needs_details');assert.equal(privateResult.data.paymentReadiness.source,null);
  const user=await actor(f.db);await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id]);
  await assert.rejects(planning.assess(f.db,user,message(source),{now}),e=>e.status===409);
});
pg('Missing or unsupported planning details yield cash-flow facts and explicit clarification without reassuring funding',async t=>{
  const f=await fixture(t,{http:false,now}),user=await actor(f.db);
  const result=await planning.assess(f.db,user,'Summarize inflow and outflow. Do I have enough funds to pay another company by next week?',{now});
  assert.equal(result.complete,false);assert.equal(result.paymentReadiness.status,'needs_details');assert.ok(result.missing.length>=3);assert.ok(result.paymentReadiness.flow);assert.deepEqual(result.actions,[]);
  const opts={results:[{tool:'check_payment_funds',value:result}],evidence:[{id:'E1'}],requireCitations:true};
  assert.match(narrativeIssue('You can pay the company [E1].',null,opts),/readiness/);
  assert.equal(narrativeIssue('The funding check needs more details [E1].',null,opts),null);
});
pg('Oversized scheduled scenarios return unavailable instead of a sufficient-funds result',async t=>{
  const f=await fixture(t,{http:false,now}),user=await actor(f.db),source=(await accounts(f.db))[0];
  await f.db.query("INSERT INTO scheduled_payments(id,user_id,type,payload_json,amount_cents,frequency,status,next_run_at,scheduled_at,authorization_json) SELECT 'planning-bulk-'||g,$1,'bill',$2,1,'once','active','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z','{}'::jsonb FROM generate_series(1,501) g",[user.id,{fromId:source.id,billerId:'pub',reference:'BULK',amountCents:1}]);
  const result=await planning.assess(f.db,user,message(source),{now});assert.equal(result.paymentReadiness.status,'unavailable');assert.equal(result.complete,false);assert.equal(result.fundingWarnings[0].code,'coverage_unavailable');
});
test('A generic balance or projection cannot answer a dated additional payment, and a shorter payment check replaces unrelated default-horizon warnings',()=>{
  const text=message({name:'Operating savings'});
  assert.ok(relevanceIssue(text,[{tool:'get_accounts',value:{accounts:[]}}]));
  assert.ok(relevanceIssue(text,[{tool:'project_liquidity',value:{shortfalls:[]}}]));
  const checked={tool:'check_payment_funds',value:{paymentReadiness:{status:'covered'},fundingWarnings:[]}};
  assert.equal(relevanceIssue(text,[checked]),null);
  assert.equal(narrativeIssue('There are sufficient funds for the requested scenario [E2].',null,{results:[{tool:'project_liquidity',value:{shortfalls:[{shortageCents:1}]}},checked],evidence:[{id:'E1'},{id:'E2'}],requireCitations:true}),null,'A prior general projection must not override the subsequent request-bound payment scenario.');
  assert.deepEqual(funds.collect([{tool:'get_accounts',value:{fundingCheck:{warnings:[{code:'scheduled_shortfall'}]}}},checked]),[]);
  assert.throws(()=>argumentsFor('check_payment_funds',{amount:10,userId:2}),e=>e.status===400);
});
