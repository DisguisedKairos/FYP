'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hashPasswordSync } = require('./models/security');

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function openDatabase(dbPath, { seed = true } = {}) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      number TEXT NOT NULL UNIQUE,
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0 AND balance_cents <= 9000000000000),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS accounts_user ON accounts(user_id);
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL CHECK (type IN ('transfer', 'bill', 'credit')),
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents != 0),
      counterparty TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      reference TEXT NOT NULL DEFAULT '',
      internal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS transactions_account_date ON transactions(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS billers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      initials TEXT NOT NULL,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS requests (
      user_id INTEGER NOT NULL REFERENCES users(id),
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      available_at INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, delivered_at TEXT, last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS outbox_delivery ON notification_outbox(status, available_at, locked_until);
    CREATE TABLE IF NOT EXISTS scheduled_payments (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL,
      payload_json TEXT NOT NULL, amount_cents INTEGER NOT NULL, frequency TEXT NOT NULL,
      scheduled_at TEXT NOT NULL, next_run_at TEXT, status TEXT NOT NULL DEFAULT 'active',
      authorization_json TEXT NOT NULL, created_at TEXT NOT NULL, last_run_at TEXT,
      last_status TEXT, last_error TEXT, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_payments(status, next_run_at, lease_until);
    CREATE TABLE IF NOT EXISTS scheduled_payment_runs (
      id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES scheduled_payments(id),
      due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'processing', transaction_id TEXT REFERENCES transactions(id),
      error TEXT, created_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE (schedule_id, due_at)
    );
  `);

  // Additive migrations preserve an existing project's accounts and history.
  const ensureColumn = (table, name, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'customer'");
  for (const [name, definition] of Object.entries({
    risk_json: 'TEXT', authorization_json: 'TEXT', review_json: 'TEXT',
    to_account_id: 'INTEGER REFERENCES accounts(id)', biller_id: 'TEXT', payee: 'TEXT',
    requested_at: 'TEXT', completed_at: 'TEXT'
  })) ensureColumn('transactions', name, definition);

  const addBiller = db.prepare('INSERT OR IGNORE INTO billers (id, name, category, initials, color) VALUES (?, ?, ?, ?, ?)');
  addBiller.run('sp-services', 'SP Services', 'Utilities', 'SP', '#dceae3');
  addBiller.run('singtel', 'Singtel', 'Telecommunications', 'S', '#f6e2e2');
  addBiller.run('pub', 'PUB', 'Water', 'P', '#dfeaf6');

  if (seed && db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0) seedDemo(db);
  if (seed) ensureDemoReviewer(db);
  db.exec(`
    UPDATE transactions SET payee = CASE counterparty
      WHEN 'SP Services' THEN 'sp-services' WHEN 'Singtel' THEN 'singtel' WHEN 'PUB' THEN 'pub' END
      WHERE type = 'bill' AND payee IS NULL AND counterparty IN ('SP Services', 'Singtel', 'PUB');
    UPDATE transactions SET payee = CASE WHEN amount_cents < 0 THEN '1020002001' ELSE '1020001001' END
      WHERE reference = 'DEMO-DINNER' AND payee IS NULL;
    UPDATE transactions SET payee = CASE WHEN amount_cents < 0 THEN '1020001002' ELSE '1020001001' END
      WHERE reference = 'DEMO-SAVINGS' AND payee IS NULL;
  `);
  return db;
}

function ensureDemoReviewer(db) {
  const alex = db.prepare("SELECT u.id FROM users u JOIN accounts a ON a.user_id = u.id WHERE u.email = 'alex@evergreen.demo' AND a.number = '1020001001'").get();
  if (!alex) return;
  transaction(db, () => {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(alex.id);
    let reviewer = db.prepare("SELECT id FROM users WHERE email = 'reviewer@evergreen.demo'").get();
    if (!reviewer) {
      const result = db.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)")
        .run('Sam Rivera', 'reviewer@evergreen.demo', hashPasswordSync('Evergreen123!'), new Date().toISOString());
      reviewer = { id: Number(result.lastInsertRowid) };
      db.prepare("INSERT INTO accounts (user_id, name, number, balance_cents, created_at) VALUES (?, 'Main savings', '1020009001', 0, ?)").run(reviewer.id, new Date().toISOString());
    }
  });
}

function seedDemo(db) {
  const passwordHash = hashPasswordSync('Evergreen123!');
  const now = new Date();
  const daysAgo = (days, hour = 10) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    date.setHours(hour, 15, 0, 0);
    return date.toISOString();
  };
  transaction(db, () => {
    const addUser = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
    const alexId = Number(addUser.run('Alex Morgan', 'alex@evergreen.demo', passwordHash, daysAgo(100)).lastInsertRowid);
    const jamieId = Number(addUser.run('Jamie Lee', 'jamie@evergreen.demo', passwordHash, daysAgo(90)).lastInsertRowid);
    const addAccount = db.prepare('INSERT INTO accounts (user_id, name, number, balance_cents, created_at) VALUES (?, ?, ?, ?, ?)');
    const mainId = Number(addAccount.run(alexId, 'Main savings', '1020001001', 2485050, daysAgo(100)).lastInsertRowid);
    const rainyId = Number(addAccount.run(alexId, 'Rainy day', '1020001002', 520000, daysAgo(80)).lastInsertRowid);
    const jamieAccountId = Number(addAccount.run(jamieId, 'Main savings', '1020002001', 120000, daysAgo(90)).lastInsertRowid);
    const addEntry = db.prepare(`INSERT INTO transactions
      (id, account_id, type, description, amount_cents, counterparty, reference, internal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const entry = (account, type, desc, cents, party, reference, internal, date) =>
      addEntry.run(randomUUID(), account, type, desc, cents, party, reference, internal, date);

    // Opening entries and subsequent activity reconcile exactly to each balance.
    entry(mainId, 'credit', 'Opening balance', 1898250, 'Welcome deposit', 'DEMO-OPENING', 0, daysAgo(100));
    entry(mainId, 'credit', 'Monthly salary', 520000, 'Acme Studio', 'SALARY', 0, daysAgo(24));
    entry(mainId, 'bill', 'SP Services bill', -12680, 'SP Services', 'SP-810294', 0, daysAgo(18));
    entry(mainId, 'transfer', 'Dinner with friends', -8500, 'Jamie Lee', 'DEMO-DINNER', 0, daysAgo(14));
    entry(jamieAccountId, 'credit', 'Opening balance', 111500, 'Welcome deposit', 'DEMO-OPENING', 0, daysAgo(90));
    entry(jamieAccountId, 'transfer', 'Dinner with friends', 8500, 'Alex Morgan', 'DEMO-DINNER', 0, daysAgo(14));
    entry(mainId, 'transfer', 'Monthly savings', -50000, 'Rainy day', 'DEMO-SAVINGS', 1, daysAgo(10));
    entry(rainyId, 'credit', 'Opening balance', 470000, 'Welcome deposit', 'DEMO-OPENING', 0, daysAgo(80));
    entry(rainyId, 'transfer', 'Monthly savings', 50000, 'Main savings', 'DEMO-SAVINGS', 1, daysAgo(10));
    entry(mainId, 'bill', 'Singtel mobile plan', -4800, 'Singtel', 'ST-298134', 0, daysAgo(5));
    entry(mainId, 'credit', 'Project payment', 142780, 'Studio North', 'INVOICE-026', 0, daysAgo(2));
  });
}

module.exports = { openDatabase, transaction };
