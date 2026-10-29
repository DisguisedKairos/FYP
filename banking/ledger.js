'use strict';
const {validProvenance}=require('./ai-provider');

const { createHash, randomUUID } = require('node:crypto');
const { HttpError } = require('../models/errors');
const { readPolicy, evaluateRules, sameBinding } = require('./risk');
const businesses = require('./business');
const MAX_CENTS = 9000000000000;
const iso = value => value ? new Date(value).toISOString() : null;
const clock = now => iso((now || Date.now)());
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const TABLE = `SELECT t.*,a.name AS account_name,a.number AS account_number,a.user_id AS maker_id,u.name AS maker_name,u.email AS maker_email
 FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN users u ON u.id=a.user_id`;

function cents(value) { const number = Number(value); if (!Number.isSafeInteger(number)) throw new HttpError(409, 'A stored monetary value is outside the supported range.'); return number; }
function accountId(value) { if (!['number', 'string'].includes(typeof value) || (typeof value === 'number' && !Number.isSafeInteger(value)) || !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value) > 9223372036854775807n) throw new HttpError(400, 'Choose a valid savings account.'); return String(value); }
function parseAmount(value) {
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,14}(?:\.\d{1,2})?$/.test(String(value).trim())) throw new HttpError(400, 'Enter a positive amount with up to two decimal places.');
  const [whole, decimal = ''] = String(value).trim().split('.');
  const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (result < 1n || result > BigInt(MAX_CENTS)) throw new HttpError(400, 'Enter an amount within the supported limit.');
  return Number(result);
}
function requestKey(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(value)) throw new HttpError(400, 'A stable requestId is required for this action.'); return value; }
function accountView(row) { return { id: String(row.id), name: row.name, number: row.number, balanceCents: cents(row.balance_cents), status: row.status, productType:row.product_type || 'business_savings',businessId:row.business_id?String(row.business_id):null,createdAt: iso(row.created_at) }; }
function transactionView(row) {
  return { id: row.id, type: row.type, description: row.description, amountCents: cents(row.amount_cents), counterparty: row.counterparty,
    status: row.status, createdAt: iso(row.created_at), accountId: String(row.account_id), accountName: row.account_name || '', accountNumber: row.account_number || '',
    reference: row.reference, isInternal: row.internal, payee: row.payee || row.counterparty, risk: json(row.risk_json),
    authorization: json(row.authorization_json), review: json(row.review_json), requestedAt: iso(row.requested_at), completedAt: iso(row.completed_at) };
}
function normalize(kind, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a payment as a JSON object.');
  if (!['transfer', 'bill'].includes(kind)) throw new HttpError(400, 'Choose a transfer or bill payment.');
  const fromId = accountId(body.fromAccountId), amountCents = parseAmount(body.amount);
  if (kind === 'transfer') {
    if (typeof body.toAccountNumber !== 'string') throw new HttpError(400, 'Enter the recipient account number.');
    const number = body.toAccountNumber.replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(number)) throw new HttpError(400, 'Enter a 10-digit account number.');
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.trim().length > 100)) throw new HttpError(400, 'Use a transfer note of up to 100 characters.');
    return { fromId, number, amountCents, note: body.description?.trim() || 'Savings transfer' };
  }
  if (typeof body.billerId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.billerId)) throw new HttpError(400, 'Choose a valid biller.');
  if (typeof body.reference !== 'string' || body.reference.trim().length < 3 || body.reference.trim().length > 64) throw new HttpError(400, 'Enter a billing reference of 3–64 characters.');
  return { fromId, amountCents, billerId: body.billerId, reference: body.reference.trim() };
}
function canonicalHash(userId, kind, payload) { return createHash('sha256').update(JSON.stringify({ userId: String(userId), kind, payload })).digest('hex'); }
function deterministicId(userId, key) { const value = createHash('sha256').update(`${userId}:${key}`).digest('hex'); return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`; }
async function view(db, id) { const row = (await db.query(`${TABLE} WHERE t.id=$1`, [id])).rows[0]; return row ? transactionView(row) : null; }
async function replay(db, userId, key, kind, payload) {
  const previous = (await db.query('SELECT * FROM requests WHERE user_id=$1 AND request_id=$2', [userId, key])).rows[0];
  if (!previous) return null;
  if (previous.kind !== kind || previous.payload_hash !== canonicalHash(userId, kind, payload)) throw new HttpError(409, 'This requestId is already bound to another action.');
  return json(previous.result_json);
}
async function resolve(db, user, kind, payload, { checkFunds = true, lock = false } = {}) {
  let target = null;
  if (kind === 'transfer') target = (await db.query('SELECT a.*,b.legal_name AS owner_name,b.status AS business_status FROM accounts a LEFT JOIN businesses b ON b.id=a.business_id WHERE a.number=$1', [payload.number])).rows[0];
  if (lock) {
    const ids = [...new Set([payload.fromId, ...(target ? [String(target.id)] : [])])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    await db.query('SELECT id FROM accounts WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
    if (target) target = (await db.query('SELECT a.*,b.legal_name AS owner_name,b.status AS business_status FROM accounts a LEFT JOIN businesses b ON b.id=a.business_id WHERE a.id=$1', [target.id])).rows[0];
  }
  const source = (await db.query('SELECT * FROM accounts WHERE id=$1 AND user_id=$2', [payload.fromId, user.id])).rows[0];
  if (!source) throw new HttpError(404, 'Savings account not found.');
  const business = await businesses.assertApproved(db,user,{accountId:source.id});
  if (source.status !== 'active') throw new HttpError(409, 'The selected savings account is closed.');
  let counterparty, note, internal = false;
  if (kind === 'transfer') {
    if (!target) throw new HttpError(404, 'Recipient account not found.');
    if(target.business_status!=='approved')throw new HttpError(409,'The recipient must have an approved Green Link Digital Bank business account.');
    if (target.status !== 'active') throw new HttpError(409, 'The recipient account is closed.');
    if (String(target.id) === String(source.id)) throw new HttpError(409, 'Choose another destination account.');
    if (cents(target.balance_cents) + payload.amountCents > MAX_CENTS) throw new HttpError(409, 'The recipient account cannot receive this amount.');
    internal = String(target.user_id) === String(user.id); counterparty = internal ? target.name : target.owner_name; note = payload.note;
  } else {
    const biller = (await db.query('SELECT * FROM billers WHERE id=$1', [payload.billerId])).rows[0];
    if (!biller) throw new HttpError(400, 'Choose a valid biller.');
    counterparty = biller.name; note = `${biller.name} bill`;
  }
  if (checkFunds && cents(source.balance_cents) < payload.amountCents) throw new HttpError(409, 'Insufficient funds in the selected account.');
  return { source, target, counterparty, note, internal, business };
}
async function historySummary(db, userId, payee, createdAt) {
  const result = (await db.query(`SELECT
    COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.completed_at >= date_trunc('day',$3::timestamptz AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore'),0) AS daily,
    COUNT(*) FILTER(WHERE t.completed_at >= $3::timestamptz-interval '10 minutes') AS count10,
    COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.completed_at >= $3::timestamptz-interval '10 minutes'),0) AS amount10,
    COALESCE(AVG(-t.amount_cents),0) AS average,COUNT(*) AS count,
    COALESCE(bool_or(COALESCE(t.payee,t.counterparty)=$2),false) AS known
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    WHERE a.user_id=$1 AND t.status='completed' AND t.amount_cents<0 AND NOT t.internal AND t.completed_at <= $3::timestamptz`, [userId, payee, createdAt])).rows[0];
  return { dailyOutgoingCents: cents(result.daily), outgoingCount10m: cents(result.count10), outgoingAmount10m: cents(result.amount10),
    averageOutgoingCents: Math.round(Number(result.average)), historyCount: cents(result.count), knownPayee: result.known };
}
async function enqueue(client, { id = randomUUID(), userId, type, title, message, transactionId = null, metadata = {}, createdAt = new Date().toISOString() }) {
  const event = { id, userId: String(userId), type, title, message, transactionId, metadata, createdAt };
  await client.query('INSERT INTO notification_outbox(id,user_id,payload_json,created_at,available_at) VALUES($1,$2,$3,$4,$4)', [id, userId, event, createdAt]);
  return event;
}
async function authorize(db, user, password, now) { return require('./auth').authorize(db, user, password, now); }

async function assertAuthorization(client, user, authorization, { admin = false } = {}) {
  const current = (await client.query('SELECT id,auth_version,role FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
  if (!current || authorization?.method !== 'password' || String(authorization.userId) !== String(user.id)
    || !Number.isInteger(authorization.authVersion) || current.auth_version !== authorization.authVersion) {
    throw new HttpError(409, 'Account security changed. Review and authorize the action again.');
  }
  if (admin && current.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
}

async function lockSender(client, userId) {
  if (!(await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])).rowCount) throw new HttpError(401, 'Account owner no longer exists.');
}
async function bind(db, user, key, kind, payload) {
  const payloadHash = canonicalHash(user.id, kind, payload), id = deterministicId(user.id, key);
  const receipt = await db.transaction(async client => {
    await lockSender(client, user.id);
    // Schedules and payments share a request namespace. Recheck after locking:
    // another request may have committed since the optimistic replay lookup.
    const completed = await replay(client, user.id, key, kind, payload);
    if (completed) return completed;
    const previous = (await client.query('SELECT * FROM payment_bindings WHERE user_id=$1 AND request_id=$2', [user.id, key])).rows[0];
    if (previous) { if (previous.kind !== kind || previous.payload_hash !== payloadHash) throw new HttpError(409, 'This requestId is permanently bound to another payment payload.'); return; }
    await client.query('INSERT INTO payment_bindings(user_id,request_id,kind,payload_hash,canonical_json,assessment_id) VALUES($1,$2,$3,$4,$5,$6)', [user.id, key, kind, payloadHash, payload, id]);
  });
  return { id, payloadHash, receipt };
}
function validateAssessment(risk, input) {
  if (!risk || !sameBinding(risk, input) || !Number.isInteger(risk.score) || risk.score < 0 || risk.score > 100
    || !Number.isInteger(risk.modelScore) || risk.modelScore < 0 || risk.modelScore > 94 || !['allow', 'review', 'block'].includes(risk.decision)
    || !Number.isSafeInteger(risk.ruleVersion) || risk.ruleVersion < 1 || !Array.isArray(risk.reasons) || !risk.policy || !Array.isArray(risk.policy.rules)
    || !risk.features || !risk.modelVersion || !Number.isFinite(Date.parse(risk.assessedAt)) || !validProvenance(risk) || typeof risk.modelName!=='string' || !/^[a-f0-9]{64}$/.test(risk.promptSha256 || '')
    || (risk.decision === 'block' && risk.score < 95) || (risk.decision !== 'block' && risk.score > 94)
    || (risk.decision === 'allow' && risk.modelScore >= 65)) throw new HttpError(503, 'Screening returned an invalid bound result. No funds moved.');
}
async function currentMatches(client, user, payload, resolved, createdAt, { blockingOnly = false } = {}) {
  const policy = await readPolicy(client, { lock: true });
  const input = { amountCents: payload.amountCents, accountBalanceCents: cents(resolved.source.balance_cents), isInternal: resolved.internal,
    historySummary: await historySummary(client, user.id, payload.number || payload.billerId, createdAt) };
  return { policy, matches: evaluateRules(policy.rules, input, { blockingOnly }) };
}
async function settle(client, user, payload, resolved, transactionId, reference, createdAt, risk) {
  await client.query('UPDATE accounts SET balance_cents=balance_cents-$2 WHERE id=$1', [resolved.source.id, payload.amountCents]);
  if (resolved.target) {
    await client.query('UPDATE accounts SET balance_cents=balance_cents+$2 WHERE id=$1', [resolved.target.id, payload.amountCents]);
    const incomingId = randomUUID();
    const associated = { provider: risk.provider, modelName: risk.modelName, modelScore: risk.modelScore, modelSha256: risk.modelSha256, modelIdentitySha256:risk.modelIdentitySha256, identityKind:risk.identityKind, resolvedModel:risk.resolvedModel, promptSha256: risk.promptSha256,
      score: risk.score, decision: risk.decision, modelVersion: risk.modelVersion, ruleVersion: risk.ruleVersion,
      assessedAt: risk.assessedAt, assessmentId: transactionId, reasons: [{ code: 'associated_transfer', message: 'Screened with the originating transfer.', contribution: 0 }] };
    await client.query(`INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq,payee,risk_json)
      VALUES($1,$2,'transfer',$3,$4,$5,'completed',$6,$7,$8,$8,$8,nextval('settlement_sequence'),$9,$10)`,
    [incomingId, resolved.target.id, resolved.note, payload.amountCents, resolved.internal ? resolved.source.name : resolved.business.legalName, reference, resolved.internal, createdAt, resolved.source.number, associated]);
    if (!resolved.internal) await enqueue(client, { userId: resolved.target.user_id, type: 'transaction.received', title: 'Business transfer received', message: `${resolved.business.legalName} sent SGD ${(payload.amountCents / 100).toFixed(2)}.`, transactionId: incomingId, createdAt });
  }
  await enqueue(client, { userId: user.id, type: 'transaction.completed', title: resolved.target ? 'Transfer completed' : 'Bill payment completed', message: `Your payment of SGD ${(payload.amountCents / 100).toFixed(2)} to ${resolved.counterparty} is complete.`, transactionId, createdAt });
}

async function submit(db, user, kind, body, options = {}) {
  const { riskClient, now = Date.now, scheduledAuthorization = null, scheduleClaim = null } = options;
  const payload = normalize(kind, body), key = requestKey(body.requestId), requestKind = kind === 'bill' ? 'payment' : 'transfer';
  const authorization = scheduledAuthorization || await (options.authorize || authorize)(db, user, body.authorizationPassword, now);
  const previous = await replay(db, user.id, key, requestKind, payload);
  if (previous) return previous;
  const binding = await bind(db, user, key, requestKind, payload);
  if (binding.receipt) return binding.receipt;
  const initial = await resolve(db, user, kind, payload), requestedAt = clock(now);
  const input = { transactionId: binding.id, userId: String(user.id), sourceAccountId: payload.fromId, payloadHash: binding.payloadHash, type: kind,
    amountCents: payload.amountCents, payee: payload.number || payload.billerId, accountBalanceCents: cents(initial.source.balance_cents),
    isInternal: initial.internal, createdAt: requestedAt, historySummary: await historySummary(db, user.id, payload.number || payload.billerId, requestedAt) };
  let risk;
  try { risk = await riskClient.assess(input); } catch (error) { if (error.status === 409) throw error; throw new HttpError(503, 'Transaction screening is unavailable. Your balance has not changed.'); }
  validateAssessment(risk, input);
  return db.transaction(async client => {
    await lockSender(client, user.id);
    if (!scheduledAuthorization) await assertAuthorization(client, user, authorization);
    const existing = await replay(client, user.id, key, requestKind, payload);
    if (existing) return existing;
    if (scheduleClaim && !(await client.query("SELECT id FROM scheduled_payments WHERE id=$1 AND user_id=$2 AND status='active' AND next_run_at=$3 AND lease_owner=$4 AND lease_until>$5::timestamptz FOR UPDATE", [scheduleClaim.id, user.id, scheduleClaim.dueAt, scheduleClaim.owner, clock(now)])).rowCount) throw new HttpError(409, 'This scheduled payment is no longer due or its worker lease expired.');
    const resolved = await resolve(client, user, kind, payload, { lock: true }), createdAt = clock(now);
    const current = await currentMatches(client, user, payload, resolved, createdAt);
    const block = current.matches.some(reason => reason.action === 'block');
    if (block || (risk.decision === 'allow' && current.matches.length)) risk = { ...risk, assessedDecision: risk.decision,
      decision: block ? 'block' : 'review', score: block ? 95 : Math.max(70, risk.score), reasons: [...risk.reasons, ...current.matches], currentRuleVersion: current.policy.version, controlledAt: createdAt };
    const status = risk.decision === 'allow' ? 'completed' : risk.decision === 'review' ? 'pending_review' : 'rejected';
    const reference = kind === 'bill' ? payload.reference : `GLB-${binding.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    await client.query(`INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,settlement_seq,risk_json,authorization_json,to_account_id,biller_id,payee)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $7='completed' THEN nextval('settlement_sequence') ELSE NULL END,$13,$14,$15,$16,$17)`,
    [binding.id, resolved.source.id, kind, resolved.note, -payload.amountCents, resolved.counterparty, status, reference, resolved.internal, createdAt, requestedAt, status === 'completed' ? createdAt : null, risk, authorization, resolved.target?.id || null, kind === 'bill' ? payload.billerId : null, input.payee]);
    if (status === 'completed') await settle(client, user, payload, resolved, binding.id, reference, createdAt, risk);
    else {
      await enqueue(client, { userId: user.id, type: status === 'pending_review' ? 'transaction.review_required' : 'transaction.blocked', title: status === 'pending_review' ? 'Transaction awaiting review' : 'Transaction declined', message: 'Your balance has not changed.', transactionId: binding.id, createdAt });
      if (status === 'pending_review') for (const admin of (await client.query("SELECT id FROM users WHERE role='admin' AND id<>$1", [user.id])).rows) await enqueue(client, { userId: admin.id, type: 'review.requested', title: 'Independent review requested', message: `${user.name} has a transaction awaiting review.`, transactionId: binding.id, createdAt });
    }
    const result = await view(client, binding.id);
    await client.query('INSERT INTO requests(user_id,request_id,kind,payload_hash,result_json) VALUES($1,$2,$3,$4,$5)', [user.id, key, requestKind, binding.payloadHash, result]);
    await client.query('INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,$2,$3)', [user.id, `transaction.${status}`, { transactionId: binding.id, payloadHash: binding.payloadHash, ruleVersion: risk.ruleVersion }]);
    return result;
  });
}

