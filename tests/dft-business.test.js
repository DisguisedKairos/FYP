'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,businessProfile,totalBalance,accountNamed}=require('./dft-helpers');
const business=require('../banking/business');
const pgTest=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL&&'TEST_DATABASE_URL required.'},work);
const fail=status=>error=>error.status===status;
const application=(extra={})=>({name:'Business Operator',email:`operator-${randomUUID()}@example.test`,password:'Greenlink123!',business:businessProfile('CORP'+randomUUID().replace(/-/g,'').slice(0,16)),...extra});
async function register(f,body=application()){const client=f.client();await client.session();const response=await client.request('/api/auth/register',{method:'POST',body});assert.equal(response.status,201,JSON.stringify(response.data));return {client,...response.data,body};}

pgTest('Wholesale bank staff are provisioned through a local operator command without a customer company or deposit account',async t=>{
  const f=await fixture(t,{seed:false}),{createStaff}=require('../scripts/create-staff');
  const staff=await createStaff({db:f.db,email:'bankops@example.test',name:'Bank Operations',password:'PrivateStaff456!'});assert.equal(staff.role,'admin');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM businesses')).rows[0].count),0);assert.equal(Number((await f.db.query('SELECT count(*) FROM accounts')).rows[0].count),0);
  await assert.rejects(createStaff({db:f.db,email:staff.email,name:'Replacement',password:'AnotherPass789!'}),fail(409));
  const client=f.client();await client.login(staff.email,'PrivateStaff456!');assert.equal((await client.request('/api/business/applications')).status,404);
  assert.equal((await client.request('/api/accounts',{method:'POST',body:{name:'Staff personal account'}})).status,403);
  assert.equal((await client.request('/api/business/profile',{method:'POST',body:{business:businessProfile('STAFFIDENTITY001'),authorizationPassword:'PrivateStaff456!'}})).status,404);
  const audit=(await f.db.query("SELECT metadata FROM audit_log WHERE event_type='operator.staff_created'")).rows[0];assert.doesNotMatch(JSON.stringify(audit),/PrivateStaff456/);
});

test('Wholesale profiles accept non-personal legal entities and validate registered business information',()=>{
  for(const legalForm of ['company','partnership','institution'])assert.equal(business.normalize({...businessProfile(),legalForm}).legalForm,legalForm);
  for(const changed of [{legalForm:'individual'},{country:'US'},{registrationNumber:'x'},{legalName:'x'},{industry:''},{registeredAddress:'short'}])assert.throws(()=>business.normalize({...businessProfile(),...changed}),fail(400));
  assert.throws(()=>business.normalize(undefined),fail(400));
  assert.equal(business.normalize({...businessProfile(),registrationNumber:' abcdef1 '}).registrationNumber,'ABCDEF1');
});

pgTest('Wholesale registration creates an empty active business without accepting privileged fields or requiring staff review',async t=>{
  const f=await fixture(t),anonymous=f.client();await anonymous.session();
  const before=Number((await f.db.query('SELECT count(*) FROM users')).rows[0].count);
  assert.equal((await anonymous.request('/api/auth/register',{method:'POST',body:application({business:undefined})})).status,400);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM users')).rows[0].count),before);
  const faked=application({role:'admin'});faked.business.status='rejected';faked.business.primaryUserId='1';
  const created=await register(f,faked);assert.equal(created.user.role,'customer');assert.equal(created.business.status,'approved');assert.equal(created.business.primaryUserId,created.user.id);
  assert.equal(created.account.businessId,created.business.id);assert.equal(created.account.productType,'business_savings');
  assert.equal(totalBalance(await created.client.dashboard()),0,'Registration does not grant spendable funds.');
  assert.equal((await created.client.request('/api/business?userId=1')).data.business.id,created.business.id);
  const opened=await created.client.request('/api/accounts',{method:'POST',body:{name:'Treasury reserve',businessId:'1'}});
  assert.equal(opened.status,201,JSON.stringify(opened.data));assert.equal(opened.data.account.businessId,created.business.id);
  assert.equal(totalBalance(await created.client.dashboard()),0);
});

pgTest('Removed business application endpoints cannot submit profiles, list applications or change access for customers or staff',async t=>{
  const f=await fixture(t),created=await register(f),staff=f.client();await staff.login('reviewer@greenlink.demo');
  await f.db.query("UPDATE businesses SET status='rejected',review_json=$2 WHERE id=$1",[created.business.id,{reason:'Historical restricted identity'}]);
  const before=(await f.db.query('SELECT * FROM businesses WHERE id=$1',[created.business.id])).rows[0];
  for(const client of [created.client,staff]){
    assert.equal((await client.request('/api/business/applications')).status,404);
    assert.equal((await client.request(`/api/business/applications/${created.business.id}/review`,{method:'POST',body:{decision:'approve',version:before.version,verificationConfirmed:true,authorizationPassword:'Greenlink123!'}})).status,404);
    assert.equal((await client.request('/api/business/profile',{method:'POST',body:{business:created.body.business,version:before.version,authorizationPassword:'Greenlink123!'}})).status,404);
  }
  assert.deepEqual((await f.db.query('SELECT * FROM businesses WHERE id=$1',[created.business.id])).rows[0],before,'Retiring the workflow must preserve business access and historical decisions.');
  assert.equal((await f.db.query("SELECT count(*) FROM audit_log WHERE event_type IN ('business.application_submitted','business.application_reviewed')")).rows[0].count,'0');
  const oldPage=await fetch(f.baseUrl+'/business-onboarding',{redirect:'manual'});assert.equal(oldPage.status,302);assert.equal(oldPage.headers.get('location'),'/dashboard');
});

