'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const totp = require('../banking/totp');
const { createAuth } = require('../banking/auth');

const PASSWORD = 'Greenlink123!';
const ORIGIN = 'https://bank.example.test';
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL TOTP integration tests.' }, work);
const failure = status => error => error.status === status;

test('DFT TOTP matches RFC6238 SHA-1 vectors and preserves leading zeroes', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totp.codeForCounter(secret, Math.floor(seconds / 30), 8), code);
  }
  assert.equal(totp.codeForCounter(secret, 1), '287082');
});

test('DFT TOTP accepts only a one-step clock tolerance and rejects previously consumed counters', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', counter = 60000000, now = counter * totp.PERIOD_MS;
  for (const offset of [-1, 0, 1]) {
    const code = totp.codeForCounter(secret, counter + offset);
    assert.equal(totp.verifyCode(secret, code, { now }), counter + offset);
    assert.equal(totp.verifyCode(secret, code, { now, lastCounter: counter + offset }), null);
  }
  assert.equal(totp.verifyCode(secret, totp.codeForCounter(secret, counter + 2), { now }), null);
  for (const value of ['12345', '1234567', 123456, null, 'abcdef']) assert.equal(totp.verifyCode(secret, value, { now }), null);
});

test('DFT TOTP secrets use authenticated encryption bound to the owning user', () => {
  const key = randomBytes(32).toString('hex'), secret = totp.newSecret();
  const first = totp.encryptSecret(secret, key, '7'), second = totp.encryptSecret(secret, key, '7');
  assert.notEqual(first, second);
  assert.equal(first.includes(secret), false);
  assert.equal(totp.decryptSecret(first, key, '7'), secret);
  assert.throws(() => totp.decryptSecret(first, key, '8'), failure(503));
  assert.throws(() => totp.decryptSecret(first, randomBytes(32).toString('hex'), '7'), failure(503));
  const tampered = first.slice(0, -1) + (first.endsWith('0') ? '1' : '0');
  assert.throws(() => totp.decryptSecret(tampered, key, '7'), failure(503));
  assert.throws(() => totp.encryptSecret(secret, '', '7'), failure(503));
});

test('DFT recovery codes are random, user-bound hashes and never embed account secrets', () => {
  const codes = totp.recoveryCodes();
  assert.equal(codes.length, 10); assert.equal(new Set(codes).size, 10);
  for (const code of codes) {
    const hash = totp.recoveryHash(code, '7');
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hash.includes(code), false);
    assert.equal(totp.recoveryHash(code.toLowerCase().replace(/-/g, ''), '7'), hash);
    assert.notEqual(totp.recoveryHash(code, '8'), hash);
  }
  assert.equal(totp.recoveryHash('not-a-recovery-code', '7'), null);
});

async function fixture(t) {
  const { Pool } = require('pg');
  const { createDatabase } = require('../database');
  const connectionString = process.env.TEST_DATABASE_URL, schema = `dft_totp_${randomUUID().replace(/-/g, '')}`;
  assert.match(schema, /^dft_totp_[a-f0-9]{32}$/);
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = createDatabase({ connectionString, poolOptions: { options: `-c search_path=${schema}`, max: 8 } });
  t.after(async () => { await db.close(); assert.match(schema, /^dft_totp_[a-f0-9]{32}$/); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await db.migrate();
  let clock = Date.parse('2027-01-01T04:00:00.000Z');
  const options = { db, now: () => clock, publicOrigin: ORIGIN, authEncryptionKey: randomBytes(32).toString('hex') };
  return { db, options, auth: createAuth(options), add: delta => { clock += delta; }, now: () => clock };
}

function browser(auth, ip = '198.51.100.20') {
  let cookie = '', csrfToken;
  const headers = {};
  const req = () => ({ ip, protocol: 'https', headers: { host: 'bank.example.test', origin: ORIGIN, cookie, ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...headers } });
  const res = { setHeader(name, value) { if (name === 'Set-Cookie') cookie = value.split(';', 1)[0]; } };
  const capture = result => { if (result.csrfToken) csrfToken = result.csrfToken; return result; };
  return {
    req, res, headers, load: () => auth.load(req()),
    register: async () => capture(await auth.register(req(), res, { name: 'Alex Morgan', email: 'alex@example.test', password: PASSWORD })),
    login: async extra => capture(await auth.login(req(), res, { email: 'alex@example.test', password: PASSWORD, ...extra })),
    setup: body => auth.mfaSetup(req(), res, body || { currentPassword: PASSWORD }),
    confirm: async otp => capture(await auth.mfaConfirm(req(), res, { otp })),
    disable: async body => capture(await auth.mfaDisable(req(), res, body)),
    logout: async () => capture(await auth.logout(req(), res)),
  };
}

const currentCode = (secret, fixture) => totp.codeForCounter(secret, Math.floor(fixture.now() / totp.PERIOD_MS));
async function enrolled(f, owner) {
  await owner.register();
  const setup = await owner.setup();
  const enabled = await owner.confirm(currentCode(setup.secret, f));
  return { secret: setup.secret, enabled };
}

pgTest('DFT MFA enrollment requires password and CSRF, stages encrypted state and expires without enabling login challenges', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  await owner.register();
  await assert.rejects(owner.setup({ currentPassword: 'wrong-password' }), failure(403));
  owner.headers['x-csrf-token'] = 'wrong';
  await assert.rejects(owner.setup(), failure(403));
  delete owner.headers['x-csrf-token'];
  const setup = await owner.setup();
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
  const stored = (await f.db.query('SELECT * FROM user_mfa')).rows[0];
  assert.equal(stored.enabled_at, null); assert.equal(stored.secret_encrypted, null);
  assert.equal(stored.pending_secret_encrypted.includes(setup.secret), false);
  const independent = browser(f.auth, '203.0.113.10');
  await independent.login();
  assert.equal((await independent.load()).user.mfaEnabled, false);
  f.add(10 * 60 * 1000 + 1);
  await assert.rejects(owner.confirm(currentCode(setup.secret, f)), failure(400));
  assert.equal((await f.db.query('SELECT enabled_at FROM user_mfa')).rows[0].enabled_at, null);
});

pgTest('DFT MFA confirmation rotates sessions, stores only recovery hashes and requires a factor at later login', async t => {
  const f = await fixture(t), owner = browser(f.auth), other = browser(f.auth, '203.0.113.11');
  await owner.register(); await other.login();
  const setup = await owner.setup();
  await assert.rejects(owner.confirm('invalid'), failure(403));
  const enabled = await owner.confirm(currentCode(setup.secret, f));
  assert.equal(enabled.user.mfaEnabled, true); assert.equal(enabled.recoveryCodes.length, 10);
  assert.equal((await other.load()).user, null);
  assert.ok((await owner.load()).session.mfa_verified_at);
  const stored = (await f.db.query('SELECT code_hash FROM mfa_recovery_codes')).rows;
  assert.equal(stored.length, 10);
  assert.ok(enabled.recoveryCodes.every(code => !JSON.stringify(stored).includes(code)));
  await assert.rejects(other.login(), error => error.status === 401 && error.code === 'MFA_REQUIRED');
  await assert.rejects(other.login({ otp: currentCode(setup.secret, f) }), error => error.code === 'MFA_INVALID');
  f.add(totp.PERIOD_MS);
  assert.equal((await other.login({ otp: currentCode(setup.secret, f) })).user.mfaEnabled, true);
  const audit = JSON.stringify((await f.db.query('SELECT metadata FROM audit_log')).rows);
  assert.equal(audit.includes(setup.secret), false);
  assert.ok(enabled.recoveryCodes.every(code => !audit.includes(code)));
});

pgTest('DFT concurrent TOTP login attempts consume a counter only once across PostgreSQL connections', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  const { secret } = await enrolled(f, owner);
  f.add(totp.PERIOD_MS);
  const otp = currentCode(secret, f);
  const results = await Promise.all([browser(createAuth(f.options), '203.0.113.12'), browser(createAuth(f.options), '203.0.113.13')]
    .map(client => client.login({ otp }).then(value => ({ value }), error => ({ error }))));
  assert.equal(results.filter(result => result.value).length, 1);
  assert.equal(results.filter(result => result.error?.code === 'MFA_INVALID').length, 1);
});

