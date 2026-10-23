'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./dft-helpers');
const { hashPassword, verifyPassword } = require('../banking/security');
const migration = '006_greenlink_demo_identity.sql';
const oldEmail = 'alex@evergreen.demo';
const newEmail = 'alex@greenlink.demo';
const password = 'ExistingCustomPass456!';
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL required.' }, work);

async function oldOperator(db, { name = 'Alex Morgan', number = '1020001001' } = {}) {
  const hash = await hashPassword(password);
  const user = (await db.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *', [name, oldEmail, hash])).rows[0];
  await db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance) VALUES($1,'Operating funds',$2,10000,10000,'legacy_verified')", [user.id, number]);
  return user;
}
async function replayMigration(db) {
  await db.query('DELETE FROM schema_migrations WHERE name=$1', [migration]);
  return db.migrate();
}

pgTest('DFT demo identity cleanup retains credentials and balances, revokes old sessions and records the rename', async t => {
  const f = await fixture(t, { seed: false });
  const user = await oldOperator(f.db);
  const before = (await f.db.query('SELECT * FROM accounts')).rows;
  const oldSession = f.client(); await oldSession.login(oldEmail, password);
  await replayMigration(f.db);
  const updated = (await f.db.query('SELECT * FROM users WHERE id=$1', [user.id])).rows[0];
  assert.equal(updated.email, newEmail);
  assert.equal(updated.password_hash, user.password_hash);
  assert.equal(await verifyPassword(password, updated.password_hash), true);
  assert.equal(updated.role, user.role);
  assert.equal(updated.auth_version, user.auth_version + 1);
  assert.deepEqual((await f.db.query('SELECT * FROM accounts')).rows, before);
  assert.equal((await oldSession.request('/api/dashboard')).status, 401);
  await f.client().login(newEmail, password);
  assert.equal((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count, '0');
  const audit = (await f.db.query("SELECT * FROM audit_log WHERE event_type='operator.demo_identity_renamed'")).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].target_user_id, user.id);
  assert.equal(audit[0].metadata.previousEmail, oldEmail); assert.equal(audit[0].metadata.email, newEmail);
  await f.db.migrate();
  assert.equal((await f.db.query("SELECT count(*) FROM audit_log WHERE event_type='operator.demo_identity_renamed'")).rows[0].count, '1');
});

pgTest('DFT demo identity cleanup refuses to overwrite an existing destination login', async t => {
  const f = await fixture(t, { http: false, seed: false });
  const legacy = await oldOperator(f.db);
  const destination = (await f.db.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING *', ['Another operator', newEmail, await hashPassword('DifferentSecret789!')])).rows[0];
  await assert.rejects(replayMigration(f.db), error => error.code === '23505');
  assert.equal((await f.db.query('SELECT email FROM users WHERE id=$1', [legacy.id])).rows[0].email, oldEmail);
  assert.deepEqual((await f.db.query('SELECT * FROM users WHERE id=$1', [destination.id])).rows[0], destination);
  assert.equal((await f.db.query('SELECT count(*) FROM schema_migrations WHERE name=$1', [migration])).rows[0].count, '0');
  assert.equal((await f.db.query("SELECT count(*) FROM audit_log WHERE event_type='operator.demo_identity_renamed'")).rows[0].count, '0');
});

pgTest('DFT demo identity cleanup leaves unrelated customer identities untouched', async t => {
  const f = await fixture(t, { http: false, seed: false });
  const unrelated = await oldOperator(f.db, { name: 'An unrelated operator' });
  await replayMigration(f.db);
  assert.deepEqual((await f.db.query('SELECT * FROM users WHERE id=$1', [unrelated.id])).rows[0], unrelated);
});
