'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { transaction } = require('../db');
const { HttpError } = require('./errors');
const bank = require('./banking');
const { verifyUserPassword } = require('./security');
const { enqueue, instant } = require('./events');

const MAX_CENTS = 9000000000000;
const transactionQuery = `SELECT t.*, a.name AS account_name, a.number AS account_number,
  a.user_id AS maker_id, u.name AS maker_name, u.email AS maker_email
  FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN users u ON u.id = a.user_id`;

function view(db, id) {
  const row = db.prepare(`${transactionQuery} WHERE t.id = ?`).get(id);
  return row ? bank.transactionView(row) : null;
}

async function authorize(db, user, password, clock = Date.now) {
  if (typeof password !== 'string' || !password || password.length > 128) throw new HttpError(403, 'Enter your current password to authorize this action.');
  const record = db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?').get(user.id);
  if (!record || !await verifyUserPassword(db, record, password)) throw new HttpError(403, 'The authorization password is incorrect.');
  return { method: 'password', authorizedAt: instant(clock).toISOString() };
}

function normalize(kind, body) {
  const fromId = bank.accountId(body.fromAccountId), amountCents = bank.parseAmount(body.amount);
  if (kind === 'transfer') {
    if (typeof body.toAccountNumber !== 'string') throw new HttpError(400, 'Enter the recipient’s account number.');
    const number = body.toAccountNumber.replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(number)) throw new HttpError(400, 'Enter a 10-digit Greenlink account number.');
    const description = body.description === undefined ? '' : body.description;
    if (typeof description !== 'string' || description.trim().length > 100) throw new HttpError(400, 'Use a transfer note of 100 characters or fewer.');
    return { fromId, number, amountCents, note: description.trim() || 'Savings transfer' };
  }
  if (typeof body.billerId !== 'string' || body.billerId.length > 80) throw new HttpError(400, 'Choose a biller.');
  if (typeof body.reference !== 'string' || body.reference.trim().length < 3 || body.reference.trim().length > 64) throw new HttpError(400, 'Enter a bill reference of 3–64 characters.');
  return { fromId, amountCents, billerId: body.billerId, reference: body.reference.trim() };
}

function resolve(db, user, kind, payload, { checkFunds = true } = {}) {
  const source = bank.ownedAccount(db, user.id, payload.fromId);
  let target = null, counterparty, note, internal = 0;
  if (kind === 'transfer') {
    target = db.prepare('SELECT a.*, u.name AS owner_name FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.number = ?').get(payload.number);
    if (!target) throw new HttpError(404, 'Recipient account not found. Check the account number.');
    if (target.status !== 'active') throw new HttpError(409, 'The recipient savings account is closed.');
    if (target.id === source.id) throw new HttpError(409, 'Choose a different account for this transfer.');
    if (target.balance_cents + payload.amountCents > MAX_CENTS) throw new HttpError(409, 'The recipient account cannot receive this amount.');
    internal = target.user_id === user.id ? 1 : 0;
    counterparty = internal ? target.name : target.owner_name;
    note = payload.note;
  } else {
    const biller = db.prepare('SELECT * FROM billers WHERE id = ?').get(payload.billerId);
    if (!biller) throw new HttpError(400, 'Choose a valid biller.');
    counterparty = biller.name;
    note = `${biller.name} bill`;
  }
  if (checkFunds && source.balance_cents < payload.amountCents) throw new HttpError(409, 'Insufficient funds in the selected account.');
  return { source, target, counterparty, note, internal };
}

function replay(db, userId, key, kind, payload) {
  const previous = db.prepare('SELECT * FROM requests WHERE user_id = ? AND request_id = ?').get(userId, key);
  if (!previous) return null;
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (previous.kind !== kind || previous.payload_hash !== hash) throw new HttpError(409, 'This request identifier was already used for another transaction.');
  return JSON.parse(previous.result_json);
}

