'use strict';

// Explicit local operator fixture. Never run during application startup or use
// an existing user's identity as a test account. Financial examples use the
// real banking modules, authorization, current rules and configured scorer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { createDatabase, createOperatorDatabase } = require('../database');
const security = require('../banking/security');
const auth = require('../banking/auth');
const business = require('../banking/business');
const ledger = require('../banking/ledger');
const workflows = require('../banking/workflows');
const totp = require('../banking/totp');
const { createRiskClient } = require('../banking/risk');
const FIXTURE = 'greenlink-feature-tour-v1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ACCOUNTS = Object.freeze([
  { key: 'business', name: 'Business Feature Tester', role: 'customer', status: 'approved', company: 'Feature Tour Trading Pte. Ltd.', number: '1088800101', funds: 4500000, purpose: 'Everyday business banking, payments, schedules, statements and assistant' },
  { key: 'recipient', name: 'Recipient Feature Tester', role: 'customer', status: 'approved', company: 'Feature Tour Supplier Pte. Ltd.', number: '1088800201', funds: 250000, purpose: 'Receive transfers and verify business/account isolation' },
  { key: 'pending', name: 'Pending Business Tester', role: 'customer', status: 'pending_review', company: 'Feature Tour Pending Pte. Ltd.', number: '1088800301', funds: 0, purpose: 'Pending onboarding and blocked financial actions' },
  { key: 'rejected', name: 'Rejected Business Tester', role: 'customer', status: 'rejected', company: 'Feature Tour Rejected Pte. Ltd.', number: '1088800401', funds: 0, purpose: 'Rejected application, review explanation and resubmission' },
  { key: 'profile', name: 'Missing Profile Tester', role: 'customer', status: null, number: '1088800501', funds: 0, purpose: 'Existing operator completing a missing registered-business profile' },
  { key: 'empty', name: 'Zero Balance Tester', role: 'customer', status: 'approved', company: 'Feature Tour New Business Pte. Ltd.', number: '1088800601', funds: 0, purpose: 'Zero balance, insufficient funds and failed scheduled instruction' },
  { key: 'staff', name: 'Bank Operations Tester', role: 'admin', status: null, purpose: 'Bank operations, business approvals, fraud rules and monitoring' },
  { key: 'reviewer', name: 'Independent Review Tester', role: 'admin', status: null, purpose: 'Independent approve/reject decisions and fraud-rule audit' },
  { key: 'maker', name: 'Payment Maker Tester', role: 'admin', status: 'approved', company: 'Feature Tour Treasury Pte. Ltd.', number: '1088800901', funds: 4000000, purpose: 'Administrator payment maker; own held payment cannot be self-approved' },
  { key: 'mfa', name: 'Authenticator Feature Tester', role: 'customer', status: 'approved', company: 'Feature Tour Secure Business Pte. Ltd.', number: '1088801001', funds: 100000, purpose: 'Authenticator login, recovery codes and profile security' },
].map((account, index) => Object.freeze({ ...account, email: `${account.key}-tester@greenlink.demo`, registration: `GLFTTEST${String(index + 1).padStart(4, '0')}` })));

async function originalSnapshot(db, ids = []) {
  return db.transaction(async client => ({
    users: (await client.query('SELECT * FROM users WHERE NOT(id=ANY($1::bigint[])) ORDER BY id', [ids])).rows,
    accounts: (await client.query('SELECT * FROM accounts WHERE NOT(user_id=ANY($1::bigint[])) ORDER BY id', [ids])).rows,
    transactions: (await client.query('SELECT t.* FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE NOT(a.user_id=ANY($1::bigint[])) ORDER BY t.id', [ids])).rows,
    businesses: (await client.query('SELECT * FROM businesses WHERE NOT(primary_user_id=ANY($1::bigint[])) ORDER BY id', [ids])).rows,
    mfa: (await client.query('SELECT * FROM user_mfa WHERE NOT(user_id=ANY($1::bigint[])) ORDER BY user_id', [ids])).rows,
    rules: (await client.query('SELECT * FROM fraud_rules ORDER BY id')).rows,
    settings: (await client.query('SELECT * FROM fraud_settings ORDER BY id')).rows,
  }), { isolation: 'REPEATABLE READ', readOnly: true });
}

