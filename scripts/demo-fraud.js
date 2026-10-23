'use strict';

// Executable C300 demonstration: real Express, restricted PostgreSQL and Python.
// Customer records are read only to verify isolation; all writes use a newly
// generated disposable database. No scoring stub or external AI API is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { Client: PgClient } = require('pg');
const { createDatabase } = require('../database');
const { provision } = require('../database/setup');
const { identifier } = require('../database/permissions');
const { inspectDatabase } = require('../database/check');
const { seedDemo } = require('./seed-demo');
const { createStaff } = require('./create-staff');
const { createApplication } = require('../app');
const { createRiskClient } = require('../banking/risk');
const { childEnvironment, pythonExecutable } = require('./start-platform');
const { renderFraudReport } = require('./fraud-report');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'Greenlink123!';
const REVIEWER = 'fraud-reviewer@greenlink.demo';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
class Session {
  constructor(base, signal) { this.base = base; this.signal = signal; this.cookie = ''; this.csrf = ''; }
  async request(route, body, method = 'POST', expected = 200, csrf = true) {
    const response = await fetch(new URL(route, this.base), {
      method: body === undefined ? 'GET' : method, signal: AbortSignal.any([AbortSignal.timeout(20000), ...(this.signal ? [this.signal] : [])]),
      headers: { Cookie: this.cookie, Origin: new URL(this.base).origin, 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': this.csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(result)}`);
    if (result.csrfToken) this.csrf = result.csrfToken;
    return result;
  }
  async login(email) { await this.request('/api/session'); await this.request('/api/auth/login', { email, password: PASSWORD }); }
}
async function originalSnapshot(db) {
  // Do not snapshot sessions: the user's running app can legitimately refresh
  // those while the demonstration is in progress.
  return db.transaction(async client => ({
    accounts: (await client.query('SELECT id,balance_cents,status FROM accounts ORDER BY id')).rows,
    ledger: (await client.query('SELECT id,amount_cents,status,account_id FROM transactions ORDER BY id')).rows,
    rules: (await client.query('SELECT id,enabled,threshold,action FROM fraud_rules ORDER BY id')).rows,
    policy: (await client.query('SELECT version FROM fraud_settings')).rows,
  }), { isolation: 'REPEATABLE READ', readOnly: true });
}

async function runDemo({ serve = false, port = 3001, signal } = {}) {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || !process.env.DATABASE_URL) throw new Error('Configure the working application .env and a separate local TEST_DATABASE_URL in .env.test first.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) throw new Error('Fraud demonstrations require a local test PostgreSQL administrator.');
  if (serve && (!Number.isInteger(port) || port < 1024 || port > 65535 || port === Number(process.env.PORT || 3000))) throw new Error('DEMO_PORT must be a separate local port between 1024 and 65535.');
  const suffix = randomBytes(8).toString('hex');
  const databaseName = `greenlink_fraud_${suffix}`, ownerRole = `dft_fraud_owner_${suffix}`, appRole = `dft_fraud_app_${suffix}`;
  const output = path.join(ROOT, 'test-results', 'fraud-demo', suffix);
  fs.mkdirSync(output, { recursive: true });
  const original = createDatabase(), administrator = new PgClient({ connectionString: testUrl });
  let before, owner, db, server, python, pythonFailure, allowCleanup = false, cleaned = false, mainClosed = false;
  const token = randomBytes(32).toString('hex'), pythonPort = await unusedPort(), fraudUrl = `http://127.0.0.1:${pythonPort}`;
  const pythonHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function startPython() {
    pythonFailure = null;
    const log = fs.openSync(path.join(output, 'python.log'), 'a');
    try {
      python = spawn(pythonExecutable(), ['-B', 'main.py'], { cwd: ROOT, windowsHide: true, shell: false,
        env: childEnvironment({ ...process.env, SERVICE_TOKEN: token, FRAUD_HOST: '127.0.0.1', FRAUD_PORT: String(pythonPort), PYTHONDONTWRITEBYTECODE: '1' }, 'fraud'), stdio: ['ignore', log, log] });
      python.on('error', error => { pythonFailure = error; });
    } finally { fs.closeSync(log); }
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (pythonFailure) throw pythonFailure;
      if (python.exitCode !== null) throw new Error('Python scorer stopped. See the demonstration python.log.');
      try { if ((await fetch(fraudUrl + '/internal/health', { headers: pythonHeaders, signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await pause(100);
    }
    throw new Error('The private Python scorer did not become ready.');
  }
  async function stopPython() {
    if (python && python.exitCode === null && python.signalCode === null) {
      const exited = once(python, 'exit');
      python.kill('SIGTERM');
      const force = setTimeout(() => python.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(force); }
    }
  }
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      if (server) {
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        await server.closeResources();
      }
      await stopPython();
      if (db) await db.close();
      if (owner) await owner.close();
      if (allowCleanup) {
        assert.match(databaseName, /^greenlink_fraud_[a-f0-9]{16}$/);
        await administrator.query(`DROP DATABASE IF EXISTS ${identifier(databaseName)}`);
        for (const role of [appRole, ownerRole]) {
          assert.match(role, /^dft_fraud_(?:app|owner)_[a-f0-9]{16}$/);
          await administrator.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
        }
      }
    } finally { if (!mainClosed) await original.close(); await administrator.end(); }
  }
  try {
    before = await originalSnapshot(original);
    signal?.throwIfAborted();
    await administrator.connect();
    assert.equal((await administrator.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount, 0);
    assert.equal((await administrator.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])', [[ownerRole, appRole]])).rowCount, 0);
    allowCleanup = true;
    const provisioned = await provision({ adminUrl: testUrl, databaseName, ownerRole, appRole });
    signal?.throwIfAborted();
    owner = createDatabase({ connectionString: provisioned.ownerUrl });
    db = createDatabase({ connectionString: provisioned.appUrl });
    await seedDemo(owner);
    await createStaff({ db: owner, email: REVIEWER, name: 'Fraud Operations Reviewer', password: PASSWORD });
    await startPython();
    const publicPort = serve ? port : await unusedPort(), base = `http://127.0.0.1:${publicPort}`;
    server = await createApplication({ db, seed: false, publicOrigin: base, trustProxy: '', backgroundJobs: serve, authEncryptionKey: randomBytes(32).toString('hex'), riskClient: createRiskClient({ db, url: fraudUrl, token }) });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(publicPort, '127.0.0.1', resolve); });
    const alex = new Session(base, signal), jamie = new Session(base, signal), policyAdmin = new Session(base, signal), reviewer = new Session(base, signal);
    await alex.login('alex@greenlink.demo'); await jamie.login('jamie@greenlink.demo');
    await policyAdmin.login('reviewer@greenlink.demo'); await reviewer.login(REVIEWER);
    const model = (await policyAdmin.request('/api/fraud/model')).model;
    const report = { title: 'GLDB fraud rule management and AI scoring demonstration', generatedAt: new Date().toISOString(), synthetic: true,
      application: { base, isolatedDatabase: databaseName, runtimeRole: appRole, keptRunning: serve },
      model: { version: model.version, training: model.training, reviewThreshold: 65, maximumModelScore: 94 },
      modelExamples: [], payments: [], controls: [], ruleAudit: [], assertions: [] };
    const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); report.assertions.push({ name, passed: true }); };
    const control = (name, result, expectedStatus, detail) => report.controls.push({ name, httpStatus: expectedStatus, error: result.error || null, detail });
    const balance = async (client, id) => (await client.request('/api/dashboard')).accounts.find(account => account.id === id).balanceCents;
    const sender = (await alex.request('/api/dashboard')).accounts.find(account => account.number === '1020001001');
    const recipient = (await jamie.request('/api/dashboard')).accounts[0];
    const initialRules = await policyAdmin.request('/api/fraud/rules');
    report.initialRules = initialRules;
    async function setRule(id, patch) {
      const current = await policyAdmin.request('/api/fraud/rules');
      return policyAdmin.request('/api/fraud/rules/' + id, { ...patch, version: current.version, authorizationPassword: PASSWORD }, 'PATCH');
    }
    async function payment(client, source, number, amount, description) {
      const body = { fromAccountId: source.id, toAccountNumber: number, amount, description, requestId: randomUUID(), authorizationPassword: PASSWORD };
      const oldBalance = await balance(client, source.id);
      const { transaction } = await client.request('/api/transfers', body);
      const newBalance = await balance(client, source.id);
      const row = { scenario: description, transactionId: transaction.id, amountSgd: Number(amount), initialStatus: transaction.status,
        finalStatus: transaction.status, modelScore: transaction.risk.modelScore, combinedScore: transaction.risk.score, decision: transaction.risk.decision,
        ruleVersion: transaction.risk.ruleVersion, matchedRules: [...new Set(transaction.risk.reasons.filter(reason => reason.ruleId).map(reason => reason.ruleId))],
        reasons: transaction.risk.reasons, modelContext: transaction.risk.context, balanceBeforeCents: oldBalance, balanceAfterSubmissionCents: newBalance,
        debitAtSubmissionCents: oldBalance - newBalance };
      report.payments.push(row);
      check(`${description}: held/rejected instructions never debit`, oldBalance - newBalance, transaction.status === 'completed' ? Math.round(Number(amount) * 100) : 0);
      return { transaction, row, body };
    }
    // Actual Python inference over labelled illustrative history inputs. These
    // three probes are explicitly separate from real ledger-derived payments.
    const baseInput = { userId: 'synthetic-demo', sourceAccountId: 'illustrative-history', payloadHash: 'a'.repeat(64), type: 'transfer', amountCents: 500000, accountBalanceCents: 5000000, payee: 'illustrative-supplier', isInternal: false, createdAt: '2026-10-24T04:00:00.000Z' };
    const probes = [
      ['Usual supplier and typical payment', { averageOutgoingCents: 500000, outgoingCount10m: 0, outgoingAmount10m: 0, dailyOutgoingCents: 0, historyCount: 40, knownPayee: true }, {}],
      ['Same amount, 100 times historical average', { averageOutgoingCents: 5000, outgoingCount10m: 0, outgoingAmount10m: 0, dailyOutgoingCents: 0, historyCount: 40, knownPayee: true }, {}],
      ['Unfamiliar recipient, rapid activity and unusual hour', { averageOutgoingCents: 5000, outgoingCount10m: 7, outgoingAmount10m: 70000, dailyOutgoingCents: 70000, historyCount: 40, knownPayee: false }, { accountBalanceCents: 600000, createdAt: '2026-10-23T19:00:00.000Z' }],
    ];
    for (const [scenario, historySummary, patch] of probes) {
      const input = { ...baseInput, ...patch, transactionId: randomUUID(), historySummary };
      const response = await fetch(fraudUrl + '/internal/assess', { method: 'POST', headers: pythonHeaders, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) });
      check(`${scenario}: real Python response`, response.status, 200);
      const risk = (await response.json()).risk;
      report.modelExamples.push({ scenario, input, score: risk.score, decision: risk.decision, features: risk.features, reasons: risk.reasons, modelVersion: risk.modelVersion, modelSha256: risk.modelSha256 });
    }
    check('Changing historical behaviour changes the AI score', report.modelExamples[1].score > report.modelExamples[0].score);
    check('Combined suspicious pattern exceeds AI review threshold', report.modelExamples[2].score >= 65);
    check('Unauthenticated private scoring is refused', (await fetch(fraudUrl + '/internal/health')).status, 401);
    const denied = await jamie.request('/api/fraud/rules/high_value', { version: initialRules.version, threshold: 1, authorizationPassword: PASSWORD }, 'PATCH', 403);
    control('Business operator cannot edit fraud rules', denied, 403, 'Role-based authorization is enforced by the API.');
    const normal = await payment(alex, sender, recipient.number, '100.00', '01 - Normal supplier payment');
    check('Normal payment completes', normal.transaction.status, 'completed');
    const newPayee = await payment(alex, sender, '1020009001', '2000.00', '02 - First large payment to a new business');
    check('New-payee rule holds the payment', newPayee.row.matchedRules.includes('new_payee'));
    check('New-payee lifecycle is pending review', newPayee.transaction.status, 'pending_review');
    await setRule('high_value', { threshold: 50, action: 'review' });
    const stale = await policyAdmin.request('/api/fraud/rules/high_value', { version: initialRules.version, threshold: 40, authorizationPassword: PASSWORD }, 'PATCH', 409);
    control('Stale policy version is refused', stale, 409, 'A concurrent editor must reload the current policy before saving.');
    const ruleHeld = await payment(alex, sender, recipient.number, '75.00', '03 - Review rule at SGD 50');
    check('Configured review rule raises a low AI score', ruleHeld.row.modelScore < 65 && ruleHeld.row.combinedScore >= 70 && ruleHeld.transaction.status === 'pending_review');
    await setRule('high_value', { action: 'block' });
    const blocked = await payment(alex, sender, recipient.number, '75.00', '04 - Same amount with blocking rule');
    check('Blocking rule rejects without debit', blocked.transaction.status, 'rejected');
    check('Blocking rule assigns final score 95', blocked.row.combinedScore, 95);
    await setRule('high_value', { threshold: 10000, action: 'review' });
    await setRule('high_value', { enabled: false });
    await setRule('new_payee', { enabled: false });
    const aiOnly = await payment(alex, sender, '1020009001', '20000.00', '05 - AI-only historical anomaly');
    check('AI can hold a payment without any matched rule', aiOnly.row.matchedRules.length === 0 && aiOnly.row.modelScore >= 65 && aiOnly.transaction.status === 'pending_review');
    const ownReview = await alex.request('/api/fraud/reviews/' + ruleHeld.transaction.id, { decision: 'approve', reason: 'Simulation of an invalid self-approval.', authorizationPassword: PASSWORD }, 'POST', 403);
    control('Maker cannot approve their own held payment', ownReview, 403, 'Independent review is required even when the maker has demo administrator access.');
    const beforeApproval = await balance(alex, sender.id);
    const approved = await reviewer.request('/api/fraud/reviews/' + ruleHeld.transaction.id, { decision: 'approve', reason: 'Simulation: supplier invoice and payment purpose independently verified.', authorizationPassword: PASSWORD });
    ruleHeld.row.finalStatus = approved.transaction.status;
    ruleHeld.row.review = { decision: 'approve', reviewer: 'Fraud Operations Reviewer', debitOnReviewCents: beforeApproval - await balance(alex, sender.id) };
    check('Independent approval settles exactly once', ruleHeld.row.review.debitOnReviewCents, 7500);
    const rejected = await reviewer.request('/api/fraud/reviews/' + newPayee.transaction.id, { decision: 'reject', reason: 'Simulation: the unfamiliar supplier invoice could not be verified.', authorizationPassword: PASSWORD });
    newPayee.row.finalStatus = rejected.transaction.status;
    newPayee.row.review = { decision: 'reject', reviewer: 'Fraud Operations Reviewer' };
    check('Independent rejection keeps the payment rejected', rejected.transaction.status, 'rejected');
    await setRule('high_value', { enabled: true });
    await setRule('new_payee', { enabled: true });
    const finalRules = await policyAdmin.request('/api/fraud/rules');
    check('All demonstration rule settings are restored', finalRules.rules, initialRules.rules);
    const beforeReplay = await balance(alex, sender.id);
    const replay = await alex.request('/api/transfers', normal.body);
    check('Request replay returns the same receipt', replay.transaction.id, normal.transaction.id);
    check('Request replay never debits twice', await balance(alex, sender.id), beforeReplay);
    control('Same payment request is safely replayed', {}, 200, 'The original receipt is returned with no second debit.');
    for (let index = 1; index <= 6; index++) {
      const rapid = await payment(jamie, recipient, sender.number, '1.25', `06.${index} - Rapid payment ${index} of 6`);
      check(`Rapid payment ${index} lifecycle`, rapid.transaction.status, index <= 5 ? 'completed' : 'pending_review');
      if (index === 6) check('Sixth request matches velocity rule', rapid.row.matchedRules.includes('velocity'));
    }
    const beforeFailure = await balance(jamie, recipient.id), ledgerCount = Number((await db.query('SELECT count(*) FROM transactions')).rows[0].count);
    await stopPython();
    const unavailable = await jamie.request('/api/transfers', { fromAccountId: recipient.id, toAccountNumber: sender.number, amount: '1.25', description: '07 - Scorer unavailable', requestId: randomUUID(), authorizationPassword: PASSWORD }, 'POST', 503);
    check('Model outage leaves the balance intact', await balance(jamie, recipient.id), beforeFailure);
    check('Model outage creates no financial ledger row', Number((await db.query('SELECT count(*) FROM transactions')).rows[0].count), ledgerCount);
    control('Unavailable AI screening fails closed', unavailable, 503, 'No debit or financial ledger entry; no JavaScript fallback. Only this demonstration scorer was stopped.');
    await startPython();
    await server.runJobs();
    report.ruleAudit = (await policyAdmin.request('/api/fraud/rules/audit?pageSize=100')).entries;
    check('Every successful rule change is audited', report.ruleAudit.length, 7);
    report.finalPolicyVersion = finalRules.version;
    report.pendingReviews = (await reviewer.request('/api/fraud/reviews')).reviews.map(row => ({ id: row.id, description: row.description, amountCents: row.amountCents, score: row.risk.score }));
    report.databaseCheck = await inspectDatabase(db);
    check('Restricted role and every ledger balance reconcile', report.databaseCheck.ready);
    report.notificationsDelivered = Number((await db.query('SELECT count(*) FROM notifications')).rows[0].count);
    check('Transaction/review notifications were delivered', report.notificationsDelivered > 0);
    const after = await originalSnapshot(original);
    check('Existing application accounts, balances, history and rules are unchanged', after, before);
    report.originalApplication = { financialDataUnchanged: true, beforeSha256: digest(before), afterSha256: digest(after), accounts: before.accounts.length, ledgerEntries: before.ledger.length };
    report.outcome = 'passed';
    const jsonPath = path.join(output, 'report.json'), htmlPath = path.join(output, 'report.html');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(htmlPath, renderFraudReport(report));
    await original.close(); mainClosed = true;
    console.table(report.payments.map(row => ({ example: row.scenario, amount: row.amountSgd, AI: row.modelScore, finalScore: row.combinedScore, submitted: row.initialStatus, finalStatus: row.finalStatus, rules: row.matchedRules.join(', ') || 'none', debit: row.debitAtSubmissionCents / 100 })));
    console.log(`Passed ${report.assertions.length} assertions. Original application financial data unchanged.`);
    console.log(`Report: ${htmlPath}\nJSON evidence: ${jsonPath}`);
    if (serve) console.log(`\nFraud demo: ${base}\nIndependent reviewer: ${REVIEWER} / ${PASSWORD}\nBusiness sender: alex@greenlink.demo / ${PASSWORD}\nRecipient: jamie@greenlink.demo / ${PASSWORD}\nOpen Fraud monitoring, Fraud rules and rule history. Two examples remain pending for your review.\nCtrl+C closes only the demonstration and removes its disposable database/roles.`);
    return { report, htmlPath, jsonPath, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
module.exports = { runDemo };
if (require.main === module) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  (async () => {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--serve') || args.length > 1) throw new Error('Usage: npm run demo:fraud, or node --env-file=.env --env-file=.env.test scripts/demo-fraud.js --serve');
    const result = await runDemo({ serve: args.includes('--serve'), port: Number(process.env.DEMO_PORT || 3001), signal: controller.signal });
    try {
      if (args.includes('--serve') && !controller.signal.aborted) await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
    } finally { await result.cleanup(); }
  })().catch(error => {
    if (controller.signal.aborted && error.name === 'AbortError') console.log('Fraud demonstration stopped; disposable resources cleaned up.');
    else { console.error(`Fraud demonstration failed: ${error.message}`); process.exitCode = 1; }
  }).finally(() => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
}