function deterministicId(userId, key) {
  const hex = createHash('sha256').update(`${userId}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function historySummary(db, userId, payee, createdAt) {
  const timestamp = Date.parse(createdAt);
  const singaporeDate = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dayStart = new Date(`${singaporeDate}T00:00:00+08:00`).toISOString();
  const tenMinutesAgo = new Date(timestamp - 10 * 60 * 1000).toISOString();
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.created_at >= ? THEN -t.amount_cents ELSE 0 END), 0) AS dailyOutgoingCents,
    COALESCE(SUM(CASE WHEN t.created_at >= ? THEN 1 ELSE 0 END), 0) AS outgoingCount10m,
    COALESCE(SUM(CASE WHEN t.created_at >= ? THEN -t.amount_cents ELSE 0 END), 0) AS outgoingAmount10m,
    COALESCE(AVG(-t.amount_cents), 0) AS averageOutgoingCents, COUNT(*) AS historyCount,
    COALESCE(MAX(CASE WHEN COALESCE(t.payee, t.counterparty) = ? THEN 1 ELSE 0 END), 0) AS knownPayee
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? AND t.status = 'completed' AND t.amount_cents < 0 AND t.internal = 0 AND t.created_at <= ?`)
    .get(dayStart, tenMinutesAgo, tenMinutesAgo, payee, userId, createdAt);
  return { ...row, averageOutgoingCents: Math.round(row.averageOutgoingCents), knownPayee: Boolean(row.knownPayee) };
}

function controlViolation(db, userId, amountCents, internal, payee, controls, createdAt) {
  if (internal || !controls) return null;
  const summary = historySummary(db, userId, payee, createdAt);
  if (Number.isFinite(controls.dailyLimitCents) && summary.dailyOutgoingCents + amountCents > controls.dailyLimitCents) {
    return { code: 'control:daily_limit', message: 'The daily outgoing limit would be exceeded when this payment completes.', contribution: 0 };
  }
  if (Number.isFinite(controls.velocityLimit) && summary.outgoingCount10m >= controls.velocityLimit) {
    return { code: 'control:velocity', message: 'The outgoing transaction count limit was reached before this payment could complete.', contribution: 0 };
  }
  return null;
}

function policyControls(policy) {
  if (!policy || !Array.isArray(policy.rules)) throw new HttpError(503, 'Current financial safety rules are unavailable.');
  const rule = id => policy.rules.find(item => item.id === id && item.enabled && item.action === 'block');
  const daily = rule('daily_limit'), velocity = rule('velocity');
  return { dailyLimitCents: daily ? daily.threshold * 100 : null, velocityLimit: velocity ? velocity.threshold : null };
}

function insertIncoming(db, { source, target, amountCents, description, reference, internal, createdAt, maker, risk }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO transactions (id, account_id, type, description, amount_cents, counterparty,
    reference, internal, created_at, requested_at, completed_at, payee, risk_json)
    VALUES (?, ?, 'transfer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, target.id, description, amountCents, internal ? source.name : maker.name, reference,
      internal, createdAt, createdAt, createdAt, source.number, risk ? JSON.stringify(risk) : null);
  if (!internal) enqueue(db, {
    userId: target.user_id, type: 'transaction.received', title: 'Transfer received',
    message: `${maker.name} sent you SGD ${(amountCents / 100).toFixed(2)}.`, transactionId: id, createdAt
  });
}

function settle(db, user, kind, payload, resolved, id, reference, createdAt) {
  const { source, target, note, internal } = resolved;
  if (source.balance_cents < payload.amountCents) throw new HttpError(409, 'Insufficient funds in the selected account.');
  // A held intent may predate other completed entries with the same timestamp.
  // Move its internal ordering key to settlement time before adding the credit.
  // Public transaction IDs and their references stay unchanged; this runs in
  // the same write transaction as both balances and the review decision.
  db.prepare("UPDATE transactions SET rowid = (SELECT COALESCE(MAX(rowid), 0) + 1 FROM transactions) WHERE id = ? AND status = 'pending_review'").run(id);
  db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(payload.amountCents, source.id);
  if (target) {
    db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(payload.amountCents, target.id);
    const record = db.prepare('SELECT risk_json FROM transactions WHERE id = ?').get(id);
    const assessed = record?.risk_json && JSON.parse(record.risk_json);
    const risk = assessed ? { score: assessed.score, decision: assessed.decision, modelVersion: assessed.modelVersion,
      ruleVersion: assessed.ruleVersion, assessedAt: assessed.assessedAt, assessmentId: id,
      reasons: [{ code: 'associated_transfer', message: 'Screened as part of the originating transfer.', contribution: 0 }] } : null;
    insertIncoming(db, { source, target, amountCents: payload.amountCents, description: note, reference, internal, createdAt, maker: user, risk });
  }
  enqueue(db, {
    userId: user.id, type: 'transaction.completed', title: kind === 'bill' ? 'Bill payment completed' : 'Transfer completed',
    message: `Your SGD ${(payload.amountCents / 100).toFixed(2)} ${kind === 'bill' ? 'bill payment' : 'transfer'} to ${resolved.counterparty} is complete.`,
    transactionId: id, createdAt
  });
}

