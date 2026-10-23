'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupSecrets, readSecret, databaseUrl, NAMES } = require('../deploy/configuration');
const { runtimeEnvironment } = require('../deploy/banking');

function directory(t) {
  const parent = path.resolve(__dirname, '..', 'test-results');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'delivery-secrets-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(parent));
    for (const name of fs.readdirSync(root)) fs.chmodSync(path.join(root, name), 0o600);
    fs.rmSync(root, { recursive: true });
  });
  return root;
}

test('Delivery setup generates distinct secrets and retains existing values on every rerun', t => {
  const root = directory(t);
  assert.deepEqual(setupSecrets(root), { created: 5, retained: 0 });
  const values = NAMES.map(name => readSecret(name, root));
  assert.equal(new Set(values).size, 5);
  assert.deepEqual(setupSecrets(root), { created: 0, retained: 5 });
  assert.deepEqual(NAMES.map(name => readSecret(name, root)), values);
  assert.equal(JSON.stringify(setupSecrets(root)).includes(values[0]), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(root).mode & 0o777, 0o700);
});

test('Delivery setup fails closed on malformed stored secrets before generating missing values', t => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, 'owner_password'), 'wrong-format');
  assert.throws(() => setupSecrets(root), /32-byte lowercase hex/);
  assert.deepEqual(fs.readdirSync(root), ['owner_password']);
  assert.equal(fs.readFileSync(path.join(root, 'owner_password'), 'utf8'), 'wrong-format');
  assert.throws(() => readSecret('../owner_password', root), /Unknown delivery secret/);
});

test('Banking container receives only runtime credentials and cannot seed or inherit operator access', t => {
  const root = directory(t); setupSecrets(root);
  const env = runtimeEnvironment({ DB_HOST: 'postgres', DB_PORT: '5432', DB_NAME: 'greenlink_dft',
    ADMIN_DATABASE_URL: 'private-admin', MIGRATION_DATABASE_URL: 'private-owner', TEST_DATABASE_URL: 'private-tests',
    APPLICATION_DATABASE_URL: 'private-copy', PGPASSWORD: 'private-password', PGHOST: 'unexpected-host',
    GREENLINK_STAFF_PASSWORD: 'private-staff', SEED_DEMO: 'true' }, root);
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.username, 'greenlink_app');
  assert.equal(url.password, readSecret('app_password', root));
  assert.equal(url.hostname, 'postgres');
  assert.equal(env.SERVICE_TOKEN, readSecret('service_token', root));
  assert.equal(env.AUTH_ENCRYPTION_KEY, readSecret('auth_encryption_key', root));
  assert.equal(env.SEED_DEMO, 'false');
  for (const key of ['ADMIN_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL', 'APPLICATION_DATABASE_URL', 'PGPASSWORD', 'PGHOST', 'GREENLINK_STAFF_PASSWORD']) assert.equal(env[key], undefined, key);
  assert.equal(JSON.stringify(env).includes(readSecret('owner_password', root)), false);
  assert.equal(JSON.stringify(env).includes(readSecret('postgres_password', root)), false);
});

test('Delivery database URL construction encodes credentials and rejects unsafe connection targets', () => {
  const url = new URL(databaseUrl({ DB_HOST: 'postgres', DB_PORT: '5432' }, 'greenlink_app', 'special@/#password'));
  assert.equal(decodeURIComponent(url.password), 'special@/#password');
  assert.equal(url.pathname, '/greenlink_dft');
  for (const env of [{ DB_HOST: 'postgres/attacker' }, { DB_PORT: '5432?options=unsafe' }, { DB_PORT: '0' }, { DB_NAME: 'invalid;drop' }]) assert.throws(() => databaseUrl(env, 'greenlink_app', 'secret'), /Invalid delivery database/);
  assert.throws(() => databaseUrl({}, 'app;drop', 'secret'), /Invalid delivery database/);
});
