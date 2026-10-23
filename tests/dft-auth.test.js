'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const security = require('../banking/security');
const { createAuth } = require('../banking/auth');

const PASSWORD = 'Greenlink123!';
const ORIGIN = 'https://bank.example.test';
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL authentication integration tests.' }, work);
const failure = status => error => error.status === status;

test('DFT security uses salted scrypt, rejects malformed hashes and has no legacy password fallback', async () => {
  const first = await security.hashPassword(PASSWORD), second = await security.hashPassword(PASSWORD);
  assert.notEqual(first, second);
  assert.equal(await security.verifyPassword(PASSWORD, first), true);
  assert.equal(await security.verifyPassword('UnrelatedPass456!', first), false);
  const olderHash = await security.hashPassword('oldpass1');
  assert.equal(await security.verifyPassword('oldpass1', olderHash), true, 'the stronger new-password policy does not invalidate an existing hash');
  for (const [value, hash] of [[PASSWORD, null], [PASSWORD, 'broken'], [null, first], ['x'.repeat(129), first], [PASSWORD, '00:bad']]) {
    assert.equal(await security.verifyPassword(value, hash), false);
  }
});

test('DFT registration policy preserves password characters and validates server-side identity boundaries', () => {
  for (const value of ['Aa1' + 'x'.repeat(5), 'Aa1' + 'x'.repeat(125), ' Aa1 spaces ']) assert.equal(security.password(value), value);
  for (const value of ['', 'Aa1' + 'x'.repeat(4), 'Aa1' + 'x'.repeat(126), 'abcdefgh', 'ABCDEFG1', 'lowercase1', 'NoNumbersHere', {}, null]) assert.throws(() => security.password(value), failure(400));
  assert.equal(security.emailAddress('  Alex@Example.Test '), 'alex@example.test');
  assert.equal(security.fullName('  Alex   Morgan '), 'Alex Morgan');
  assert.throws(() => security.emailAddress('not an email'), failure(400));
  assert.throws(() => security.fullName('x'), failure(400));
});

test('DFT security requires exact origins and session CSRF while leaving proxy trust to Express', () => {
  const req = { ip: '198.51.100.10', headers: { origin: ORIGIN, host: 'internal:4010', 'x-forwarded-for': '203.0.113.99', 'x-csrf-token': 'correct' } };
  security.assertOrigin(req, ORIGIN);
  security.assertCsrf(req, { csrf_token: 'correct' });
  assert.equal(security.clientAddress(req), '198.51.100.10');
  for (const origin of ['http://bank.example.test', 'https://bank.example.test.evil.test', `${ORIGIN}:444`, `${ORIGIN}/extra`, 'null']) {
    assert.throws(() => security.assertOrigin({ ...req, headers: { ...req.headers, origin } }, ORIGIN), failure(403));
  }
  assert.throws(() => security.assertOrigin({ ...req, headers: { ...req.headers, 'sec-fetch-site': 'cross-site' } }, ORIGIN), failure(403));
  assert.throws(() => security.assertCsrf(req, { csrf_token: 'different' }), failure(403));
  assert.throws(() => security.assertCsrf(req, null), failure(403));
});

