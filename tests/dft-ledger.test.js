'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ledger = require('../banking/ledger');
const { createRiskClient } = require('../banking/risk');
const { HttpError } = require('../models/errors');
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL for PostgreSQL ledger integration tests.' }, work);
const failure = status => error => error.status === status;
const NOW = '2027-01-01T04:00:00.000Z';
const authorized = async (_db,user) => ({ method: 'password', authorizedAt: NOW, userId:String(user.id), authVersion:1 });

function modelResult(input, score = 5) {
  const summary = input.historySummary, known = input.isInternal || summary.knownPayee;
  return {
    ...Object.fromEntries(['transactionId', 'userId', 'sourceAccountId', 'payloadHash', 'type', 'amountCents', 'payee', 'isInternal'].map(key => [key, input[key]])),
    modelScore: score, score, decision: score >= 65 ? 'review' : 'allow', provider:'ollama',modelName:'controlled-local',modelSha256:'a'.repeat(64),promptSha256:'b'.repeat(64), modelVersion: 'explicit-test-model', assessedAt: input.createdAt,
    features: { amountLog: 0.1, amountDeviation: 0, velocity: 0, newPayee: known ? 0 : 1, balanceUtilization: Math.min(1.5, input.amountCents / Math.max(1, input.accountBalanceCents)), unusualHour: 0, recentValue: 0 },
    context: { historicalTransactions: summary.historyCount, averageOutgoingCents: summary.averageOutgoingCents, outgoingCount10m: summary.outgoingCount10m, dailyOutgoingCents: summary.dailyOutgoingCents, knownPayee: known },
    reasons: [{ code: 'test_fixture', message: 'Explicit test-only model response.', contribution: 0 }],
  };
}

async function setup(t, { modelScore = 5, assessModel } = {}) {
  const { db } = await require('./dft-helpers').fixture(t, { http: false, seed: false });
  const makeUser = async (name, role) => (await db.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *', [name, `${randomUUID()}@ledger.example.test`, 'test-only-unused', role])).rows[0];
  const owner = await makeUser('Ledger Maker', 'admin'), recipient = await makeUser('Ledger Recipient', 'customer'), reviewer = await makeUser('Independent Reviewer', 'admin');
  for(const user of [owner,recipient,reviewer])await require('./dft-helpers').approveBusiness(db,user);
  const makeAccount = async (user, name, number, balance) => (await db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance,created_at) VALUES($1,$2,$3,$4,$4,'seed','2026-01-01T00:00:00Z') RETURNING *", [user.id, name, number, balance])).rows[0];
  const source = await makeAccount(owner, 'Operating savings', '9200000001', 1000000), reserve = await makeAccount(owner, 'Reserve savings', '9200000002', 500000), target = await makeAccount(recipient, 'Recipient savings', '9200000003', 500000);
  const riskClient = createRiskClient({ db, assessModel: assessModel || (async input => modelResult(input, modelScore)) });
  const options = { riskClient, authorize: authorized, now: () => Date.parse(NOW) };
  const body = changes => ({ fromAccountId: String(source.id), toAccountNumber: target.number, amount: '25.00', description: 'Integration transfer', requestId: randomUUID(), authorizationPassword: 'unused-test-stub', ...changes });
  const balance = async account => Number((await db.query('SELECT balance_cents FROM accounts WHERE id=$1', [account.id])).rows[0].balance_cents);
  const allIds = [source.id, reserve.id, target.id];
  const total = async () => Number((await db.query('SELECT sum(balance_cents) AS total FROM accounts WHERE id=ANY($1::bigint[])', [allIds])).rows[0].total);
  return { db, owner, recipient, reviewer, source, reserve, target, riskClient, options, body, balance, total };
}

test('DFT money conversion preserves integer cents and rejects nondecimal or unsafe amounts', () => {
  for (const [value, expected] of [['0.01', 1], ['1.10', 110], ['90000000000.00', 9000000000000]]) assert.equal(ledger.parseAmount(value), expected);
  for (const value of ['0', '-1', '1.001', '1e3', 'NaN', 'Infinity', '90000000000.01', true, {}, null]) assert.throws(() => ledger.parseAmount(value), failure(400));
  const one = ledger.normalize('transfer', { fromAccountId: '1', toAccountNumber: '1020002001', amount: '0.10', description: 'Lunch' });
  const two = ledger.normalize('transfer', { fromAccountId: '2', toAccountNumber: '1020002001', amount: '0.10', description: 'Lunch' });
  assert.notEqual(ledger.canonicalHash('1', 'transfer', one), ledger.canonicalHash('1', 'transfer', two));
});

pgTest('DFT review refuses authorization invalidated by a concurrent account-security change', async t => {
  const f=await setup(t,{modelScore:80}),held=await ledger.submit(f.db,f.owner,'transfer',f.body(),f.options),before=await f.total();
  const stale=async (_db,user)=>{await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[user.id]);return authorized(_db,user);};
  await assert.rejects(ledger.review(f.db,f.reviewer,held.id,{decision:'approve',reason:'Independent check',authorizationPassword:'test-only'},{authorize:stale}),failure(409));
  assert.equal((await ledger.view(f.db,held.id)).status,'pending_review');assert.equal(await f.total(),before);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),1);
});

