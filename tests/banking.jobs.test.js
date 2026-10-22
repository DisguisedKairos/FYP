const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createFixture, riskClientFor, accountNamed, totalBalance } = require('./helpers');

const send = (client, path, body, method = 'POST', extra = {}) => client.request(path, { method, body, ...extra });
function success(result) { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data)); return result.data; }
async function schedules(client) { return success(await client.request('/api/scheduled-payments')).schedules; }
function clockAt(value = '2027-01-30T01:00:00.000Z') {
  let time = Date.parse(value);
  return { now: () => time, set: value => { time = Date.parse(value); }, add: milliseconds => { time += milliseconds; } };
}
function readStore(path, query) {
  const db = new DatabaseSync(path);
  try { return db.prepare(query).all(); } finally { db.close(); }
}
const schedulePayload = (fromAccountId, changes = {}) => ({
  type: 'transfer', fromAccountId, toAccountNumber: '1020002001', amount: '10.00',
  frequency: 'once', scheduledAt: '2027-01-31T01:00:00.000Z', ...changes,
});

test('scheduled payments validate authorization, future dates and ownership without reserving funds', async (t) => {
  const clock = clockAt();
  const fixture = await createFixture(t, { now: clock.now });
  const client = fixture.client();
  const other = fixture.client();
  await client.login();
  await other.login('jamie@evergreen.demo');
  const before = await client.dashboard();
  const payload = schedulePayload(before.accounts[0].id);
  assert.equal((await send(client, '/api/scheduled-payments', payload, 'POST', { authorize: false })).status, 403);
  assert.equal((await send(client, '/api/scheduled-payments', { ...payload, authorizationPassword: 'Incorrect123!' })).status, 403);
  for (const changes of [
    { scheduledAt: '2027-01-29T01:00:00.000Z' }, { scheduledAt: '2027-02-30T01:00:00.000Z' },
    { scheduledAt: '2027-01-31T09:00:00+08:00' }, { frequency: 'daily' }, { amount: '-1.00' },
  ]) assert.equal((await send(client, '/api/scheduled-payments', { ...payload, ...changes })).status, 400);
  const created = success(await send(client, '/api/scheduled-payments', { ...payload, requestId: 'schedule-creation' })).schedule;
  assert.equal(created.status, 'active');
  assert.equal(created.runs.length, 0);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.equal(success(await send(client, '/api/scheduled-payments', { ...payload, requestId: 'schedule-creation' })).schedule.id, created.id);
  assert.equal((await send(client, '/api/scheduled-payments', { ...payload, amount: '10.01', requestId: 'schedule-creation' })).status, 409);
  assert.equal((await schedules(other)).length, 0);
  assert.equal((await send(other, `/api/scheduled-payments/${created.id}`, {}, 'DELETE')).status, 404);
  const storage = readStore(fixture.dbPath, 'SELECT authorization_json FROM scheduled_payments');
  assert.equal(storage.length, 1);
  assert.equal(storage[0].authorization_json.includes('Evergreen123!'), false);
  assert.equal(JSON.parse(storage[0].authorization_json).scope, 'scheduled_payment');
});

test('a one-time payment survives restart and concurrent ticks execute its due occurrence exactly once', async (t) => {
  const clock = clockAt();
  const fixture = await createFixture(t, { now: clock.now });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const created = success(await send(client, '/api/scheduled-payments', schedulePayload(before.accounts[0].id))).schedule;
  await fixture.runJobs();
  assert.equal((await schedules(client))[0].runs.length, 0);
  await fixture.stop();
  await fixture.start();
  const returning = fixture.client();
  await returning.login();
  assert.equal((await schedules(returning))[0].id, created.id);
  clock.set(created.scheduledAt);
  await Promise.all([fixture.runJobs(), fixture.runJobs()]);
  await fixture.runJobs();
  const finished = (await schedules(returning))[0];
  assert.equal(finished.status, 'completed');
  assert.equal(finished.nextRunAt, null);
  assert.equal(finished.runs.length, 1);
  assert.equal(finished.runs[0].status, 'completed');
  assert.ok(finished.runs[0].transactionId);
  assert.equal(totalBalance(await returning.dashboard()), totalBalance(before) - 1000);
  const recipient = fixture.client();
  await recipient.login('jamie@evergreen.demo');
  assert.equal(totalBalance(await recipient.dashboard()), 121000);
  assert.equal((await send(returning, `/api/scheduled-payments/${created.id}`, {}, 'DELETE')).status, 409);
});

