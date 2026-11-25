'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { fixture, businessProfile } = require('./dft-helpers');
const { ensureAccounts } = require('../scripts/feature-accounts');
const { seedIndustryBusinesses, CASES, PASSWORD: INDUSTRY_PASSWORD } = require('../scripts/seed-industry-businesses');
const { RETIRED_PREFIX, isRetiredPassword, retireAccounts } = require('../scripts/retire-accounts');
const { createAuth } = require('../banking/auth');
const security = require('../banking/security');
const totp = require('../banking/totp');

const PASSWORD = 'RetirementFixture123!';
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL required.' }, work);

// Capture every table so preservation checks also cover data added by future
// migrations. Only users, sessions and newly appended audit events may change.
async function snapshot(db) {
  return db.transaction(async client => {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows;
    const result = {};
    for (const { tablename } of tables) {
      assert.match(tablename, /^[a-z_][a-z_0-9]*$/);
      result[tablename] = (await client.query(`SELECT COALESCE(jsonb_agg(to_jsonb(record) ORDER BY to_jsonb(record)::text),'[]'::jsonb) AS records FROM "${tablename}" record`)).rows[0].records;
    }
    return result;
  }, { isolation: 'REPEATABLE READ', readOnly: true });
}

function assertSanitized(result, records) {
  const serialized = JSON.stringify(result);
  for (const table of ['users', 'sessions', 'user_mfa', 'mfa_recovery_codes']) {
    for (const row of records[table] || []) {
      for (const key of ['password_hash', 'token_hash', 'csrf_token', 'secret_encrypted', 'pending_secret_encrypted', 'code_hash']) {
        if (row[key]) assert.equal(serialized.includes(row[key]), false, `${key} must not appear in operator output`);
      }
    }
  }
  assert.equal(serialized.includes(PASSWORD), false);
  for (const user of records.users || []) {
    if (!user.email.endsWith('@greenlink.demo')) assert.equal(serialized.includes(user.email), false, 'non-demo email addresses must be masked in operator output');
  }
  for (const row of result.accounts) {
    assert.ok(row.id);
    assert.ok(row.identity);
    assert.ok(['customer', 'admin'].includes(row.role));
    assert.equal(typeof row.retired, 'boolean');
    for (const key of ['password_hash', 'token_hash', 'csrf_token', 'secret_encrypted', 'pending_secret_encrypted', 'code_hash']) assert.equal(Object.hasOwn(row, key), false);
  }
}

