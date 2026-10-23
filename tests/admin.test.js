'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { grant } = require('../scripts/manage-admin');
const { createFixture } = require('./helpers');

test('operator grant promotes an existing customer once, preserves password and records an audit', async t => {
  const fixture = await createFixture(t), client = fixture.client();
  await client.login('jamie@greenlink.demo');
  const inspect = () => { const db = new DatabaseSync(fixture.dbPath); try { return { user: db.prepare("SELECT * FROM users WHERE email='jamie@greenlink.demo'").get(), audit: db.prepare('SELECT * FROM operator_role_audit').all() }; } finally { db.close(); } };
  const before = new DatabaseSync(fixture.dbPath);
  const password = before.prepare("SELECT password_hash FROM users WHERE email='jamie@greenlink.demo'").get().password_hash; before.close();
  assert.equal((await client.request('/api/fraud/rules')).status, 403);
  assert.equal(grant({ dbPath: fixture.dbPath, email: 'jamie@greenlink.demo' }).changed, true);
  assert.equal(grant({ dbPath: fixture.dbPath, email: 'jamie@greenlink.demo' }).changed, false);
  assert.equal(inspect().user.password_hash, password);
  assert.equal(inspect().audit.length, 1);
  assert.equal(inspect().audit[0].previous_role, 'customer');
  assert.equal((await client.request('/api/fraud/rules')).status, 200);
  assert.throws(() => grant({ dbPath: fixture.dbPath, email: 'missing@greenlink.demo' }), /not found/);
  assert.throws(() => grant({ dbPath: fixture.dbPath + '.missing', email: 'jamie@greenlink.demo' }), /does not exist/);
  assert.equal(inspect().audit.length, 1);
});
