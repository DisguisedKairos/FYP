'use strict';

// Financial mutations are allowed only against an explicitly seeded, separate
// Compose fixture. Never point this script at an existing customer database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
async function run(base) {
  const origin = new URL(base);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname), 'Container smoke requires a loopback fixture.');
  assert.equal(process.env.GREENLINK_SEED_DEMO, 'true', 'Explicit seeded Compose fixture required.');
  let cookie = '', csrf = '';
  async function request(pathname, body, expected = 200) {
    const response = await fetch(new URL(pathname, origin), { method: body ? 'POST' : 'GET',
      headers: { Origin: origin.origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(75000) });
    if (response.headers.getSetCookie()[0]) cookie = response.headers.getSetCookie()[0].split(';')[0];
    const result = await response.json();
    assert.ok([expected].flat().includes(response.status), `${pathname}: ${response.status} ${JSON.stringify(result)}`);
    if (result.csrfToken) csrf = result.csrfToken;
    return { ...result, httpStatus: response.status };
  }
  assert.equal((await request('/health')).database, 'postgresql');
  await request('/api/dashboard', undefined, 401);
  await request('/api/session');
  await request('/api/auth/login', { email: 'alex@greenlink.demo', password: 'Greenlink123!' });
  const before = await request('/api/dashboard'), source = before.accounts.find(a => a.number === '1020001001');
  assert.ok(source);
  const payload = { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '1.25', description: 'Container integration transfer',
    authorizationPassword: 'Greenlink123!', requestId: randomUUID() };
  const model=await request('/api/fraud/model',undefined,[200,503]);
  if(model.httpStatus===503){
    await request('/api/transfers',payload,503);
    await request('/api/agents/assistant',{message:'test'},503);
    assert.equal((await request('/api/dashboard')).accounts.find(a=>a.id===source.id).balanceCents,source.balanceCents);
    console.log('Compose: no model weights provisioned; AI/payment requests fail closed without fallback and balances are unchanged.');return;
  }
  assert.equal(model.model.provider,'ollama');
  const payment=(await request('/api/transfers',payload)).transaction;
  assert.equal(payment.risk.provider,'ollama');
  assert.equal((await request('/api/transfers',payload)).transaction.id,payment.id);
  const expected=source.balanceCents-(payment.status==='completed'?125:0);
  assert.equal((await request('/api/dashboard')).accounts.find(a=>a.id===source.id).balanceCents,expected);
  const activity=(await request('/api/fraud/model-activity')).activity;
  assert.equal(activity.provider,'ollama');assert.equal(activity.accuracy,undefined);
  let scan;
  for(let attempt=0;attempt<20;attempt++){
    const response=await request('/api/fraud/scan', { transactionId: payment.id },[200,409]);
    if(response.httpStatus===200){scan=response.scan;break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(scan,'Monitoring batch should become available.');
  assert.ok([0,1].includes(scan.modelAnalyzed)); // An automatic batch may already have analysed it.
  const monitored = (await request('/api/fraud/analysis/' + payment.id)).analysis;
  assert.ok(Number.isInteger(monitored.evidence.model.score));
  assert.equal((await request('/api/dashboard')).accounts.find(a => a.id === source.id).balanceCents, expected);
  const history = await request('/api/transactions?q=Container%20integration%20transfer');
  assert.ok(history.transactions.some(t => t.id === payment.id));
  console.log('Container smoke passed: Nginx, authenticated banking, PostgreSQL, real local Ollama scoring, atomic transfer, idempotency, history and fraud rules.');
}
module.exports = { run };
if (require.main === module) run(process.env.GREENLINK_PUBLIC_ORIGIN || 'http://localhost:8080').catch(error => { console.error(error.message); process.exitCode = 1; });