test('weekly and month-end schedules retain their calendar anchors across occurrences', async (t) => {
  const clock = clockAt();
  const fixture = await createFixture(t, { now: clock.now });
  const client = fixture.client();
  await client.login();
  const account = (await client.dashboard()).accounts[0];
  const monthly = success(await send(client, '/api/scheduled-payments', schedulePayload(account.id, { frequency: 'monthly', amount: '1.00' }))).schedule;
  const weekly = success(await send(client, '/api/scheduled-payments', schedulePayload(account.id, { frequency: 'weekly', amount: '1.00' }))).schedule;
  clock.set('2027-01-31T01:00:00.000Z');
  await fixture.runJobs();
  let items = await schedules(client);
  assert.equal(items.find(item => item.id === monthly.id).nextRunAt, '2027-02-28T01:00:00.000Z');
  assert.equal(items.find(item => item.id === weekly.id).nextRunAt, '2027-02-07T01:00:00.000Z');
  success(await send(client, `/api/scheduled-payments/${weekly.id}`, {}, 'DELETE'));
  clock.set('2027-02-28T01:00:00.000Z');
  await fixture.runJobs();
  items = await schedules(client);
  assert.equal(items.find(item => item.id === monthly.id).nextRunAt, '2027-03-31T01:00:00.000Z');
  assert.equal(items.find(item => item.id === monthly.id).runs.length, 2);
  assert.equal(items.find(item => item.id === weekly.id).runs.length, 1);
});

test('cancellation is idempotent and stops a due run even when its screening request is already in flight', async (t) => {
  const clock = clockAt();
  let entered;
  let release;
  const screeningEntered = new Promise(resolve => { entered = resolve; });
  const screeningReleased = new Promise(resolve => { release = resolve; });
  const allow = riskClientFor();
  const fixture = await createFixture(t, { now: clock.now, riskClient: { async assess(input) { entered(); await screeningReleased; return allow.assess(input); } } });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const created = success(await send(client, '/api/scheduled-payments', schedulePayload(before.accounts[0].id))).schedule;
  clock.set(created.scheduledAt);
  const running = fixture.runJobs();
  await screeningEntered;
  try {
    assert.equal(success(await send(client, `/api/scheduled-payments/${created.id}`, {}, 'DELETE')).schedule.status, 'cancelled');
    assert.equal(success(await send(client, `/api/scheduled-payments/${created.id}`, {}, 'DELETE')).schedule.status, 'cancelled');
  } finally { release(); await running; }
  await fixture.runJobs();
  const cancelled = (await schedules(client))[0];
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.nextRunAt, null);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.deepEqual((await client.dashboard()).transactions, before.transactions);
  assert.equal(cancelled.runs.length, 1);
  assert.equal(cancelled.runs[0].status, 'cancelled');
});

test('due payments are screened at execution and held or failed runs cannot debit funds', async (t) => {
  const clock = clockAt();
  const fixture = await createFixture(t, { now: clock.now, riskClient: riskClientFor('review') });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const held = success(await send(client, '/api/scheduled-payments', schedulePayload(before.accounts[0].id))).schedule;
  const insufficient = success(await send(client, '/api/scheduled-payments', schedulePayload(before.accounts[0].id, { amount: '999999.00' }))).schedule;
  clock.set(held.scheduledAt);
  await fixture.runJobs();
  const items = await schedules(client);
  assert.equal(items.find(item => item.id === held.id).runs[0].status, 'pending_review');
  assert.equal(items.find(item => item.id === insufficient.id).status, 'failed');
  assert.equal(items.find(item => item.id === insufficient.id).runs[0].status, 'failed');
  assert.match(items.find(item => item.id === insufficient.id).lastError, /insufficient/i);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.equal((await client.dashboard()).transactions.filter(transaction => transaction.status === 'pending_review').length, 1);
});

test('notification delivery retries a lost acknowledgement and does not duplicate money or events', async (t) => {
  const clock = clockAt();
  const accepted = new Map();
  let loseAcknowledgement = true;
  let deliveries = 0;
  const client = {
    async publish(event) {
      deliveries++;
      accepted.set(event.id, event);
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Acknowledgement lost after acceptance'); }
      return { id: event.id };
    },
  };
  const fixture = await createFixture(t, { now: clock.now, notificationClient: client });
  const user = fixture.client();
  await user.login();
  const before = await user.dashboard();
  success(await send(user, '/api/payments', { fromAccountId: before.accounts[0].id, billerId: 'sp-services', reference: 'OUTBOX123', amount: '1.23', requestId: 'outbox-payment' }));
  await fixture.runJobs();
  assert.equal(accepted.size, 1);
  assert.equal(readStore(fixture.dbPath, 'SELECT status FROM notification_outbox')[0].status, 'pending');
  clock.add(2001);
  await fixture.runJobs();
  await fixture.runJobs();
  assert.equal(deliveries, 2);
  assert.equal(accepted.size, 1);
  assert.equal(readStore(fixture.dbPath, 'SELECT status FROM notification_outbox')[0].status, 'delivered');
  assert.equal(totalBalance(await user.dashboard()), totalBalance(before) - 123);
});

