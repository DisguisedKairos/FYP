'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./dft-helpers'),reports=require('../banking/agents/reports'),finance=require('../banking/finance-reports');
const {prepareDraft}=require('../banking/agents/drafts'),funds=require('../banking/agents/funds');
const {narrativeIssue,relevanceIssue}=require('../banking/agents/evidence');
const {createAgents}=require('../banking/agents');
const pg=(name,fn)=>test(name,{skip:!process.env.TEST_DATABASE_URL},fn);
const actor=async(db,email='alex@greenlink.demo')=>(await db.query('SELECT * FROM users WHERE email=$1',[email])).rows[0];
async function schedule(client,source,{amount='40000.00',days=1,frequency='once'}={}){
  const result=await client.request('/api/scheduled-payments',{method:'POST',body:{type:'bill',fromAccountId:source.id,billerId:'pub',reference:'FUNDING-CHECK',amount,scheduledAt:new Date(Date.now()+days*86400000).toISOString(),frequency,requestId:randomUUID()}});
  assert.equal(result.status,201,JSON.stringify(result.data));return result.data;
}
pg('Payment drafts display exact source-account shortages without combining reserve funds or moving money',async t=>{
  const f=await fixture(t),client=f.client();await client.login();const accounts=(await client.dashboard()).accounts,source=accounts[0];
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),required=source.balanceCents+1,amount=(required/100).toFixed(2);
  const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Transfer SGD '+amount+' from '+source.number+' to 1020002001'}});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.narrativeWithheld,undefined);
  const warning=result.data.fundingWarnings.find(w=>w.code==='payment_shortfall');assert.ok(warning);assert.equal(warning.accountId,source.id);assert.equal(warning.availableCents,source.balanceCents);assert.equal(warning.requiredCents,required);assert.equal(warning.shortageCents,1);
  assert.equal(result.data.actions[0].type,'draft_transfer');assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
});
pg('Balance enquiries and finance reports warn about account-level scheduled gaps within the same read snapshot',async t=>{
  const f=await fixture(t,{poolMax:1}),client=f.client();await client.login();const source=(await client.dashboard()).accounts[0];await schedule(client,source);
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const balance=await client.request('/api/agents/assistant',{method:'POST',body:{message:'What is my balance?'}});
  assert.equal(balance.status,200,JSON.stringify(balance.data));assert.equal(balance.data.fundingWarnings[0].code,'scheduled_shortfall');assert.equal(balance.data.fundingWarnings[0].shortageCents,4000000-source.balanceCents);assert.equal(balance.data.fundingWarnings[0].days,30);
  const report=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Generate a downloadable finance report'}});
  assert.equal(report.status,200,JSON.stringify(report.data));assert.ok(report.data.financeReport);assert.equal(report.data.fundingWarnings[0].accountId,source.id);
  const direct=await finance.create(f.db,await actor(f.db),new URLSearchParams(),{includeFunding:true});assert.equal(direct.fundingCheck.warnings[0].shortageCents,balance.data.fundingWarnings[0].shortageCents);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
});
pg('Recurring schedules report the largest gap and first shortage date, while narrower horizons exclude later obligations',async t=>{
  const f=await fixture(t),client=f.client();await client.login('jamie@greenlink.demo');const source=(await client.dashboard()).accounts[0];await schedule(client,source,{amount:'400.00',frequency:'weekly'});
  const user=await actor(f.db,'jamie@greenlink.demo'),projection=await reports.liquidity(f.db,user,{days:30}),warning=projection.fundingCheck.warnings[0];
  assert.equal(projection.occurrences.length,5);assert.equal(warning.shortageCents,80000);assert.equal(warning.dueAt,projection.occurrences[3].dueAt);
  const short=await reports.liquidity(f.db,user,{days:7});assert.deepEqual(short.fundingCheck.warnings,[]);
  assert.deepEqual(funds.collect([{tool:'get_accounts',value:{fundingCheck:projection.fundingCheck}},{tool:'project_liquidity',value:short}]),[],'The latest selected coverage period replaces earlier coverage warnings.');
});
pg('No fixed low-balance threshold is invented, and a payment equal to available funds produces no shortage',async t=>{
  const f=await fixture(t),client=f.client();await client.login();const zero=await client.request('/api/accounts',{method:'POST',body:{name:'Zero balance, no payments'}});assert.equal(zero.status,201);
  const user=await actor(f.db),read=await reports.balances(f.db,user);assert.ok(read.accounts.some(a=>a.balanceCents===0));assert.deepEqual(read.fundingCheck.warnings,[]);
  const source=read.accounts[0],draft=await prepareDraft(f.db,user,{kind:'transfer',fromAccountId:source.id,toAccountNumber:'1020002001',amount:(source.balanceCents/100).toFixed(2)});
  assert.deepEqual(draft.fundingWarnings,[]);assert.deepEqual(funds.draftWarnings({id:'1',name:'Minimal balance',balance_cents:'1'},1),[]);
  await schedule(client,source,{amount:(source.balanceCents/100).toFixed(2)});
  assert.deepEqual((await reports.balances(f.db,user)).fundingCheck.warnings,[],'Reaching zero is covered when the entered obligation exactly matches funds.');
});
pg('Scheduled drafts disclose current insufficiency without claiming the future payment failed or reserving funds',async t=>{
  const f=await fixture(t,{http:false}),user=await actor(f.db),source=(await f.db.query('SELECT * FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
  const result=await prepareDraft(f.db,user,{kind:'schedule',type:'bill',fromAccountId:String(source.id),billerId:'pub',reference:'FUTURE-FUNDING',amount:'40000.00',scheduledAt:new Date(Date.now()+86400000).toISOString(),frequency:'once'});
  assert.equal(result.complete,true);assert.equal(result.fundingWarnings[0].code,'scheduled_draft_shortfall');assert.match(result.fundingWarnings[0].message,/funds will be checked again/);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count),0);
});
pg('Funding warnings remain private to the signed-in operator and an outdated auth version cannot read balances',async t=>{
  const f=await fixture(t),alex=f.client(),jamie=f.client();await alex.login();await jamie.login('jamie@greenlink.demo');
  const source=(await alex.dashboard()).accounts[0];await schedule(alex,source);
  const other=await jamie.request('/api/agents/assistant',{method:'POST',body:{message:'Am I low on funds?'}});assert.equal(other.status,200,JSON.stringify(other.data));assert.deepEqual(other.data.fundingWarnings,[]);
  const user=await actor(f.db);await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id]);
  await assert.rejects(reports.balances(f.db,user),e=>e.status===409);
});
test('Funding guardrails reject false reassurance while allowing explicit insufficiency and unaltered authoritative warnings',()=>{
  const warning={code:'payment_shortfall',shortageCents:100},results=[{tool:'prepare_payment_draft',value:{complete:true,fundingWarnings:[warning]}}],options={results,evidence:[{id:'E1'}],requireCitations:true};
  assert.match(narrativeIssue('You have sufficient funds [E1].',null,options),/funding/);
  assert.equal(narrativeIssue('You do not have enough funds for this draft [E1].',null,options),null);
  assert.ok(relevanceIssue('Am I low on funds?',[{tool:'search_transactions'}]));
  assert.deepEqual(funds.collect(results),[warning]);
});
pg('An oversized scheduled-payment check reports incomplete coverage instead of reassuring the customer or hiding balances',async t=>{
  const f=await fixture(t,{http:false}),user=await actor(f.db),source=(await f.db.query('SELECT * FROM accounts WHERE user_id=$1 ORDER BY id LIMIT 1',[user.id])).rows[0];
  await f.db.query("INSERT INTO scheduled_payments(id,user_id,type,payload_json,amount_cents,frequency,status,next_run_at,scheduled_at,authorization_json) SELECT 'funding-bulk-'||g,$1,'bill',$2,1,'once','active',now()+interval '1 day',now()+interval '1 day','{}'::jsonb FROM generate_series(1,501) g",[user.id,{fromId:String(source.id),billerId:'pub',reference:'BULK',amountCents:1}]);
  const result=await reports.balances(f.db,user);assert.ok(result.accounts.length);assert.equal(result.fundingCheck.available,false);assert.equal(result.fundingCheck.warnings[0].code,'coverage_unavailable');
});

