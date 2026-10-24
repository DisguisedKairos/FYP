'use strict';

const { HttpError } = require('../models/errors');
const MODEL_REVIEW_THRESHOLD = 65;
const MAX_CENTS = 9000000000000;
const asIso = value => new Date(value).toISOString();
const integer = (value, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const FEATURE_MAXIMUMS = { amountLog: 2, amountDeviation: 2, velocity: 2, newPayee: 1, balanceUtilization: 1.5, unusualHour: 1, recentValue: 2 };
const ruleView = row => ({ id: row.id, name: row.name, description: row.description, enabled: row.enabled, threshold: Number(row.threshold), unit: row.unit, action: row.action });

function sameBinding(left, right) {
  return ['transactionId', 'userId', 'sourceAccountId', 'payloadHash', 'type', 'amountCents', 'payee', 'isInternal'].every(key => left[key] === right[key]);
}

function validateInput(input) {
  if (!object(input)) throw new HttpError(400, 'A bound transaction assessment is required.');
  for (const key of ['transactionId', 'userId', 'sourceAccountId', 'payee']) {
    if (typeof input[key] !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(input[key])) throw new HttpError(400, `Invalid assessment ${key}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(input.payloadHash) || !['transfer', 'bill'].includes(input.type) || typeof input.isInternal !== 'boolean'
    || !integer(input.amountCents, MAX_CENTS) || input.amountCents < 1 || !integer(input.accountBalanceCents, MAX_CENTS)
    || typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) throw new HttpError(400, 'Invalid bound assessment data.');
  const summary = input.historySummary;
  if (!object(summary) || !['dailyOutgoingCents', 'outgoingCount10m', 'outgoingAmount10m', 'historyCount'].every(key => integer(summary[key]))
    || !Number.isFinite(summary.averageOutgoingCents) || summary.averageOutgoingCents < 0 || typeof summary.knownPayee !== 'boolean') {
    throw new HttpError(503, 'Authoritative payment history is unavailable.');
  }
}

function validateModel(risk, input) {
  const invalid = () => new HttpError(503, 'The fraud model returned an invalid or unbound assessment. No funds moved.');
  if (!object(risk) || !sameBinding(risk, input) || !integer(risk.score, 94) || risk.modelScore !== risk.score
    || risk.decision !== (risk.score >= MODEL_REVIEW_THRESHOLD ? 'review' : 'allow') || risk.synthetic !== true
    || typeof risk.modelVersion !== 'string' || risk.modelVersion.length < 1 || risk.modelVersion.length > 150
    || typeof risk.assessedAt !== 'string' || !Number.isFinite(Date.parse(risk.assessedAt))
    || !object(risk.features) || !object(risk.context) || !Array.isArray(risk.reasons) || risk.reasons.length > 100
    || Date.parse(risk.assessedAt) !== Date.parse(input.createdAt)) throw invalid();
  if (Object.keys(risk.features).length !== 7 || !Object.entries(FEATURE_MAXIMUMS).every(([key, maximum]) =>
    typeof risk.features[key] === 'number' && Number.isFinite(risk.features[key]) && risk.features[key] >= 0 && risk.features[key] <= maximum
    && (!['newPayee', 'unusualHour'].includes(key) || [0, 1].includes(risk.features[key])))) throw invalid();
  const summary = input.historySummary, context = risk.context;
  if (!integer(context.historicalTransactions) || context.historicalTransactions !== summary.historyCount
    || !integer(context.averageOutgoingCents, MAX_CENTS) || context.averageOutgoingCents !== Math.round(summary.averageOutgoingCents)
    || !integer(context.outgoingCount10m) || context.outgoingCount10m !== summary.outgoingCount10m
    || !integer(context.dailyOutgoingCents) || context.dailyOutgoingCents !== summary.dailyOutgoingCents
    || context.knownPayee !== Boolean(input.isInternal || summary.knownPayee)
    || (risk.modelSha256 !== undefined && !/^[a-f0-9]{64}$/.test(risk.modelSha256))) throw invalid();
  if (!risk.reasons.every(reason => object(reason) && typeof reason.code === 'string' && reason.code.length <= 150
    && typeof reason.message === 'string' && reason.message.length <= 1000 && Number.isFinite(reason.contribution))) throw invalid();
  return risk;
}

function evaluateRules(rules, input, { blockingOnly = false } = {}) {
  const summary = input.historySummary;
  return rules.filter(rule => {
    if (!rule.enabled || (blockingOnly && rule.action !== 'block')) return false;
    if (rule.id === 'high_value') return input.amountCents >= Math.round(rule.threshold * 100);
    if (rule.id === 'balance_utilization') return input.accountBalanceCents > 0 && input.amountCents * 100 >= input.accountBalanceCents * rule.threshold;
    if (input.isInternal) return false;
    if (rule.id === 'new_payee') return !summary.knownPayee && input.amountCents >= Math.round(rule.threshold * 100);
    if (rule.id === 'velocity') return summary.outgoingCount10m >= rule.threshold;
    if (rule.id === 'daily_limit') return summary.dailyOutgoingCents + input.amountCents > Math.round(rule.threshold * 100);
    throw new HttpError(503, 'An unsupported financial rule is configured.');
  }).map(rule => ({ code: `rule:${rule.id}`, message: `${rule.name}: the configured ${rule.action} threshold was reached.`, contribution: 0, ruleId: rule.id, action: rule.action }));
}

async function readPolicy(queryable, { lock = false } = {}) {
  const settings = (await queryable.query(`SELECT * FROM fraud_settings WHERE id=1${lock ? ' FOR SHARE' : ''}`)).rows[0];
  const rows = (await queryable.query('SELECT * FROM fraud_rules ORDER BY id')).rows;
  if (!settings || rows.length !== 5 || !rows.every(row => ['high_value', 'new_payee', 'velocity', 'balance_utilization', 'daily_limit'].includes(row.id))) throw new HttpError(503, 'Financial safety rules are unavailable.');
  return { rules: rows.map(ruleView), version: Number(settings.version), reviewThreshold: Number(settings.review_threshold), blockThreshold: 95 };
}

function positivePage(value, fallback, maximum) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw new HttpError(400, 'Invalid audit pagination.');
  return Number(value);
}

function createRiskClient({ db, url = process.env.FRAUD_SERVICE_URL || 'http://127.0.0.1:4011', token = process.env.SERVICE_TOKEN, assessModel = null, modelInfo = null } = {}) {
  if (!db?.transaction || !db?.query) throw new Error('A PostgreSQL database is required for risk orchestration.');
  const origin = new URL(url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('FRAUD_SERVICE_URL must be an HTTP(S) origin.');
  async function call(pathname, body) {
    if (!token || token.length < 24) throw new HttpError(503, 'The fraud service is not securely configured.');
    try {
      const response = await fetch(new URL(pathname, origin), { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('Fraud service rejected the assessment.');
      return result;
    } catch { throw new HttpError(503, 'Transaction screening is unavailable. Your balance has not changed.'); }
  }
  async function getRules() { return db.transaction(client => readPolicy(client), { isolation: 'REPEATABLE READ', readOnly: true }); }
  async function analyze(input) {
    validateInput(input);
    return validateModel(assessModel ? await assessModel(input) : (await call('/internal/assess', input)).risk, input);
  }
  async function assess(input) {
    validateInput(input);
    const record = await db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`risk:${input.transactionId}`]);
      const previous = (await client.query('SELECT * FROM fraud_assessments WHERE id=$1', [input.transactionId])).rows[0];
      if (previous) {
        if (!sameBinding(previous.input_json, input)) throw new HttpError(409, 'This assessment identifier is bound to another payment.');
        return previous;
      }
      const policy = await readPolicy(client, { lock: true });
      const inserted = await client.query('INSERT INTO fraud_assessments(id,user_id,source_account_id,payload_hash,policy_version,policy_json,input_json) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [input.transactionId, input.userId, input.sourceAccountId, input.payloadHash, policy.version, policy, input]);
      return inserted.rows[0];
    });
    if (record.result_json) return record.result_json;
    const bound = record.input_json, policy = record.policy_json;
    const model = await analyze(bound);
    const matches = evaluateRules(policy.rules, bound);
    const decision = matches.some(reason => reason.action === 'block') ? 'block' : matches.length || model.decision === 'review' ? 'review' : 'allow';
    const result = { ...model, decision, score: decision === 'block' ? 95 : matches.length ? Math.max(70, model.score) : model.score, ruleVersion: policy.version,
      reasons: [...model.reasons, ...matches], policy: { version: policy.version, rules: policy.rules },
      controls: { dailyLimitCents: Math.round(policy.rules.find(rule => rule.id === 'daily_limit' && rule.enabled && rule.action === 'block')?.threshold * 100) || null,
        velocityLimit: policy.rules.find(rule => rule.id === 'velocity' && rule.enabled && rule.action === 'block')?.threshold || null } };
    const stored = await db.query('UPDATE fraud_assessments SET result_json=COALESCE(result_json,$2::jsonb) WHERE id=$1 RETURNING result_json', [bound.transactionId, result]);
    return stored.rows[0].result_json;
  }
  async function updateRule(id, patch, actor) {
    if (!object(patch) || Object.keys(patch).some(key => !['enabled', 'threshold', 'action', 'version'].includes(key))) throw new HttpError(400, 'Invalid rule changes.');
    if (!Number.isSafeInteger(Number(patch.version)) || Number(patch.version) < 1) throw new HttpError(400, 'Supply the current rule version.');
    return db.transaction(async client => {
      const administrator = (await client.query("SELECT id,name,auth_version FROM users WHERE id=$1 AND role='admin' FOR UPDATE", [actor?.id])).rows[0];
      if (!administrator) throw new HttpError(403, 'Administrator access is required.');
      if (actor.auth_version !== undefined && administrator.auth_version !== actor.auth_version) throw new HttpError(409, 'Account security changed. Authorize the rule change again.');
      const settings = (await client.query('SELECT version FROM fraud_settings WHERE id=1 FOR UPDATE')).rows[0];
      if (Number(settings.version) !== Number(patch.version)) throw new HttpError(409, 'The rules changed. Reload before saving.');
      const row = (await client.query('SELECT * FROM fraud_rules WHERE id=$1', [id])).rows[0];
      if (!row) throw new HttpError(404, 'Financial rule not found.');
      const before = ruleView(row), after = { ...before };
      if (patch.enabled !== undefined) { if (typeof patch.enabled !== 'boolean') throw new HttpError(400, 'Enabled must be true or false.'); after.enabled = patch.enabled; }
      if (patch.action !== undefined) { if (!['review', 'block'].includes(patch.action)) throw new HttpError(400, 'Choose review or block.'); after.action = patch.action; }
      if (patch.threshold !== undefined) {
        const threshold = Number(patch.threshold);
        if (!['string', 'number'].includes(typeof patch.threshold) || !/^\d+(?:\.\d{1,2})?$/.test(String(patch.threshold)) || !Number.isFinite(threshold) || threshold <= 0 || threshold > MAX_CENTS / 100
          || (id === 'velocity' && !Number.isSafeInteger(threshold)) || (id === 'balance_utilization' && threshold > 100)) throw new HttpError(400, 'Choose a valid rule threshold.');
        after.threshold = threshold;
      }
      await client.query('UPDATE fraud_rules SET enabled=$2,threshold=$3,action=$4 WHERE id=$1', [id, after.enabled, after.threshold, after.action]);
      const version = Number(settings.version) + 1;
      await client.query('UPDATE fraud_settings SET version=$1 WHERE id=1', [version]);
      await client.query('INSERT INTO fraud_rule_audit(rule_id,version,actor_id,actor_name,before_json,after_json) VALUES($1,$2,$3,$4,$5,$6)', [id, version, administrator.id, administrator.name, before, after]);
      return { ...await readPolicy(client), updatedRule: after };
    });
  }
  async function getAudit(parameters = {}) {
    const page = positivePage(parameters.page, 1, 1000000), pageSize = positivePage(parameters.pageSize, 10, 100);
    return db.transaction(async client => {
      const values = [], where = parameters.ruleId ? 'WHERE rule_id=$1' : '';
      if (parameters.ruleId) {
        if (!(await client.query('SELECT id FROM fraud_rules WHERE id=$1', [parameters.ruleId])).rowCount) throw new HttpError(400, 'Unknown financial rule.');
        values.push(parameters.ruleId);
      }
      const total = Number((await client.query(`SELECT count(*) AS count FROM fraud_rule_audit ${where}`, values)).rows[0].count);
      const rows = (await client.query(`SELECT * FROM fraud_rule_audit ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])).rows;
      return { entries: rows.map(row => ({ id: String(row.id), ruleId: row.rule_id, version: Number(row.version), actor: { id: String(row.actor_id), name: row.actor_name }, before: row.before_json, after: row.after_json, createdAt: asIso(row.created_at) })),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    }, { isolation: 'REPEATABLE READ', readOnly: true });
  }
  return { assess, analyze, getRules, getAudit, updateRule, getModelInfo: async () => modelInfo || (await call('/internal/model')).model, close() {} };
}

module.exports = { createRiskClient, readPolicy, evaluateRules, validateInput, validateModel, sameBinding };
