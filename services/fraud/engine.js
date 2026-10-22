'use strict';

const { createHash } = require('node:crypto');
const { openStore } = require('../common');
const { HttpError } = require('../../models/errors');
const { FEATURE_NAMES, historicalFeatures, sigmoid } = require('./features');

const DEFAULT_RULES = [
  { id: 'high_value', name: 'High-value payment', description: 'Review a payment at or above this amount.', threshold: 10000, unit: 'SGD', enabled: true, action: 'review' },
  { id: 'new_payee', name: 'New recipient', description: 'Review a large payment to a recipient with no completed outgoing history.', threshold: 1500, unit: 'SGD', enabled: true, action: 'review' },
  { id: 'velocity', name: 'Rapid transactions', description: 'Review after this many outgoing payments within ten minutes.', threshold: 5, unit: 'transactions / 10 minutes', enabled: true, action: 'review' },
  { id: 'balance_utilization', name: 'Balance depletion', description: 'Review payments using this percentage of the available balance.', threshold: 90, unit: '%', enabled: true, action: 'review' },
  { id: 'daily_limit', name: 'Daily outgoing limit', description: 'Block payments that exceed the daily limit, using Singapore calendar days.', threshold: 25000, unit: 'SGD / day', enabled: true, action: 'block' },
];

function validateAssessment(input) {
  if (!input || typeof input !== 'object' || !String(input.transactionId || '').match(/^[A-Za-z0-9:_-]{1,150}$/)) throw new HttpError(400, 'A transaction identifier is required for assessment.');
  if (!['transfer', 'bill'].includes(input.type) || !String(input.userId || '').trim() || !String(input.payee || '').trim()) throw new HttpError(400, 'Supply a transaction owner, type, and recipient.');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 9000000000000) throw new HttpError(400, 'Invalid transaction amount.');
  if (!Number.isSafeInteger(input.accountBalanceCents) || input.accountBalanceCents < 0) throw new HttpError(400, 'Invalid account balance.');
  if (input.history !== undefined && (!Array.isArray(input.history) || input.history.length > 10000)) throw new HttpError(400, 'Invalid transaction history.');
  if (input.createdAt && !Number.isFinite(new Date(input.createdAt).getTime())) throw new HttpError(400, 'Invalid assessment date.');
  if (input.historySummary !== undefined) {
    if (!input.historySummary || typeof input.historySummary !== 'object' || Array.isArray(input.historySummary)) throw new HttpError(400, 'Invalid historical summary.');
    for (const name of ['dailyOutgoingCents', 'outgoingCount10m', 'outgoingAmount10m', 'averageOutgoingCents', 'historyCount']) {
      const value = input.historySummary[name];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new HttpError(400, 'Invalid historical aggregate.');
    }
    if (input.historySummary.knownPayee !== undefined && typeof input.historySummary.knownPayee !== 'boolean') throw new HttpError(400, 'Invalid recipient history.');
  }
}

