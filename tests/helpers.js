const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApplication } = require('../app');

function riskClientFor(decision = 'allow') {
  return {
    async getRules() { return { rules: [], version: 1 }; },
    async assess(input) {
      const chosen = typeof decision === 'function' ? decision(input) : decision;
      return {
        transactionId: input.transactionId,
        score: { allow: 12, review: 65, block: 99 }[chosen],
        decision: chosen,
        reasons: [{ code: 'integration_test', message: `Controlled integration test: ${chosen}` }],
        modelVersion: 'integration-test', ruleVersion: 1,
        features: {}, assessedAt: input.createdAt,
      };
    },
  };
}

async function createFixture(t, { seed = true, riskClient = riskClientFor(), ...options } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'greenlink-integration-'));
  const dbPath = join(directory, 'bank.sqlite');
  let server;
  let baseUrl;

  async function stop() {
    if (!server?.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections?.();
    });
  }

  async function start(restartOptions = {}) {
    server = createApplication({ dbPath, seed, riskClient, ...options, ...restartOptions });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  t.after(async () => {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  });
  await start();

  return {
    start,
    stop,
    dbPath,
    get baseUrl() { return baseUrl; },
    runJobs: (...args) => server.runJobs(...args),
    client: () => new Client(() => baseUrl),
  };
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrfToken = null;
  }

  async request(path, { method = 'GET', body, csrf = true, authorize = true, responseType = 'json', headers = {} } = {}) {
    if (authorize && method === 'POST' && ['/api/transfers', '/api/payments', '/api/scheduled-payments'].includes(path) && body) {
      body = { authorizationPassword: this.password, ...body };
    }
    const requestHeaders = { ...headers };
    if (this.cookies.size) {
      requestHeaders.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    if (csrf && this.csrfToken && method !== 'GET') {
      requestHeaders['X-CSRF-Token'] = this.csrfToken;
    }
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    if (responseType === 'text') return { status: response.status, data: text, headers: response.headers };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      assert.fail(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 160)}`);
    }
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    if (response.ok && path === '/api/auth/register') this.password = body.password;
    return { status: response.status, data, headers: response.headers };
  }

  async session() {
    const result = await this.request('/api/session');
    assert.equal(result.status, 200);
    assert.equal(typeof result.data.csrfToken, 'string');
    return result;
  }

  async login(email = 'alex@greenlink.demo', password = 'Greenlink123!') {
    await this.session();
    const result = await this.request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.user.email, email);
    this.password = password;
    return result;
  }

  async dashboard() {
    const result = await this.request('/api/dashboard');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  }

  async history(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
    const result = await this.request(`/api/transactions?${query}`);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  }

  async ledger(filters = {}) {
    const transactions = [];
    for (let page = 1; ; page++) {
      const result = await this.history({ ...filters, page, pageSize: 100 });
      transactions.push(...result.transactions);
      if (page >= result.pagination.totalPages) return transactions;
    }
  }
}

function accountNamed(dashboard, name) {
  const account = dashboard.accounts.find((item) => item.name === name);
  assert.ok(account, `Expected account named ${name}`);
  return account;
}

function totalBalance(dashboard) {
  return dashboard.accounts.reduce((sum, account) => sum + account.balanceCents, 0);
}

module.exports = { createFixture, accountNamed, totalBalance, riskClientFor };