async function registered(f, key) {
  const client = f.client(), email = `${key}@retirement.example.test`;
  const result = await client.request('/api/auth/register', { method: 'POST', body: {
    name: `${key} Operator`, email, password: PASSWORD, confirmPassword: PASSWORD,
    business: businessProfile(`RETIRE${key.toUpperCase()}`),
  } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return { client, email, ...result.data };
}

test('Account retirement marker keeps the original verifier while making password verification fail closed', async () => {
  assert.equal(RETIRED_PREFIX, '!retired!');
  const hash = await security.hashPassword(PASSWORD);
  assert.equal(isRetiredPassword(hash), false);
  assert.equal(isRetiredPassword(RETIRED_PREFIX + hash), true);
  for (const value of [null, undefined, 0, {}, '', 'retired!' + hash]) assert.equal(isRetiredPassword(value), false);
  assert.equal(await security.verifyPassword(PASSWORD, hash), true);
  assert.equal(await security.verifyPassword(PASSWORD, RETIRED_PREFIX + hash), false);
});

pgTest('Account retirement defaults to a read-only preview and rejects invalid explicit ID lists without any mutation', async t => {
  const f = await fixture(t, { http: false });
  const user = (await f.db.query("SELECT * FROM users WHERE email='jamie@greenlink.demo'")).rows[0];
  const before = await snapshot(f.db);
  const preview = await retireAccounts(f.db, [user.id]);
  assert.equal(preview.applied, false);
  assert.equal(preview.accounts.length, 1);
  assert.equal(String(preview.accounts[0].id), String(user.id));
  assert.equal(preview.accounts[0].retired, false);
  assertSanitized(preview, before);
  assert.deepEqual(await snapshot(f.db), before);

  const invalid = [undefined, null, [], user.id, {}, [null], [{}], [true], [NaN], [Infinity], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [''], ['-1'], ['1.1'], ['1 OR 1=1'], ['9223372036854775808'], [user.id, user.id], Array.from({ length: 51 }, (_, index) => String(index + 1))];
  for (const ids of invalid) await assert.rejects(async () => retireAccounts(f.db, ids, { apply: true }));
  assert.deepEqual(await snapshot(f.db), before, 'validation must not retire a valid subset or append audit records');

  for (const apply of [false, true]) {
    await assert.rejects(retireAccounts(f.db, [user.id, '9223372036854775807'], { apply }));
    assert.deepEqual(await snapshot(f.db), before, 'one missing ID must reject the entire target list');
  }
});

pgTest('Account retirement refuses removal of the last active administrator atomically, including an already retired administrator', async t => {
  const f = await fixture(t, { http: false });
  const users = (await f.db.query('SELECT * FROM users ORDER BY id')).rows;
  const admins = users.filter(row => row.role === 'admin'), customer = users.find(row => row.role === 'customer');
  assert.equal(admins.length, 2);
  let before = await snapshot(f.db);
  for (const apply of [false, true]) {
    await assert.rejects(retireAccounts(f.db, [customer.id, ...admins.map(row => row.id)], { apply }));
    assert.deepEqual(await snapshot(f.db), before);
  }
  const result = await retireAccounts(f.db, [admins[0].id], { apply: true });
  assert.equal(result.retiredCount, 1);
  before = await snapshot(f.db);
  await assert.rejects(retireAccounts(f.db, [customer.id, admins[1].id], { apply: true }));
  assert.deepEqual(await snapshot(f.db), before, 'an administrator with a retired verifier cannot satisfy the remaining-admin guard');
});

pgTest('Account retirement preserves all banking and MFA history, blocks six selected logins and sessions, and retains all eight industry operators', async t => {
  let instant = Date.parse('2027-01-01T04:00:00Z');
  const now = () => instant;
  const f = await fixture(t, { now, authEncryptionKey: randomBytes(32).toString('hex') });
  const features = await ensureAccounts(f.db, PASSWORD, { now });
  await seedIndustryBusinesses(f.db, { now });
  const standard = await registered(f, 'standard'), enabled = await registered(f, 'enabled'), pending = await registered(f, 'pending');
  const targets = [features.users.staff, features.users.profile, features.users.empty, standard.user.id, enabled.user.id, pending.user.id].map(String);
  const clients = [standard, enabled, pending];
  for (const key of ['staff', 'profile', 'empty']) {
    const client = f.client(), email = `${key}-tester@greenlink.demo`;
    await client.login(email, PASSWORD);
    clients.push({ client, email });
  }

  const setup = await enabled.client.request('/api/auth/mfa/setup', { method: 'POST', body: { currentPassword: PASSWORD } });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  const confirmed = await enabled.client.request('/api/auth/mfa/confirm', { method: 'POST', body: { otp: totp.codeForCounter(setup.data.secret, Math.floor(now() / totp.PERIOD_MS)) } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.recoveryCodes.length, 10);
  const challenge = await f.client().request('/api/auth/login', { method: 'POST', body: { email: enabled.email, password: PASSWORD } });
  assert.equal(challenge.status, 401);
  assert.equal(challenge.data.code, 'MFA_REQUIRED');
  const pendingSetup = await pending.client.request('/api/auth/mfa/setup', { method: 'POST', body: { currentPassword: PASSWORD } });
  assert.equal(pendingSetup.status, 200, JSON.stringify(pendingSetup.data));

  // Give a selected user settled financial history and an optional business
  // profile as well as the zero-balance/profile-missing/staff variants above.
  const account = (await f.db.query('SELECT * FROM accounts WHERE user_id=$1', [standard.user.id])).rows[0];
  await f.db.query("UPDATE businesses SET status='approved' WHERE primary_user_id=$1", [standard.user.id]);
  await f.db.query("INSERT INTO business_advisory_profiles(business_id,profile_key,settings_json) VALUES($1,'technology',$2)", [account.business_id, { preserved: true }]);
  await f.db.query("INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,created_at,requested_at,completed_at,settlement_seq) VALUES($1,$2,'credit','Historical retirement fixture receipt',12500,'Fixture customer','completed','RETAIN-HISTORY',$3,$3,$3,nextval('settlement_sequence'))", [randomUUID(), account.id, new Date(now() - 86400000)]);
  await f.db.query('UPDATE accounts SET balance_cents=12500 WHERE id=$1', [account.id]);
  await f.db.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'fixture.previous_operator_action',$2)", [standard.user.id, { preserve: 'original audit metadata' }]);

  // An expired yet unrevoked session and an old revoked session must both
  // survive, with only the unrevoked one receiving a revocation timestamp.
  await f.db.query("INSERT INTO sessions(token_hash,user_id,csrf_token,auth_version,created_at,last_seen_at,expires_at) SELECT $2,id,$3,auth_version,$4,$4,$5 FROM users WHERE id=$1", [standard.user.id, security.tokenHash(security.token()), security.token(), new Date(now() - 3600000), new Date(now() - 1)]);
  const retained = f.client();
  await retained.login(CASES[0].email, INDUSTRY_PASSWORD);
  const auth = createAuth({ db: f.db, now });
  const staleUser = (await f.db.query('SELECT * FROM users WHERE id=$1', [standard.user.id])).rows[0];
  const staleAuthorization = await auth.authorize(staleUser, PASSWORD, { ip: 'retirement-fixture', purpose: 'payment' });
  assert.equal(staleAuthorization.authVersion, staleUser.auth_version);
  const before = await snapshot(f.db);
  const preview = await retireAccounts(f.db, targets, { now });
  assert.equal(preview.applied, false);
  assert.equal(preview.accounts.length, 6);
  assertSanitized(preview, before);
  assert.deepEqual(await snapshot(f.db), before);

  instant += 1000;
  const reason = 'Unneeded project account';
  const result = await retireAccounts(f.db, targets, { apply: true, reason, now });
  assert.equal(result.applied, true);
  assert.equal(result.retiredCount, 6);
  assert.deepEqual(new Set(result.accounts.map(row => String(row.id))), new Set(targets));
  assert.ok(result.accounts.every(row => row.retired));
  assertSanitized(result, before);
  const after = await snapshot(f.db);
  for (const table of Object.keys(before).filter(name => !['users', 'sessions', 'audit_log'].includes(name))) assert.deepEqual(after[table], before[table], `${table} must be retained exactly`);
  assert.equal(after.users.length, before.users.length);
  for (const previous of before.users) {
    const current = after.users.find(row => row.id === previous.id);
    if (targets.includes(String(previous.id))) {
      assert.deepEqual(current, { ...previous, password_hash: RETIRED_PREFIX + previous.password_hash, auth_version: previous.auth_version + 1 });
    } else assert.deepEqual(current, previous, 'all retained users must keep credentials and authorization versions');
  }
  assert.equal(after.sessions.length, before.sessions.length);
  for (const previous of before.sessions) {
    const current = after.sessions.find(row => row.token_hash === previous.token_hash);
    if (targets.includes(String(previous.user_id)) && !previous.revoked_at) {
      assert.deepEqual({ ...current, revoked_at: previous.revoked_at }, previous);
      assert.equal(new Date(current.revoked_at).getTime(), now());
    } else assert.deepEqual(current, previous, 'already revoked and retained sessions must remain unchanged');
  }
  const originalAudits = new Set(before.audit_log.map(row => String(row.id)));
  assert.deepEqual(after.audit_log.filter(row => originalAudits.has(String(row.id))), before.audit_log);
  const retirementAudits = after.audit_log.filter(row => !originalAudits.has(String(row.id)));
  assert.equal(retirementAudits.length, 6);
  assert.ok(retirementAudits.every(row => row.event_type === 'operator.account_retired'));
  assert.deepEqual(new Set(retirementAudits.map(row => String(row.target_user_id))), new Set(targets));
  assert.equal(JSON.stringify(retirementAudits).includes(PASSWORD), false);

  instant += 1000;
  const repeat = await retireAccounts(f.db, [...targets].reverse(), { apply: true, reason: 'Repeated operator request', now });
  assert.equal(repeat.applied, true);
  assert.equal(repeat.retiredCount, 0);
  assert.deepEqual(await snapshot(f.db), after, 'repeat retirement must change no hashes, authorization versions, session timestamps or audit records');
  assertSanitized(repeat, after);

  instant += totp.PERIOD_MS;
  for (const { client, email } of clients) {
    assert.equal((await client.request('/api/dashboard')).status, 401, 'the old authenticated session must stop working');
    assert.equal((await client.session()).data.user, null);
    const login = await f.client().request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
    assert.equal(login.status, 401);
    assert.notEqual(login.data.code, 'MFA_REQUIRED', 'a retired verifier must be rejected before opening an MFA challenge');
  }
  for (const extra of [{ otp: totp.codeForCounter(setup.data.secret, Math.floor(now() / totp.PERIOD_MS)) }, { recoveryCode: confirmed.data.recoveryCodes[0] }]) {
    const login = await f.client().request('/api/auth/login', { method: 'POST', body: { email: enabled.email, password: PASSWORD, ...extra } });
    assert.equal(login.status, 401, 'a valid factor cannot resurrect a retired login');
  }
  const confirmation = await pending.client.request('/api/auth/mfa/confirm', { method: 'POST', body: { otp: totp.codeForCounter(pendingSetup.data.secret, Math.floor(now() / totp.PERIOD_MS)) } });
  assert.equal(confirmation.status, 401, 'pending enrollment cannot be completed using a retired session');
  await assert.rejects(auth.authorize(staleUser, PASSWORD, { ip: 'retirement-fixture', purpose: 'payment' }), error => error.status === 403);
  assert.equal((await retained.session()).data.user.email, CASES[0].email, 'a retained industry session must remain valid');
  for (const sample of CASES) {
    const login = await f.client().login(sample.email, INDUSTRY_PASSWORD);
    assert.equal(login.data.user.email, sample.email);
  }
  await f.client().login('alex@greenlink.demo');
  assert.deepEqual((await snapshot(f.db)).user_mfa, after.user_mfa);
  assert.deepEqual((await snapshot(f.db)).mfa_recovery_codes, after.mfa_recovery_codes, 'failed retired logins must not consume a recovery code');
});

pgTest('Account retirement invalidates a correct password login already in flight before it creates a session', async t => {
  const f = await fixture(t);
  const user = (await f.db.query("SELECT * FROM users WHERE email='jamie@greenlink.demo'")).rows[0];
  const query = f.db.query;
  let intercepted = false;
  f.db.query = async (sql, values) => {
    const result = await query(sql, values);
    if (!intercepted && /^SELECT id,name,email,role,auth_version,password_hash FROM users WHERE lower\(email\)=/.test(sql)) {
      intercepted = true;
      await retireAccounts(f.db, [user.id], { apply: true });
    }
    return result;
  };
  t.after(() => { f.db.query = query; });
  const login = await f.client().request('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'Greenlink123!' } });
  assert.equal(intercepted, true);
  assert.equal(login.status, 401);
  assert.equal((await query('SELECT count(*)::integer AS count FROM sessions WHERE user_id=$1 AND revoked_at IS NULL', [user.id])).rows[0].count, 0);
  assert.equal((await query("SELECT count(*)::integer AS count FROM audit_log WHERE target_user_id=$1 AND event_type='auth.login.succeeded'", [user.id])).rows[0].count, 0);
});
