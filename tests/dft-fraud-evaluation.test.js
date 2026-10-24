'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const e = require('../banking/fraud-evaluation');
const { fixture } = require('./dft-helpers');
const pg = (name, fn) => test(name, { skip: !process.env.TEST_DATABASE_URL }, fn);
const model = require('../services/fraud/model.json');

test('Evaluation reproduces approved held-out confusion and training coefficients without changing artifacts', () => {
  const location = path.resolve(__dirname, '../services/fraud/model.json'), bytes = fs.readFileSync(location);
  const rows = e.parseCsv(fs.readFileSync(path.resolve(__dirname, '../datasets/fraud-history.csv'), 'utf8'));
  const split = e.shuffledSplit(rows), coefficients = e.fit(split.train);
  assert.deepEqual(coefficients, { intercept: model.intercept, weights: model.weights });
  const report = e.baselineReport();
  for (const key of ['truePositive', 'falsePositive', 'trueNegative', 'falseNegative', 'precision', 'recall', 'accuracy']) assert.equal(report.baseline.metrics[key], model.metrics[key]);
  assert.deepEqual(fs.readFileSync(location), bytes);
  assert.equal(report.modelSha256, createHash('sha256').update(bytes.toString().replace(/\r\n/g, '\n')).digest('hex'));
});
test('Chronological partitions keep equal timestamps together and reject missing or single-class windows', () => {
  const rows = e.temporalDemo(), split = e.temporalSplit([...rows].reverse());
  assert.ok(Date.parse(split.train.at(-1).occurredAt) < Date.parse(split.validation[0].occurredAt));
  assert.ok(Date.parse(split.validation.at(-1).occurredAt) < Date.parse(split.test[0].occurredAt));
  const duplicated = rows.map((r, i) => ({ ...r, occurredAt: rows[Math.floor(i / 13) * 13].occurredAt }));
  const grouped = e.temporalSplit(duplicated);
  assert.equal(new Set([...grouped.train, ...grouped.validation, ...grouped.test]).size, rows.length);
  assert.ok(Date.parse(grouped.train.at(-1).occurredAt) < Date.parse(grouped.validation[0].occurredAt));
  assert.throws(() => e.temporalSplit(rows.map(r => ({ ...r, occurredAt: undefined }))), /timestamped/);
  assert.throws(() => e.temporalSplit(rows.map(r => ({ ...r, y: 0 }))), /both labels/);
});
test('Threshold selection uses validation labels only; changed test labels cannot affect selection', () => {
  const rows = e.temporalDemo(), first = e.evaluateTemporal(rows, { synthetic: true });
  const changed = rows.map((r, i) => i >= 960 ? { ...r, y: 1 - r.y } : r), second = e.evaluateTemporal(changed, { synthetic: true });
  assert.deepEqual(first.validationThresholds, second.validationThresholds);
  assert.equal(first.selectedThreshold, second.selectedThreshold);
  assert.notDeepEqual(first.testAtSelectedThreshold, second.testAtSelectedThreshold);
  assert.equal(first.partitions.train.rows + first.partitions.validation.rows + first.partitions.test.rows, rows.length);
});
test('Metrics handle no predicted positives and calibration counts all held-out outcomes', () => {
  const rows = [{ x: [0], y: 0 }, { x: [0], y: 1 }], m = { intercept: 0, weights: [0] };
  const result = e.metrics(rows, m, 65);
  assert.equal(result.precision, null); assert.equal(result.recall, 0); assert.equal(result.falseNegative, 1);
  const calibration = e.calibration(rows, m);
  assert.equal(calibration.brierScore, 0.25);
  assert.equal(calibration.bins.reduce((sum, b) => sum + b.count, 0), 2);
  assert.equal(calibration.bins[5].observedFraudRate, 0.5);
  assert.throws(() => e.metrics(rows, m, 95));
});
test('CSV evaluation refuses missing dates, malformed values, duplicate headers and impossible dates', () => {
  const csv = fs.readFileSync(path.resolve(__dirname, '../datasets/fraud-history.csv'), 'utf8').replace(/\r\n/g, '\n');
  assert.throws(() => e.parseCsv(csv, { temporal: true }), /occurredAt/);
  assert.throws(() => e.parseCsv(csv.replace('amountCents,', 'hour,')));
  assert.throws(() => e.parseCsv(csv.replace(/\n\d+/, '\n1.5')), /Invalid evaluation/);
  const rows = csv.trim().split('\n'), header = rows.shift();
  const temporal = header + ',occurredAt\n' + rows.map(line => line + ',2026-02-31T00:00:00Z').join('\n');
  assert.throws(() => e.parseCsv(temporal, { temporal: true }), /Invalid UTC/);
});
test('Feature shift is zero for identical distributions and responds to shifted inputs', () => {
  assert.equal(e.distributionShift([10, 20, 30, 20, 10], [10, 20, 30, 20, 10]), 0);
  assert.ok(e.distributionShift([100, 0, 0, 0, 0], [0, 0, 0, 0, 100]) > 0.2);
  const rows = e.temporalDemo();
  const features = e.compareFeatures(rows.slice(0, 720), rows.slice(960));
  assert.equal(features.length, 7); assert.ok(features.every(f => Number.isFinite(f.psi)));
});
pg('Evaluation API is staff-only, validates windows and reports insufficient live samples', async t => {
  const f = await fixture(t), client = f.client();
  assert.equal((await client.request('/api/fraud/evaluation')).status, 401);
  await client.login('jamie@greenlink.demo');
  assert.equal((await client.request('/api/fraud/evaluation')).status, 403);
  await client.login('reviewer@greenlink.demo');
  assert.equal((await client.request('/api/fraud/evaluation?days=0')).status, 400);
  assert.equal((await client.request('/api/fraud/evaluation?days=1e1')).status, 400);
  const response = await client.request('/api/fraud/evaluation');
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.evaluation.monitoring.status, 'insufficient_data');
  assert.equal(response.data.evaluation.monitoring.modelReviewRate, null);
  assert.ok(!JSON.stringify(response.data).includes('password_hash'));
});
pg('Monitoring excludes other model versions and future attempts and never changes live rules', async t => {
  const f = await fixture(t), client = f.client(); await client.login();
  const source = (await client.dashboard()).accounts[0], before = await f.riskClient.getRules();
  const policy = await f.riskClient.getRules(), input = { userId: String(source.userId || 1) };
  const user = (await f.db.query("SELECT id FROM users WHERE email='alex@greenlink.demo'")).rows[0];
  for (let i = 0; i < 104; i++) {
    const value = { modelVersion: i === 100 ? 'old-model' : model.version, modelSha256: i === 103 ? 'f'.repeat(64) : e.baselineReport().modelSha256, modelScore: 70, decision: 'review', features: { amountLog: 2, amountDeviation: 2, velocity: 2, newPayee: 1, balanceUtilization: 1.5, unusualHour: 1, recentValue: 2 } };
    await f.db.query('INSERT INTO fraud_assessments(id,user_id,source_account_id,payload_hash,policy_version,policy_json,input_json,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), user.id, source.id, 'a'.repeat(64), policy.version, policy, input, i === 101 ? null : value, new Date(Date.now() + (i === 102 ? 86400000 : -1000)).toISOString()]);
  }
  const result = await client.request('/api/fraud/evaluation'); assert.equal(result.status, 200);
  const m = result.data.evaluation.monitoring;
  assert.equal(m.status, 'investigate'); assert.equal(m.scored, 100); assert.equal(m.otherModel, 2); assert.equal(m.missing, 1); assert.equal(m.modelReviewRate, 1);
  assert.deepEqual(await f.riskClient.getRules(), before);
  assert.equal(m.accuracy, undefined); assert.equal(m.precision, undefined);
});
pg('Evaluation refuses metrics from a different running scorer artifact', async t => {
  const f = await fixture(t, { http: false });
  const staff = (await f.db.query("SELECT id,role,auth_version FROM users WHERE email='reviewer@greenlink.demo'")).rows[0];
  await assert.rejects(require('../banking/fraud-monitoring').modelEvaluation(f.db, staff, { activeModel: { version: 'unapproved' } }), err => err.status === 503);
});