async function assertSameTarget(owner, runtime) {
  const sql = 'SELECT current_database() AS database,current_schema() AS schema,inet_server_addr()::text AS address,inet_server_port() AS port';
  const [operator, application] = await Promise.all([owner.query(sql), runtime.query(sql)]);
  assert.deepEqual(operator.rows[0], application.rows[0], 'Operator and application connections must target the same local database/schema before any test data is written.');
  return operator.rows[0];
}

async function ensureAccounts(db, password, { now = Date.now } = {}) {
  security.password(password);
  const hashes = await Promise.all(ACCOUNTS.map(() => security.hashPassword(password)));
  return db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database()||current_schema()||':feature-accounts',0))");
    const marker = (await client.query("SELECT metadata FROM audit_log WHERE event_type='operator.feature_accounts_created' AND metadata->>'fixture'=$1 ORDER BY id LIMIT 1", [FIXTURE])).rows[0];
    if (marker) {
      const users = (await client.query('SELECT id,email,role FROM users WHERE id=ANY($1::bigint[]) ORDER BY id', [Object.values(marker.metadata.users)])).rows;
      assert.equal(users.length, ACCOUNTS.length, 'The saved feature fixture is incomplete; no account will be replaced.');
      for (const account of ACCOUNTS) assert.ok(users.some(user => String(user.id) === marker.metadata.users[account.key] && user.email === account.email && user.role === account.role), 'A test identity changed; review it explicitly instead of replacing it.');
      return { ...marker.metadata, created: false };
    }
    const collision = await client.query('SELECT email FROM users WHERE lower(email)=ANY($1::text[])', [ACCOUNTS.map(a => a.email)]);
    assert.equal(collision.rowCount, 0, 'A reserved test email already exists. Existing users are never adopted or replaced.');
    const numbers = ACCOUNTS.filter(a => a.number).map(a => a.number).concat('1088800102', '1088800103');
    assert.equal((await client.query('SELECT 1 FROM accounts WHERE number=ANY($1::text[])', [numbers])).rowCount, 0, 'A reserved sample account number already exists.');
    assert.equal((await client.query('SELECT 1 FROM businesses WHERE registration_number=ANY($1::text[])', [ACCOUNTS.map(a => a.registration)])).rowCount, 0, 'A reserved sample business registration already exists.');
    const manifest = { fixture: FIXTURE, users: {}, accounts: {}, businesses: {}, createdAt: new Date(now()).toISOString() };
    for (const [index, account] of ACCOUNTS.entries()) {
      const user = (await client.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', [account.name, account.email, hashes[index], account.role])).rows[0];
      manifest.users[account.key] = String(user.id);
      if (account.company) {
        const record = await business.create(client, user, { legalName: account.company, registrationNumber: account.registration, country: 'SG', legalForm: 'company', industry: 'Synthetic feature testing', registeredAddress: '1 Sample Business Avenue, Singapore 000001' }, { now });
        manifest.businesses[account.key] = record.id;
        await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'business.application_submitted',$2)", [user.id, { fixture: FIXTURE, businessId: record.id, synthetic: true }]);
      }
      if (account.number) {
        const record = (await client.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_provenance,created_at) VALUES($1,'Operating savings',$2,$3,'seed',$4) RETURNING id", [user.id, account.number, account.funds, new Date(now() - 60 * 86400000)])).rows[0];
        manifest.accounts[account.key] = String(record.id);
        if (account.funds) await credit(client, record.id, account.funds, 'Feature tour sample-funds deposit', now() - 45 * 86400000);
      }
    }
    const reserve = (await client.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_provenance,created_at) VALUES($1,'Liquidity reserve','1088800102',500000,'seed',$2) RETURNING id", [manifest.users.business, new Date(now() - 45 * 86400000)])).rows[0];
    manifest.accounts.reserve = String(reserve.id);
    await credit(client, reserve.id, 500000, 'Feature tour liquidity deposit', now() - 45 * 86400000);
    const closed = (await client.query("INSERT INTO accounts(user_id,name,number,status,opening_provenance) VALUES($1,'Closed feature-test account','1088800103','closed','seed') RETURNING id", [manifest.users.business])).rows[0];
    manifest.accounts.closed = String(closed.id);
    await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'account.closed',$2)", [manifest.users.business, {accountId: String(closed.id), fixture: FIXTURE, synthetic: true}]);
    await ledger.enqueue(client, { userId: manifest.users.business, type: 'feature.welcome', title: 'Feature tour is ready', message: 'Sample business accounts are available for the feature walkthrough.', metadata: { fixture: FIXTURE } });
    await client.query("INSERT INTO audit_log(event_type,metadata) VALUES('operator.feature_accounts_created',$1)", [manifest]);
    return { ...manifest, created: true };
  });
}
async function credit(client, accountId, cents, description, timestamp) {
  const date = new Date(timestamp);
  await client.query(`INSERT INTO transactions(id,account_id,type,description,amount_cents,counterparty,status,reference,created_at,requested_at,completed_at,settlement_seq)
    VALUES($1,$2,'credit',$3,$4,'Synthetic feature-test funds','completed','GLFT-SAMPLE-FUNDS',$5,$5,$5,nextval('settlement_sequence'))`, [randomUUID(), accountId, description, cents, date]);
}

