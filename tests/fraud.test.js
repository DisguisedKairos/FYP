'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FraudEngine } = require('../services/fraud/engine');
const { historicalFeatures } = require('../services/fraud/features');
const { NotificationStore } = require('../services/notifications/store');
const model = require('../services/fraud/model.json');

const now = '2026-10-22T04:00:00.000Z';
const history = Array.from({ length: 12 }, (_, i) => ({ amountCents: -20000, type: 'transfer', payee: 'known', status: 'completed', createdAt: new Date(new Date(now).getTime() - (i + 1) * 86400000).toISOString() }));
const input = (id, overrides = {}) => ({ transactionId: id, userId: 'customer-1', type: 'transfer', amountCents: 10000, payee: 'known', accountBalanceCents: 3000000, history, createdAt: now, ...overrides });

test('risk scoring uses historical patterns and explains a high-value new recipient', t => {
  const engine = new FraudEngine(); t.after(() => engine.close());
  const usual = engine.assess(input('usual'));
  const unusual = engine.assess(input('unusual', { amountCents: 500000, payee: 'new' }));
  assert.equal(usual.decision, 'allow');
  assert.equal(unusual.decision, 'review');
  assert.ok(unusual.score > usual.score);
  assert.ok(unusual.reasons.some(r => r.code === 'amount_deviation'));
  assert.ok(unusual.reasons.some(r => r.code === 'rule:new_payee'));
  assert.equal(unusual.context.historicalTransactions, 12);
  assert.ok(unusual.modelVersion);
  assert.equal(unusual.ruleVersion, 1);
});

test('hard financial rules block excessive daily outflow and velocity rules use actual recent history', t => {
  const engine = new FraudEngine(); t.after(() => engine.close());
  const blocked = engine.assess(input('over-limit', { amountCents: 2600000 }));
  assert.equal(blocked.decision, 'block');
  assert.ok(blocked.score >= 95);
  const recent = Array.from({ length: 6 }, (_, i) => ({ amountCents: -1000, payee: 'known', status: 'completed', createdAt: new Date(new Date(now).getTime() - (i + 1) * 30000).toISOString() }));
  const rapid = engine.assess(input('rapid', { history: recent }));
  assert.equal(rapid.context.outgoingCount10m, 6);
  assert.ok(rapid.matchedRules.includes('velocity'));
});

test('future, failed and internal history cannot inflate velocity or daily totals', () => {
  const result = historicalFeatures(input('features', { history: [
    { amountCents: -5000000, status: 'completed', createdAt: '2026-10-23T04:00:00Z' },
    { amountCents: -5000000, status: 'rejected', createdAt: now },
    { amountCents: -5000000, status: 'completed', isInternal: true, createdAt: now },
  ] }));
  assert.equal(result.context.historyCount, 0);
  assert.equal(result.context.outgoingCount10m, 0);
  assert.equal(result.context.dailyOutgoingCents, 0);
});

test('rule changes are validated, versioned, audited, and cannot rewrite an existing assessment', t => {
  const engine = new FraudEngine(); t.after(() => engine.close());
  const original = engine.assess(input('stable', { payee: 'new', amountCents: 180000 }));
  const updated = engine.updateRule('new_payee', { enabled: false, version: 1 }, { id: 'reviewer' });
  assert.equal(updated.version, 2);
  assert.equal(updated.rules.find(r => r.id === 'new_payee').enabled, false);
  assert.throws(() => engine.updateRule('high_value', { threshold: 2000, version: 1 }, { id: 'reviewer' }), e => e.status === 409);
  assert.throws(() => engine.updateRule('velocity', { threshold: 1.5, version: 2 }, { id: 'reviewer' }), e => e.status === 400);
  assert.throws(() => engine.updateRule('balance_utilization', { threshold: 101, version: 2 }, { id: 'reviewer' }), e => e.status === 400);
  assert.throws(() => engine.updateRule('daily_limit', { threshold: 0.001, version: 2 }, { id: 'reviewer' }), e => e.status === 400);
  assert.deepEqual(engine.assess(input('stable', { payee: 'new', amountCents: 180000, history: [] })), original);
  assert.throws(() => engine.assess(input('stable', { payee: 'other' })), e => e.status === 409);
  assert.equal(engine.db.prepare('SELECT COUNT(*) AS n FROM fraud_rule_audit').get().n, 1);
});

test('assessments and rule configuration survive a service restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evergreen-risk-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'fraud.sqlite');
  let engine = new FraudEngine({ dbPath });
  const result = engine.assess(input('durable'));
  engine.updateRule('high_value', { threshold: 8000, version: 1 }, { id: 'reviewer' });
  engine.close();
  engine = new FraudEngine({ dbPath });
  assert.deepEqual(engine.assess(input('durable')), result);
  assert.equal(engine.getRules().version, 2);
  engine.close();
});

test('model provenance and held-out metrics explicitly describe the synthetic baseline', () => {
  assert.equal(model.training.synthetic, true);
  assert.equal(model.training.rows, model.training.trainRows + model.training.testRows);
  assert.equal(model.metrics.truePositive + model.metrics.trueNegative + model.metrics.falsePositive + model.metrics.falseNegative, model.training.testRows);
  assert.ok(model.metrics.accuracy > 0 && model.metrics.accuracy < 1);
  assert.ok(model.metrics.precision >= 0 && model.metrics.precision <= 1);
  assert.ok(model.metrics.recall >= 0 && model.metrics.recall <= 1);
  assert.equal(model.weights.length, model.features.length);
  assert.match(model.policy, /human review/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'datasets', 'fraud-history.csv'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), model.training.datasetSha256);
});

test('exact ledger aggregates enforce limits beyond a bounded history sample', t => {
  const engine = new FraudEngine(); t.after(() => engine.close());
  const risk = engine.assess(input('aggregate-limit', { amountCents: 10000, history: [], historySummary: { dailyOutgoingCents: 2495000, outgoingCount10m: 12, outgoingAmount10m: 2000000, averageOutgoingCents: 18000, historyCount: 2500, knownPayee: true } }));
  assert.equal(risk.decision, 'block');
  assert.equal(risk.context.historicalTransactions, 2500);
  assert.equal(risk.context.dailyOutgoingCents, 2495000);
  assert.equal(risk.controls.dailyLimitCents, 2500000);
  assert.ok(risk.matchedRules.includes('daily_limit'));
  assert.throws(() => engine.assess(input('invalid-summary', { historySummary: { dailyOutgoingCents: -1 } })), e => e.status === 400);
});

test('notification events are idempotent, private to their recipient, and support unread acknowledgement', t => {
  const store = new NotificationStore(); t.after(() => store.close());
  const event = { id: 'event-1', userId: 'alice', type: 'transaction.completed', title: 'Transfer complete', message: 'Your transfer completed.', transactionId: 'txn-1', createdAt: now };
  assert.equal(store.publish(event).duplicate, false);
  assert.equal(store.publish(event).duplicate, true);
  assert.equal(store.list('alice').notifications.length, 1);
  assert.equal(store.list('alice').unreadCount, 1);
  assert.equal(store.list('bob').unreadCount, 0);
  assert.throws(() => store.markRead('bob', 'event-1'), e => e.status === 404);
  assert.equal(store.markRead('alice', 'event-1').unreadCount, 0);
  assert.equal(store.markRead('alice', 'all').notifications[0].isRead, true);
  assert.throws(() => store.publish({ ...event, userId: 'bob' }), e => e.status === 409);
});