pgTest('DFT completed transfers atomically conserve value and persist both ledger sides and outbox events', async t => {
  const f = await setup(t), before = await f.total();
  const result = await ledger.submit(f.db, f.owner, 'transfer', f.body(), f.options);
  assert.equal(result.status, 'completed');
  assert.equal(result.amountCents, -2500);
  assert.equal(await f.balance(f.source), 997500);
  assert.equal(await f.balance(f.target), 502500);
  assert.equal(await f.total(), before);
  const records = (await f.db.query('SELECT * FROM transactions ORDER BY settlement_seq')).rows;
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(row => Number(row.amount_cents)), [-2500, 2500]);
  assert.ok(records.every(row => row.completed_at && row.settlement_seq));
  assert.equal(records[0].reference, records[1].reference);
  assert.equal(records[1].risk_json.assessmentId, result.id);
  assert.equal(records[1].risk_json.context, undefined, 'Recipient must not receive sender behavioural aggregates.');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM notification_outbox')).rows[0].count), 2);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM audit_log')).rows[0].count), 1);
});

pgTest('DFT duplicate concurrent confirmations settle a payment once and replay the same receipt', async t => {
  const f = await setup(t), submitted = f.body();
  const results = await Promise.all(Array.from({ length: 6 }, () => ledger.submit(f.db, f.owner, 'transfer', submitted, f.options)));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(await f.balance(f.source), 997500);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 2);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM requests')).rows[0].count), 1);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM payment_bindings')).rows[0].count), 1);
  const restartedRisk = createRiskClient({ db: f.db, assessModel: async () => { throw new Error('A completed replay must not rescreen.'); } });
  assert.deepEqual(await ledger.submit(f.db, f.owner, 'transfer', submitted, { ...f.options, riskClient: restartedRisk }), results[0]);
});

pgTest('DFT row locks prevent parallel overspending without losing money or creating partial credits', async t => {
  const f = await setup(t);
  await f.db.query('UPDATE accounts SET balance_cents=10000,opening_balance_cents=10000 WHERE id=$1', [f.source.id]);
  const before = await f.total();
  const results = await Promise.allSettled([ledger.submit(f.db, f.owner, 'transfer', f.body({ amount: '60.00' }), f.options), ledger.submit(f.db, f.owner, 'transfer', f.body({ amount: '60.00' }), f.options)]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.status === 'completed').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(await f.balance(f.source), 4000);
  assert.equal(await f.balance(f.target), 506000);
  assert.equal(await f.total(), before);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 2);
});

pgTest('DFT concurrent payments recheck current blocking rules inside settlement', async t => {
  const f = await setup(t);
  await f.riskClient.updateRule('daily_limit', { version: 1, threshold: 100 }, f.reviewer);
  const before = await f.total();
  const results = await Promise.all([ledger.submit(f.db, f.owner, 'transfer', f.body({ amount: '60.00' }), f.options), ledger.submit(f.db, f.owner, 'transfer', f.body({ amount: '60.00' }), f.options)]);
  assert.deepEqual(results.map(result => result.status).sort(), ['completed', 'rejected']);
  assert.equal(await f.balance(f.source), 994000);
  assert.equal(await f.balance(f.target), 506000);
  assert.equal(await f.total(), before);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM transactions WHERE status='completed'")).rows[0].count), 2);
  assert.equal(Number((await f.db.query("SELECT count(*) FROM transactions WHERE status='rejected'")).rows[0].count), 1);
});

pgTest('DFT failed screening permanently binds requestId and cannot be retried with a different source or payload', async t => {
  let available = false;
  const f = await setup(t, { assessModel: async input => { if (!available) throw new Error('Model temporarily unavailable'); return modelResult(input); } });
  const submitted = f.body();
  await assert.rejects(ledger.submit(f.db, f.owner, 'transfer', submitted, f.options), failure(503));
  assert.equal(await f.balance(f.source), 1000000);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  for (const changes of [{ fromAccountId: String(f.reserve.id) }, { amount: '26.00' }, { toAccountNumber: f.reserve.number }, { description: 'Different consent' }]) {
    await assert.rejects(ledger.submit(f.db, f.owner, 'transfer', { ...submitted, ...changes }, f.options), failure(409));
  }
  available = true;
  const completed = await ledger.submit(f.db, f.owner, 'transfer', submitted, f.options);
  assert.equal(completed.status, 'completed');
  assert.equal(await f.balance(f.source), 997500);
});