pg('Direct payment affordability questions use the entered amount and source without creating a payment draft',async t=>{
  const f=await fixture(t),client=f.client();await client.login();const source=(await client.dashboard()).accounts[0],before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  const result=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Can I afford SGD '+((source.balanceCents+1)/100).toFixed(2)+' from '+source.number+'?'}});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.steps[0].tool,'check_payment_funds');assert.equal(result.data.narrativeWithheld,undefined);assert.equal(result.data.fundingWarnings[0].shortageCents,1);assert.match(result.data.fundingWarnings[0].title,/proposed payment/);assert.deepEqual(result.data.actions,[]);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  const missing=await client.request('/api/agents/assistant',{method:'POST',body:{message:'Can I afford SGD 10?'}});assert.equal(missing.status,200);assert.equal(missing.data.fundingWarnings[0].code,'payment_details_required');assert.deepEqual(missing.data.actions,[]);
});
test('Funding validation recognizes a retrieved default planning check only for the matching requested period',()=>{
  const result={tool:'get_accounts',value:{fundingCheck:{available:true,days:30,occurrenceCount:1,warnings:[]}}};
  assert.equal(relevanceIssue('Do I have sufficient funds for scheduled payments over the next 30 days?',[result]),null);
  assert.ok(relevanceIssue('Can I cover upcoming payments over the next 7 days?',[result]));
  assert.ok(relevanceIssue('Can I cover upcoming payments over the next year?',[result]));
  assert.ok(relevanceIssue('Can I cover upcoming payments?',[{tool:'get_accounts'}]));
});

