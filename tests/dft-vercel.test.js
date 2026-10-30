'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createHostedApplication, configuration } = require('../deploy/vercel');
const { fraudServiceUrl, createRiskClient } = require('../banking/risk');
const { fixture, Client, MODEL_INFO, modelStub } = require('./dft-helpers');

const CRON = 'controlled-vercel-cron-secret-1234567890';
const TOKEN = 'controlled-vercel-service-token-123456';
const environment = extra => ({ DATABASE_URL: 'postgresql://test:test@localhost/test', AUTH_ENCRYPTION_KEY: 'a'.repeat(64), SERVICE_TOKEN: TOKEN, CRON_SECRET: CRON, FRAUD_SERVICE_BINDING_URL: 'https://fraud.internal.example/bound/', PUBLIC_ORIGIN: 'https://bank.example', VERCEL_ENV: 'production', ...extra });
async function listen(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}

test('Vercel binding overrides local discovery and retains its internal path prefix', () => {
  assert.equal(new URL('internal/model', fraudServiceUrl({ url: 'http://127.0.0.1:4011', bindingUrl: 'https://fraud.internal.example/base' })).href, 'https://fraud.internal.example/base/internal/model');
  assert.equal(fraudServiceUrl({ url: 'http://fraud:4011', bindingUrl: '' }).href, 'http://fraud:4011/');
  for (const bindingUrl of ['ftp://fraud.example', 'https://user:secret@fraud.example', 'https://fraud.example/?token=secret', 'https://fraud.example/#fragment']) assert.throws(() => fraudServiceUrl({ bindingUrl }));
  for (const url of ['https://public.example', 'http://public.example', 'http://localhost:4011/other']) assert.throws(() => fraudServiceUrl({ url, bindingUrl: '' }));
});

test('Bound model calls preserve paths, bearer authentication and assessment validation', async t => {
  const received = [];
  const scorer = express(); scorer.use(express.json());
  scorer.use((req, _res, next) => { assert.equal(req.get('authorization'), 'Bearer ' + TOKEN); received.push(req.path); next(); });
  scorer.get('/bound/internal/model', (_req, res) => res.json({ ok: true, model: MODEL_INFO }));
  scorer.post('/bound/internal/assess', async (req, res) => res.json({ ok: true, risk: await modelStub(20)(req.body) }));
  const base = await listen(t, scorer);
  const risk = createRiskClient({ db: { transaction() {}, query() {} }, bindingUrl: base + '/bound', token: TOKEN });
  assert.deepEqual(await risk.getModelInfo(), MODEL_INFO);
  const input = { transactionId: 'bound-test', userId: '1', sourceAccountId: '1', payloadHash: 'a'.repeat(64), type: 'transfer', amountCents: 100, accountBalanceCents: 10000, payee: '100000001', isInternal: false, createdAt: '2026-10-29T00:00:00.000Z', historySummary: { dailyOutgoingCents: 0, outgoingCount10m: 0, outgoingAmount10m: 0, historyCount: 0, averageOutgoingCents: 0, knownPayee: false } };
  assert.equal((await risk.analyze(input)).score, 20);
  assert.deepEqual(received, ['/bound/internal/model', '/bound/internal/assess']);
  scorer.post('/invalid/internal/assess', (_req, res) => res.json({ ok: true, risk: { score: 0 } }));
  const invalid = createRiskClient({ db: { transaction() {}, query() {} }, bindingUrl: base + '/invalid', token: TOKEN });
  await assert.rejects(invalid.analyze(input), error => error.status === 503);
});

test('Hosted configuration requires persistent secrets and runtime binding with fixed HTTPS origin', () => {
  assert.equal(configuration(environment()).publicOrigin, 'https://bank.example');
  for (const extra of [{ DATABASE_URL: '' }, { AUTH_ENCRYPTION_KEY: 'short' }, { SERVICE_TOKEN: '' }, { FRAUD_SERVICE_BINDING_URL: '' }, { PUBLIC_ORIGIN: 'http://bank.example' }, { PUBLIC_ORIGIN: 'https://bank.example/path' }]) assert.throws(() => configuration(environment(extra)));
  assert.equal(configuration(environment({ PUBLIC_ORIGIN: '', VERCEL_ENV: 'preview', VERCEL_URL: 'preview.example' })).publicOrigin, 'https://preview.example');
  assert.equal(configuration(environment({ PUBLIC_ORIGIN: '', VERCEL_PROJECT_PRODUCTION_URL: 'production.example' })).publicOrigin, 'https://production.example');
  assert.equal(configuration(environment({ PUBLIC_ORIGIN: 'http://localhost:3000', VERCEL_ENV: 'development' })).publicOrigin, 'http://localhost:3000');
});

