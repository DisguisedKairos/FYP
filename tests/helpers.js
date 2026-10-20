const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApplication } = require('../app');

async function createFixture(t, { seed = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'evergreen-integration-'));
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

  async function start() {
    server = createApplication({ dbPath, seed });
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
    client: () => new Client(() => baseUrl),
  };
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrfToken = null;
  }

  async request(path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
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
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      assert.fail(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 160)}`);
    }
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }

  async session() {
    const result = await this.request('/api/session');
    assert.equal(result.status, 200);
    assert.equal(typeof result.data.csrfToken, 'string');
    return result;
  }

  async login(email = 'alex@evergreen.demo', password = 'Evergreen123!') {
    await this.session();
    const result = await this.request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.user.email, email);
    return result;
  }

  async dashboard() {
    const result = await this.request('/api/dashboard');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
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

module.exports = { createFixture, accountNamed, totalBalance };
