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
    accountId: row.account_id, reference: row.reference
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
  const inserted = db.prepare('INSERT INTO accounts (user_id, name, number, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, normalizedName, number, createdAt);
  return accountView(db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(inserted.lastInsertRowid)));
}

function renameAccount(db, userId, id, name) {
  const account = ownedAccount(db, userId, id);
  const normalizedName = accountName(name);
  db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(normalizedName, account.id);
  return accountView({ ...account, name: normalizedName });
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

function dashboard(db, userId) {
  const accounts = db.prepare("SELECT * FROM accounts WHERE user_id = ? AND status = 'active' ORDER BY id").all(userId).map(accountView);
  const transactions = db.prepare(`SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT 100`).all(userId).map(transactionView);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income,
    COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS outgoing
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? AND t.internal = 0 AND t.created_at >= ?`).get(userId, since);
  const billers = db.prepare('SELECT id, name, category, initials, color FROM billers ORDER BY rowid').all();
  return { accounts, transactions, billers, summary: { incomeCents: totals.income, outgoingCents: totals.outgoing } };
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

function addEntry(db, { accountId: id, type, description, amountCents, counterparty, reference, internal = 0, createdAt }) {
  const txnId = randomUUID();
  db.prepare(`INSERT INTO transactions
    (id, account_id, type, description, amount_cents, counterparty, reference, internal, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(txnId, id, type, description, amountCents, counterparty, reference, internal, createdAt);
  return transactionView(db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId));
}

function transfer(db, user, body) {
  const fromId = accountId(body.fromAccountId);
  const amountCents = parseAmount(body.amount);
  if (typeof body.toAccountNumber !== 'string') throw new HttpError(400, 'Enter the recipient’s account number.');
  const number = body.toAccountNumber.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(number)) throw new HttpError(400, 'Enter a 10-digit Evergreen account number.');
  const description = body.description === undefined ? '' : body.description;
  if (typeof description !== 'string' || description.trim().length > 100) throw new HttpError(400, 'Use a transfer note of 100 characters or fewer.');
  const note = description.trim() || 'Savings transfer';
  const key = requestKey(body.requestId);
  return once(db, user.id, key, 'transfer', { fromId, number, amountCents, note }, () => {
    const source = ownedAccount(db, user.id, fromId);
    const target = db.prepare(`SELECT a.*, u.name AS owner_name FROM accounts a JOIN users u ON u.id = a.user_id
      WHERE a.number = ?`).get(number);
    if (!target) throw new HttpError(404, 'Recipient account not found. Check the account number.');
    if (target.status !== 'active') throw new HttpError(409, 'The recipient savings account is closed.');
    if (source.id === target.id) throw new HttpError(409, 'Choose a different account for this transfer.');
    if (source.balance_cents < amountCents) throw new HttpError(409, 'Insufficient funds in the selected account.');
    if (target.balance_cents + amountCents > MAX_CENTS) throw new HttpError(409, 'The recipient account cannot receive this amount.');
    db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(amountCents, source.id);
    db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?').run(amountCents, target.id);
    const createdAt = new Date().toISOString();
    const reference = `EVG-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const internal = source.user_id === target.user_id ? 1 : 0;
    const outgoing = addEntry(db, {
      accountId: source.id, type: 'transfer', description: note, amountCents: -amountCents,
      counterparty: internal ? target.name : target.owner_name, reference, internal, createdAt
    });
    addEntry(db, {
      accountId: target.id, type: 'transfer', description: note, amountCents,
      counterparty: internal ? source.name : user.name, reference, internal, createdAt
    });
    return outgoing;
  });
}

function payment(db, user, body) {
  const fromId = accountId(body.fromAccountId);
  const amountCents = parseAmount(body.amount);
  if (typeof body.billerId !== 'string' || body.billerId.length > 80) throw new HttpError(400, 'Choose a biller.');
  if (typeof body.reference !== 'string' || body.reference.trim().length < 3 || body.reference.trim().length > 64) {
    throw new HttpError(400, 'Enter a bill reference of 3–64 characters.');
  }
  const reference = body.reference.trim();
  const key = requestKey(body.requestId);
  return once(db, user.id, key, 'payment', { fromId, amountCents, billerId: body.billerId, reference }, () => {
    const source = ownedAccount(db, user.id, fromId);
    const biller = db.prepare('SELECT * FROM billers WHERE id = ?').get(body.billerId);
    if (!biller) throw new HttpError(400, 'Choose a valid biller.');
    if (source.balance_cents < amountCents) throw new HttpError(409, 'Insufficient funds in the selected account.');
    db.prepare('UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ?').run(amountCents, source.id);
    return addEntry(db, {
      accountId: source.id, type: 'bill', description: `${biller.name} bill`, amountCents: -amountCents,
      counterparty: biller.name, reference, createdAt: new Date().toISOString()
    });
  });
}

module.exports = {
  accountView, transactionView, accountName, parseAmount, createAccount, renameAccount,
  closeAccount, dashboard, transfer, payment
};