pgTest('Previously restricted business profiles still block financial writes while balances and history remain readable',async t=>{
  const f=await fixture(t),created=await register(f),client=created.client;
  for(const status of ['pending_review','rejected']){
    await f.db.query('UPDATE businesses SET status=$2 WHERE id=$1',[created.business.id,status]);
    const common={fromAccountId:created.account.id,amount:'1.00',requestId:randomUUID()};
    for(const[path,body]of [['/api/transfers',{...common,toAccountNumber:'1020002001'}],['/api/payments',{...common,requestId:randomUUID(),billerId:'pub',reference:'WHOLESALE-001'}],['/api/scheduled-payments',{...common,requestId:randomUUID(),type:'transfer',toAccountNumber:'1020002001',frequency:'once',scheduledAt:new Date(Date.now()+3600000).toISOString()}],['/api/accounts',{name:'Restricted account'}]]){
      const result=await client.request(path,{method:'POST',body});assert.equal(result.status,403,JSON.stringify(result.data));assert.equal(result.data.code,'BUSINESS_APPROVAL_REQUIRED');assert.doesNotMatch(result.data.error,/onboarding/i);
    }
    assert.equal(totalBalance(await client.dashboard()),0);assert.equal((await client.history()).transactions.length,0);
  }
});

pgTest('Wholesale funding requires an approved recipient and identifies the legal business on both ledger sides and statements',async t=>{
  const f=await fixture(t),created=await register(f),payer=f.client();await payer.login();
  const before=await payer.dashboard(),source=accountNamed(before,'Operating savings');
  const payload={fromAccountId:source.id,toAccountNumber:created.account.number,amount:'1.25',description:'Supplier business funding',requestId:randomUUID()};
  await f.db.query("UPDATE businesses SET status='pending_review' WHERE id=$1",[created.business.id]);
  assert.equal((await payer.request('/api/transfers',{method:'POST',body:payload})).status,409);
  await f.db.query("UPDATE businesses SET status='approved' WHERE id=$1",[created.business.id]);
  const paid=await payer.request('/api/transfers',{method:'POST',body:payload});assert.equal(paid.status,200,JSON.stringify(paid.data));assert.equal(paid.data.transaction.counterparty,created.business.legalName);
  const recipient=await created.client.dashboard();assert.equal(totalBalance(recipient),125);assert.equal(recipient.transactions[0].counterparty,'Meridian Logistics Pte. Ltd.');
  const statement=await created.client.request('/api/statements?'+new URLSearchParams({accountId:created.account.id,from:'2020-01-01',to:'2099-01-01'}));assert.equal(statement.status,200);assert.equal(statement.data.statement.business.legalName,created.business.legalName);
  assert.equal(totalBalance(await payer.dashboard()),totalBalance(before)-125);
});

pgTest('Wholesale business identity uniqueness and database ownership bindings prevent company-account takeover',async t=>{
  const f=await fixture(t),one=await register(f),twoBody=application({business:{...one.body.business,legalName:'Another company name'}}),client=f.client();await client.session();
  const before=Number((await f.db.query('SELECT count(*) FROM users')).rows[0].count);
  assert.equal((await client.request('/api/auth/register',{method:'POST',body:twoBody})).status,409);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM users')).rows[0].count),before);
  await assert.rejects(f.db.query("INSERT INTO accounts(user_id,name,number,business_id) VALUES($1,'Hijacked','9990000001',$2)",['1',one.business.id]),error=>error.code==='23514');
  assert.equal((await one.client.request('/api/accounts/1',{method:'PATCH',body:{name:'Takeover'}})).status,404);
});

pgTest('Wholesale schedules wait for business approval without losing the occurrence or consuming screening retries',async t=>{
  let clock=Date.now();const f=await fixture(t,{now:()=>clock}),client=f.client();await client.login();const before=await client.dashboard(),source=accountNamed(before,'Operating savings');
  const result=await client.request('/api/scheduled-payments',{method:'POST',body:{type:'transfer',frequency:'once',fromAccountId:source.id,toAccountNumber:'1020002001',amount:'1.00',description:'Wholesale standing instruction',requestId:randomUUID(),scheduledAt:new Date(clock+60000).toISOString()}});assert.equal(result.status,201);
  await f.db.query("UPDATE businesses SET status='pending_review' WHERE id=$1",[before.business.id]);clock+=61000;await f.runJobs();
  const first=(await client.request('/api/scheduled-payments')).data.schedules[0];assert.equal(first.lastStatus,'awaiting_business_approval');assert.equal(first.runs[0].attempts,0);assert.equal(first.nextRunAt,result.data.schedule.nextRunAt);assert.equal(totalBalance(await client.dashboard()),totalBalance(before));
  await f.db.query("UPDATE businesses SET status='approved' WHERE id=$1",[before.business.id]);clock+=61000;await f.runJobs();
  const last=(await client.request('/api/scheduled-payments')).data.schedules[0];assert.equal(last.status,'completed');assert.equal(last.runs[0].status,'completed');assert.equal(totalBalance(await client.dashboard()),totalBalance(before)-100);
});
