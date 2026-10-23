'use strict';

const { randomInt, randomUUID, createHash } = require('node:crypto');
const { transaction } = require('../db');
const { HttpError } = require('./errors');

const MAX_CENTS = 9000000000000;

function accountView(row) {
  return {
    id: row.id, name: row.name, number: row.number, balanceCents: row.balance_cents,
    status: row.status, createdAt: row.created_at
  };
}

function transactionView(row) {
  return {
    id: row.id, type: row.type, description: row.description, amountCents: row.amount_cents,
    counterparty: row.counterparty, status: row.status, createdAt: row.created_at,
    accountId: row.account_id, accountName: row.account_name || '', accountNumber: row.account_number || '',
    reference: row.reference, isInternal: Boolean(row.internal), payee: row.payee || row.counterparty,
    risk: row.risk_json ? JSON.parse(row.risk_json) : null,
    authorization: row.authorization_json ? JSON.parse(row.authorization_json) : null,
    review: row.review_json ? JSON.parse(row.review_json) : null,
    requestedAt: row.requested_at || row.created_at,
    completedAt: row.completed_at || (row.status === 'completed' ? row.created_at : null)
  };
}

function accountName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter an account name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Account names must be 2–40 characters.');
  return name;
}

function accountId(value) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) {
    throw new HttpError(400, 'Choose a valid savings account.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Choose a valid savings account.');
  return id;
}

function parseAmount(value) {
  if (!['string', 'number'].includes(typeof value)) throw new HttpError(400, 'Enter a valid amount.');
  const amount = String(value).trim();
  if (amount.length > 16 || !/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new HttpError(400, 'Enter an amount with up to 2 decimal places.');
  }
  const [whole, fraction = ''] = amount.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n || cents > BigInt(MAX_CENTS)) throw new HttpError(400, 'Enter a positive amount within the supported limit.');
  return Number(cents);
}

function ownedAccount(db, userId, id, { active = true } = {}) {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId(id), userId);
  if (!row) throw new HttpError(404, 'Savings account not found.');
  if (active && row.status !== 'active') throw new HttpError(409, 'This savings account is closed.');
  return row;
}

function createAccount(db, userId, name) {
  const normalizedName = accountName(name);
  if (db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE user_id = ? AND status = 'active'").get(userId).count >= 8) {
    throw new HttpError(409, 'You can have up to 8 active savings accounts.');
  }
  let number;
  do {
    number = `102${String(randomInt(0, 10000000)).padStart(7, '0')}`;
  } while (db.prepare('SELECT id FROM accounts WHERE number = ?').get(number));
  const createdAt = new Date().toISOString();
  const inserted = db.prepare("INSERT INTO accounts (user_id, name, number, created_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM accounts WHERE user_id = ? AND status = 'active') < 8")
    .run(userId, normalizedName, number, createdAt, userId);
  if (!inserted.changes) throw new HttpError(409, 'You can have up to 8 active savings accounts.');
  return accountView(db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(inserted.lastInsertRowid)));
}

function renameAccount(db, userId, id, name) {
  return transaction(db, () => {
    const account = ownedAccount(db, userId, id);
    const normalizedName = accountName(name);
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(normalizedName, account.id);
    return accountView({ ...account, name: normalizedName });
  });
}

function closeAccount(db, userId, id) {
  return transaction(db, () => {
    const account = ownedAccount(db, userId, id);
    if (account.balance_cents !== 0) throw new HttpError(409, 'Transfer the remaining balance before closing this account.');
    const activeCount = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE user_id = ? AND status = 'active'").get(userId).count;
    if (activeCount <= 1) throw new HttpError(409, 'Keep at least one savings account open.');
    db.prepare("UPDATE accounts SET status = 'closed' WHERE id = ?").run(account.id);
    return accountView({ ...account, status: 'closed' });
  });
}

function dashboard(db, userId, { now = Date.now } = {}) {
  const history = require('./history');
  return history.readSnapshot(db, () => {
  const timestamp = new Date(now());
  const accounts = db.prepare("SELECT * FROM accounts WHERE user_id = ? AND status = 'active' ORDER BY id").all(userId).map(accountView);
  const closedAccounts = db.prepare("SELECT * FROM accounts WHERE user_id = ? AND status = 'closed' ORDER BY id").all(userId).map(accountView);
  const transactions = db.prepare(`SELECT t.*, a.name AS account_name, a.number AS account_number FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT 10`).all(userId).map(transactionView);
  const since = new Date(timestamp.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income,
    COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS outgoing
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? AND t.internal = 0 AND t.status = 'completed' AND t.created_at >= ? AND t.created_at <= ?`).get(userId, since, timestamp.toISOString());
  const billers = db.prepare('SELECT id, name, category, initials, color FROM billers ORDER BY rowid').all();
  return { accounts, closedAccounts, transactions, billers, summary: { incomeCents: totals.income, outgoingCents: totals.outgoing },
    insights: history.insights(db, userId, () => timestamp) };
  });
}

function requestKey(value) {
  if (value === undefined || value === null || value === '') return randomUUID();
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(value)) {
    throw new HttpError(400, 'Use a valid request identifier.');
  }
  return value;
}

function once(db, userId, key, kind, payload, operation) {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return transaction(db, () => {
    const previous = db.prepare('SELECT * FROM requests WHERE user_id = ? AND request_id = ?').get(userId, key);
    if (previous) {
      if (previous.kind !== kind || previous.payload_hash !== hash) {
        throw new HttpError(409, 'This request identifier was already used for another transaction.');
      }
      return JSON.parse(previous.result_json);
    }
    const result = operation();
    db.prepare('INSERT INTO requests (user_id, request_id, kind, payload_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, key, kind, hash, JSON.stringify(result), new Date().toISOString());
    return result;
  });
}

module.exports = {
  accountView, transactionView, accountName, parseAmount, createAccount, renameAccount,
  closeAccount, dashboard, accountId, ownedAccount, requestKey, once
};