test('Import and unauthorized job requests never initialize services or run jobs', async t => {
  let initialized = 0;
  const app = createHostedApplication({ environment: environment(), databaseFactory() { initialized++; throw Error('Must not initialize'); } });
  assert.equal(initialized, 0);
  const base = await listen(t, app);
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer ' + TOKEN]) {
    const response = await fetch(base + '/api/jobs/run', { headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(base + '/api/jobs/run', { method: 'POST', headers: { Authorization: 'Bearer ' + CRON } })).status, 405);
  assert.equal((await fetch(base + '/api/jobs/run', { method: 'HEAD', headers: { Authorization: 'Bearer ' + CRON } })).status, 405);
  await new Promise((resolve, reject) => { const req = http.get(base + '/api/jobs/run', { headers: { Authorization: ['Bearer ' + CRON, 'Bearer other'] } }, res => { assert.equal(res.statusCode, 401); res.resume(); res.on('end', resolve); }); req.on('error', reject); });
  assert.equal(initialized, 0);
});

test('Cold concurrent requests initialize once and authenticated jobs await durable work', async t => {
  let initialized = 0, jobs = 0, closed = 0, attached = 0;
  const inner = express(); inner.get('/health', (_req, res) => res.json({ ok: true }));
  const app = createHostedApplication({ environment: environment(), databaseFactory(options) { initialized++; assert.equal(options.poolOptions.max, 5); return { pool: {}, query() {}, transaction() {}, close: async () => { closed++; } }; }, attachPool() { attached++; }, applicationFactory: async options => { assert.equal(options.backgroundJobs, false); assert.equal(options.seed, false); await new Promise(resolve => setTimeout(resolve, 20)); return { app: inner, runJobs: async () => { await new Promise(resolve => setTimeout(resolve, 20)); jobs++; return { schedulesProcessed: 1 }; }, closeResources: async () => {} }; } });
  const base = await listen(t, app);
  const responses = await Promise.all(Array.from({ length: 6 }, () => fetch(base + '/health')));
  assert.ok(responses.every(response => response.status === 200)); assert.equal(initialized, 1); assert.equal(attached, 1);
  const result = await fetch(base + '/api/jobs/run', { headers: { Authorization: 'Bearer ' + CRON } });
  assert.equal(result.status, 200); assert.equal((await result.json()).schedulesProcessed, 1); assert.equal(jobs, 1);
  await app.closeResources(); assert.equal(closed, 1);
});

test('Failed cold starts release their pool, redact errors and allow a later retry', async t => {
  let attempts = 0, closed = 0;
  const app = createHostedApplication({ environment: environment(), databaseFactory() { return { pool: {}, query() {}, transaction() {}, close: async () => { closed++; } }; }, attachPool() {}, applicationFactory: async () => { if (++attempts === 1) throw Error('private-connection-details'); const inner = express(); inner.get('/health', (_req, res) => res.json({ ok: true })); return { app: inner, closeResources: async () => {} }; } });
  const base = await listen(t, app);
  const failed = await fetch(base + '/health'); assert.equal(failed.status, 503); assert.equal((await failed.text()).includes('private-connection-details'), false); assert.equal(closed, 1);
  assert.equal((await fetch(base + '/health')).status, 200); assert.equal(attempts, 2);
  await app.closeResources(); assert.equal(closed, 2);
});

test('Hosted routing retains login, banking authorization, private endpoint isolation and secure session cookies', async t => {
  const f = await fixture(t, { http: false });
  const { createApplication } = require('../app');
  const app = createHostedApplication({ environment: environment(), databaseFactory: () => f.db, attachPool() {}, applicationFactory: options => createApplication({ ...options, migrate: false, riskClient: f.riskClient, agentModel: f.agentModel }) });
  const base = await listen(t, app), client = new Client(() => base);
  assert.equal((await fetch(base + '/login')).status, 200);
  assert.equal((await client.request('/api/dashboard')).status, 401);
  for (const route of ['/internal/health', '/internal/assess', '/data/testing/neon/feature-accounts.json']) assert.equal((await fetch(base + route)).status, 404);
  const session = await client.session(); assert.match(session.headers.get('set-cookie'), /; Secure/);
  const wrong = await client.request('/api/auth/login', { method: 'POST', headers: { Origin: 'https://other.example' }, body: { email: 'alex@greenlink.demo', password: 'Greenlink123!' } }); assert.equal(wrong.status, 403);
  await client.login(); assert.equal((await client.dashboard()).user.email, 'alex@greenlink.demo');
  assert.equal((await client.request('/api/fraud/model')).status, 200);
  const jobs = await fetch(base + '/api/jobs/run', { headers: { Authorization: 'Bearer ' + CRON } }); assert.equal(jobs.status, 200); assert.equal((await jobs.json()).ok, true);
});

