'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRiskClient } = require('../banking/risk');
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL for PostgreSQL risk integration tests.' }, work);
const failure = status => error => error.status === status;
const NOW = '2027-01-01T04:00:00.000Z';

function modelResult(input, score = 5) {
  const summary = input.historySummary;
  const known = input.isInternal || summary.knownPayee;
  return {
    ...Object.fromEntries(['transactionId', 'userId', 'sourceAccountId', 'payloadHash', 'type', 'amountCents', 'payee', 'isInternal'].map(key => [key, input[key]])),
    modelScore: score, score, decision: score >= 65 ? 'review' : 'allow', provider:'openai',modelName:'controlled-openai',modelIdentitySha256:require('../banking/ai-provider').identity('controlled-openai'),promptSha256:'b'.repeat(64), modelVersion: 'explicit-test-model', assessedAt: input.createdAt,
    features: { amountLog: 0.1, amountDeviation: 0, velocity: 0, newPayee: known ? 0 : 1, balanceUtilization: Math.min(1.5, input.amountCents / Math.max(1, input.accountBalanceCents)), unusualHour: 0, recentValue: 0 },
    context: { historicalTransactions: summary.historyCount, averageOutgoingCents: summary.averageOutgoingCents, outgoingCount10m: summary.outgoingCount10m, dailyOutgoingCents: summary.dailyOutgoingCents, knownPayee: known },
    reasons: [{ code: 'test_fixture', message: 'Explicit test-only model response.', contribution: 0 }],
  };
}