pg('Automatic funding checks require sign-in, isolate the owner and do not invoke AI or change money',async t=>{
  let modelCalls=0;
  const f=await fixture(t,{poolMax:1,agentModel:{name:'unused',complete:async()=>{modelCalls++;throw new Error('An automatic check must not call AI.');}}}),client=f.client();
  assert.equal((await client.request('/api/funding-check')).status,401);
  await client.login();const source=(await client.dashboard()).accounts[0];
  const instruction=await schedule(client,source,{amount:((source.balanceCents+1)/100).toFixed(2)});
  const before=JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows);
  for(let i=0;i<2;i++){
    const result=await client.request('/api/funding-check');
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal(result.data.fundingCheck.available,true);assert.equal(result.data.fundingCheck.days,30);
    assert.equal(result.data.fundingCheck.warnings[0].shortageCents,1);assert.equal(result.data.fundingCheck.warnings[0].accountId,source.id);
  }
  const other=f.client();await other.login('jamie@greenlink.demo');
  assert.deepEqual((await other.request('/api/funding-check')).data.fundingCheck.warnings,[]);
  assert.equal(modelCalls,0);assert.equal(Number((await f.db.query('SELECT count(*) FROM agent_runs')).rows[0].count),0);
  assert.equal(JSON.stringify((await f.db.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows),before);
  assert.equal((await client.request('/api/scheduled-payments/'+instruction.schedule.id,{method:'DELETE',body:{}})).status,200);
  assert.deepEqual((await client.request('/api/funding-check')).data.fundingCheck.warnings,[]);
});
pg('Automatic warnings recalculate after an owned-account top-up and include only the default planning window',async t=>{
  const f=await fixture(t),client=f.client();await client.login();
  const accounts=(await client.dashboard()).accounts,source=accounts[0],reserve=accounts[1];
  await schedule(client,source,{amount:'40000',days:40});
  assert.deepEqual((await client.request('/api/funding-check')).data.fundingCheck.warnings,[]);
  await schedule(client,source,{amount:((source.balanceCents+1)/100).toFixed(2)});
  assert.equal((await client.request('/api/funding-check')).data.fundingCheck.warnings[0].shortageCents,1);
  const payment=await client.request('/api/transfers',{method:'POST',body:{fromAccountId:reserve.id,toAccountNumber:source.number,amount:'0.01',description:'Fund known obligation',requestId:randomUUID()}});
  assert.equal(payment.status,200,JSON.stringify(payment.data));assert.equal(payment.data.transaction.status,'completed');
  assert.deepEqual((await client.request('/api/funding-check')).data.fundingCheck.warnings,[]);
});
