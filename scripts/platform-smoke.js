'use strict';

// Exercise real Express/PostgreSQL and FastAPI against a disposable schema.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
let base;
const password = 'Greenlink123!';
class BrowserSession {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async request(path, body, method = 'POST', expected = 200) {
    const response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : method, headers: { Cookie: this.cookie, Origin: new URL(base).origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    if (result.csrfToken) this.csrf = result.csrfToken;
    return result;
  }
  async login(email) { await this.request('/api/session'); return this.request('/api/auth/login', { email, password }); }
}

async function runSmoke(baseUrl, { fraudUrl = process.env.FRAUD_SERVICE_URL, token = process.env.SERVICE_TOKEN } = {}) {
  base = baseUrl;
  const destination = new URL(base);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(destination.hostname), 'Smoke tests require an isolated loopback application.');
  assert.ok(fraudUrl && token, 'Set the matching local FRAUD_SERVICE_URL and SERVICE_TOKEN for the smoke test.');
  const pythonHeaders = { Authorization: 'Bearer ' + token, 'Content-Type':'application/json' };
  assert.equal((await fetch(new URL('/internal/health',fraudUrl))).status,401);
  const pythonHealth = await fetch(new URL('/internal/health',fraudUrl),{headers:pythonHeaders});
  assert.equal(pythonHealth.status,200);
  assert.equal((await pythonHealth.json()).service,'fraud');
  const modelInfoResponse=await fetch(new URL('/internal/model',fraudUrl),{headers:pythonHeaders});
  const modelAvailable=modelInfoResponse.status===200;
  const bound = {transactionId:randomUUID(),userId:'smoke-user',sourceAccountId:'smoke-source',payloadHash:'a'.repeat(64),type:'transfer',amountCents:100,accountBalanceCents:10000,payee:'1020002001',isInternal:false,createdAt:new Date().toISOString(),historySummary:{averageOutgoingCents:0,outgoingCount10m:0,outgoingAmount10m:0,dailyOutgoingCents:0,historyCount:0,knownPayee:false}};
  const modelResponse=await fetch(new URL('/internal/assess',fraudUrl),{method:'POST',headers:pythonHeaders,body:JSON.stringify(bound)});
  if(!modelAvailable){
    assert.equal(modelResponse.status,503);
    const client=new BrowserSession();await client.login('alex@greenlink.demo');const before=await client.request('/api/dashboard');
    await client.request('/api/agents/assistant',{message:'test'},'POST',503);
    await client.request('/api/transfers',{fromAccountId:before.accounts[0].id,toAccountNumber:'1020002001',amount:'1.25',authorizationPassword:password,requestId:randomUUID()},'POST',503);
    assert.deepEqual((await client.request('/api/dashboard')).accounts.map(a=>a.balanceCents),before.accounts.map(a=>a.balanceCents));
    console.log('No local model in this fixture: Ollama-only assistant and payment screening fail closed; account reads remain available and balances are unchanged. Run with installed Ollama for real inference coverage.');return;
  }
  assert.equal(modelResponse.status,200);
  const rawModel=(await modelResponse.json()).risk;
  for(const field of ['transactionId','userId','sourceAccountId','payloadHash','type','amountCents','payee','isInternal'])assert.equal(rawModel[field],bound[field]);
  assert.ok(Number.isInteger(rawModel.score) && rawModel.score>=0 && rawModel.score<=94);
  assert.equal(rawModel.modelScore,rawModel.score);
  assert.equal(rawModel.decision,rawModel.score>=65?'review':'allow');
  assert.equal(rawModel.provider,'ollama');assert.equal(rawModel.synthetic,undefined);assert.match(rawModel.modelSha256,/^[a-f0-9]{64}$/);
  assert.equal(rawModel.ruleVersion,undefined);
  const malformed=await fetch(new URL('/internal/assess',fraudUrl),{method:'POST',headers:pythonHeaders,body:JSON.stringify({...bound,amountCents:'100',authorizationPassword:'Never-echo-this-secret-123!'})});
  assert.equal(malformed.status,422);
  assert.doesNotMatch(await malformed.text(),/Never-echo-this-secret/);
  const duplicate=await fetch(new URL('/internal/assess',fraudUrl),{method:'POST',headers:pythonHeaders,body:'{"amountCents":1,"amountCents":2}'});
  assert.equal(duplicate.status,400);
  const nonfinite=await fetch(new URL('/internal/assess',fraudUrl),{method:'POST',headers:pythonHeaders,body:'{"amountCents":NaN}'});
  assert.equal(nonfinite.status,400);
  assert.equal((await fetch(new URL('/health', base))).status, 200);
  assert.equal((await fetch(new URL('/internal/jobs/tick', base), { method: 'POST' })).status, 404);
  const alex = new BrowserSession(), recipient = new BrowserSession(), reviewer = new BrowserSession();
  async function settleHeld(transaction){
    if(transaction.status!=='pending_review')return transaction;
    await reviewer.login('reviewer@greenlink.demo');
    return (await reviewer.request('/api/fraud/reviews/'+transaction.id,{decision:'approve',reason:'Independent authorization in a disposable real-model integration fixture.',authorizationPassword:password})).transaction;
  }
  await alex.login('alex@greenlink.demo');
  const original = await alex.request('/api/dashboard');
  const source = original.accounts.find(a => a.name === 'Operating savings') || original.accounts[0];
  const localAgent=(await alex.request('/api/agents/status')).agent;
  if(localAgent.available){
    const assistantBalance = await alex.request('/api/assistant/messages', { message: 'What is my balance?' });
    assert.equal(assistantBalance.engine, 'ollama');
    assert.ok(assistantBalance.evidenceReferences.some(e=>e.tool==='get_accounts'));
    assert.equal(assistantBalance.privacy.externalServices, false);
    const assistantDraft = await alex.request('/api/assistant/messages', { message: 'Transfer SGD 25 to 1020002001' });
    assert.equal(assistantDraft.actions[0].type, 'draft_transfer');
    assert.equal(assistantDraft.requiresAuthorization, true);
    console.log('Local Ollama assistant evidence and draft checks passed.');
  }else{
    await alex.request('/api/assistant/messages', { message: 'What is my balance?' }, 'POST', 503);
    await alex.request('/api/agents/reconciliation', {}, 'POST', 503);
    console.log('Ollama is not installed in this fixture: verified explicit AI unavailability with no offline fallback. Run demo:agents locally for real model coverage.');
  }
  assert.equal((await alex.request('/api/dashboard')).accounts.find(a => a.id === source.id).balanceCents, source.balanceCents);
  const first = await alex.request('/api/transfers', { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '1.25', description: 'Service smoke transfer', authorizationPassword: password, requestId: randomUUID() });
  first.transaction=await settleHeld(first.transaction);
  assert.equal(first.transaction.status, 'completed');
  assert.equal(typeof first.transaction.risk.score, 'number');
  const afterFirst = await alex.request('/api/dashboard');
  assert.equal(afterFirst.accounts.find(a => a.id === source.id).balanceCents, source.balanceCents - 125);

