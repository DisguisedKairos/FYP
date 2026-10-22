'use strict';

const { randomUUID } = require('node:crypto');
const { transaction } = require('../db');
const { HttpError } = require('./errors');
const bank = require('./banking');
const money = require('./money');
const { instant, enqueue } = require('./events');

function scheduleView(db, row) {
  const payload = JSON.parse(row.payload_json);
  const source = db.prepare('SELECT name FROM accounts WHERE id = ?').get(payload.fromId);
  const biller = payload.billerId ? db.prepare('SELECT name FROM billers WHERE id = ?').get(payload.billerId) : null;
  const runs = db.prepare('SELECT r.*, t.status AS transaction_status FROM scheduled_payment_runs r LEFT JOIN transactions t ON t.id = r.transaction_id WHERE r.schedule_id = ? ORDER BY r.due_at DESC').all(row.id)
    .map(run => ({ id: run.id, dueAt: run.due_at, status: run.transaction_status || run.status, transactionId: run.transaction_id, error: run.error, createdAt: run.created_at, completedAt: run.completed_at }));
  return {
    id: row.id, type: row.type, fromAccountId: payload.fromId, fromAccountName: source?.name || '',
    toAccountNumber: payload.number || null, billerId: payload.billerId || null, billerName: biller?.name || null,
    reference: payload.reference || '', amountCents: row.amount_cents, description: payload.note || '',
    scheduledAt: row.scheduled_at, nextRunAt: row.next_run_at, frequency: row.frequency,
    status: row.status, createdAt: row.created_at, lastRunAt: row.last_run_at,
    lastStatus: runs[0]?.status || row.last_status, lastError: row.last_error, runs
  };
}

function list(db, user) {
  return db.prepare('SELECT * FROM scheduled_payments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC').all(user.id).map(row => scheduleView(db, row));
}

