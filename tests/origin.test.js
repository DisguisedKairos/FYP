const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../app');
const { createFixture } = require('./helpers');

test('a configured HTTPS public origin issues Secure cookies and accepts only that exact browser origin', async (t) => {
  const origin = 'https://bank.example';
  const fixture = await createFixture(t, { publicOrigin: origin });
  const client = fixture.client();
  const session = await client.session();
  assert.match(session.headers.get('set-cookie'), /;\s*Secure(?:;|$)/i);
  const signedIn = await client.request('/api/auth/login', { method: 'POST', headers: { Origin: origin }, body: {
    email: 'alex@greenlink.demo', password: 'Greenlink123!',
  } });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get('set-cookie'), /;\s*Secure(?:;|$)/i);
  const before = (await client.dashboard()).accounts;
  for (const invalid of ['https://untrusted.example', 'http://bank.example', fixture.baseUrl, 'https://bank.example/path']) {
    const rejected = await client.request('/api/accounts', { method: 'POST', headers: { Origin: invalid }, body: { name: 'Rejected account' } });
    assert.equal(rejected.status, 403, invalid);
  }
  assert.deepEqual((await client.dashboard()).accounts, before);
  const accepted = await client.request('/api/accounts', { method: 'POST', headers: { Origin: origin }, body: { name: 'Authorized origin' } });
  assert.equal(accepted.status, 201);
});

test('untrusted forwarding headers cannot change the cookie security or accepted request origin', async (t) => {
  const fixture = await createFixture(t, { publicOrigin: null });
  const client = fixture.client();
  const spoofed = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'bank.example', Forwarded: 'proto=https;host=bank.example' };
  const session = await client.request('/api/session', { headers: spoofed });
  assert.equal(session.status, 200);
  assert.doesNotMatch(session.headers.get('set-cookie'), /;\s*Secure(?:;|$)/i);
  const rejected = await client.request('/api/auth/login', { method: 'POST', headers: { ...spoofed, Origin: 'https://bank.example' }, body: {
    email: 'alex@greenlink.demo', password: 'Greenlink123!',
  } });
  assert.equal(rejected.status, 403);
  assert.equal((await client.session()).data.user, null);
});

test('invalid public origin configuration fails before creating an application database', () => {
  for (const publicOrigin of ['http://bank.example', 'https://user:password@bank.example', 'https://bank.example/path', 'https://bank.example?query=1', 'https://bank.example#fragment', 'not a URL', 123]) {
    assert.throws(() => createApplication({ dbPath: ':memory:', seed: false, publicOrigin }), /PUBLIC_ORIGIN/);
  }
});