function requireAdmin(user) { if (user?.role !== 'admin') throw new HttpError(403, 'Administrator access is required.'); }
async function reviews(db, user) {
  requireAdmin(user);
  return (await db.query(`${TABLE} WHERE t.status='pending_review' AND a.user_id<>$1 ORDER BY t.created_at,t.insert_seq`, [user.id])).rows.map(row => ({ ...transactionView(row), maker: { id: String(row.maker_id), name: row.maker_name, email: row.maker_email } }));
}
async function review(db, actor, id, body, options = {}) {
  requireAdmin(actor);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send the review decision as a JSON object.');
  if (!['approve', 'reject'].includes(body.decision) || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 500) throw new HttpError(400, 'Choose approve or reject and give a reason of 3–500 characters.');
  const now = options.now || Date.now;
  const authorization = await (options.authorize || authorize)(db, actor, body.authorizationPassword, now);
  return db.transaction(async client => {
    const candidate = (await client.query(`${TABLE} WHERE t.id=$1`, [id])).rows[0];
    if (!candidate) throw new HttpError(404, 'Transaction not found.');
    await client.query('SELECT id FROM users WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [[actor.id,candidate.maker_id]]);
    await assertAuthorization(client, actor, authorization, { admin: true });
    const row = (await client.query(`${TABLE} WHERE t.id=$1 FOR UPDATE OF t`, [id])).rows[0];
    if (!row) throw new HttpError(404, 'Transaction not found.');
    if (String(row.maker_id) === String(actor.id)) throw new HttpError(403, 'An independent administrator must review your transaction.');
    if (row.status !== 'pending_review') {
      if (row.review_json?.reviewedBy?.id === String(actor.id) && row.review_json.decision === body.decision && row.review_json.reason === body.reason.trim()) return transactionView(row);
      throw new HttpError(409, 'This transaction has already been reviewed.');
    }
    await lockSender(client, row.maker_id);
    const user = { id: row.maker_id, name: row.maker_name }, createdAt = clock(now);
    const result = { decision: body.decision, reason: body.reason.trim(), reviewedAt: createdAt, reviewedBy: { id: String(actor.id), name: actor.name }, authorization };
    if (body.decision === 'approve') {
      const payload = row.type === 'transfer' ? { fromId: String(row.account_id), number: row.payee, amountCents: -cents(row.amount_cents), note: row.description }
        : { fromId: String(row.account_id), amountCents: -cents(row.amount_cents), billerId: row.biller_id, reference: row.reference };
      const resolved = await resolve(client, user, row.type, payload, { lock: true });
      const current = await currentMatches(client, user, payload, resolved, createdAt, { blockingOnly: true });
      if (current.matches.length) throw new HttpError(409, current.matches.map(reason => reason.message).join(' '));
      await client.query("UPDATE transactions SET status='completed',created_at=$2,completed_at=$2,settlement_seq=nextval('settlement_sequence'),review_json=$3 WHERE id=$1", [id, createdAt, result]);
      await settle(client, user, payload, resolved, id, row.reference, createdAt, row.risk_json);
    } else await client.query("UPDATE transactions SET status='rejected',review_json=$2 WHERE id=$1", [id, result]);
    await enqueue(client, { userId: user.id, type: `review.${body.decision}`, title: body.decision === 'approve' ? 'Transaction approved' : 'Transaction rejected', message: `${actor.name}: ${result.reason}`, transactionId: id, createdAt });
    const updated = await view(client, id);
    await client.query("UPDATE requests SET result_json=$3 WHERE user_id=$1 AND result_json->>'id'=$2 AND kind IN ('transfer','payment')", [user.id, id, updated]);
    await client.query('INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$2,$3,$4)', [actor.id, user.id, `review.${body.decision}`, { transactionId: id, reason: result.reason }]);
    return updated;
  });
}

module.exports = { submit, review, reviews, normalize, resolve, replay, view, authorize, assertAuthorization, accountView, transactionView, accountId, parseAmount, requestKey, canonicalHash, deterministicId, enqueue, historySummary, cents, requireAdmin };
