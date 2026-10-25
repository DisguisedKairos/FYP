'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { HttpError } = require('../models/errors');
const { assertActor } = require('./agents/reports');
const { readPolicy, evaluateRules } = require('./risk');
const { enqueue, assertAuthorization } = require('./ledger');
const iso = value => new Date(value).toISOString();
const VERSION = 'surveillance-v3-ollama';
const reviewCodes = new Set(['confirmed_fraud', 'legitimate', 'inconclusive']);
function batchSize(value = 25) { if (!Number.isInteger(value) || value < 1 || value > 25) throw new HttpError(400, 'Scan between 1 and 25 payments per batch.'); return value; }
function signal(code, message, source) { return { code, message, source }; }
function bindingMatches(input, row) {
  return input && input.transactionId === row.id && input.userId === String(row.user_id) && input.sourceAccountId === String(row.account_id) && input.amountCents === -Number(row.amount_cents) && input.type === row.type && input.payee === row.payee && input.isInternal === row.internal && Date.parse(input.createdAt) === new Date(row.requested_at).getTime();
}
function finding(row, { model = null, policy, prior, now = Date.now } = {}) {
  const signals = [], amount = -Number(row.amount_cents), original = row.risk_json || row.result_json;
  if (['review', 'block'].includes(original?.decision)) signals.push(signal('original_' + original.decision, 'The original payment screening requested ' + (original.decision === 'block' ? 'a block' : 'independent review') + '.', 'recorded_screening'));
  if (model?.modelScore >= 65) signals.push(signal('ai_risk', 'The AI model identified an unusual transaction pattern above its review threshold.', 'ollama_ai'));
  let matched = [];
  if (model) {
    matched = evaluateRules(policy.rules, row.input_json);
    signals.push(...matched.map(r => signal(r.code, r.message + ' This is a retrospective policy comparison.', 'current_policy')));
  } else signals.push(signal('missing_context', 'The original bound historical input is unavailable or mismatched. AI reassessment is unavailable; manually inspect this record.', 'coverage_gap'));
  const high = policy.rules.find(r => r.id === 'high_value'), threshold = high?.enabled ? Math.round(high.threshold * 100) : null;
  if (!row.internal && threshold && prior.samePayeeCount >= 2 && amount < threshold && prior.samePayeeCents + amount >= threshold) signals.push(signal('split_payments', 'Several smaller payments to the same payee within ten minutes reach the configured high-value threshold together.', 'historical_pattern'));
  if (!row.internal && prior.count >= 5 && prior.averageCents > 0 && amount >= 150000 && amount >= 4 * prior.averageCents) signals.push(signal('amount_jump', 'This payment is at least four times the earlier average, with sufficient prior payments for comparison.', 'historical_pattern'));
  const base = model?.modelScore ?? (Number.isInteger(original?.modelScore) && original.modelScore >= 0 && original.modelScore <= 94 ? original.modelScore : null);
  const score = matched.some(r => r.action === 'block') || original?.decision === 'block' ? 95 : signals.some(s => s.code !== 'missing_context') ? Math.max(70, base || 0) : base;
  return { analyzedAt: iso(now()), detector: VERSION, transactionId: row.id, amountCents: amount, transactionStatusAtScan: row.status,
    flagged: signals.length > 0, score, scoreScale: 100, signals,
    model: model ? { score: model.modelScore, provider:model.provider,modelName:model.modelName,promptSha256:model.promptSha256,version: model.modelVersion, sha256: model.modelSha256 || null, reasons: model.reasons, features: model.features, snapshotAt: row.input_json.createdAt } : null,
    original: original ? { modelScore: original.modelScore ?? null, combinedScore: original.score ?? null, decision: original.decision, reasons: original.reasons || [] } : null,
    history: prior, policyVersion: policy.version, policy: policy.rules,
    limitations: ['A flag is a request for human investigation, not proof of fraud.', 'AI uses the recorded pre-payment context; later transactions do not enter this model snapshot.', 'Pattern comparisons use earlier completed outgoing payments on the source account; equal-time entries are conservatively excluded.', 'Scores are local Ollama risk indicators without validated real-world fraud performance. A low score does not establish safety.', 'Case decisions do not approve, reverse, refund or change any payment.'] };
}
async function historyBefore(db, row, policy) {
  const threshold = Math.round((policy.rules.find(r => r.id === 'high_value')?.threshold || 90000000000) * 100);
  const r = (await db.query(`SELECT count(*)::int AS count,COALESCE(avg(-amount_cents),0)::text AS average,
    count(*) FILTER(WHERE payee=$3 AND completed_at >= $2::timestamptz-interval '10 minutes' AND -amount_cents<$5)::int AS same_count,
    COALESCE(sum(-amount_cents) FILTER(WHERE payee=$3 AND completed_at >= $2::timestamptz-interval '10 minutes' AND -amount_cents<$5),0)::text AS same_cents
    FROM transactions WHERE account_id=$1 AND amount_cents<0 AND status='completed' AND NOT internal AND completed_at<$2 AND id<>$4`, [row.account_id, row.requested_at, row.payee, row.id, threshold])).rows[0];
  return { count: r.count, averageCents: Math.round(Number(r.average)), samePayeeCount: r.same_count, samePayeeCents: Number(r.same_cents), samePayeeThresholdCents: threshold, before: iso(row.requested_at) };
}
async function audit(client, actor, event, metadata, now) { await client.query('INSERT INTO audit_log(actor_id,event_type,metadata,created_at) VALUES($1,$2,$3,$4)', [actor?.id || null, event, metadata, iso(now())]); }
async function saveFinding(db, row, evidence, detector, lease, { actor, now, validateSession }) {
  return db.transaction(async client => {
    await validateSession();
    if (actor) await assertActor(client, actor, { admin: true });
    const state = (await client.query('SELECT lease_owner,lease_until FROM fraud_monitor_state WHERE id=1 FOR UPDATE')).rows[0];
    if (state.lease_owner !== lease || new Date(state.lease_until).getTime() <= now()) throw new HttpError(409, 'This scan lease expired. Start another scan.');
    const inserted = await client.query('INSERT INTO fraud_screenings(id,transaction_id,detector_version,evidence_json,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(transaction_id,detector_version) DO NOTHING RETURNING id', [randomUUID(), row.id, detector, evidence, iso(now())]);
    if (!inserted.rowCount || !evidence.flagged) return { created: 0, reopened: 0 };
    const previous = (await client.query('SELECT c.*,s.evidence_json FROM fraud_cases c JOIN fraud_screenings s ON s.id=c.screening_id WHERE c.transaction_id=$1 FOR UPDATE OF c', [row.id])).rows[0];
    const newSignals = previous ? evidence.signals.some(s => !previous.evidence_json.signals.some(old => old.code === s.code)) : true;
    const escalated = previous && (evidence.score || 0) > (previous.score || 0);
    const reopen = previous?.status === 'closed' && (newSignals || escalated);
    let id = previous?.id, created = 0;
    if (!previous) {
      id = randomUUID(); created = 1;
      await client.query('INSERT INTO fraud_cases(id,transaction_id,screening_id,score,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, row.id, inserted.rows[0].id, evidence.score, iso(now())]);
    } else if (previous.status !== 'closed' || reopen) {
      await client.query(`UPDATE fraud_cases SET screening_id=$2,score=$3,version=version+1,updated_at=$4,
        status=CASE WHEN $5 THEN 'open' ELSE status END,assigned_to=CASE WHEN $5 THEN NULL ELSE assigned_to END,
        outcome=CASE WHEN $5 THEN NULL ELSE outcome END,review_reason=CASE WHEN $5 THEN NULL ELSE review_reason END,resolved_at=CASE WHEN $5 THEN NULL ELSE resolved_at END WHERE id=$1`, [id, inserted.rows[0].id, evidence.score, iso(now()), Boolean(reopen)]);
    }
    if (created || reopen) {
      await audit(client, actor, reopen ? 'fraud.case_reopened' : 'fraud.case_flagged', { caseId: id, transactionId: row.id, screeningId: inserted.rows[0].id, signalCodes: evidence.signals.map(s => s.code), score: evidence.score }, now);
      const staff = (await client.query("SELECT id FROM users WHERE role='admin' AND id<>$1", [row.user_id])).rows;
      for (const reviewer of staff) await enqueue(client, { userId: reviewer.id, type: 'fraud.flagged', title: reopen ? 'Suspicious activity case reopened' : 'Suspicious activity needs review', message: 'A payment was flagged for human investigation. Inspect the recorded AI and pattern evidence.', transactionId: row.id, metadata: { fraudCaseId: id }, createdAt: iso(now()) });
    }
    return { created, reopened: Number(Boolean(reopen)) };
  });
}
async function scan(db, riskClient, { actor = null, now = Date.now, limit = 25, transactionId = null, force = false, validateSession = async () => {} } = {}) {
  limit = batchSize(limit);
  if (actor) await assertActor(db, actor, { admin: true });
  if (transactionId !== null) {
    if (typeof transactionId !== 'string' || !/^[A-Za-z0-9:_-]{1,150}$/.test(transactionId)) throw new HttpError(400, 'Choose a valid outgoing transaction ID.');
    if (!(await db.query("SELECT 1 FROM transactions WHERE id=$1 AND amount_cents<0 AND type IN ('transfer','bill') AND requested_at<=$2", [transactionId, iso(now())])).rowCount) throw new HttpError(404, 'Outgoing payment not found. Incoming credits are represented by their original outgoing payment.');
  }
  const lease = randomUUID(), started = now(), deadline = Date.now() + 60000;
  const claimed = await db.query(`UPDATE fraud_monitor_state SET lease_owner=$1,lease_until=$2,last_started_at=$3,next_run_at=$4
    WHERE id=1 AND (lease_until IS NULL OR lease_until<=$3) AND ($5 OR next_run_at<=$3) RETURNING id`, [lease, iso(started + 120000), iso(started), iso(started + 30000), force]);
  if (!claimed.rowCount) { if (force) throw new HttpError(409, 'A monitoring scan is already running. Try again shortly.'); return { skipped: true }; }
  const summary = { checked: 0, flagged: 0, created: 0, reopened: 0, modelAnalyzed: 0, manualContext: 0, remaining: 0 };
  try {
    const active = await riskClient.getModelInfo(), policy = await readPolicy(db);
    const digest = active.modelSha256 || createHash('sha256').update(JSON.stringify(active)).digest('hex');
    const detector = `${VERSION}:${active.version}:${digest}:prompt-${active.promptSha256 || "unknown"}:policy-${policy.version}`;
    const rows = (await db.query(`SELECT t.*,a.user_id,f.input_json,f.result_json FROM transactions t JOIN accounts a ON a.id=t.account_id
      LEFT JOIN fraud_assessments f ON f.id=t.id WHERE t.amount_cents<0 AND t.type IN ('transfer','bill') AND t.requested_at<=$2
      AND NOT EXISTS(SELECT 1 FROM fraud_screenings s WHERE s.transaction_id=t.id AND s.detector_version=$1) AND ($4::text IS NULL OR t.id=$4)
      ORDER BY t.insert_seq LIMIT $3`, [detector, iso(started), limit + 1, transactionId])).rows;
    for (const row of rows.slice(0, limit)) {
      if (Date.now() + 8000 > deadline) break;
      await validateSession();
      if (actor) await assertActor(db, actor, { admin: true });
      const model = bindingMatches(row.input_json, row) ? await riskClient.analyze(row.input_json,{timeoutMs:Math.min(50000,deadline-Date.now()),audit:{kind:'monitoring',subjectId:row.id,actorId:actor?.id || null,detectorVersion:detector}}) : null;
      if (model && active.modelSha256 && model.modelSha256 !== active.modelSha256) throw new HttpError(503, 'The scorer changed during analysis. Retry after verifying the model.');
      const evidence = finding(row, { model, policy, prior: await historyBefore(db, row, policy), now });
      const saved = await saveFinding(db, row, evidence, detector, lease, { actor, now, validateSession });
      summary.checked++; summary.flagged += Number(evidence.flagged); summary.created += saved.created; summary.reopened += saved.reopened;
      if (model) summary.modelAnalyzed++; else summary.manualContext++;
    }
    summary.remaining = Number((await db.query(`SELECT count(*)::int AS count FROM transactions t WHERE amount_cents<0 AND type IN ('transfer','bill') AND requested_at<=$2 AND ($3::text IS NULL OR t.id=$3) AND NOT EXISTS(SELECT 1 FROM fraud_screenings s WHERE s.transaction_id=t.id AND s.detector_version=$1)`, [detector, iso(started), transactionId])).rows[0].count);
    await db.query('UPDATE fraud_monitor_state SET lease_owner=NULL,lease_until=NULL,last_completed_at=$2,last_error=NULL,last_summary=$3 WHERE id=1 AND lease_owner=$1', [lease, iso(now()), summary]);
    return summary;
  } catch (error) {
    await db.query('UPDATE fraud_monitor_state SET lease_owner=NULL,lease_until=NULL,last_error=$2,last_summary=$3 WHERE id=1 AND lease_owner=$1', [lease, error instanceof HttpError ? `HTTP_${error.status}` : 'SCAN_FAILED', summary]);
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Transaction monitoring is unavailable. Existing flags remain queued; unchecked payments will retry.');
  }
}
const projection = `SELECT c.*,t.amount_cents::text,t.description,t.status AS payment_status,t.account_id,a.user_id,a.number,b.legal_name,s.evidence_json,u.name AS reviewer_name
  FROM fraud_cases c JOIN transactions t ON t.id=c.transaction_id JOIN accounts a ON a.id=t.account_id
  LEFT JOIN businesses b ON b.id=a.business_id JOIN fraud_screenings s ON s.id=c.screening_id LEFT JOIN users u ON u.id=c.assigned_to`;
function caseView(row) { return { id: row.id, transactionId: row.transaction_id, status: row.status, score: row.score, version: row.version, assignedTo: row.assigned_to ? String(row.assigned_to) : null, reviewerName: row.reviewer_name || null, outcome: row.outcome, reviewReason: row.review_reason, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), resolvedAt: row.resolved_at ? iso(row.resolved_at) : null, transaction: { description: row.description, amountCents: -Number(row.amount_cents), status: row.payment_status, accountSuffix: row.number.slice(-4), business: row.legal_name || 'Business profile unavailable', makerId: String(row.user_id) }, evidence: row.evidence_json }; }
async function list(db, actor, { status = 'active', page = '1' } = {}) {
  await assertActor(db, actor, { admin: true });
  if (!['active', 'open', 'in_review', 'closed', 'all'].includes(status) || !/^[1-9]\d{0,5}$/.test(String(page))) throw new HttpError(400, 'Choose a valid case filter and page.');
  return db.transaction(async client => {
    const where = status === 'all' ? '' : status === 'active' ? "WHERE c.status<>'closed'" : 'WHERE c.status=$1', values = status === 'all' || status === 'active' ? [] : [status];
    const total = Number((await client.query('SELECT count(*) FROM fraud_cases c ' + where, values)).rows[0].count);
    const rows = (await client.query(projection + ' ' + where + ` ORDER BY c.updated_at DESC,c.id LIMIT 20 OFFSET $${values.length + 1}`, [...values, (Number(page) - 1) * 20])).rows;
    const counts = (await client.query("SELECT count(*) FILTER(WHERE status='open')::int AS open,count(*) FILTER(WHERE status='in_review')::int AS in_review,count(*) FILTER(WHERE status='closed')::int AS closed FROM fraud_cases")).rows[0];
    const state = (await client.query('SELECT last_started_at,last_completed_at,last_error,last_summary,lease_until FROM fraud_monitor_state WHERE id=1')).rows[0];
    return { cases: rows.map(caseView), counts, pagination: { page: Number(page), total, totalPages: Math.ceil(total / 20) }, monitor: { lastStartedAt: state.last_started_at ? iso(state.last_started_at) : null, lastCompletedAt: state.last_completed_at ? iso(state.last_completed_at) : null, lastError: state.last_error, summary: state.last_summary, running: state.lease_until && new Date(state.lease_until).getTime() > Date.now() }, scope: 'All recorded outgoing internal transfers and bills, including completed, pending and rejected instructions. Incoming mirror credits are represented by their source payment.' };
  }, { isolation: 'REPEATABLE READ', readOnly: true });
}
async function detail(db, actor, id) {
  await assertActor(db, actor, { admin: true });
  const row = (await db.query(projection + ' WHERE c.id=$1', [id])).rows[0];
  if (!row) throw new HttpError(404, 'Fraud investigation case not found.');
  const events = (await db.query("SELECT event_type,actor_id,metadata,created_at FROM audit_log WHERE metadata->>'caseId'=$1 AND event_type LIKE 'fraud.case_%' ORDER BY id", [id])).rows;
  return { ...caseView(row), events: events.map(e => ({ type: e.event_type, actorId: e.actor_id ? String(e.actor_id) : null, metadata: e.metadata, createdAt: iso(e.created_at) })) };
}
async function analysis(db, actor, transactionId) {
  await assertActor(db, actor, { admin: true });
  const row = (await db.query('SELECT s.id,s.evidence_json,s.created_at,c.id AS case_id FROM fraud_screenings s LEFT JOIN fraud_cases c ON c.transaction_id=s.transaction_id WHERE s.transaction_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 1', [transactionId])).rows[0];
  if (!row) throw new HttpError(404, 'No completed monitoring analysis is available for this outgoing payment.');
  return { screeningId: row.id, caseId: row.case_id || null, createdAt: iso(row.created_at), evidence: row.evidence_json };
}
async function decide(db, actor, id, body, { now = Date.now, authorization } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['action', 'version', 'outcome', 'reason'].includes(k)) || !['claim', 'close'].includes(body.action) || !Number.isInteger(body.version) || body.version < 1) throw new HttpError(400, 'Supply a supported action and the current case version.');
  if (body.action === 'close' && (!reviewCodes.has(body.outcome) || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.trim().length > 1000)) throw new HttpError(400, 'Choose an outcome and explain your decision in 10–1,000 characters.');
  await db.transaction(async client => {
    await assertActor(client, actor, { admin: true });
    const row = (await client.query('SELECT c.*,a.user_id FROM fraud_cases c JOIN transactions t ON t.id=c.transaction_id JOIN accounts a ON a.id=t.account_id WHERE c.id=$1 FOR UPDATE OF c', [id])).rows[0];
    if (!row) throw new HttpError(404, 'Fraud investigation case not found.');
    // Keep the case-before-reviewer lock order consistent with monitoring events.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
    await assertActor(client, actor, { admin: true });
    if (body.action === 'close') await assertAuthorization(client, actor, authorization, { admin: true });
    if (String(row.user_id) === String(actor.id)) throw new HttpError(403, 'A different bank reviewer must investigate your own payment.');
    if (row.version !== body.version || row.status === 'closed') throw new HttpError(409, 'This case changed. Reload it before making a decision.');
    if (body.action === 'claim') {
      if (row.status !== 'open') throw new HttpError(409, 'Another reviewer has already claimed this case.');
      await client.query("UPDATE fraud_cases SET status='in_review',assigned_to=$2,version=version+1,updated_at=$3 WHERE id=$1", [id, actor.id, iso(now())]);
    } else {
      if (row.status !== 'in_review' || String(row.assigned_to) !== String(actor.id)) throw new HttpError(403, 'Claim the case before recording your review outcome.');
      await client.query("UPDATE fraud_cases SET status='closed',outcome=$2,review_reason=$3,resolved_at=$4,updated_at=$4,version=version+1 WHERE id=$1", [id, body.outcome, body.reason.trim(), iso(now())]);
    }
    await audit(client, actor, body.action === 'claim' ? 'fraud.case_claimed' : 'fraud.case_closed', { caseId: id, transactionId: row.transaction_id, screeningId: row.screening_id, previousVersion: row.version, ...(body.action === 'close' ? { outcome: body.outcome, reason: body.reason.trim() } : {}) }, now);
  });
  return detail(db, actor, id);
}
module.exports = { scan, list, detail, analysis, decide, finding, bindingMatches, VERSION };
