'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./dft-helpers');
const { ACCOUNTS, ensureAccounts, seedExamples, originalSnapshot, assertSameTarget, prepareMfaAndVerify } = require('../scripts/feature-accounts');
const { hashPassword } = require('../banking/security');
const workflows = require('../banking/workflows');
const PASSWORD = 'FeatureIntegrationPass123!';
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL required.' }, work);

pgTest('Feature operator and application target mismatch is refused before seeding either database schema', async t => {
  const first = await fixture(t, { http: false, seed: false }), second = await fixture(t, { http: false, seed: false });
  await assert.rejects(assertSameTarget(first.db, second.db), /same local database\/schema/);
  assert.equal((await first.db.query('SELECT count(*) FROM users')).rows[0].count, '0');
  assert.equal((await second.db.query('SELECT count(*) FROM users')).rows[0].count, '0');
  assert.equal((await assertSameTarget(first.db, first.db)).schema, first.schema);
});

pgTest('Feature accounts retain all original records, use distinct hashes and preserve user changes on rerun', async t => {
  const f = await fixture(t, { http: false }), before = await originalSnapshot(f.db);
  const manifest = await ensureAccounts(f.db, PASSWORD);
  assert.equal(manifest.created, true);
  assert.equal(Object.keys(manifest.users).length, 10);
  assert.deepEqual(await originalSnapshot(f.db, Object.values(manifest.users)), before);
  const records = (await f.db.query('SELECT * FROM users WHERE id=ANY($1::bigint[])', [Object.values(manifest.users)])).rows;
  assert.equal(new Set(records.map(row => row.password_hash)).size, 10);
  assert.deepEqual(new Set(records.map(row => row.role)), new Set(['customer', 'admin']));
  await f.db.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1', [manifest.users.business, await hashPassword('UserChangedTheirPassword456!')]);
  await f.db.query("UPDATE accounts SET name='User renamed this account' WHERE id=$1", [manifest.accounts.business]);
  const changed = await originalSnapshot(f.db);
  assert.equal((await ensureAccounts(f.db, PASSWORD)).created, false);
  assert.deepEqual(await originalSnapshot(f.db), changed);
  assert.equal((await f.db.query('SELECT count(*) FROM businesses WHERE primary_user_id=$1', [manifest.users.profile])).rows[0].count, '0');
});

pgTest('Feature seeding refuses reserved-email collisions and rolls back without adopting the existing user', async t => {
  const f = await fixture(t, { http: false });
  await f.db.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)', ['Unrelated real operator', ACCOUNTS[0].email, await hashPassword('ExistingPrivatePassword789!')]);
  const before = await originalSnapshot(f.db);
  await assert.rejects(ensureAccounts(f.db, PASSWORD), /Existing users are never adopted/);
  assert.deepEqual(await originalSnapshot(f.db), before);
  assert.equal((await f.db.query("SELECT count(*) FROM audit_log WHERE event_type='operator.feature_accounts_created'")).rows[0].count, '0');
});

pgTest('Feature tour prepares real guarded banking lifecycles, schedules and MFA without changing original users or policy', async t => {
  const f = await fixture(t, { http: false }), before = await originalSnapshot(f.db);
  let instant = Date.now(); const now = () => instant;
  const manifest = await ensureAccounts(f.db, PASSWORD, { now });
  const examples = await seedExamples(f.db, manifest, PASSWORD, f.riskClient, { now });
  assert.equal(examples.payments['supplier-payment'].status, 'completed');
  assert.equal(examples.payments['independently-approved'].status, 'completed');
  assert.equal(examples.payments['independently-rejected'].status, 'rejected');
  assert.equal(examples.payments['high-value-awaiting-review'].status, 'pending_review');
  assert.equal(examples.payments['maker-awaiting-independent-review'].status, 'pending_review');
  assert.equal(examples.payments['daily-limit-blocked'].score, 95);
  assert.equal(examples.controls[0].passed, true);
  instant += 5000;
  await workflows.runDue(f.db, { now, riskClient: f.riskClient });
  assert.equal((await f.db.query('SELECT status FROM scheduled_payments WHERE id=$1', [examples.schedules.execute.id])).rows[0].status, 'completed');
  assert.equal((await f.db.query('SELECT status FROM scheduled_payments WHERE id=$1', [examples.schedules.insufficient.id])).rows[0].status, 'failed');
  assert.equal((await f.db.query('SELECT status FROM scheduled_payments WHERE id=$1', [examples.schedules.cancelled.id])).rows[0].status, 'cancelled');
  const filename = path.resolve(__dirname, '..', 'test-results', 'feature-credentials-' + randomUUID() + '.json');
  t.after(() => { if (fs.existsSync(filename)) fs.unlinkSync(filename); });
  const credentials = { password: PASSWORD };
  const verified = await prepareMfaAndVerify(f.db, manifest, credentials, filename, f.riskClient, 'a'.repeat(64), undefined, { agentModel:f.agentModel });
  assert.equal(verified.length, 10);
  assert.equal(credentials.mfa.recoveryCodes.length, 9);
  const row = (await f.db.query('SELECT secret_encrypted FROM user_mfa WHERE user_id=$1', [manifest.users.mfa])).rows[0];
  assert.ok(!row.secret_encrypted.includes(credentials.mfa.secret));
  assert.deepEqual(await originalSnapshot(f.db, Object.values(manifest.users)), before);
  const balances = await f.db.query("SELECT a.id FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.status='completed' GROUP BY a.id HAVING a.balance_cents<>a.opening_balance_cents+COALESCE(sum(t.amount_cents),0)");
  assert.equal(balances.rowCount, 0);
  const count = (await f.db.query('SELECT count(*) FROM transactions')).rows[0].count;
  await seedExamples(f.db, manifest, PASSWORD, f.riskClient, { now });
  assert.equal((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count, count);
});
