'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client: PgClient } = require('pg');
const { provision, connection } = require('../database/setup');
const { createDatabase } = require('../database');
const { inspectDatabase } = require('../database/check');
const { identifier } = require('../database/permissions');
const { seedDemo } = require('../scripts/seed-demo');
const { createRiskClient } = require('../banking/risk');
const { Client, modelStub, businessProfile } = require('./dft-helpers');
const available = Boolean(process.env.TEST_DATABASE_URL);

async function fixture(t) {
  // These tests need CREATE DATABASE/CREATE ROLE, separately from normal schema
  // fixtures. Every created object has a unique name and is explicitly cleaned.
  const admin = new PgClient({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  const suffix = randomBytes(7).toString('hex');
  const databaseName = 'greenlink_test_' + suffix, ownerRole = 'dft_owner_' + suffix, appRole = 'dft_app_' + suffix;
  const ownerPassword = randomBytes(32).toString('hex'), appPassword = randomBytes(32).toString('hex');
  let owner, app, server;
  t.after(async () => {
    if (server) { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await server.closeResources(); }
    if (app) await app.close();
    if (owner) await owner.close();
    assert.match(databaseName, /^greenlink_test_[a-f0-9]{14}$/);
    await admin.query(`DROP DATABASE IF EXISTS ${identifier(databaseName)}`);
    for (const role of [appRole, ownerRole]) {
      assert.match(role, /^dft_(?:app|owner)_[a-f0-9]{14}$/);
      await admin.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    }
    await admin.end();
  });
  const options = { adminUrl: process.env.TEST_DATABASE_URL, databaseName, ownerRole, appRole, ownerPassword, appPassword };
  const result = await provision(options);
  owner = createDatabase({ connectionString: result.ownerUrl });
  app = createDatabase({ connectionString: result.appUrl });
  return { admin, owner, app, options, result, async start() {
    const { createApplication } = require('../app');
    const riskClient = createRiskClient({ db: app, assessModel: modelStub(), modelInfo: require('../services/fraud/model.json') });
    server = await createApplication({ db: app, seed: false, backgroundJobs: false, publicOrigin: '', trustProxy: '', riskClient });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    return { client: () => new Client(() => base), runJobs: () => server.runJobs() };
  } };
}

test('PostgreSQL setup is repeatable, preserves records, and enforces restricted SQL permissions', { skip: !available }, async t => {
  const f = await fixture(t);
  await seedDemo(f.owner);
  const before = (await f.owner.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows;
  await f.app.migrate(); // Verification needs neither CREATE nor metadata writes.
  const latest = (await f.owner.query("DELETE FROM schema_migrations WHERE name='005_wholesale_businesses.sql' RETURNING *")).rows[0];
  await assert.rejects(f.app.migrate(), /Run npm run db:migrate/);
  await f.owner.query('INSERT INTO schema_migrations(name,checksum,applied_at) VALUES($1,$2,$3)', [latest.name, latest.checksum, latest.applied_at]);
  let report = await inspectDatabase(f.app);
  assert.equal(report.ready, true);
  assert.equal(report.tables, 23);
  assert.equal(report.migrations.length, 5);
  assert.deepEqual(report.discrepancies, []);
  const denied = [
    'CREATE TABLE injected(id int)',
    "UPDATE users SET role='admin' WHERE role='customer'",
    "INSERT INTO users(name,email,password_hash,role) VALUES('Bad Actor','denied@example.test','invalid','admin')",
    'UPDATE audit_log SET event_type=event_type',
    'DELETE FROM audit_log',
    'DELETE FROM transactions',
    'UPDATE transactions SET amount_cents=amount_cents',
    'UPDATE accounts SET opening_balance_cents=0',
    "UPDATE schema_migrations SET checksum='forged'",
    `SET ROLE ${identifier(f.result.ownerRole)}`,
  ];
  for (const sql of denied) await assert.rejects(f.app.query(sql), error => error.code === '42501', sql);
  // Permission refresh must remove old column grants as well as table grants.
  await f.owner.query(`GRANT UPDATE(role) ON users TO ${identifier(f.result.appRole)}`);
  await provision({ ...f.options, ownerKnown: true, appKnown: true });
  await assert.rejects(f.app.query("UPDATE users SET role='admin'"), error => error.code === '42501');
  assert.deepEqual((await f.owner.query('SELECT id,balance_cents FROM accounts ORDER BY id')).rows, before);
  await assert.rejects(provision({ ...f.options }), /Existing role/);
  report = await inspectDatabase(f.app);
  assert.equal(report.ready, true);
  // The check must detect actual ledger drift, rather than just connectivity.
  await f.owner.query('UPDATE accounts SET balance_cents=balance_cents+1 WHERE id=(SELECT min(id) FROM accounts)');
  report = await inspectDatabase(f.app);
  assert.equal(report.ready, false);
  assert.equal(report.discrepancies.length, 1);
});

test('restricted PostgreSQL login supports business onboarding, payments, rules, schedules and audit', { skip: !available }, async t => {
  const f = await fixture(t);
  await seedDemo(f.owner);
  const http = await f.start(), alex = http.client(), reviewer = http.client(), applicant = http.client();
  await alex.login(); await reviewer.login('reviewer@greenlink.demo');
  await applicant.session();
  const registered = await applicant.request('/api/auth/register', { method: 'POST', body: {
    name: 'Postgres Operator', email: 'pg-operator@example.test', password: 'Greenlink123!', confirmPassword: 'Greenlink123!', business: businessProfile('PGCOMPANY001'),
  } });
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  const business = registered.data.business;
  const approved = await reviewer.request(`/api/business/applications/${business.id}/review`, { method: 'POST', body: {
    decision: 'approve', version: business.version, reason: 'Independent database integration verification.', verificationConfirmed: true, authorizationPassword: 'Greenlink123!',
  } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const dashboard = await alex.dashboard(), source = dashboard.accounts[0];
  const sent = await alex.request('/api/transfers', { method: 'POST', body: { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '1.25', description: 'Restricted SQL transfer', requestId: randomUUID() } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.transaction.status, 'completed');
  const bill = await alex.request('/api/payments', { method: 'POST', body: { fromAccountId: source.id, billerId: 'pub', reference: 'PG-TEST-01', amount: '0.75', requestId: randomUUID() } });
  assert.equal(bill.status, 200, JSON.stringify(bill.data));
  const schedule = await alex.request('/api/scheduled-payments', { method: 'POST', body: { type: 'bill', fromAccountId: source.id, billerId: 'pub', reference: 'PG-SCHEDULE', amount: '1.00', scheduledAt: new Date(Date.now()+3600000).toISOString(), frequency: 'once', requestId: randomUUID() } });
  assert.equal(schedule.status, 201, JSON.stringify(schedule.data));
  assert.equal((await alex.request('/api/scheduled-payments/' + schedule.data.schedule.id, { method: 'DELETE', body: {} })).status, 200);
  const rules = (await alex.request('/api/fraud/rules')).data;
  const changed = await alex.request('/api/fraud/rules/high_value', { method: 'PATCH', body: { version: rules.version, threshold: 9000 } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  await http.runJobs();
  assert.ok((await alex.request('/api/notifications')).data.notifications.length);
  assert.ok((await alex.history({ q: 'Restricted SQL transfer' })).transactions.length);
  assert.equal((await inspectDatabase(f.app)).ready, true);
  assert.ok(Number((await f.app.query('SELECT count(*) FROM audit_log')).rows[0].count) > 0);
});

test('database setup rejects an unrelated populated target before creating roles', { skip: !available }, async t => {
  const f = await fixture(t);
  await f.owner.query('CREATE TABLE unrelated_records(id integer)');
  await assert.rejects(provision({ ...f.options, ownerKnown: true, appKnown: true }), /unrelated tables/);
  assert.equal((await f.owner.query('SELECT count(*) FROM unrelated_records')).rows[0].count, '0');
  assert.equal(connection('postgresql://u:p@localhost:55432/postgres?options=bad', 'greenlink_dft', 'safe', 'secret').includes('options='), false);
  const encoded = new URL(connection('postgresql://user%40name:p%40ss%2Fword@localhost:55432/postgres', 'greenlink_dft'));
  assert.equal(decodeURIComponent(encoded.username), 'user@name');
  assert.equal(decodeURIComponent(encoded.password), 'p@ss/word');
});