async function create(db, user, body, { now = Date.now } = {}) {
  if (!['transfer', 'bill'].includes(body.type)) throw new HttpError(400, 'Choose a transfer or bill payment.');
  if (!['once', 'weekly', 'monthly'].includes(body.frequency)) throw new HttpError(400, 'Choose once, weekly or monthly.');
  if (typeof body.scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.scheduledAt)) throw new HttpError(400, 'Choose a valid future date in UTC.');
  const date = new Date(body.scheduledAt);
  const normalizedInput = body.scheduledAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalizedInput) throw new HttpError(400, 'Choose a valid future date in UTC.');
  const payload = money.normalize(body.type, body), key = bank.requestKey(body.requestId);
  const authorization = await money.authorize(db, user, body.authorizationPassword, now);
  const canonical = { type: body.type, payload, frequency: body.frequency, scheduledAt: date.toISOString() };
  const previous = money.replay(db, user.id, key, 'schedule', canonical);
  if (previous) return previous;
  if (date.getTime() <= instant(now).getTime()) throw new HttpError(400, 'Choose a valid future date in UTC.');
  return bank.once(db, user.id, key, 'schedule', canonical, () => {
    money.resolve(db, user, body.type, payload, { checkFunds: false });
    const id = randomUUID(), createdAt = instant(now).toISOString();
    db.prepare(`INSERT INTO scheduled_payments (id, user_id, type, payload_json, amount_cents, frequency,
      scheduled_at, next_run_at, authorization_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, body.type, JSON.stringify(payload), payload.amountCents, body.frequency,
        date.toISOString(), date.toISOString(), JSON.stringify({ ...authorization, scope: 'scheduled_payment', scheduleId: id }), createdAt);
    enqueue(db, { userId: user.id, type: 'schedule.created', title: 'Payment scheduled', message: `Your ${body.frequency === 'once' ? 'one-time' : body.frequency} payment of SGD ${(payload.amountCents / 100).toFixed(2)} is scheduled.`, createdAt, metadata: { scheduleId: id } });
    return scheduleView(db, db.prepare('SELECT * FROM scheduled_payments WHERE id = ?').get(id));
  });
}

function cancel(db, user, id, { now = Date.now } = {}) {
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM scheduled_payments WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!row) throw new HttpError(404, 'Scheduled payment not found.');
    if (row.status === 'cancelled') return scheduleView(db, row);
    if (row.status !== 'active') throw new HttpError(409, 'This scheduled payment has already finished.');
    db.prepare("UPDATE scheduled_payments SET status = 'cancelled', next_run_at = NULL, lease_owner = NULL, lease_until = 0 WHERE id = ?").run(id);
    enqueue(db, { userId: user.id, type: 'schedule.cancelled', title: 'Scheduled payment cancelled', message: 'Future payments for this schedule have been cancelled.', createdAt: instant(now).toISOString(), metadata: { scheduleId: id } });
    return scheduleView(db, db.prepare('SELECT * FROM scheduled_payments WHERE id = ?').get(id));
  });
}

function nextOccurrence(row) {
  if (row.frequency === 'once') return null;
  const date = new Date(row.next_run_at);
  if (row.frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else {
    const anchor = new Date(row.scheduled_at).getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(anchor, lastDay));
  }
  return date.toISOString();
}

async function runDue(db, { riskClient, now = Date.now } = {}) {
  const timestamp = instant(now), owner = randomUUID();
  const due = transaction(db, () => {
    const rows = db.prepare("SELECT * FROM scheduled_payments WHERE status = 'active' AND next_run_at <= ? AND lease_until <= ? ORDER BY next_run_at LIMIT 20").all(timestamp.toISOString(), timestamp.getTime());
    for (const row of rows) {
      db.prepare('UPDATE scheduled_payments SET lease_owner = ?, lease_until = ? WHERE id = ?').run(owner, timestamp.getTime() + 300000, row.id);
      db.prepare("INSERT OR IGNORE INTO scheduled_payment_runs (id, schedule_id, due_at, status, created_at) VALUES (?, ?, ?, 'processing', ?)")
        .run(randomUUID(), row.id, row.next_run_at, timestamp.toISOString());
    }
    return rows;
  });
  let schedulesProcessed = 0;
  for (const row of due) {
    let result = null, failure = null;
    try {
      const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(row.user_id);
      if (!user) throw new HttpError(404, 'The account owner no longer exists.');
      const saved = JSON.parse(row.payload_json);
      const body = { fromAccountId: saved.fromId, amount: (saved.amountCents / 100).toFixed(2), requestId: `schedule:${row.id}:${Date.parse(row.next_run_at)}`,
        ...(row.type === 'transfer' ? { toAccountNumber: saved.number, description: saved.note } : { billerId: saved.billerId, reference: saved.reference }) };
      result = await money.submit(db, user, row.type, body, {
        riskClient, now, scheduledAuthorization: JSON.parse(row.authorization_json),
        scheduleClaim: { id: row.id, dueAt: row.next_run_at, owner }
      });
    } catch (error) { failure = String(error.message || error).slice(0, 500); }
    transaction(db, () => {
      const current = db.prepare('SELECT * FROM scheduled_payments WHERE id = ?').get(row.id);
      const cancelled = current.status === 'cancelled';
      if (!cancelled && current.lease_owner !== owner) return;
      const status = result?.status || (cancelled ? 'cancelled' : 'failed');
      const completedAt = instant(now).toISOString();
      db.prepare('UPDATE scheduled_payment_runs SET status = ?, transaction_id = ?, error = ?, completed_at = ? WHERE schedule_id = ? AND due_at = ?')
        .run(status, result?.id || null, failure, completedAt, row.id, row.next_run_at);
      if (current.lease_owner === owner && current.status === 'active') {
        const next = nextOccurrence(row);
        db.prepare('UPDATE scheduled_payments SET status = ?, next_run_at = ?, last_run_at = ?, last_status = ?, last_error = ?, lease_owner = NULL, lease_until = 0 WHERE id = ?')
          .run(next ? 'active' : failure ? 'failed' : 'completed', next, completedAt, status, failure, row.id);
      }
      if (failure && !cancelled) enqueue(db, {
        userId: row.user_id, type: 'schedule.failed', title: 'Scheduled payment failed',
        message: `Your scheduled payment could not be completed: ${failure}`, createdAt: completedAt,
        metadata: { scheduleId: row.id, dueAt: row.next_run_at }
      });
    });
    schedulesProcessed++;
  }
  return { schedulesProcessed };
}

module.exports = { list, create, cancel, runDue };