pgTest('DFT payment ownership, authorization and destination checks cannot be bypassed', async t => {
  const f = await setup(t);
  await assert.rejects(ledger.submit(f.db, f.recipient, 'transfer', f.body(), f.options), failure(404));
  const denied = { ...f.options, authorize: async () => { throw new HttpError(403, 'Wrong authorization password.'); } };
  await assert.rejects(ledger.submit(f.db, f.owner, 'transfer', f.body(), denied), failure(403));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  await f.db.query("UPDATE accounts SET status='closed' WHERE id=$1", [f.target.id]);
  await assert.rejects(ledger.submit(f.db, f.owner, 'transfer', f.body(), f.options), failure(409));
  assert.equal(await f.balance(f.source), 1000000);
});

pgTest('DFT held requests do not reserve money and independent approval settles once with current funds', async t => {
  const f = await setup(t, { modelScore: 70 }), submitted = f.body();
  const held = await ledger.submit(f.db, f.owner, 'transfer', submitted, f.options);
  assert.equal(held.status, 'pending_review');
  assert.equal(held.completedAt, null);
  assert.equal(await f.balance(f.source), 1000000);
  assert.equal(await f.balance(f.target), 500000);
  const decision = { decision: 'approve', reason: 'Verified independently with the customer.', authorizationPassword: 'test-only' };
  await assert.rejects(ledger.review(f.db, f.owner, held.id, decision, { authorize: authorized }), failure(403));
  await assert.rejects(ledger.review(f.db, f.recipient, held.id, decision, { authorize: authorized }), failure(403));
  const options = { authorize: authorized, now: () => Date.parse(NOW) + 60000 };
  const results = await Promise.all([ledger.review(f.db, f.reviewer, held.id, decision, options), ledger.review(f.db, f.reviewer, held.id, decision, options)]);
  assert.ok(results.every(result => result.status === 'completed'));
  assert.deepEqual(results[0], results[1]);
  assert.equal(await f.balance(f.source), 997500);
  assert.equal(await f.balance(f.target), 502500);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 2);
  const replay = await ledger.submit(f.db, f.owner, 'transfer', submitted, f.options);
  assert.equal(replay.status, 'completed');
  assert.equal(replay.review.reviewedBy.id, String(f.reviewer.id));
  assert.equal(replay.requestedAt, NOW);
  assert.equal(replay.completedAt, '2027-01-01T04:01:00.000Z');
});

pgTest('DFT held approval respects new blocking rules and a rejection never debits balances', async t => {
  const f = await setup(t, { modelScore: 70 });
  const held = await ledger.submit(f.db, f.owner, 'transfer', f.body(), f.options);
  await f.riskClient.updateRule('high_value', { version: 1, threshold: 1, action: 'block' }, f.reviewer);
  await assert.rejects(ledger.review(f.db, f.reviewer, held.id, { decision: 'approve', reason: 'Independent review', authorizationPassword: 'test-only' }, { authorize: authorized, now: () => Date.parse(NOW) + 60000 }), failure(409));
  assert.equal((await ledger.view(f.db, held.id)).status, 'pending_review');
  const rejected = await ledger.review(f.db, f.reviewer, held.id, { decision: 'reject', reason: 'Blocking policy requires rejection.', authorizationPassword: 'test-only' }, { authorize: authorized });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.completedAt, null);
  assert.equal(await f.balance(f.source), 1000000);
  assert.equal(await f.balance(f.target), 500000);
  await assert.rejects(ledger.review(f.db, f.reviewer, held.id, { decision: 'approve', reason: 'Cannot reopen a final rejection.', authorizationPassword: 'test-only' }, { authorize: authorized }), failure(409));
});

pgTest('DFT bills debit exact cents once and preserve billing references without a recipient credit', async t => {
  const f = await setup(t), reference = 'A'.repeat(64);
  const submitted = { fromAccountId: String(f.source.id), billerId: 'sp-services', amount: '0.01', reference, requestId: randomUUID() };
  const first = await ledger.submit(f.db, f.owner, 'bill', submitted, f.options);
  assert.equal(first.status, 'completed');
  assert.equal(first.amountCents, -1);
  assert.equal(first.reference, reference);
  assert.equal(await f.balance(f.source), 999999);
  assert.equal(await f.balance(f.target), 500000);
  assert.deepEqual(await ledger.submit(f.db, f.owner, 'bill', submitted, f.options), first);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 1);
});

pgTest('DFT a downstream database failure rolls back balances, both ledger sides and outbox writes', async t => {
  const f = await setup(t), before = await f.total();
  await f.db.query('ALTER TABLE notification_outbox ADD CONSTRAINT forced_delivery_failure CHECK(false) NOT VALID');
  await assert.rejects(ledger.submit(f.db, f.owner, 'transfer', f.body(), f.options), error => error.code === '23514');
  assert.equal(await f.balance(f.source), 1000000);
  assert.equal(await f.balance(f.target), 500000);
  assert.equal(await f.total(), before);
  for (const table of ['transactions', 'requests', 'notification_outbox', 'audit_log']) assert.equal(Number((await f.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0);
});