test('Root Express export remains callable with the native application factories', () => {
  const entry = require('../app');
  assert.equal(typeof entry, 'function'); assert.equal(typeof entry.use, 'function');
  assert.equal(typeof entry.createApplication, 'function'); assert.equal(typeof entry.trustProxy, 'function');
});

test('Only hosted Vercel requests use the platform client address; local forwarded headers stay untrusted', async t => {
  for (const hosted of [false, true]) {
    const inner = express(); inner.get('/address', (req, res) => res.json({ address: req.ip }));
    const app = createHostedApplication({ environment: environment({ VERCEL: hosted ? '1' : undefined }), databaseFactory: () => ({ pool: {}, query() {}, transaction() {}, close: async () => {} }), attachPool() {}, applicationFactory: async () => ({ app: inner, closeResources: async () => {} }) });
    const base = await listen(t, app);
    const r = await fetch(base + '/address', { headers: { 'X-Real-IP': '203.0.113.9', 'X-Forwarded-For': '198.51.100.7' } });
    assert.equal((await r.json()).address, hosted ? '203.0.113.9' : '127.0.0.1');
    await app.closeResources();
  }
});


test('Hosted and native entries load a shared factory without a module dependency cycle', async t => {
  const rootEntry = require('../app');
  const base = await listen(t, rootEntry);
  assert.equal((await fetch(base + '/api/jobs/run')).status, 401);
  const entries = ['../app', '../application', '../deploy/vercel'].map(name => require.resolve(name));
  const visited = new Set(), active = new Set();
  function visit(filename) {
    assert.equal(active.has(filename), false, 'A hosted entry must not import itself through another module.');
    if (visited.has(filename)) return;
    active.add(filename);
    for (const child of require.cache[filename].children) if (entries.includes(child.filename)) visit(child.filename);
    active.delete(filename); visited.add(filename);
  }
  for (const filename of entries) visit(filename);
  assert.equal(rootEntry.createApplication, require('../application').createApplication);
});

test('Default hosted application factory reaches PostgreSQL and renders the website', async t => {
  const f = await fixture(t, { http: false });
  const app = createHostedApplication({ environment: environment(), databaseFactory: () => ({ ...f.db, close: async () => {} }), attachPool() {} });
  t.after(() => app.closeResources());
  const base = await listen(t, app);
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200); assert.equal((await health.json()).database, 'postgresql');
  const login = await fetch(base + '/login');
  assert.equal(login.status, 200); assert.match(login.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(base + '/application.js')).status, 404);
});

test('Hosted startup logs identify invalid settings without revealing their values or changing public errors', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const secret = 'PRIVATE-startup-value-that-must-never-appear';
  const cases = [
    ['DATABASE_URL', secret], ['AUTH_ENCRYPTION_KEY', secret], ['SERVICE_TOKEN', secret + '!'],
    ['FRAUD_SERVICE_BINDING_URL', 'https://user:' + secret + '@fraud.example'],
    ['PUBLIC_ORIGIN', 'https://user:' + secret + '@bank.example']
  ];
  for (const [setting, value] of cases) {
    let initialized = false;
    const app = createHostedApplication({ environment: environment({ [setting]: value }), databaseFactory() { initialized = true; throw Error('Must not initialize'); } });
    const base = await listen(t, app), response = await fetch(base + '/');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'The banking service is temporarily unavailable. Please try again.' });
    assert.equal(initialized, false);
    assert.match(log.mock.calls.at(-1).arguments.join(' '), new RegExp('CONFIGURATION_' + setting + ':'));
  }
  assert.equal(JSON.stringify(log.mock.calls).includes(secret), false);
});

test('Hosted driver and migration failures log only allowlisted diagnostic codes and fixed guidance', async t => {
  const log = t.mock.method(console, 'error', () => {});
  const secret = 'PRIVATE-database-password-and-hostname';
  for (const code of ['28P01', '42501', 'MIGRATION_REQUIRED', 'MIGRATION_CHANGED', 'ENOENT', secret]) {
    let closed = false;
    const app = createHostedApplication({ environment: environment(), attachPool() {}, databaseFactory: () => ({ pool: {}, query() {}, transaction() {}, close: async () => { closed = true; } }), applicationFactory: async () => { throw Object.assign(new Error(secret), { code }); } });
    const base = await listen(t, app), response = await fetch(base + '/health');
    assert.equal(response.status, 503); assert.equal(closed, true);
    assert.equal((await response.text()).includes(secret), false);
    assert.match(log.mock.calls.at(-1).arguments.join(' '), new RegExp(code === secret ? 'BANKING_STARTUP_FAILED:' : code + ':'));
  }
  assert.equal(JSON.stringify(log.mock.calls).includes(secret), false);
});
