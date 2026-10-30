'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { Session } = require('./feature-accounts');
const { normalizeOrigin } = require('../banking/security');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function verify({ origin = process.env.VERCEL_TEST_ORIGIN || 'http://localhost:3300', accounts = null } = {}) {
  origin = normalizeOrigin(origin);
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('Use an HTTP loopback VERCEL_TEST_ORIGIN for local verification.');
  const checks = [];
  async function request(route, status, { asset = null, method = 'GET' } = {}) {
    const response = await fetch(new URL(route, origin), { method, signal: AbortSignal.timeout(15000), redirect: 'error' });
    assert.equal(response.status, status, method + ' ' + route + ' returned an unexpected status.');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route + ' must have nosniff protection.');
    if (asset) {
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(fs.readFileSync(asset)), route + ' must serve its public asset, never the backend entrypoint.');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    } else await response.body?.cancel();
    checks.push({ method, route, status });
  }
  await request('/health', 200);
  await request('/login', 200);
  function assets(directory, prefix = '') {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const filename = path.join(directory, entry.name), route = prefix + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Do not verify linked public assets.');
      return entry.isDirectory() ? assets(filename, route) : [{ filename, route }];
    });
  }
  const publicFiles = assets(path.join(root, 'public'));
  for (const asset of publicFiles) await request(asset.route, 200, { asset: asset.filename });
  for (const route of ['/banking/risk.js', '/database/index.js', '/deploy/vercel.js', '/scripts/feature-accounts.js', '/views/index.html', '/main.py', '/requirements.txt', '/package.json', '/vercel.json', '/.env', '/.env.database-admin', '/data/testing/neon/feature-accounts.json', '/public/app.js', '/internal/health', '/internal/model', '/internal/assess', '/fraud/internal/health']) {
    await request(route, 404);
    await request(route, 404, { method: 'HEAD' });
  }
  await request('/api/dashboard', 401);
  await request('/api/jobs/run', 401);
  await request('/api/jobs/run', 405, { method: 'POST' });
  // No cron invocation is authorized here: verification must not execute due payments.
  const missingHostStatus = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname.replace(/^\[|\]$/g, ''), port: parsed.port || 80, path: '/banking/risk.js', setHost: false }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Missing-host request timed out.')));
  });
  assert.ok([400, 404].includes(missingHostStatus), 'A missing Host header must never expose source files.');
  let binding = 'not_requested';
  if (accounts) {
    assert.ok(['native', 'neon'].includes(accounts));
    const filename = path.join(root, 'data', 'testing', ...(accounts === 'neon' ? ['neon'] : []), 'feature-accounts.json');
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    assert.equal(saved.fixture, 'greenlink-feature-tour-v1', 'Use only the dedicated synthetic test fixture.');
    const session = new Session(origin);
    await session.login('staff-tester@greenlink.demo', saved.password);
    try {
      await session.request('/api/dashboard');
      const result = await session.request('/api/fraud/model');
      assert.equal(result.model.provider, 'openai'); assert.equal(result.model.available, true);
      binding = 'passed';
    } finally { await session.request('/api/auth/logout', {}); }
  }
  return { checks: checks.length, publicAssets: publicFiles.length, sourceExposure: 'blocked', missingHost: missingHostStatus, privateFraudBinding: binding };
}
module.exports = { verify };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--neon', '--native'].includes(args[0]))) { console.error('Usage: npm run test:vercel -- [--neon|--native]'); process.exitCode = 1; }
  else verify({ accounts: args[0]?.slice(2) || null }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error('Vercel verification failed:', error.message); process.exitCode = 1; });
}