async function seedExamples(db, manifest, password, riskClient, { now = Date.now } = {}) {
  const outcome = { payments: {}, schedules: {}, controls: [] };
  const user = async key => (await db.query('SELECT id,name,email,role,auth_version FROM users WHERE id=$1', [manifest.users[key]])).rows[0];
  // CLI-generated examples retain real password checks and quotas, in their own
  // internal-operation bucket so the user's browser quota is left available.
  const authorize = (database, actor, value, clock) => auth.authorize(database, actor, value, clock, { ip: 'feature-account-fixture', purpose: 'feature_walkthrough' });
  const options = { authorize, riskClient, now };
  async function once(key, work) {
    const previous = (await db.query("SELECT metadata->'result' AS result FROM audit_log WHERE event_type='operator.feature_example_created' AND metadata->>'fixture'=$1 AND metadata->>'step'=$2 ORDER BY id LIMIT 1", [FIXTURE, key])).rows[0];
    if (previous) return previous.result;
    const result = await work();
    await db.query("INSERT INTO audit_log(event_type,metadata) VALUES('operator.feature_example_created',$1)", [{ fixture: FIXTURE, step: key, result }]);
    return result;
  }
  const reviewer = await user('reviewer');
  for (const account of ACCOUNTS.filter(a => a.company && a.status !== 'pending_review')) {
    await once('onboarding-' + account.key, async () => {
      const application = await business.own(db, await user(account.key));
      if (application.status !== 'pending_review') return { id: application.id, status: application.status };
      const result = await business.review(db, reviewer, application.id, { decision: account.status === 'approved' ? 'approve' : 'reject', version: application.version,
        reason: account.status === 'approved' ? 'Synthetic feature fixture: sample business checks confirmed.' : 'Synthetic feature fixture: supporting business documents need correction.', verificationConfirmed: true, authorizationPassword: password }, options);
      return { id: result.id, status: result.status };
    });
  }
  async function payment(key, maker, amount, target, kind = 'transfer') {
    const result = await once(key, async () => ledger.submit(db, await user(maker), kind, { fromAccountId: manifest.accounts[maker], amount, requestId: FIXTURE + ':' + key,
      authorizationPassword: password, ...(kind === 'bill' ? { billerId: 'pub', reference: 'GLFT-BUSINESS-WATER' } : { toAccountNumber: target, description: 'Feature tour - ' + key }) }, options));
    outcome.payments[key] = { id: result.id, status: result.status, amountCents: result.amountCents, score: result.risk?.score, modelScore: result.risk?.modelScore };
    return result;
  }
  await payment('supplier-payment', 'business', '25.00', '1088800201');
  await payment('utility-bill', 'business', '30.00', null, 'bill');
  await payment('liquidity-transfer', 'business', '100.00', '1088800102');
  const approved = await payment('independently-approved', 'business', '2000.00', '1088801001');
  await once('approve-held', () => ledger.review(db, reviewer, approved.id, { decision: 'approve', reason: 'Feature tour: supplier invoice independently confirmed.', authorizationPassword: password }, options));
  outcome.payments['independently-approved'].status = 'completed';
  const rejected = await payment('independently-rejected', 'business', '1500.00', '1088800601');
  await once('reject-held', () => ledger.review(db, reviewer, rejected.id, { decision: 'reject', reason: 'Feature tour: sample supplier details could not be verified.', authorizationPassword: password }, options));
  outcome.payments['independently-rejected'].status = 'rejected';
  await payment('high-value-awaiting-review', 'business', '10000.00', '1088800201');
  await payment('daily-limit-blocked', 'business', '30000.00', '1088800201');
  const makerHeld = await payment('maker-awaiting-independent-review', 'maker', '2000.00', '1088800201');
  outcome.controls.push(await once('self-approval-denied', async () => {
    await assert.rejects(ledger.review(db, await user('maker'), makerHeld.id, { decision: 'approve', reason: 'Feature tour self-approval attempt.', authorizationPassword: password }, options), error => error.status === 403);
    return { case: 'Maker cannot self-approve', expectedHttpStatus: 403, passed: true };
  }));
  for (const [key, frequency, days] of [['once', 'once', 7], ['weekly', 'weekly', 14], ['monthly', 'monthly', 30], ['cancelled', 'once', 10]]) {
    const record = await once('schedule-' + key, async () => workflows.createSchedule(db, await user('business'), { type: 'bill', fromAccountId: manifest.accounts.business,
      amount: '12.50', billerId: 'pub', reference: 'GLFT-' + key.toUpperCase(), frequency, scheduledAt: new Date(now() + days * 86400000).toISOString(),
      requestId: FIXTURE + ':schedule-' + key, authorizationPassword: password }, options));
    if (key === 'cancelled') await once('cancel-schedule', async () => workflows.cancelSchedule(db, await user('business'), record.id, options));
    outcome.schedules[key] = { id: record.id, status: key === 'cancelled' ? 'cancelled' : record.status };
  }
  for (const [key, owner] of [['execute', 'business'], ['insufficient', 'empty']]) {
    const record = await once('schedule-' + key, async () => workflows.createSchedule(db, await user(owner), { type: 'bill', fromAccountId: manifest.accounts[owner],
      amount: '1.00', billerId: 'pub', reference: 'GLFT-' + key.toUpperCase(), frequency: 'once', scheduledAt: new Date(now() + 3000).toISOString(),
      requestId: FIXTURE + ':schedule-' + key, authorizationPassword: password }, options));
    outcome.schedules[key] = { id: record.id, status: record.status };
  }
  await workflows.dispatch(db);
  return outcome;
}