async function setup(t) {
  const result = await require('./dft-helpers').fixture(t, { http: false, seed: false });
  const { db } = result;
  const owner = (await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Risk Owner',$1,'test-only-unused','customer') RETURNING *", [`risk-${randomUUID()}@example.test`])).rows[0];
  const admin = (await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Risk Reviewer',$1,'test-only-unused','admin') RETURNING *", [`risk-admin-${randomUUID()}@example.test`])).rows[0];
  const source = (await db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance) VALUES($1,'Risk savings','9100000001',3000000,3000000,'seed') RETURNING *", [owner.id])).rows[0];
  const alternate = (await db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance) VALUES($1,'Risk reserve','9100000002',1000000,1000000,'seed') RETURNING *", [owner.id])).rows[0];
  const input = changes => ({ transactionId: randomUUID(), userId: String(owner.id), sourceAccountId: String(source.id), payloadHash: 'a'.repeat(64), type: 'transfer', amountCents: 1000, accountBalanceCents: 3000000, payee: '1020002001', isInternal: false, createdAt: NOW,
    historySummary: { averageOutgoingCents: 20000, outgoingCount10m: 0, outgoingAmount10m: 0, dailyOutgoingCents: 0, historyCount: 10, knownPayee: true }, ...changes });
  return { db, owner, admin, source, alternate, input };
}

pgTest('DFT risk persists the canonical source, payload and policy before calling Python', async t => {
  const { db, source, input } = await setup(t);
  let calls = 0;
  const risk = createRiskClient({ db, assessModel: async bound => {
    calls++;
    const row = (await db.query('SELECT * FROM fraud_assessments WHERE id=$1', [bound.transactionId])).rows[0];
    assert.equal(String(row.source_account_id), String(source.id));
    assert.equal(row.payload_hash, bound.payloadHash);
    assert.deepEqual(row.input_json, bound);
    assert.equal(Number(row.policy_version), 1);
    assert.equal(row.policy_json.rules.length, 5);
    assert.equal(row.result_json, null);
    return modelResult(bound);
  } });
  const submitted = input();
  const first = await risk.assess(submitted);
  assert.equal(first.ruleVersion, 1);
  assert.equal(first.decision, 'allow');
  assert.equal(first.modelScore, 5);
  const repeated = await risk.assess({ ...submitted, accountBalanceCents: 1, createdAt: '2027-01-02T04:00:00Z', historySummary: { ...submitted.historySummary, dailyOutgoingCents: 2000000 } });
  assert.deepEqual(repeated, first);
  assert.equal(calls, 1);
});

pgTest('DFT risk cannot reuse an assessment identifier across immutable payment bindings', async t => {
  const { db, alternate, input } = await setup(t);
  const risk = createRiskClient({ db, assessModel: async bound => modelResult(bound) });
  const submitted = input();
  await risk.assess(submitted);
  for (const changes of [{ sourceAccountId: String(alternate.id) }, { payloadHash: 'b'.repeat(64) }, { amountCents: 1001 }, { payee: '1020002002' }, { type: 'bill' }, { isInternal: true }]) {
    await assert.rejects(risk.assess({ ...submitted, ...changes }), failure(409));
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM fraud_assessments')).rows[0].count), 1);
});

pgTest('DFT risk retries a failed Python call against the original saved policy snapshot', async t => {
  const { db, admin, input } = await setup(t);
  let attempts = 0;
  const risk = createRiskClient({ db, assessModel: async bound => { if (++attempts === 1) throw new Error('Python unavailable'); return modelResult(bound); } });
  const submitted = input({ amountCents: 200000, historySummary: { averageOutgoingCents: 20000, outgoingCount10m: 0, outgoingAmount10m: 0, dailyOutgoingCents: 0, historyCount: 10, knownPayee: false } });
  await assert.rejects(risk.assess(submitted), /Python unavailable/);
  const pending = (await db.query('SELECT policy_version,result_json FROM fraud_assessments WHERE id=$1', [submitted.transactionId])).rows[0];
  assert.equal(Number(pending.policy_version), 1);
  assert.equal(pending.result_json, null);
  await risk.updateRule('new_payee', { version: 1, enabled: false }, admin);
  const retried = await risk.assess(submitted);
  assert.equal(retried.ruleVersion, 1);
  assert.equal(retried.decision, 'review');
  assert.ok(retried.reasons.some(reason => reason.code === 'rule:new_payee'));
  assert.equal((await risk.getRules()).version, 2);
});

pgTest('DFT deterministic rules hold and block independently of a low model score', async t => {
  const { db, input } = await setup(t);
  const risk = createRiskClient({ db, assessModel: async bound => modelResult(bound) });
  const large = await risk.assess(input({ amountCents: 1000000 }));
  assert.equal(large.decision, 'review');
  assert.equal(large.score, 70);
  assert.equal(large.modelScore, 5);
  const excessive = await risk.assess(input({ amountCents: 2600000 }));
  assert.equal(excessive.decision, 'block');
  assert.equal(excessive.score, 95);
  assert.ok(excessive.reasons.some(reason => reason.code === 'rule:daily_limit'));
  const internal = await risk.assess(input({ isInternal: true, amountCents: 1000, historySummary: { averageOutgoingCents: 20000, outgoingCount10m: 0, outgoingAmount10m: 0, dailyOutgoingCents: 2500000, historyCount: 10, knownPayee: false } }));
  assert.equal(internal.decision, 'allow');
});

pgTest('DFT invalid or unbound Python outputs fail closed without persisting a result', async t => {
  const { db, input } = await setup(t);
  const mutations = [
    result => ({ ...result, sourceAccountId: '999999' }), result => ({ ...result, payloadHash: 'b'.repeat(64) }),
    result => ({ ...result, type: 'bill' }), result => ({ ...result, amountCents: result.amountCents + 1 }),
    result => ({ ...result, score: NaN }), result => ({ ...result, score: 95, modelScore: 95 }),
    result => ({ ...result, modelScore: 4 }), result => ({ ...result, decision: 'block' }),
    result => ({ ...result, provider: 'retired-model' }), result => ({ ...result, reasons: [{ code: 'x', message: 'x', contribution: Infinity }] }),
    result => ({ ...result, features: { ...result.features, amountLog: NaN } }), result => ({ ...result, context: {} }),
    result => ({ ...result, assessedAt: '2026-01-01T00:00:00Z' }),
  ];
  for (const mutate of mutations) {
    const risk = createRiskClient({ db, assessModel: async bound => mutate(modelResult(bound)) });
    await assert.rejects(risk.assess(input()), failure(503));
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM fraud_assessments WHERE result_json IS NOT NULL')).rows[0].count), 0);
});

pgTest('DFT rule changes enforce real administrator identity, version conflicts and an exact audit trail', async t => {
  const { db, owner, admin } = await setup(t);
  const risk = createRiskClient({ db, assessModel: async bound => modelResult(bound) });
  await assert.rejects(risk.updateRule('high_value', { version: 1, threshold: 5000 }, { ...owner, role: 'admin' }), failure(403));
  const first = await risk.updateRule('high_value', { version: 1, threshold: 5000, action: 'block' }, { id: admin.id, name: 'Spoofed actor name' });
  assert.equal(first.version, 2);
  await assert.rejects(risk.updateRule('high_value', { version: 1, threshold: 4000 }, admin), failure(409));
  await assert.rejects(risk.updateRule('velocity', { version: 2, threshold: 1.5 }, admin), failure(400));
  await assert.rejects(risk.updateRule('balance_utilization', { version: 2, threshold: 101 }, admin), failure(400));
  await assert.rejects(risk.updateRule('daily_limit', { version: 2, unsupported: true }, admin), failure(400));
  const audit = await risk.getAudit({ page: 1, pageSize: 10, ruleId: 'high_value' });
  assert.equal(audit.pagination.total, 1);
  assert.equal(audit.entries[0].actor.name, 'Risk Reviewer');
  assert.equal(audit.entries[0].actor.id, String(admin.id));
  assert.equal(audit.entries[0].before.threshold, 10000);
  assert.equal(audit.entries[0].after.threshold, 5000);
  assert.equal(audit.entries[0].after.action, 'block');
  assert.equal(audit.entries[0].version, 2);
  assert.equal((await risk.getRules()).version, 2);
});

pgTest('DFT simultaneous assessment requests persist one stable result for the bound transaction', async t => {
  const { db, input } = await setup(t);
  let calls = 0;
  const risk = createRiskClient({ db, assessModel: async bound => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return modelResult(bound); } });
  const submitted = input();
  const results = await Promise.all(Array.from({ length: 6 }, () => risk.assess(submitted)));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.ok(calls >= 1);
  assert.equal(Number((await db.query('SELECT count(*) FROM fraud_assessments WHERE id=$1', [submitted.transactionId])).rows[0].count), 1);
});

pgTest('DFT screening configuration cannot silently replace Python with a local fallback', async t => {
  const { db, input } = await setup(t);
  const unavailable = createRiskClient({ db, url: 'http://127.0.0.1:1', token: 'test-token-longer-than-twenty-four-characters' });
  await assert.rejects(unavailable.assess(input()), failure(503));
  const invalid = createRiskClient({ db, token: '' });
  await assert.rejects(invalid.assess(input()), failure(503));
  assert.equal(Number((await db.query('SELECT count(*) FROM fraud_assessments WHERE result_json IS NOT NULL')).rows[0].count), 0);
});

test('Fraud inference refuses external model endpoints and permits only local/private scorer origins',()=>{
  const db={query:async()=>{},transaction:async()=>{}};
  for(const url of ['https://fraud.example','http://fraud.example','https://localhost:4011','http://u:p@localhost:4011','http://127.0.0.1:4011/path','http://127.0.0.1:4011?remote=true'])assert.throws(()=>createRiskClient({db,url}),/remote model endpoints are refused/);
  for(const url of ['http://127.0.0.1:4011','http://localhost:4011','http://[::1]:4011','http://fraud:4011'])assert.doesNotThrow(()=>createRiskClient({db,url}));
});
