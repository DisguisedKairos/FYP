'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fixture } = require('./dft-helpers');
const { importSqlite } = require('../scripts/import-sqlite');
const { grant } = require('../scripts/manage-admin');
const { hashPasswordSync, verifyPassword } = require('../banking/security');
const ledger = require('../banking/ledger');
const history = require('../banking/history');
const workflows = require('../banking/workflows');
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL for PostgreSQL import tests.' }, work);
const OUTGOING = '11111111-1111-4111-a111-111111111111';
const HELD = '22222222-2222-4222-a222-222222222222';
const password = 'CustomLegacyPassword!7';
const digest = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');

function legacy(t, { negative = false, chronology = false, adjacent = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'greenlink-import-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'banking.sqlite'), source = new DatabaseSync(filename);
  const hash = hashPasswordSync(password);
  source.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,password_hash TEXT,role TEXT,created_at TEXT);
    CREATE TABLE accounts(id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,number TEXT,balance_cents INTEGER,status TEXT,created_at TEXT);
    CREATE TABLE transactions(id TEXT PRIMARY KEY,account_id INTEGER,type TEXT,description TEXT,amount_cents INTEGER,counterparty TEXT,status TEXT,reference TEXT,internal INTEGER,created_at TEXT,requested_at TEXT,completed_at TEXT,risk_json TEXT,authorization_json TEXT,review_json TEXT,to_account_id INTEGER,biller_id TEXT,payee TEXT);
    CREATE TABLE sessions(token_hash TEXT,user_id INTEGER,csrf_token TEXT,expires_at INTEGER);
    CREATE TABLE requests(user_id INTEGER,request_id TEXT,kind TEXT,payload_hash TEXT,result_json TEXT,created_at TEXT);
    CREATE TABLE scheduled_payments(id TEXT PRIMARY KEY,user_id INTEGER,type TEXT,payload_json TEXT,amount_cents INTEGER,frequency TEXT,scheduled_at TEXT,next_run_at TEXT,status TEXT,authorization_json TEXT,created_at TEXT,last_run_at TEXT,last_status TEXT,last_error TEXT,lease_owner TEXT,lease_until INTEGER);
    CREATE TABLE scheduled_payment_runs(id TEXT,schedule_id TEXT,due_at TEXT,status TEXT,transaction_id TEXT,error TEXT,created_at TEXT,completed_at TEXT);
    CREATE TABLE notification_outbox(id TEXT,user_id INTEGER,payload_json TEXT,status TEXT,attempts INTEGER,available_at INTEGER,locked_until INTEGER,created_at TEXT,delivered_at TEXT,last_error TEXT);`);
  const user = source.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)');
  user.run(10, 'Legacy Customer', 'legacy@example.test', hash, 'customer', '2026-01-01T00:00:00.000Z');
  user.run(20, 'Legacy Recipient', 'recipient@example.test', hash, 'customer', '2026-01-01T00:00:00.000Z');
  user.run(30, 'Legacy Reviewer', 'reviewer@example.test', hash, 'admin', '2026-01-01T00:00:00.000Z');
  source.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(101, 10, 'Legacy savings', '9400000001', negative ? 500 : 10800, 'active', chronology ? '2026-01-05T00:00:00.000Z' : '2026-01-01T00:00:00.000Z');
  source.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(202, 20, 'Recipient savings', '9400000002', 200, 'active', '2026-01-01T00:00:00.000Z');
  const insert = source.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('legacy-credit', 101, 'credit', 'Deposit', 1000, 'Deposit', 'completed', 'OPEN', 0, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', null, null, null, null, null, null);
  insert.run(OUTGOING, 101, 'transfer', 'Dinner', -200, 'Legacy Recipient', 'completed', 'REF-OLD', 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', null, '{"method":"password"}', null, 202, null, '9400000002');
  insert.run('legacy-incoming', 202, 'transfer', 'Dinner', 200, 'Legacy Customer', 'completed', 'REF-OLD', 0, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', null, null, null, null, null, '9400000001');
  const risk = { score: 70, decision: 'review', modelVersion: 'legacy-model', ruleVersion: 1, assessedAt: '2026-01-04T00:00:00.000Z', reasons: [{ code: 'legacy', message: 'Historical held transaction', contribution: 0 }] };
  insert.run(HELD, 101, 'transfer', 'Held payment', -500, 'Legacy Recipient', 'pending_review', 'HELD-OLD', 0, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z', null, JSON.stringify(risk), '{"method":"password"}', null, 202, null, '9400000002');
  source.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(10, 'legacy-transfer', 'transfer', 'old-format-hash', JSON.stringify({ id: OUTGOING }), '2026-01-03T00:00:00.000Z');
  source.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('a'.repeat(64), 10, 'old-csrf', Date.now() + 86400000);
  const payload = { fromId: 101, number: '9400000002', amountCents: 100, note: 'Standing payment' };
  source.prepare('INSERT INTO scheduled_payments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-schedule', 10, 'transfer', JSON.stringify(payload), 100, 'monthly', '2027-01-31T04:00:00.000Z', '2027-01-31T04:00:00.000Z', 'active', '{"method":"password","scope":"scheduled_payment","scheduleId":"legacy-schedule"}', '2026-01-04T00:00:00.000Z', null, null, null, 'old-worker', Date.now());
  source.prepare('INSERT INTO scheduled_payment_runs VALUES(?,?,?,?,?,?,?,?)').run('legacy-run', 'legacy-schedule', '2027-01-31T04:00:00.000Z', 'processing', null, null, '2027-01-31T04:00:00.000Z', null);
  const event = { id: 'legacy-event', userId: 10, type: 'account', title: 'Legacy notice', message: 'A retained notification', transactionId: OUTGOING, metadata: {}, createdAt: '2026-01-04T00:00:00.000Z' };
  source.prepare('INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,?,?,?,?)').run(event.id, 10, JSON.stringify(event), 'pending', 0, 0, 0, event.createdAt, null, null);
  source.close();
  if (adjacent) {
    const store = new DatabaseSync(path.join(directory, 'notifications.sqlite'));
    store.exec('CREATE TABLE notifications(id TEXT,user_id TEXT,type TEXT,title TEXT,message TEXT,transaction_id TEXT,created_at TEXT,read_at TEXT,metadata_json TEXT)');
    store.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-read-notice', '10', 'account', 'Read notice', 'Retained read state', OUTGOING, event.createdAt, event.createdAt, '{}'); store.close();
    const fraud = new DatabaseSync(path.join(directory, 'fraud.sqlite'));
    fraud.exec('CREATE TABLE fraud_rules(id TEXT,value_json TEXT);CREATE TABLE fraud_settings(id INTEGER,version INTEGER);CREATE TABLE fraud_assessments(id TEXT,fingerprint TEXT,result_json TEXT,created_at TEXT)');
    fraud.prepare('INSERT INTO fraud_rules VALUES(?,?)').run('high_value', JSON.stringify({ id: 'high_value', name: 'High-value payment', description: 'Imported policy', enabled: true, threshold: 5000, unit: 'SGD', action: 'review' }));
    fraud.prepare('INSERT INTO fraud_settings VALUES(1,9)').run();
    fraud.prepare('INSERT INTO fraud_assessments VALUES(?,?,?,?)').run('unbound-old-assessment', 'legacy-fingerprint', JSON.stringify(risk), event.createdAt); fraud.close();
  }
  return { filename, hash, checksum: digest(filename) };
}

pgTest('DFT SQLite import preserves money, custom credentials and lifecycle with explicit opening provenance', async t => {
  const { db } = await fixture(t, { http: false, seed: false }), source = legacy(t, { adjacent: true });
  const result = await importSqlite({ db, sourcePath: source.filename, confirmEmptyTarget: true, withAdjacentStores: true });
  assert.equal(result.duplicate, false); assert.equal(digest(source.filename), source.checksum);
  const user = (await db.query('SELECT * FROM users WHERE id=10')).rows[0];
  assert.equal(user.email, 'legacy@example.test'); assert.equal(user.password_hash, source.hash); assert.equal(await verifyPassword(password, user.password_hash), true);
  const account = (await db.query('SELECT * FROM accounts WHERE id=101')).rows[0];
  assert.equal(Number(account.balance_cents), 10800); assert.equal(Number(account.opening_balance_cents), 10000); assert.equal(account.opening_provenance, 'legacy_verified');
  assert.equal((await ledger.view(db, HELD)).status, 'pending_review');
  assert.equal(Number((await db.query('SELECT count(*) FROM sessions')).rows[0].count), 0);
  const schedule = (await workflows.listSchedules(db, user))[0]; assert.equal(schedule.id, 'legacy-schedule'); assert.equal(schedule.runs.length, 1);
  assert.equal((await db.query('SELECT lease_owner FROM scheduled_payments')).rows[0].lease_owner, null);
  assert.equal((await workflows.notifications(db, user)).notifications[0].isRead, true);
  assert.equal(Number((await db.query('SELECT count(*) FROM fraud_assessments')).rows[0].count), 0);
  assert.equal(Number((await db.query('SELECT count(*) FROM legacy_service_records')).rows[0].count), 1);
  const statement = await history.statement(db, user, new URLSearchParams({ accountId: '101', from: '2026-01-01', to: '2026-01-31' }));
  assert.equal(statement.closingBalanceCents, 10800); assert.equal(statement.baselineCents, 10000);
  assert.equal(statement.transactions[0].isOpeningBalance, true);
  const replay = await ledger.submit(db, user, 'transfer', { fromAccountId: '101', toAccountNumber: '9400000002', amount: '2.00', description: 'Dinner', requestId: 'legacy-transfer' }, { authorize: async () => ({ method: 'password' }), riskClient: { assess: async () => { throw new Error('Imported completed request must not rescreen'); } } });
  assert.equal(replay.id, OUTGOING); assert.equal(Number((await db.query('SELECT balance_cents FROM accounts WHERE id=101')).rows[0].balance_cents), 10800);
  const again = await importSqlite({ db, sourcePath: source.filename, confirmEmptyTarget: true, withAdjacentStores: true }); assert.equal(again.duplicate, true);
  assert.equal(Number((await db.query('SELECT count(*) FROM legacy_imports')).rows[0].count), 1);
  const newUser = (await db.query("INSERT INTO users(name,email,password_hash) VALUES('New User','new@example.test','test-only') RETURNING id")).rows[0]; assert.ok(BigInt(newUser.id) > 30n);
  const newAccount = (await db.query("INSERT INTO accounts(user_id,name,number) VALUES($1,'New savings','9400000003') RETURNING id", [newUser.id])).rows[0]; assert.ok(BigInt(newAccount.id) > 202n);
});

pgTest('DFT corrupt or ambiguous legacy history is refused without target mutations', async t => {
  for (const options of [{ negative: true }, { chronology: true }]) {
    const { db } = await fixture(t, { http: false, seed: false }), source = legacy(t, options);
    await assert.rejects(importSqlite({ db, sourcePath: source.filename, confirmEmptyTarget: true }), /Legacy|Import refused/);
    assert.equal(Number((await db.query('SELECT count(*) FROM users')).rows[0].count), 0);
    assert.equal(Number((await db.query('SELECT count(*) FROM legacy_imports')).rows[0].count), 0);
    assert.equal(digest(source.filename), source.checksum);
  }
});

pgTest('DFT imports require explicit confirmation and an empty target', async t => {
  const { db } = await fixture(t, { http: false, seed: false }), source = legacy(t);
  await assert.rejects(importSqlite({ db, sourcePath: source.filename }), /confirm-empty-target/);
  await db.query("INSERT INTO users(name,email,password_hash) VALUES('Existing User','existing@example.test','test-only')");
  await assert.rejects(importSqlite({ db, sourcePath: source.filename, confirmEmptyTarget: true }), /target is not empty/);
  assert.equal(Number((await db.query('SELECT count(*) FROM users')).rows[0].count), 1);
  assert.equal(Number((await db.query('SELECT count(*) FROM accounts')).rows[0].count), 0);
});

pgTest('DFT PostgreSQL operator role grant requires an existing user and invalidates old sessions', async t => {
  const { db } = await fixture(t, { http: false, seed: false });
  const user = (await db.query("INSERT INTO users(name,email,password_hash) VALUES('Operator Target','target@example.test','unchanged-custom-hash') RETURNING *")).rows[0];
  await db.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES('token',$1,'csrf',now()+interval '1 day')", [user.id]);
  await assert.rejects(grant({ db, email: 'missing@example.test' }), /not found/);
  assert.equal((await grant({ db, email: user.email })).changed, true);
  const updated = (await db.query('SELECT * FROM users WHERE id=$1', [user.id])).rows[0]; assert.equal(updated.role, 'admin'); assert.equal(updated.auth_version, 2); assert.equal(updated.password_hash, user.password_hash);
  assert.ok((await db.query('SELECT revoked_at FROM sessions WHERE user_id=$1', [user.id])).rows[0].revoked_at);
  assert.equal((await grant({ db, email: user.email })).changed, false);
  assert.equal(Number((await db.query("SELECT count(*) FROM audit_log WHERE event_type='operator.role_granted'")).rows[0].count), 1);
});
