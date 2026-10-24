'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, modelStub } = require('./dft-helpers');
const cases = require('../banking/fraud-cases');
const { HttpError } = require('../models/errors');
const pg = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL }, work);
async function actor(db, email = 'reviewer@greenlink.demo') { return (await db.query('SELECT id,role,auth_version FROM users WHERE email=$1', [email])).rows[0]; }
async function money(db) { return { accounts: (await db.query('SELECT id,balance_cents,opening_balance_cents FROM accounts ORDER BY id')).rows, payments: (await db.query('SELECT id,status,amount_cents,risk_json FROM transactions ORDER BY id')).rows }; }
async function payment(f, { amount = '100', reference = 'AI-SURVEILLANCE' } = {}) { const client = f.client(); await client.login(); const source = (await client.dashboard()).accounts[0]; const r = await client.request('/api/payments', { method: 'POST', body: { fromAccountId: source.id, billerId: 'pub', reference, amount, requestId: randomUUID() } }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.transaction; }
const scan = (f, options = {}) => cases.scan(f.db, f.riskClient, { force: true, ...options });
async function caseFor(f, transactionId) { return (await cases.list(f.db, await actor(f.db), { status: 'all' })).cases.find(c => c.transactionId === transactionId); }

pg('Suspicious-activity APIs enforce authentication, real staff roles, CSRF and request allowlists', async t => {
  const f = await fixture(t), client = f.client();
  assert.equal((await client.request('/api/fraud/cases')).status, 401);
  await client.login('jamie@greenlink.demo');
  assert.equal((await client.request('/api/fraud/cases')).status, 403);
  assert.equal((await client.request('/api/fraud/scan', { method: 'POST', body: {} })).status, 403);
  await client.login('reviewer@greenlink.demo');
  assert.equal((await client.request('/api/fraud/scan', { method: 'POST', body: {}, csrf: false })).status, 403);
  for (const body of [[], { limit: 26 }, { userId: '1' }, { limit: '5' }]) assert.equal((await client.request('/api/fraud/scan', { method: 'POST', body })).status, 400);
  assert.equal((await client.request('/api/fraud/cases?status=unknown')).status, 400);
  assert.equal((await client.request('/api/fraud/cases?page=1e2')).status, 400);
  assert.equal((await client.request('/api/fraud/cases/' + randomUUID())).status, 404);
});
pg('AI retrospectively flags completed payments with explanations and never changes their original assessment or money', async t => {
  let score = 2;
  const f = await fixture(t, { assessModel: input => modelStub(score)(input) }), transaction = await payment(f), before = await money(f.db);
  assert.equal(transaction.status, 'completed'); score = 82;
  const result = await scan(f), flagged = await caseFor(f, transaction.id);
  assert.ok(result.modelAnalyzed >= 1); assert.equal(flagged.evidence.model.score, 82);
  assert.ok(flagged.evidence.signals.some(s => s.code === 'ai_risk')); assert.ok(flagged.evidence.model.reasons.length);
  assert.equal(flagged.transaction.status, 'completed'); assert.equal(flagged.evidence.original.modelScore, 2);
  assert.deepEqual(await money(f.db), before);
  const original = (await f.db.query('SELECT result_json FROM fraud_assessments WHERE id=$1', [transaction.id])).rows[0]; assert.equal(original.result_json.modelScore, 2);
});
pg('Repeated monitoring creates one case and one notification per independent reviewer', async t => {
  const f = await fixture(t, { assessModel: modelStub(80) }), transaction = await payment(f);
  await scan(f); const initial = await caseFor(f, transaction.id);
  const count = Number((await f.db.query("SELECT count(*) FROM notification_outbox WHERE payload_json->'metadata'->>'fraudCaseId'=$1", [initial.id])).rows[0].count);
  const second = await scan(f); assert.equal(second.checked, 0); assert.equal(second.created, 0);
  assert.equal((await caseFor(f, transaction.id)).id, initial.id);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM notification_outbox WHERE payload_json->'metadata'->>'fraudCaseId'=$1", [initial.id])).rows[0].count), count);
  assert.ok(count > 0);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM notification_outbox WHERE user_id=(SELECT id FROM users WHERE email='alex@greenlink.demo') AND payload_json->'metadata'->>'fraudCaseId'=$1", [initial.id])).rows[0].count), 0);
});
pg('Monitoring detects split payments that individually passed AI and payment thresholds', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  const maker = await actor(f.db, 'alex@greenlink.demo'), policy = await f.riskClient.getRules();
  await f.riskClient.updateRule('new_payee', { enabled: false, version: policy.version }, maker);
  const payments = [];
  for (let i = 0; i < 4; i++) { clock += 1000; payments.push(await payment(f, { amount: '3000', reference: 'SPLIT-' + i })); }
  assert.ok(payments.every(p => p.status === 'completed' && p.risk.modelScore === 2));
  const before = await money(f.db); await scan(f, { now: () => clock });
  const flagged = await caseFor(f, payments[3].id);
  assert.ok(flagged.evidence.signals.some(s => s.code === 'split_payments')); assert.equal(flagged.evidence.history.samePayeeCount, 3);
  assert.equal(flagged.evidence.history.samePayeeCents, 900000);
  assert.deepEqual(await money(f.db), before);
});
pg('Legacy payments without bound context are explicitly routed for manual review without inventing AI scores', async t => {
  let called = 0; const f = await fixture(t, { assessModel: input => { called++; return modelStub()(input); } });
  const before = await money(f.db), result = await scan(f); assert.equal(result.modelAnalyzed, 0); assert.ok(result.manualContext > 0); assert.equal(called, 0);
  const records = await cases.list(f.db, await actor(f.db));
  assert.ok(records.cases.every(c => c.evidence.signals.some(s => s.code === 'missing_context') && c.evidence.model === null));
  assert.deepEqual(await money(f.db), before);
});
pg('A staff member can analyse any selected outgoing payment and inspect a low-risk result without a fabricated flag', async t => {
  const f = await fixture(t), transaction = await payment(f), client = f.client(); await client.login('reviewer@greenlink.demo');
  const r = await client.request('/api/fraud/scan', { method: 'POST', body: { transactionId: transaction.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.scan.checked, 1); assert.equal(r.data.scan.modelAnalyzed, 1); assert.equal(r.data.scan.created, 0);
  const analysis = await client.request('/api/fraud/analysis/' + transaction.id);
  assert.equal(analysis.status, 200); assert.equal(analysis.data.analysis.evidence.model.score, 2); assert.equal(analysis.data.analysis.evidence.flagged, false); assert.equal(analysis.data.analysis.caseId, null);
  const reused = await client.request('/api/fraud/scan', { method: 'POST', body: { transactionId: transaction.id } }); assert.equal(reused.data.scan.checked, 0);
  assert.equal((await client.request('/api/fraud/scan', { method: 'POST', body: { transactionId: randomUUID() } })).status, 404);
  await client.login('jamie@greenlink.demo'); assert.equal((await client.request('/api/fraud/analysis/' + transaction.id)).status, 403);
});
pg('Background jobs automatically flag new recorded payments and deliver independent-reviewer alerts', async t => {
  const f = await fixture(t, { assessModel: modelStub(80) }), transaction = await payment(f), before = await money(f.db);
  const jobs = await f.runJobs(); assert.ok(jobs.fraudMonitoring.created > 0);
  const c = await caseFor(f, transaction.id); assert.equal(c.status, 'open');
  const reviewer = f.client(); await reviewer.login('reviewer@greenlink.demo');
  const notifications = (await reviewer.request('/api/notifications')).data.notifications;
  assert.ok(notifications.some(n => n.type === 'fraud.flagged' && n.metadata.fraudCaseId === c.id));
  assert.deepEqual(await money(f.db), before);
});
pg('Independent human review requires a claim, current version, fresh password and a reason; case resolution does not settle a payment', async t => {
  const f = await fixture(t, { assessModel: modelStub(80) }), transaction = await payment(f), before = await money(f.db); await scan(f);
  let c = await caseFor(f, transaction.id); const maker = f.client(), reviewer = f.client(); await maker.login(); await reviewer.login('reviewer@greenlink.demo');
  const path = '/api/fraud/cases/' + c.id + '/review';
  assert.equal((await maker.request(path, { method: 'POST', body: { action: 'claim', version: c.version } })).status, 403);
  assert.equal((await reviewer.request(path, { method: 'POST', body: { action: 'close', version: c.version, outcome: 'legitimate', reason: 'Verified supporting invoice.', authorizationPassword: 'Greenlink123!' } })).status, 403);
  let result = await reviewer.request(path, { method: 'POST', body: { action: 'claim', version: c.version } }); assert.equal(result.status, 200, JSON.stringify(result.data)); c = result.data.case;
  assert.equal(c.status, 'in_review');
  assert.equal((await reviewer.request(path, { method: 'POST', body: { action: 'close', version: c.version, outcome: 'legitimate', reason: 'Verified supporting invoice.', authorizationPassword: 'Wrong123!' } })).status, 403);
  assert.equal((await reviewer.request(path, { method: 'POST', body: { action: 'close', version: c.version - 1, outcome: 'legitimate', reason: 'Verified supporting invoice.', authorizationPassword: 'Greenlink123!' } })).status, 409);
  result = await reviewer.request(path, { method: 'POST', body: { action: 'close', version: c.version, outcome: 'legitimate', reason: 'Verified supporting invoice independently.', authorizationPassword: 'Greenlink123!' } }); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.case.status, 'closed'); assert.equal(result.data.case.outcome, 'legitimate'); assert.equal(result.data.case.transaction.status, 'pending_review');
  assert.ok(result.data.case.events.some(e => e.type === 'fraud.case_closed' && e.metadata.reason.includes('independently')));
  assert.deepEqual(await money(f.db), before);
});
pg('Only one independent reviewer can claim a case and other reviewers cannot close it', async t => {
  const f = await fixture(t, { assessModel: modelStub(80) }), transaction = await payment(f); await scan(f);
  await f.db.query("INSERT INTO users(name,email,password_hash,role) SELECT 'Other Reviewer','other@greenlink.demo',password_hash,'admin' FROM users WHERE email='reviewer@greenlink.demo'");
  const c = await caseFor(f, transaction.id), first = f.client(), second = f.client(); await first.login('reviewer@greenlink.demo'); await second.login('other@greenlink.demo');
  const path = '/api/fraud/cases/' + c.id + '/review';
  const results = await Promise.all([first, second].map(client => client.request(path, { method: 'POST', body: { action: 'claim', version: c.version } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const winner = results.find(r => r.status === 200).data.case, loser = results[0].status === 200 ? second : first;
  assert.equal((await loser.request(path, { method: 'POST', body: { action: 'close', version: winner.version, outcome: 'confirmed_fraud', reason: 'Unsupported attempt by another reviewer.', authorizationPassword: 'Greenlink123!' } })).status, 403);
});
pg('Scoring failures remain visible, do not mark unchecked payments safe, and retry without duplicate cases', async t => {
  const f = await fixture(t), transaction = await payment(f), before = await money(f.db), original = f.riskClient.analyze;
  f.riskClient.analyze = async () => { throw new HttpError(503, 'Unavailable fixture.'); };
  await assert.rejects(scan(f), e => e.status === 503);
  let state = (await cases.list(f.db, await actor(f.db))).monitor; assert.equal(state.lastError, 'HTTP_503');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_screenings WHERE transaction_id=$1', [transaction.id])).rows[0].count), 0);
  f.riskClient.analyze = original; const retried = await scan(f); assert.ok(retried.modelAnalyzed > 0);
  state = (await cases.list(f.db, await actor(f.db))).monitor; assert.equal(state.lastError, null);
  assert.deepEqual(await money(f.db), before);
});
pg('Scan leases exclude concurrent workers and an expired worker cannot commit findings after takeover', async t => {
  const f = await fixture(t), transaction = await payment(f); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  const analyze = f.riskClient.analyze;
  f.riskClient.analyze = async input => { entered(); await gate; return analyze(input); };
  const running = scan(f); await ready;
  await assert.rejects(scan(f), e => e.status === 409);
  await f.db.query('UPDATE fraud_monitor_state SET lease_owner=$1,lease_until=now()+interval \'2 minutes\' WHERE id=1', ['replacement']);
  release(); await assert.rejects(running, e => e.status === 409);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_screenings WHERE transaction_id=$1', [transaction.id])).rows[0].count), 0);
  assert.equal((await f.db.query('SELECT lease_owner FROM fraud_monitor_state')).rows[0].lease_owner, 'replacement');
});
pg('Revoked staff authorization cannot persist a case after an in-flight model request', async t => {
  const f = await fixture(t), transaction = await payment(f), user = await actor(f.db), analyze = f.riskClient.analyze;
  f.riskClient.analyze = async input => { const result = await analyze(input); await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [user.id]); return result; };
  await assert.rejects(scan(f, { actor: user }), e => e.status === 409);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM fraud_screenings WHERE transaction_id=$1', [transaction.id])).rows[0].count), 0);
});
pg('Resolved cases stay resolved on unchanged findings and reopen only for material new risk evidence', async t => {
  let score = 2; const f = await fixture(t, { assessModel: input => modelStub(score)(input) }), transaction = await payment(f, { amount: '10000' }); await scan(f);
  let c = await caseFor(f, transaction.id); const reviewer = f.client(); await reviewer.login('reviewer@greenlink.demo'); const path = '/api/fraud/cases/' + c.id + '/review';
  c = (await reviewer.request(path, { method: 'POST', body: { action: 'claim', version: c.version } })).data.case;
  const closed = await reviewer.request(path, { method: 'POST', body: { action: 'close', version: c.version, outcome: 'legitimate', reason: 'Verified legitimate business payment.', authorizationPassword: 'Greenlink123!' } }); assert.equal(closed.status, 200);
  const maker = await actor(f.db, 'alex@greenlink.demo'); let policy = await f.riskClient.getRules();
  await f.riskClient.updateRule('high_value', { version: policy.version, threshold: 9900 }, maker); await scan(f);
  assert.equal((await caseFor(f, transaction.id)).status, 'closed');
  score = 85; policy = await f.riskClient.getRules(); await f.riskClient.updateRule('high_value', { version: policy.version, threshold: 9800 }, maker); const result = await scan(f);
  c = await caseFor(f, transaction.id); assert.equal(c.status, 'open'); assert.equal(c.outcome, null); assert.equal(c.assignedTo, null); assert.ok(result.reopened >= 1);
  assert.ok((await cases.detail(f.db, await actor(f.db), c.id)).events.some(e => e.type === 'fraud.case_closed'));
});
