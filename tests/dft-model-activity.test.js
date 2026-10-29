'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,MODEL_INFO}=require('./dft-helpers');
const pg=(name,work)=>test(name,{skip:!process.env.TEST_DATABASE_URL},work);
pg('OpenAI model activity requires staff and rejects the removed evaluation endpoint',async t=>{
 const f=await fixture(t),client=f.client();
 assert.equal((await client.request('/api/fraud/model-activity')).status,401);
 await client.login('jamie@greenlink.demo');assert.equal((await client.request('/api/fraud/model-activity')).status,403);
 await client.login('reviewer@greenlink.demo');
 assert.equal((await client.request('/api/fraud/evaluation')).status,404);
 for(const days of ['0','1e1','91'])assert.equal((await client.request('/api/fraud/model-activity?days='+days)).status,400);
 const r=await client.request('/api/fraud/model-activity');assert.equal(r.status,200);
 assert.equal(r.data.activity.provider,'openai');assert.equal(r.data.activity.status,'no_assessments');
 assert.equal(r.data.activity.accuracy,undefined);assert.equal(r.data.activity.baseline,undefined);
});
pg('Activity counts actual provider records while excluding legacy, changed models and future attempts',async t=>{
 const f=await fixture(t),client=f.client();await client.login();const account=(await client.dashboard()).accounts[0];
 const policy=await f.riskClient.getRules(),before=policy;
 const base={...MODEL_INFO,modelScore:25,decision:'allow'};
 const samples=[base,{...base,modelScore:75,decision:'review'},{...base,provider:'retired'},{...base,modelIdentitySha256:'c'.repeat(64)},null,base];
 for(let i=0;i<samples.length;i++)await f.db.query('INSERT INTO fraud_assessments(id,user_id,source_account_id,payload_hash,policy_version,policy_json,input_json,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),account.userId || 1,account.id,'a'.repeat(64),policy.version,policy,{},samples[i],new Date(Date.now()+(i===5?86400000:-1000)).toISOString()]);
 const r=await client.request('/api/fraud/model-activity');assert.equal(r.status,200);
 const value=r.data.activity;assert.equal(value.scored,2);assert.equal(value.legacy,1);assert.equal(value.otherModel,1);assert.equal(value.missing,1);
 assert.deepEqual(value.decisions,{allow:1,review:1,block:0});assert.equal(value.scoreSummary.mean,50);
 assert.deepEqual(await f.riskClient.getRules(),before);
});
pg('Activity refuses unverified current provider provenance',async t=>{
 const f=await fixture(t,{http:false});const user=(await f.db.query("SELECT id,role,auth_version FROM users WHERE email='reviewer@greenlink.demo'")).rows[0];
 await assert.rejects(require('../banking/fraud-monitoring').modelActivity(f.db,user,{activeModel:{provider:'retired'}}),e=>e.status===503);
});