test('delivered notifications retain unread state across restart and cannot be read by another customer', async (t) => {
  const fixture = await createFixture(t);
  const sender = fixture.client();
  const recipient = fixture.client();
  await sender.login();
  await recipient.login('jamie@evergreen.demo');
  const source = accountNamed(await sender.dashboard(), 'Main savings');
  success(await send(sender, '/api/transfers', { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '3.21' }));
  await fixture.runJobs();
  const own = success(await sender.request('/api/notifications'));
  const received = success(await recipient.request('/api/notifications'));
  assert.equal(own.unreadCount, 1);
  assert.equal(received.unreadCount, 1);
  assert.equal(received.notifications[0].type, 'transaction.received');
  assert.equal((await send(recipient, `/api/notifications/${own.notifications[0].id}`, { read: true }, 'PATCH')).status, 404);
  success(await send(sender, `/api/notifications/${own.notifications[0].id}`, { read: true }, 'PATCH'));
  assert.equal(success(await sender.request('/api/notifications?unreadOnly=true')).notifications.length, 0);
  await fixture.stop();
  await fixture.start();
  const returning = fixture.client();
  await returning.login('jamie@evergreen.demo');
  assert.equal(success(await returning.request('/api/notifications')).unreadCount, 1);
  success(await send(returning, '/api/notifications/all', { read: true }, 'PATCH'));
  assert.equal(success(await returning.request('/api/notifications')).unreadCount, 0);
});

test('internal job ticks require a service bearer and cannot inject a caller supplied clock', async (t) => {
  const previousToken = process.env.SERVICE_TOKEN;
  const token = 'integration-only-service-token-123456';
  process.env.SERVICE_TOKEN = token;
  t.after(() => { if (previousToken === undefined) delete process.env.SERVICE_TOKEN; else process.env.SERVICE_TOKEN = previousToken; });
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  assert.equal((await send(client, '/internal/jobs/tick', {})).status, 401);
  assert.equal((await send(client, '/internal/jobs/tick', {}, 'POST', { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await send(client, '/internal/jobs/tick', { now: '2100-01-01T00:00:00.000Z' }, 'POST', { headers })).status, 400);
  const valid = success(await send(client, '/internal/jobs/tick', {}, 'POST', { headers }));
  assert.equal(typeof valid.schedulesProcessed, 'number');
  delete process.env.SERVICE_TOKEN;
  assert.equal((await send(client, '/internal/jobs/tick', {}, 'POST', { headers })).status, 404);
});

test('a paused remote notification consumer cannot delay a successful payment or notification read', async (t) => {
  let entered;
  let release;
  const publishEntered = new Promise(resolve => { entered = resolve; });
  const publishReleased = new Promise(resolve => { release = resolve; });
  let publishCalls = 0;
  const notificationClient = {
    isRemote: true,
    async list() { return { notifications: [], unreadCount: 0 }; },
    async publish() { publishCalls++; entered(); await publishReleased; return { duplicate: false }; },
  };
  const fixture = await createFixture(t, { notificationClient });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  let jobs;
  const write = send(client, '/api/payments', { fromAccountId: before.accounts[0].id, billerId: 'sp-services', reference: 'REMOTE123', amount: '1.23' });
  try {
    const first = await Promise.race([write.then(result => ({ kind: 'payment', result })), publishEntered.then(() => ({ kind: 'publish' }))]);
    assert.equal(first.kind, 'payment', 'the payment response is independent of remote delivery');
    assert.equal(success(first.result).transaction.status, 'completed');
    const read = await Promise.race([client.request('/api/notifications').then(result => ({ kind: 'read', result })), publishEntered.then(() => ({ kind: 'publish' }))]);
    assert.equal(read.kind, 'read', 'notification reads never drain the outbox');
    success(read.result);
    assert.equal(publishCalls, 0);
    assert.equal(readStore(fixture.dbPath, 'SELECT status FROM notification_outbox')[0].status, 'pending');
    jobs = fixture.runJobs();
    await publishEntered;
    assert.equal(publishCalls, 1);
  } finally { release(); await write; if (jobs) await jobs; }
  assert.equal(readStore(fixture.dbPath, 'SELECT status FROM notification_outbox')[0].status, 'delivered');
  assert.equal(totalBalance(await client.dashboard()), totalBalance(before) - 123);
});