test('DFT session cookies require a single opaque token and contain browser security flags', () => {
  const raw = security.token();
  assert.equal(security.readCookie({ headers: { cookie: `greenlink_session=${raw}` } }), raw);
  assert.equal(security.readCookie({ headers: { cookie: `greenlink_session=${raw}; greenlink_session=${raw}` } }), null);
  assert.equal(security.readCookie({ headers: { cookie: 'greenlink_session=untrusted' } }), null);
  let cookie;
  security.writeCookie({ setHeader(name, value) { assert.equal(name, 'Set-Cookie'); cookie = value; } }, raw, { secure: true, now: 0, expiresAt: 3600000 });
  assert.match(cookie, /; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
  assert.match(cookie, /; Path=\//);
  assert.deepEqual(security.publicUser({ id: 7, name: 'Alex', email: 'alex@example.test', role: 'customer', password_hash: 'secret', auth_version: 4 }), { id: '7', name: 'Alex', email: 'alex@example.test', role: 'customer' });
});

async function fixture(t) {
  const { Pool } = require('pg');
  const { createDatabase } = require('../database');
  const connectionString = process.env.TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const schema = `dft_auth_${randomUUID().replace(/-/g, '')}`;
  assert.match(schema, /^dft_auth_[a-f0-9]{32}$/);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const db = createDatabase({ connectionString, poolOptions: { options: `-c search_path=${schema}`, max: 8 } });
  t.after(async () => {
    await db.close();
    assert.match(schema, /^dft_auth_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  await db.migrate();
  let clock = Date.parse('2027-01-01T04:00:00.000Z');
  const options = { db, now: () => clock, publicOrigin: ORIGIN };
  return { db, options, auth: createAuth(options), add: delta => { clock += delta; }, now: () => clock };
}

function browser(auth, ip = '198.51.100.20') {
  let cookie = '', csrfToken;
  const headers = {};
  const req = () => ({ ip, protocol: 'https', headers: { host: 'bank.example.test', origin: ORIGIN, cookie, ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}), ...headers } });
  const res = { setHeader(name, value) { if (name === 'Set-Cookie') cookie = value.split(';', 1)[0]; } };
  const capture = result => { csrfToken = result.csrfToken; return result; };
  return {
    req, res, headers,
    get cookie() { return cookie; },
    get csrfToken() { return csrfToken; },
    bootstrap: async () => capture(await auth.bootstrap(req(), res)),
    register: async (email = 'alex@example.test', extra = {}) => capture(await auth.register(req(), res, { name: 'Alex Morgan', email, password: PASSWORD, confirmPassword: PASSWORD, business:require('./dft-helpers').businessProfile('TEST'+require('node:crypto').createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0,16)), ...extra })),
    login: async (email = 'alex@example.test', password = PASSWORD) => capture(await auth.login(req(), res, { email, password })),
    logout: async () => capture(await auth.logout(req(), res)),
    load: () => auth.load(req()),
    change: async body => capture(await auth.changePassword(req(), res, body)),
    revoke: async body => capture(await auth.revokeAll(req(), res, body)),
  };
}

pgTest('DFT PostgreSQL registration, session rotation, logout and persisted hashes work together', async t => {
  const f = await fixture(t), client = browser(f.auth);
  const anonymous = await client.bootstrap(), initialCookie = client.cookie;
  assert.equal(anonymous.user, null);
  await assert.rejects(client.register('weak@example.test', { password: 'abcdefgh', confirmPassword: 'abcdefgh' }), failure(400));
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 0, 'direct API registration cannot bypass the UI password policy');
  const registered = await client.register('Alex@Example.Test', { role: 'admin' });
  assert.equal(registered.user.id, String(registered.user.id));
  assert.equal(registered.user.role, 'customer');
  assert.equal(registered.user.email, 'alex@example.test');
  assert.equal(registered.account.balanceCents, 0);
  assert.notEqual(client.cookie, initialCookie);
  assert.notEqual(client.csrfToken, anonymous.csrfToken);
  assert.equal((await f.auth.load({ ...client.req(), headers: { ...client.req().headers, cookie: initialCookie } })).user, null);
  const saved = (await f.db.query('SELECT password_hash FROM users')).rows[0];
  assert.equal(await security.verifyPassword(PASSWORD, saved.password_hash), true);
  assert.equal(saved.password_hash.includes(PASSWORD), false);
  const tokens = (await f.db.query('SELECT token_hash FROM sessions')).rows;
  assert.ok(tokens.every(row => !client.cookie.includes(row.token_hash)));
  await assert.rejects(client.register(), failure(409));
  const old = client.cookie;
  await client.logout();
  assert.equal((await client.load()).user, null);
  assert.notEqual(client.cookie, old);
  await assert.rejects(client.login('alex@example.test', 'incorrect'), failure(401));
  await client.login();
  assert.equal((await client.load()).user.email, 'alex@example.test');
});

pgTest('DFT durable login limits coordinate concurrent connections and survive adapter recreation', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  await owner.register();
  const attempts = await Promise.all(Array.from({ length: 9 }, (_, index) => browser(createAuth(f.options), `198.51.100.${30 + index}`).login('alex@example.test', 'wrong-password').then(() => 200, error => error.status)));
  assert.equal(attempts.filter(status => status === 401).length, 8);
  assert.equal(attempts.filter(status => status === 429).length, 1);
  await assert.rejects(browser(createAuth(f.options), '203.0.113.1').login(), failure(429));
  f.add(15 * 60 * 1000 + 1);
  await browser(createAuth(f.options), '203.0.113.1').login();
  assert.equal((await f.db.query("SELECT COUNT(*)::integer AS count FROM audit_log WHERE event_type='auth.login.failed'")).rows[0].count, 8);
});

pgTest('DFT financial reauthorization is limited durably across purposes and never records passwords', async t => {
  const f = await fixture(t), owner = browser(f.auth);
  await owner.register();
  const { user } = await owner.load();
  for (let attempt = 0; attempt < 8; attempt++) await assert.rejects(f.auth.authorize(user, 'WrongPassword!', { ip: `198.51.100.${attempt + 50}`, purpose: attempt % 2 ? 'rule' : 'payment' }), failure(403));
  await assert.rejects(createAuth(f.options).authorize(user, PASSWORD, { ip: '203.0.113.2', purpose: 'review' }), failure(429));
  f.add(15 * 60 * 1000 + 1);
  assert.equal((await createAuth(f.options).authorize(user, PASSWORD, { ip: '203.0.113.2', purpose: 'payment' })).method, 'password');
  const audits = (await f.db.query('SELECT metadata FROM audit_log')).rows;
  assert.equal(JSON.stringify(audits).includes('WrongPassword!'), false);
  assert.equal(JSON.stringify(audits).includes(PASSWORD), false);
});