async function submit(db, user, kind, body, { riskClient, now = Date.now, scheduledAuthorization = null, scheduleClaim = null } = {}) {
  const payload = normalize(kind, body), key = bank.requestKey(body.requestId);
  const authorization = scheduledAuthorization || await authorize(db, user, body.authorizationPassword, now);
  const requestKind = kind === 'bill' ? 'payment' : 'transfer';
  const previous = replay(db, user.id, key, requestKind, payload);
  if (previous) return previous;
  const initial = resolve(db, user, kind, payload);
  const id = deterministicId(user.id, key), requestedAt = instant(now).toISOString();
  const history = db.prepare(`SELECT t.amount_cents AS amountCents, t.type, t.counterparty,
    COALESCE(t.payee, t.counterparty) AS payee, t.created_at AS createdAt, t.internal AS isInternal, t.status
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? AND t.status = 'completed' AND t.amount_cents < 0 AND t.internal = 0
    ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1000`).all(user.id)
    .map(entry => ({ ...entry, isInternal: Boolean(entry.isInternal) }));
  let risk;
  try {
    risk = await riskClient.assess({
      transactionId: id, userId: user.id, type: kind, amountCents: payload.amountCents,
      payee: kind === 'transfer' ? payload.number : payload.billerId,
      accountBalanceCents: initial.source.balance_cents, history, isInternal: Boolean(initial.internal), createdAt: requestedAt,
      historySummary: historySummary(db, user.id, kind === 'transfer' ? payload.number : payload.billerId, requestedAt)
    });
  } catch (error) {
    if (error.status === 409) throw new HttpError(409, error.message);
    throw new HttpError(503, 'Transaction screening is unavailable. Your balance has not changed. Try again shortly.');
  }
  if (!risk || !Number.isFinite(risk.score) || risk.score < 0 || risk.score > 100 || !['allow', 'review', 'block'].includes(risk.decision) || !Array.isArray(risk.reasons)) {
    throw new HttpError(503, 'Transaction screening returned an invalid result. Your balance has not changed.');
  }
  return bank.once(db, user.id, key, requestKind, payload, () => {
    if (scheduleClaim && !db.prepare("SELECT id FROM scheduled_payments WHERE id = ? AND user_id = ? AND status = 'active' AND next_run_at = ? AND lease_owner = ?")
      .get(scheduleClaim.id, user.id, scheduleClaim.dueAt, scheduleClaim.owner)) {
      throw new HttpError(409, 'This scheduled payment was cancelled or is no longer due.');
    }
    const resolved = resolve(db, user, kind, payload);
    const createdAt = instant(now).toISOString();
    const violation = controlViolation(db, user.id, payload.amountCents, resolved.internal,
      kind === 'transfer' ? payload.number : payload.billerId, risk.controls, createdAt);
    if (violation) risk = { ...risk, assessedDecision: risk.decision, assessedScore: risk.score,
      decision: 'block', score: Math.max(95, risk.score), reasons: [...risk.reasons, violation], controlledAt: createdAt };
    const status = risk.decision === 'allow' ? 'completed' : risk.decision === 'review' ? 'pending_review' : 'rejected';
    const reference = kind === 'bill' ? payload.reference : `GLB-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    db.prepare(`INSERT INTO transactions (id, account_id, type, description, amount_cents, counterparty,
      status, reference, internal, created_at, requested_at, completed_at, risk_json, authorization_json,
      to_account_id, biller_id, payee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, resolved.source.id, kind, resolved.note, -payload.amountCents, resolved.counterparty, status,
        reference, resolved.internal, createdAt, requestedAt, status === 'completed' ? createdAt : null,
        JSON.stringify(risk), JSON.stringify(authorization), resolved.target?.id || null,
        kind === 'bill' ? payload.billerId : null, kind === 'transfer' ? payload.number : payload.billerId);
    if (status === 'completed') settle(db, user, kind, payload, resolved, id, reference, createdAt);
    else {
      enqueue(db, {
        userId: user.id, type: status === 'pending_review' ? 'transaction.review_required' : 'transaction.blocked',
        title: status === 'pending_review' ? 'Transaction awaiting review' : 'Transaction declined',
        message: status === 'pending_review' ? 'An independent reviewer must approve this transaction before funds move.' : 'This transaction was declined by the financial safety rules. Your balance has not changed.',
        transactionId: id, createdAt, metadata: { score: risk.score, reasons: risk.reasons }
      });
      if (status === 'pending_review') for (const admin of db.prepare("SELECT id FROM users WHERE role = 'admin' AND id != ?").all(user.id)) {
        enqueue(db, { userId: admin.id, type: 'review.requested', title: 'Transaction review requested', message: `${user.name} has a transaction awaiting independent review.`, transactionId: id, createdAt });
      }
    }
    return view(db, id);
  });
}