  await recipient.request('/api/session');
  const registration = await recipient.request('/api/auth/register', { name: 'Smoke Recipient', email: `smoke-${randomUUID()}@greenlink.demo`, password, confirmPassword: password,business:{legalName:'Smoke Trading Pte. Ltd.',registrationNumber:'SMOKE'+randomUUID().replace(/-/g,'').slice(0,16),country:'SG',legalForm:'company',industry:'Business services',registeredAddress:'1 Sample Business Road, Singapore 000001'} }, 'POST', 201);
  await reviewer.login('reviewer@greenlink.demo');
  await reviewer.request(`/api/business/applications/${registration.business.id}/review`,{decision:'approve',version:registration.business.version,reason:'Business registration checked for isolated project smoke.',verificationConfirmed:true,authorizationPassword:password});
  const target = registration.account || (await recipient.request('/api/dashboard')).accounts[0];
  const held = await alex.request('/api/transfers', { fromAccountId: source.id, toAccountNumber: target.number, amount: '2000.00', description: 'Review smoke transfer', authorizationPassword: password, requestId: randomUUID() });
  assert.equal(held.transaction.status, 'pending_review');
  assert.equal((await alex.request('/api/dashboard')).accounts.find(a => a.id === source.id).balanceCents, source.balanceCents - 125);
  await alex.request(`/api/fraud/reviews/${held.transaction.id}`, { decision: 'approve', reason: 'Own approval must be denied', authorizationPassword: password }, 'POST', 403);
  await reviewer.login('reviewer@greenlink.demo');
  assert.ok((await reviewer.request('/api/fraud/reviews')).reviews.some(t => t.id === held.transaction.id));
  const approved = await reviewer.request(`/api/fraud/reviews/${held.transaction.id}`, { decision: 'approve', reason: 'Independent review of isolated service smoke', authorizationPassword: password });
  assert.equal(approved.transaction.status, 'completed');
  assert.equal((await recipient.request('/api/dashboard')).accounts[0].balanceCents, 200000);