pgTest('DFT PostgreSQL sessions enforce thirty-minute idle and twenty-four-hour absolute expiry', async t => {
  const f = await fixture(t), idle = browser(f.auth);
  await idle.register();
  f.add(security.IDLE_MS);
  assert.equal((await idle.load()).user, null, 'idle boundary expires exactly at thirty minutes');
  const active = browser(f.auth, '203.0.113.3');
  await active.login();
  for (let step = 0; step < 49; step++) { f.add(29 * 60 * 1000); assert.ok((await active.load()).user); }
  f.add(19 * 60 * 1000);
  assert.equal((await active.load()).user, null, 'activity cannot extend absolute session lifetime');
  assert.equal((await active.bootstrap()).user, null);
});

pgTest('DFT password change requires CSRF and current password, revokes all old sessions and rotates the current session', async t => {
  const f = await fixture(t), owner = browser(f.auth), other = browser(f.auth, '203.0.113.4');
  await owner.register(); await other.login();
  const before = owner.cookie;
  const body = { currentPassword: PASSWORD, newPassword: 'UpdatedPassword123!', confirmPassword: 'UpdatedPassword123!' };
  owner.headers['x-csrf-token'] = 'wrong';
  await assert.rejects(owner.change(body), failure(403));
  delete owner.headers['x-csrf-token'];
  await assert.rejects(owner.change({ ...body, currentPassword: 'wrong-password' }), failure(403));
  assert.ok((await other.load()).user, 'unsuccessful password change preserves existing sessions');
  const changed = await owner.change(body);
  assert.equal(changed.user.email, 'alex@example.test');
  assert.notEqual(owner.cookie, before);
  assert.ok((await owner.load()).user);
  assert.equal((await other.load()).user, null);
  await assert.rejects(other.login('alex@example.test', PASSWORD), failure(401));
  await other.login('alex@example.test', body.newPassword);
  assert.equal((await f.db.query("SELECT COUNT(*)::integer AS count FROM audit_log WHERE event_type='auth.password_changed'")).rows[0].count, 1);
});

pgTest('DFT revoking all sessions invalidates stale authorizations and requires a password before any revocation', async t => {
  const f = await fixture(t), owner = browser(f.auth), other = browser(f.auth, '203.0.113.5');
  await owner.register(); await other.login();
  const stale = (await other.load()).user;
  await assert.rejects(owner.revoke({ currentPassword: 'wrong-password' }), failure(403));
  assert.ok((await other.load()).user);
  assert.equal((await owner.revoke({ currentPassword: PASSWORD })).user, null);
  assert.equal((await owner.load()).user, null);
  assert.equal((await other.load()).user, null);
  await assert.rejects(f.auth.authorize(stale, PASSWORD, { ip: '203.0.113.5' }), failure(403));
});

pgTest('DFT concurrent duplicate registration creates exactly one owned account and cannot escalate role', async t => {
  const f = await fixture(t);
  const results = await Promise.all([browser(f.auth).register('alex@example.test', { role: 'admin' }), browser(f.auth, '203.0.113.6').register('ALEX@example.test')].map(promise => promise.then(value => ({ value }), error => ({ status: error.status }))));
  assert.equal(results.filter(result => result.value).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM accounts')).rows[0].count, 1);
  assert.equal((await f.db.query('SELECT role FROM users')).rows[0].role, 'customer');
});

pgTest('DFT client IP login limits persist while attempts rotate across different accounts', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) await browser(f.auth, `198.51.100.${100 + index}`).register(`customer${index}@example.test`);
  const ip = '203.0.113.200';
  for (let attempt = 0; attempt < 40; attempt++) await assert.rejects(browser(f.auth, ip).login(`customer${attempt % 5}@example.test`, 'wrong-password'), failure(401));
  await assert.rejects(browser(createAuth(f.options), ip).login('another@example.test', 'wrong-password'), failure(429));
  f.add(15 * 60 * 1000 + 1);
  await browser(createAuth(f.options), ip).login('customer0@example.test');
});

pgTest('DFT anonymous-session creation quotas cannot be bypassed by discarding cookies or recreating the adapter', async t => {
  const f = await fixture(t), ip = '203.0.113.201';
  for (let attempt = 0; attempt < 60; attempt++) assert.equal((await browser(f.auth, ip).bootstrap()).user, null);
  await assert.rejects(browser(createAuth(f.options), ip).bootstrap(), failure(429));
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM sessions')).rows[0].count, 60);
  f.add(15 * 60 * 1000 + 1);
  await browser(createAuth(f.options), ip).bootstrap();
});

pgTest('DFT registration quotas count duplicate attempts without creating extra users or accounts', async t => {
  const f = await fixture(t);
  await browser(f.auth).register();
  const ip = '203.0.113.202';
  for (let attempt = 0; attempt < 20; attempt++) await assert.rejects(browser(f.auth, ip).register(), failure(409));
  await assert.rejects(browser(createAuth(f.options), ip).register('different@example.test'), failure(429));
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 1);
  assert.equal((await f.db.query('SELECT COUNT(*)::integer AS count FROM accounts')).rows[0].count, 1);
});