function requireAdmin(user) {
  if (user?.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
}

function reviews(db, user) {
  requireAdmin(user);
  return db.prepare(`${transactionQuery} WHERE t.status = 'pending_review' AND a.user_id != ? ORDER BY t.created_at`).all(user.id)
    .map(row => ({ ...bank.transactionView(row), maker: { id: row.maker_id, name: row.maker_name, email: row.maker_email } }));
}

async function review(db, actor, id, body, { now = Date.now, riskClient } = {}) {
  requireAdmin(actor);
  if (!['approve', 'reject'].includes(body.decision)) throw new HttpError(400, 'Choose approve or reject.');
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 500) throw new HttpError(400, 'Give a review reason of 3–500 characters.');
  const authorization = await authorize(db, actor, body.authorizationPassword, now);
  let controls = null;
  if (body.decision === 'approve') {
    try { controls = policyControls(await riskClient.getRules()); }
    catch { throw new HttpError(503, 'Current financial safety rules are unavailable. This transaction remains held.'); }
  }
  return transaction(db, () => {
    const row = db.prepare(`${transactionQuery} WHERE t.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Transaction not found.');
    if (row.maker_id === actor.id) throw new HttpError(403, 'An independent administrator must review your transaction.');
    if (row.status !== 'pending_review') {
      const previous = row.review_json && JSON.parse(row.review_json);
      if (previous?.reviewedBy.id === actor.id && previous.decision === body.decision && previous.reason === body.reason.trim()) return bank.transactionView(row);
      throw new HttpError(409, 'This transaction has already been reviewed.');
    }
    const createdAt = instant(now).toISOString();
    const result = { decision: body.decision, reason: body.reason.trim(), reviewedAt: createdAt, reviewedBy: { id: actor.id, name: actor.name }, authorization };
    if (body.decision === 'approve') {
      const maker = { id: row.maker_id, name: row.maker_name };
      const payload = row.type === 'transfer' ? { fromId: row.account_id, number: row.payee, amountCents: -row.amount_cents, note: row.description }
        : { fromId: row.account_id, amountCents: -row.amount_cents, billerId: row.biller_id, reference: row.reference };
      const resolved = resolve(db, maker, row.type, payload);
      const violation = controlViolation(db, maker.id, payload.amountCents, resolved.internal, row.payee, controls, createdAt);
      if (violation) throw new HttpError(409, violation.message);
      settle(db, maker, row.type, payload, resolved, id, row.reference, createdAt);
      db.prepare("UPDATE transactions SET status = 'completed', created_at = ?, completed_at = ?, review_json = ? WHERE id = ?")
        .run(createdAt, createdAt, JSON.stringify(result), id);
    } else db.prepare("UPDATE transactions SET status = 'rejected', review_json = ? WHERE id = ?").run(JSON.stringify(result), id);
    enqueue(db, {
      userId: row.maker_id, type: `review.${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      title: body.decision === 'approve' ? 'Transaction approved' : 'Transaction rejected',
      message: `${actor.name} ${body.decision === 'approve' ? 'approved' : 'rejected'} your transaction: ${result.reason}`,
      transactionId: id, createdAt
    });
    const updated = view(db, id);
    db.prepare("UPDATE requests SET result_json = ? WHERE user_id = ? AND kind IN ('transfer', 'payment') AND json_extract(result_json, '$.id') = ?")
      .run(JSON.stringify(updated), row.maker_id, id);
    return updated;
  });
}

module.exports = { submit, normalize, resolve, authorize, replay, view, reviews, review, requireAdmin };