class FraudEngine {
  constructor({ dbPath = ':memory:', model = require('./model.json') } = {}) {
    this.model = model;
    this.db = openStore(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fraud_rules (id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fraud_settings (id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fraud_rule_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL, actor_id TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fraud_assessments (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS fraud_assessments_date ON fraud_assessments(created_at);
    `);
    const insert = this.db.prepare('INSERT OR IGNORE INTO fraud_rules(id,value_json) VALUES(?,?)');
    for (const rule of DEFAULT_RULES) insert.run(rule.id, JSON.stringify(rule));
    this.db.prepare('INSERT OR IGNORE INTO fraud_settings(id,version,updated_at) VALUES(1,1,?)').run(new Date().toISOString());
  }

  getRules() {
    const settings = this.db.prepare('SELECT version,updated_at FROM fraud_settings WHERE id=1').get();
    return { rules: this.db.prepare('SELECT value_json FROM fraud_rules ORDER BY rowid').all().map(r => JSON.parse(r.value_json)), version: settings.version, updatedAt: settings.updated_at, reviewThreshold: 65, blockThreshold: 95 };
  }

  updateRule(id, patch, actor) {
    const current = this.db.prepare('SELECT value_json FROM fraud_rules WHERE id=?').get(id);
    if (!current) throw new HttpError(404, 'Fraud rule not found.');
    if (!Number.isSafeInteger(patch.version)) throw new HttpError(400, 'Supply the current rule version.');
    const rule = JSON.parse(current.value_json);
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new HttpError(400, 'Choose whether the rule is enabled.');
    if (patch.action !== undefined && !['review', 'block'].includes(patch.action)) throw new HttpError(400, 'Choose review or block.');
    if (patch.threshold !== undefined && (typeof patch.threshold !== 'number' || !Number.isFinite(patch.threshold) || patch.threshold <= 0 || patch.threshold > (id === 'balance_utilization' ? 100 : id === 'velocity' ? 1000 : 10000000))) throw new HttpError(400, 'Enter a positive threshold within the supported limit.');
    if (rule.unit.startsWith('SGD') && patch.threshold !== undefined && (patch.threshold < 0.01 || Math.abs(patch.threshold * 100 - Math.round(patch.threshold * 100)) > 0.000001)) throw new HttpError(400, 'Currency thresholds must be at least one cent and support up to two decimal places.');
    if (id === 'velocity' && patch.threshold !== undefined && !Number.isInteger(patch.threshold)) throw new HttpError(400, 'Transaction counts must be whole numbers.');
    if (!actor || !String(actor.id || actor.userId || actor).trim()) throw new HttpError(400, 'A rule-change actor is required.');
    const next = { ...rule, ...Object.fromEntries(['enabled', 'threshold', 'action'].filter(key => patch[key] !== undefined).map(key => [key, patch[key]])) };
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.db.prepare('UPDATE fraud_settings SET version=version+1, updated_at=? WHERE id=1 AND version=?').run(now, patch.version);
      if (!updated.changes) throw new HttpError(409, 'Fraud rules changed. Refresh and try again.');
      this.db.prepare('UPDATE fraud_rules SET value_json=? WHERE id=?').run(JSON.stringify(next), id);
      this.db.prepare('INSERT INTO fraud_rule_audit(rule_id,actor_id,before_json,after_json,version,created_at) VALUES(?,?,?,?,?,?)').run(id, String(actor.id || actor.userId || actor), JSON.stringify(rule), JSON.stringify(next), patch.version + 1, now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.getRules();
  }

  getModelInfo() {
    const { version, algorithm, features, training, metrics, policy } = this.model;
    return { version, algorithm, features, training, metrics, policy, historyWindow: 'Completed outgoing transactions supplied by the banking ledger; Singapore time for daily and hourly features.', scoreMeaning: '0–100 risk indicator, not a probability of proven fraud.', limitations: 'The included baseline is trained on synthetic labelled observations. Evaluate and calibrate with representative, governed data before any real financial use.' };
  }

  assess(input) {
    validateAssessment(input);
    const fingerprint = createHash('sha256').update(JSON.stringify([String(input.userId), input.type, input.amountCents, String(input.payee), Boolean(input.isInternal)])).digest('hex');
    const previous = this.db.prepare('SELECT fingerprint,result_json FROM fraud_assessments WHERE id=?').get(String(input.transactionId));
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new HttpError(409, 'This assessment identifier was already used for a different transaction.');
      return JSON.parse(previous.result_json);
    }
    const { context, values } = historicalFeatures(input);
    const contributions = values.map((value, i) => value * this.model.weights[i]);
    const prediction = sigmoid(this.model.intercept + contributions.reduce((sum, value) => sum + value, 0));
    // Machine learning alone sends unusual payments to a reviewer; hard limits may block.
    let score = Math.min(94, Math.round(prediction * 100));
    let decision = score >= 65 ? 'review' : 'allow';
    const reasons = [];
    const add = (code, message, contribution = 0) => reasons.push({ code, message, contribution: Number(contribution.toFixed(3)) });
    if (context.amountCents > context.averageOutgoingCents * 3 && context.historyCount) add('amount_deviation', `Amount is ${(context.amountCents / context.averageOutgoingCents).toFixed(1)}× the historical average outgoing payment.`, contributions[1]);
    if (!context.knownPayee) add('new_recipient', 'No completed outgoing payment to this recipient appears in the available history.', contributions[3]);
    if (context.outgoingCount10m >= 3) add('recent_activity', `${context.outgoingCount10m} outgoing payments were completed in the last ten minutes.`, contributions[2]);
    if (context.amountCents / Math.max(1, context.balanceCents) >= 0.75) add('balance_share', 'This payment uses a large share of the available account balance.', contributions[4]);
    if (context.hour < 6) add('unusual_hour', 'The payment was initiated between midnight and 6am Singapore time.', contributions[5]);
    if (!context.historyCount) add('limited_history', 'Limited historical activity is available; the baseline model is used.');
    const policy = this.getRules();
    const matchedRules = [];
    for (const rule of policy.rules.filter(rule => rule.enabled)) {
      const thresholdCents = Math.round(rule.threshold * 100);
      const matched = rule.id === 'high_value' ? input.amountCents >= thresholdCents
        : rule.id === 'new_payee' ? !context.knownPayee && input.amountCents >= thresholdCents
          : rule.id === 'velocity' ? context.outgoingCount10m >= rule.threshold
            : rule.id === 'balance_utilization' ? input.amountCents / Math.max(1, context.balanceCents) * 100 >= rule.threshold
              : rule.id === 'daily_limit' ? !input.isInternal && context.dailyOutgoingCents + input.amountCents > thresholdCents : false;
      if (!matched) continue;
      matchedRules.push(rule.id);
      add(`rule:${rule.id}`, `${rule.name} rule matched (${rule.threshold.toLocaleString('en-SG')} ${rule.unit}).`);
      score = Math.max(score, rule.action === 'block' ? 95 : 70);
      if (rule.action === 'block') decision = 'block';
      else if (decision !== 'block') decision = 'review';
    }
    if (score >= 65 && !reasons.length) add('model_pattern', 'The combined amount, timing and recent activity differ from the baseline transaction pattern.');
    if (!reasons.length) add('usual_pattern', 'No enabled rule or strong behavioural anomaly was detected.');
    const result = {
      score, decision, reasons, modelVersion: this.model.version, ruleVersion: policy.version,
      assessedAt: new Date(input.createdAt || Date.now()).toISOString(), matchedRules,
      features: Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, Number(values[i].toFixed(4))])),
      context: { historicalTransactions: context.historyCount, averageOutgoingCents: Math.round(context.averageOutgoingCents), outgoingCount10m: context.outgoingCount10m, dailyOutgoingCents: context.dailyOutgoingCents, knownPayee: context.knownPayee },
      controls: {
        dailyLimitCents: Math.round((policy.rules.find(r => r.id === 'daily_limit' && r.enabled && r.action === 'block')?.threshold || 0) * 100) || null,
        velocityLimit: policy.rules.find(r => r.id === 'velocity' && r.enabled && r.action === 'block')?.threshold || null,
      },
    };
    // A second concurrent request returns the first persisted assessment.
    this.db.prepare('INSERT OR IGNORE INTO fraud_assessments(id,fingerprint,result_json,created_at) VALUES(?,?,?,?)').run(String(input.transactionId), fingerprint, JSON.stringify(result), result.assessedAt);
    const stored = this.db.prepare('SELECT fingerprint,result_json FROM fraud_assessments WHERE id=?').get(String(input.transactionId));
    if (stored.fingerprint !== fingerprint) throw new HttpError(409, 'Assessment identifier conflict.');
    return JSON.parse(stored.result_json);
  }

  close() { this.db.close(); }
}

module.exports = { FraudEngine, DEFAULT_RULES };