class Session {
  constructor(origin) { this.origin = origin; this.cookie = ''; this.csrf = ''; }
  async request(route, body, expected = 200) {
    const response = await fetch(new URL(route, this.origin), { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000),
      headers: { Cookie: this.cookie, Origin: this.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.getSetCookie()[0]) this.cookie = response.headers.getSetCookie()[0].split(';')[0];
    const result = await response.json();
    assert.equal(response.status, expected, `Unexpected response from ${route}: ${result.error || response.status}`);
    if (result.csrfToken) this.csrf = result.csrfToken;
    return result;
  }
  async login(email, password, extra = {}, expected = 200) {
    await this.request('/api/session'); return this.request('/api/auth/login', { email, password, ...extra }, expected);
  }
}

function savePrivate(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing a linked feature credential file.');
  const temporary = filename + '.' + randomBytes(5).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, filename);
}

async function prepareMfaAndVerify(db, manifest, credentials, filename, riskClient, encryptionKey, verificationOrigin, { agentModel } = {}) {
  // The live operator command talks to the already running restricted web
  // process. Only isolated integration tests construct an in-process server.
  let server, origin = verificationOrigin;
  if (!origin) {
    server = await require('../app').createApplication({ db, migrate: false, seed: false, backgroundJobs: false, riskClient, agentModel, publicOrigin: '', trustProxy: '', authEncryptionKey: encryptionKey });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port;
  }
  try {
    const mfaRow = (await db.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1', [manifest.users.mfa])).rows[0];
    if (!mfaRow?.enabled_at) {
      const session = new Session(origin); await session.login('mfa-tester@greenlink.demo', credentials.password);
      const setup = await session.request('/api/auth/mfa/setup', { currentPassword: credentials.password });
      credentials.mfa = { secret: setup.secret, otpauthUrl: setup.otpauthUrl, recoveryCodes: [] };
      savePrivate(filename, credentials);
      const confirmation = await session.request('/api/auth/mfa/confirm', { otp: totp.codeForCounter(setup.secret, Math.floor(Date.now() / totp.PERIOD_MS)) });
      credentials.mfa.recoveryCodes = confirmation.recoveryCodes;
      savePrivate(filename, credentials);
      await session.request('/api/auth/logout', {});
    }
    const verified = [];
    for (const account of ACCOUNTS.filter(a => a.key !== 'mfa')) {
      const session = new Session(origin); await session.login(account.email, credentials.password);
      verified.push(account.email);
      if (account.key === 'business') {
        await session.request('/api/fraud/rules', undefined, 403);
        await session.request('/api/transactions?accountId=' + manifest.accounts.recipient, undefined, 404);
        const assistant = await session.request('/api/assistant/messages', { message: 'What is my balance?' });
        assert.equal(assistant.engine, 'ollama');
        assert.ok(assistant.evidenceReferences?.some(e=>e.tool==='get_accounts'));
        assert.ok(assistant.items?.some(a=>a.amountCents!==undefined));
      }
      await session.request('/api/auth/logout', {});
    }
    const challenge = new Session(origin);
    const required = await challenge.login('mfa-tester@greenlink.demo', credentials.password, {}, 401);
    assert.equal(required.mfaRequired, true);
    const unused = [];
    for (const code of credentials.mfa?.recoveryCodes || []) {
      if ((await db.query('SELECT 1 FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL', [manifest.users.mfa, totp.recoveryHash(code, manifest.users.mfa)])).rowCount) unused.push(code);
    }
    if (unused.length) {
      await challenge.login('mfa-tester@greenlink.demo', credentials.password, { recoveryCode: unused[0] });
      credentials.mfa.recoveryCodes = unused.slice(1);
      await challenge.request('/api/auth/logout', {});
      verified.push('mfa-tester@greenlink.demo (recovery login)');
    }
    savePrivate(filename, credentials);
    return verified;
  } finally { if (server) { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await server.closeResources(); } }
}

async function waitForScheduledExamples(db, examples) {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const key of ['execute', 'insufficient']) {
      const row = (await db.query('SELECT status,last_error FROM scheduled_payments WHERE id=$1', [examples.schedules[key].id])).rows[0];
      examples.schedules[key].status = row.status;
      examples.schedules[key].error = row.last_error;
    }
    if (examples.schedules.execute.status !== 'active' && examples.schedules.insufficient.status !== 'active') return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function renderGuide(manifest, credentials, examples, verified) {
  const rows = ACCOUNTS.map(a => `| ${a.email} | ${a.role} | ${a.status || (a.key === 'profile' ? 'Missing profile' : 'Staff workspace')} | ${a.number || 'No deposit account'} | ${a.purpose} |`).join('\n');
  return `# Greenlink private feature-testing logins\n\nOpen ${credentials.origin}. These are dedicated synthetic test identities. Original users, passwords, accounts and fraud settings are preserved.\n\nInitial password for all ten new users: **${credentials.password}**\n\nChanged passwords, approvals, review decisions and balances are retained when setup is repeated.\n\n| Login email | Actual permission role | Business state | Operating account | Test purpose |\n| --- | --- | --- | --- | --- |\n${rows}\n\n## Feature walkthrough\n\nFollow docs/feature-testing.md for every screen and workflow. Use different browser profiles/private windows for maker and reviewer. Business operating account: 1088800101; reserve: 1088800102; recipient: 1088800201.\n\nPrepared payment outcomes:\n\n${Object.entries(examples.payments).map(([key,p])=>`- ${key}: ${p.status}, AI score ${p.modelScore}, combined score ${p.score}; receipt ${p.id}`).join('\n')}\n\nPrepared schedules:\n\n${Object.entries(examples.schedules).map(([key,s])=>`- ${key}: ${s.status}; instruction ${s.id}${s.error?' ('+s.error+')':''}`).join('\n')}\n\n## Authenticator account\n\nOnly mfa-tester@greenlink.demo requires a second factor initially. Add this account to your authenticator using the private secret **${credentials.mfa?.secret || 'See saved credentials'}**.\n\nAuthenticator URI: ${credentials.mfa?.otpauthUrl || ''}\n\nOr run npm run test:accounts:otp to obtain the current local test code. Codes cannot be reused; wait for the next 30-second slot after a successful code login.\n\nUnused initial recovery codes (one use each):\n\n${(credentials.mfa?.recoveryCodes || []).map(code=>'- '+code).join('\n')}\n\n## Verification\n\n${verified.length} sign-ins verified through real Express/PostgreSQL. MFA password-only sign-in was refused, recovery sign-in succeeded, customer administrator access and cross-business reads were refused, and assistant balance enquiry succeeded. The original-record fingerprint check passed. Sample financial writes were scored by the configured private Python service; original policy values were retained.\n\nThis file and feature-accounts.json contain private credentials and remain under ignored data/testing/.\n`;
}

async function main() {
  const origin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:3000');
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)) throw new Error('Feature fixtures are restricted to an explicit local development database and browser origin.');
  const directory = path.resolve(__dirname, '..', 'data', 'testing'), filename = path.join(directory, 'feature-accounts.json');
  const owner = createOperatorDatabase(), runtime = createDatabase();
  let lock;
  try {
    const target = await assertSameTarget(owner, runtime);
    await owner.migrate();
    lock = await owner.pool.connect();
    const held = (await lock.query("SELECT pg_try_advisory_lock(hashtextextended(current_database()||current_schema()||':feature-tour-run',0)) AS held")).rows[0].held;
    if (!held) throw new Error('Another feature-account setup is already running.');
    const identity = (await owner.query('SELECT current_database() AS database')).rows[0].database;
    let credentials;
    if (fs.existsSync(filename)) {
      if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing a linked feature credential file.');
      credentials = JSON.parse(fs.readFileSync(filename, 'utf8'));
      assert.equal(credentials.database, identity, 'Saved feature credentials belong to a different database.');
      if (credentials.target) assert.deepEqual(credentials.target, target, 'Saved feature credentials belong to a different PostgreSQL target.');
      else { credentials.target = target; savePrivate(filename, credentials); }
    } else {
      const exists = (await owner.query("SELECT 1 FROM audit_log WHERE event_type='operator.feature_accounts_created' AND metadata->>'fixture'=$1", [FIXTURE])).rowCount;
      if (exists) throw new Error('Feature identities already exist but their private credential file is missing. Existing passwords will not be reset.');
      credentials = { fixture: FIXTURE, database: identity, target, origin: origin.origin, password: 'GLTest-' + randomBytes(9).toString('base64url') + '!a1' };
      savePrivate(filename, credentials);
    }
    const previous = (await owner.query("SELECT metadata FROM audit_log WHERE event_type='operator.feature_accounts_created' AND metadata->>'fixture'=$1 LIMIT 1", [FIXTURE])).rows[0];
    const before = await originalSnapshot(owner, Object.values(previous?.metadata.users || {}));
    const manifest = await ensureAccounts(owner, credentials.password);
    const completed = (await owner.query("SELECT metadata FROM audit_log WHERE event_type='operator.feature_tour_ready' AND metadata->>'fixture'=$1 ORDER BY id DESC LIMIT 1", [FIXTURE])).rows[0];
    if (completed) {
      console.log(`Feature accounts already exist; no passwords, balances, reviews or MFA settings were reset.\nPrivate login guide: ${path.join(directory, 'FEATURE-TESTING.md')}`);
      return;
    }
    const riskClient = createRiskClient({ db: runtime });
    const examples = await seedExamples(runtime, manifest, credentials.password, riskClient);
    const verified = await prepareMfaAndVerify(runtime, manifest, credentials, filename, riskClient, process.env.AUTH_ENCRYPTION_KEY, origin.origin);
    await waitForScheduledExamples(runtime, examples);
    assert.equal(examples.schedules.execute.status, 'completed', 'Keep the native banking worker running, then rerun to finish the scheduled-payment example.');
    assert.equal(examples.schedules.insufficient.status, 'failed', 'The zero-balance scheduled example has not reached its expected final state; existing instructions will not be reset.');
    await workflows.dispatch(runtime);
    assert.equal(digest(await originalSnapshot(owner, Object.values(manifest.users))), digest(before), 'Original identities, MFA records, financial data or fraud settings changed.');
    const discrepancy = (await runtime.query(`SELECT a.id FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.status='completed'
      GROUP BY a.id HAVING a.balance_cents<>a.opening_balance_cents+COALESCE(sum(t.amount_cents),0)`)).rows;
    assert.equal(discrepancy.length, 0, 'A ledger balance does not reconcile.');
    savePrivate(path.join(directory, 'FEATURE-TESTING.md'), renderGuide(manifest, credentials, examples, verified));
    await owner.query("INSERT INTO audit_log(event_type,metadata) VALUES('operator.feature_tour_ready',$1)", [{ fixture: FIXTURE, users: manifest.users, examples, verifiedSignIns: verified.length,
      originalRecordsPreserved: true, originalFingerprint: digest(before) }]);
    console.table(ACCOUNTS.map(a => ({ email: a.email, role: a.role, business: a.status || 'none', account: a.number || 'staff only' })));
    console.log(`Created ${ACCOUNTS.length} test logins; ${verified.length} sign-ins verified. Original records and policy settings preserved.\nPrivate guide: ${path.join(directory, 'FEATURE-TESTING.md')}\nPassword: ${credentials.password}`);
  } finally {
    if (lock) { await lock.query('SELECT pg_advisory_unlock_all()').catch(() => {}); lock.release(); }
    await runtime.close(); await owner.close();
  }
}

