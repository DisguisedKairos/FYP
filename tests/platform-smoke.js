'use strict';

// Run only against an isolated demo instance (CI Compose or a temporary DATA_DIR).
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const base = process.env.PLATFORM_SMOKE_BASE_URL;
if (!base) throw new Error('Set PLATFORM_SMOKE_BASE_URL to an isolated demo platform URL.');
const password = 'Evergreen123!';
class BrowserSession {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async request(path, body, method = 'POST', expected = 200) {
    const response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : method, headers: { Cookie: this.cookie, Origin: new URL(base).origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(';')[0];
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    if (result.csrfToken) this.csrf = result.csrfToken;
    return result;
  }
  async login(email) { await this.request('/api/session'); return this.request('/api/auth/login', { email, password }); }
}

(async () => {
  assert.equal((await fetch(new URL('/health', base))).status, 200);
  assert.equal((await fetch(new URL('/internal/jobs/tick', base), { method: 'POST' })).status, 404);
  const alex = new BrowserSession(), recipient = new BrowserSession(), reviewer = new BrowserSession();
  await alex.login('alex@evergreen.demo');
  const original = await alex.request('/api/dashboard');
  const source = original.accounts.find(a => a.name === 'Main savings') || original.accounts[0];
  const first = await alex.request('/api/transfers', { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '1.25', description: 'Service smoke transfer', authorizationPassword: password, requestId: randomUUID() });
  assert.equal(first.transaction.status, 'completed');
  assert.equal(typeof first.transaction.risk.score, 'number');
  const afterFirst = await alex.request('/api/dashboard');
  assert.equal(afterFirst.accounts.find(a => a.id === source.id).balanceCents, source.balanceCents - 125);

  await recipient.request('/api/session');
  const registration = await recipient.request('/api/auth/register', { name: 'Smoke Recipient', email: `smoke-${randomUUID()}@evergreen.demo`, password, confirmPassword: password }, 'POST', 201);
  const target = registration.account || (await recipient.request('/api/dashboard')).accounts[0];
  const held = await alex.request('/api/transfers', { fromAccountId: source.id, toAccountNumber: target.number, amount: '2000.00', description: 'Review smoke transfer', authorizationPassword: password, requestId: randomUUID() });
  assert.equal(held.transaction.status, 'pending_review');
  assert.equal((await alex.request('/api/dashboard')).accounts.find(a => a.id === source.id).balanceCents, source.balanceCents - 125);
  await alex.request(`/api/fraud/reviews/${held.transaction.id}`, { decision: 'approve', reason: 'Own approval must be denied', authorizationPassword: password }, 'POST', 403);
  await reviewer.login('reviewer@evergreen.demo');
  assert.ok((await reviewer.request('/api/fraud/reviews')).reviews.some(t => t.id === held.transaction.id));
  const approved = await reviewer.request(`/api/fraud/reviews/${held.transaction.id}`, { decision: 'approve', reason: 'Independent review of isolated service smoke', authorizationPassword: password });
  assert.equal(approved.transaction.status, 'completed');
  assert.equal((await recipient.request('/api/dashboard')).accounts[0].balanceCents, 200000);

  const bill = await alex.request('/api/payments', { fromAccountId: source.id, billerId: 'sp-services', reference: 'SMOKE-UTILITY-001', amount: '0.75', authorizationPassword: password, requestId: randomUUID() });
  assert.equal(bill.transaction.status, 'completed');
  const schedule = await alex.request('/api/scheduled-payments', { type: 'bill', fromAccountId: source.id, billerId: 'pub', reference: 'SMOKE-SCHEDULE-001', amount: '1.00', scheduledAt: new Date(Date.now() + 3600000).toISOString(), frequency: 'once', authorizationPassword: password, requestId: randomUUID() }, 'POST', 201);
  assert.equal(schedule.schedule.status, 'active');
  await alex.request(`/api/scheduled-payments/${schedule.schedule.id}`, {}, 'DELETE');
  assert.equal((await alex.request('/api/fraud/rules')).rules.length, 5);
  assert.equal((await alex.request('/api/fraud/model')).model.training.synthetic, true);
  let notifications;
  for (let attempt = 0; attempt < 40; attempt++) {
    notifications = await alex.request('/api/notifications');
    if (notifications.notifications.some(n => n.transactionId === first.transaction.id)) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(notifications.notifications.some(n => n.transactionId === first.transaction.id));
  assert.equal((await alex.request('/api/notifications/all', { read: true }, 'PATCH')).unreadCount, 0);
  console.log('Platform smoke passed: gateway, remote scoring, atomic transfer, independent review, bill, schedule, and event notifications.');
})().catch(error => { console.error(error); process.exitCode = 1; });