  const bill = await alex.request('/api/payments', { fromAccountId: source.id, billerId: 'sp-services', reference: 'SMOKE-UTILITY-001', amount: '0.75', authorizationPassword: password, requestId: randomUUID() });
  bill.transaction=await settleHeld(bill.transaction);
  assert.equal(bill.transaction.status, 'completed');
  const schedule = await alex.request('/api/scheduled-payments', { type: 'bill', fromAccountId: source.id, billerId: 'pub', reference: 'SMOKE-SCHEDULE-001', amount: '1.00', scheduledAt: new Date(Date.now() + 3600000).toISOString(), frequency: 'once', authorizationPassword: password, requestId: randomUUID() }, 'POST', 201);
  assert.equal(schedule.schedule.status, 'active');
  await alex.request(`/api/scheduled-payments/${schedule.schedule.id}`, {}, 'DELETE');
  assert.equal((await alex.request('/api/fraud/rules')).rules.length, 5);
  assert.equal((await alex.request('/api/fraud/model')).model.provider, 'ollama');
  const history = await alex.request('/api/transactions?q=Service%20smoke%20transfer&pageSize=1');
  assert.equal(history.transactions[0].id, first.transaction.id);
  assert.equal(history.pagination.total, 1);
  assert.equal((await alex.request(`/api/transactions/${first.transaction.id}`)).transaction.id, first.transaction.id);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const statement = (await alex.request(`/api/statements?accountId=${source.id}&from=${today}&to=${today}`)).statement;
  assert.equal(statement.period.timeZone, 'Asia/Singapore');
  assert.ok(statement.transactions.some(t => t.id === first.transaction.id));
  const csv = await fetch(new URL('/api/transactions/export?q=Service%20smoke%20transfer', base), { headers: { Cookie: alex.cookie } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /Service smoke transfer/);
  const rules = await alex.request('/api/fraud/rules');
  await alex.request('/api/fraud/rules/high_value', { version: rules.version, threshold: 9000, authorizationPassword: password }, 'PATCH');
  const audit = await alex.request('/api/fraud/rules/audit?ruleId=high_value&pageSize=1');
  assert.equal(audit.entries[0].actor.name, 'Alex Morgan');
  assert.equal(audit.entries[0].before.threshold, 10000);
  assert.equal(audit.entries[0].after.threshold, 9000);
  let notifications;
  for (let attempt = 0; attempt < 40; attempt++) {
    notifications = await alex.request('/api/notifications');
    if (notifications.notifications.some(n => n.transactionId === first.transaction.id)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(notifications.notifications.some(n => n.transactionId === first.transaction.id));
  assert.equal((await alex.request('/api/notifications/all', { read: true }, 'PATCH')).unreadCount, 0);
  console.log('DFT smoke passed: authenticated FastAPI contracts, Express/PostgreSQL banking, local-model availability boundary, screening/review, transfers/bills, schedules, notifications, history/statements and rule audit.');
}

async function unusedPort() {
  const server = require('node:net').createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
async function runIsolated() {
  const {Pool}=require('pg');
  const {randomBytes}=require('node:crypto');
  const {once}=require('node:events');
  const {startPlatform}=require('./start-platform');
  if(!process.env.TEST_DATABASE_URL)throw new Error('Set TEST_DATABASE_URL to run an isolated PostgreSQL/FastAPI smoke.');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const schema='dft_smoke_'+randomUUID().replace(/-/g,'');
  assert.match(schema,/^dft_smoke_[a-f0-9]{32}$/);
  let platform,created=false;
  try {
    await admin.query('CREATE SCHEMA '+schema);created=true;
    const database=new URL(process.env.TEST_DATABASE_URL);database.searchParams.set('options','-c search_path='+schema);
    const publicPort=await unusedPort(),fraudPort=await unusedPort();
    const token=randomBytes(32).toString('hex'),fraudUrl='http://127.0.0.1:'+fraudPort,origin='http://127.0.0.1:'+publicPort;
    const env={...process.env,DATABASE_URL:database.toString(),SERVICE_TOKEN:token,AUTH_ENCRYPTION_KEY:randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:String(publicPort),PUBLIC_ORIGIN:origin,FRAUD_PORT:String(fraudPort),FRAUD_SERVICE_URL:fraudUrl,SEED_DEMO:'true'};
    platform=await startPlatform({env});
    await runSmoke(origin,{fraudUrl,token});
  } finally {
    if(platform){const exited=platform.children.filter(child=>child.exitCode===null && child.signalCode===null).map(child=>once(child,'exit'));platform.stop();await Promise.all(exited);}
    if(created){assert.match(schema,/^dft_smoke_[a-f0-9]{32}$/);await admin.query('DROP SCHEMA '+schema+' CASCADE');}
    await admin.end();
  }
}
module.exports={runSmoke,runIsolated};
if(require.main===module)(process.env.PLATFORM_SMOKE_BASE_URL?runSmoke(process.env.PLATFORM_SMOKE_BASE_URL):runIsolated()).catch(error=>{console.error(error.message);process.exitCode=1;});