async function printOtp() {
  const filename = path.resolve(__dirname, '..', 'data', 'testing', 'feature-accounts.json');
  const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!saved.mfa?.secret) throw new Error('Run test:accounts first to enroll the dedicated MFA tester.');
  const db = createDatabase();
  try {
    const row = (await db.query("SELECT m.last_counter,m.secret_encrypted,u.id FROM user_mfa m JOIN users u ON u.id=m.user_id WHERE u.email='mfa-tester@greenlink.demo' AND m.enabled_at IS NOT NULL")).rows[0];
    if (!row || totp.decryptSecret(row.secret_encrypted, process.env.AUTH_ENCRYPTION_KEY, row.id) !== saved.mfa.secret) throw new Error('The test authenticator was changed or disabled. Use its current enrolment instead of the saved fixture.');
    const counter = Math.floor(Date.now() / totp.PERIOD_MS), remaining = Math.ceil((totp.PERIOD_MS - Date.now() % totp.PERIOD_MS) / 1000);
    if (Number(row.last_counter) >= counter) console.log(`This 30-second code was already used. Request a fresh code in ${remaining} seconds, or use an unused recovery code from the private guide.`);
    else console.log(`MFA tester code: ${totp.codeForCounter(saved.mfa.secret, counter)} (valid for ${remaining} seconds; one use).`);
  } finally { await db.close(); }
}
module.exports = { ACCOUNTS, FIXTURE, ensureAccounts, seedExamples, originalSnapshot, assertSameTarget, prepareMfaAndVerify, renderGuide, Session };
if (require.main === module) {
  const args = process.argv.slice(2);
  (args.length === 0 ? main() : args.length === 1 && args[0] === '--otp' ? printOtp() : Promise.reject(new Error('Use test:accounts or test:accounts:otp.')))
    .catch(error => { console.error('Feature setup failed:', error.message); process.exitCode = 1; });
}