pgTest('DFT recovery codes have one atomic use, survive adapter recreation and cannot bypass password checks', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  const { enabled } = await enrolled(f, owner), recoveryCode = enabled.recoveryCodes[0];
  const results = await Promise.all([browser(createAuth(f.options), '203.0.113.14'), browser(createAuth(f.options), '203.0.113.15')]
    .map(client => client.login({ recoveryCode }).then(value => ({ value }), error => ({ error }))));
  assert.equal(results.filter(result => result.value).length, 1);
  assert.equal(results.filter(result => result.error?.code === 'MFA_INVALID').length, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM mfa_recovery_codes WHERE used_at IS NOT NULL')).rows[0].count, 1);
  const client = browser(createAuth(f.options), '203.0.113.16');
  await assert.rejects(client.login({ password: 'wrong-password', recoveryCode: enabled.recoveryCodes[1] }), failure(401));
  await client.login({ recoveryCode: enabled.recoveryCodes[1] });
});

pgTest('DFT MFA disable requires current password and a fresh OTP, revokes old sessions and erases factor material', async t => {
  const f = await fixture(t), owner = browser(f.auth), other = browser(f.auth, '203.0.113.17');
  const { secret, enabled } = await enrolled(f, owner);
  f.add(totp.PERIOD_MS);
  await other.login({ recoveryCode: enabled.recoveryCodes[0] });
  await assert.rejects(owner.disable({ currentPassword: 'wrong-password', otp: currentCode(secret, f) }), failure(403));
  await assert.rejects(owner.disable({ currentPassword: PASSWORD, otp: 'invalid' }), failure(403));
  assert.ok((await other.load()).user);
  assert.equal((await owner.disable({ currentPassword: PASSWORD, otp: currentCode(secret, f) })).user.mfaEnabled, false);
  assert.equal((await other.load()).user, null);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM user_mfa')).rows[0].count, 0);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM mfa_recovery_codes')).rows[0].count, 0);
  await other.login();
});

pgTest('DFT authenticator verification fails closed without its encryption key and preserves a counter on failed session commit', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  const { secret } = await enrolled(f, owner);
  f.add(totp.PERIOD_MS);
  const otp = currentCode(secret, f), missingKey = browser(createAuth({ ...f.options, authEncryptionKey: '' }), '203.0.113.18');
  await assert.rejects(missingKey.login({ otp }), failure(503));
  await f.db.query(`CREATE FUNCTION reject_test_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test session insert failure'; END; $$;
    CREATE TRIGGER reject_test_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_test_session()`);
  const client = browser(createAuth(f.options), '203.0.113.19');
  await assert.rejects(client.login({ otp }), /Test session insert failure/);
  await f.db.query('DROP TRIGGER reject_test_session ON sessions; DROP FUNCTION reject_test_session()');
  assert.equal((await client.login({ otp })).user.mfaEnabled, true, 'rolled back session creation cannot consume an authenticator counter');
});
