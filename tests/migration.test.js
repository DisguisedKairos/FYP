const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { hashPasswordSync } = require('../models/security');
const { createFixture } = require('./helpers');

test('known legacy demo identities migrate to Greenlink without resetting balances or replacing customized passwords', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const initial = await client.dashboard();
  const transfer = await client.request('/api/transfers', { method: 'POST', body: {
    fromAccountId: initial.accounts[0].id, toAccountNumber: '1020001002', amount: '1.23', requestId: 'migration-preserved-transfer',
  } });
  assert.equal(transfer.status, 200);
  const before = await client.dashboard();
  const ledgerBefore = await client.ledger();
  await fixture.stop();
  const db = new DatabaseSync(fixture.dbPath);
  try {
    const oldDefault = hashPasswordSync('Evergreen123!');
    const custom = hashPasswordSync('CustomLegacy123!');
    db.prepare('UPDATE users SET email=?,password_hash=? WHERE email=?').run('alex@evergreen.demo', oldDefault, 'alex@greenlink.demo');
    db.prepare('UPDATE users SET email=?,password_hash=? WHERE email=?').run('reviewer@evergreen.demo', oldDefault, 'reviewer@greenlink.demo');
    db.prepare('UPDATE users SET email=?,password_hash=? WHERE email=?').run('jamie@evergreen.demo', custom, 'jamie@greenlink.demo');
  } finally { db.close(); }
  await fixture.start();
  const returning = fixture.client(); await returning.login();
  const after = await returning.dashboard();
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual((await returning.ledger()).map(row => row.id), ledgerBefore.map(row => row.id));
  const recipient = fixture.client(); await recipient.login('jamie@greenlink.demo', 'CustomLegacy123!');
  assert.equal((await recipient.request('/api/auth/login', { method: 'POST', body: { email: 'jamie@greenlink.demo', password: 'Greenlink123!' } })).status, 401);
  const reviewer = fixture.client(); await reviewer.login('reviewer@greenlink.demo');
  assert.equal((await reviewer.dashboard()).user.role, 'admin');
});

test('an unrelated registered legacy email is preserved when it does not have the known demo account number', async (t) => {
  const fixture = await createFixture(t, { seed: false });
  const client = fixture.client(); await client.session();
  const registered = await client.request('/api/auth/register', { method: 'POST', body: {
    name: 'Original Customer', email: 'alex@evergreen.demo', password: 'OriginalCustom123!',
  } });
  assert.equal(registered.status, 201);
  await fixture.stop();
  const db = new DatabaseSync(fixture.dbPath);
  try { db.prepare('UPDATE accounts SET number=? WHERE id=?').run('1020999999', registered.data.account.id); }
  finally { db.close(); }
  await fixture.start({ seed: true });
  const returning = fixture.client(); await returning.login('alex@evergreen.demo', 'OriginalCustom123!');
  assert.equal((await returning.dashboard()).user.name, 'Original Customer');
  const stranger = fixture.client(); await stranger.session();
  assert.equal((await stranger.request('/api/auth/login', { method: 'POST', body: { email: 'alex@greenlink.demo', password: 'Greenlink123!' } })).status, 401);
});
