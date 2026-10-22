'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createFraudServer } = require('../services/fraud/server');
const { createNotificationServer } = require('../services/notifications/server');
const { createRiskClient, createNotificationClient } = require('../services/clients');
const { createGateway } = require('../services/gateway');

const token = 'isolated-test-service-token-1234567890';
async function listen(server, t) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('fraud service enforces service authentication and preserves assessments across HTTP retries', async t => {
  const base = await listen(createFraudServer({ token, dbPath: ':memory:' }), t);
  assert.equal((await fetch(base + '/internal/rules')).status, 401);
  assert.equal((await fetch(base + '/internal/rules', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const client = createRiskClient({ url: base, token });
  const input = { transactionId: 'network-1', userId: 'alice', type: 'bill', amountCents: 10000, payee: 'sp-services', accountBalanceCents: 1000000, history: [], createdAt: '2026-10-22T04:00:00Z' };
  const first = await client.assess(input);
  assert.deepEqual(await client.assess(input), first);
  assert.equal((await client.getModelInfo()).training.synthetic, true);
  const rules = await client.getRules();
  assert.equal((await client.updateRule('high_value', { threshold: 8000, version: rules.version }, { id: 'reviewer' })).version, rules.version + 1);
  await assert.rejects(client.updateRule('high_value', { threshold: 7000, version: rules.version }, { id: 'reviewer' }), e => e.status === 409);
});

test('notification HTTP consumer deduplicates events and the gateway hides private service endpoints', async t => {
  const base = await listen(createNotificationServer({ token, dbPath: ':memory:' }), t);
  const client = createNotificationClient({ url: base, token });
  const event = { id: 'network-event', userId: 'alice', title: 'Payment received', message: 'A new payment is available.', createdAt: '2026-10-22T04:00:00Z' };
  await client.publish(event); await client.publish(event);
  assert.equal((await client.list('alice')).notifications.length, 1);
  assert.equal((await client.markRead('alice', 'all')).unreadCount, 0);
  const gateway = await listen(createGateway({ target: base, token }), t);
  assert.equal((await fetch(gateway + '/internal/events', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 404);
  assert.equal((await fetch(gateway + '/in%74ernal/events')).status, 404);
});

test('unavailable remote scoring service fails closed with an actionable service error', async () => {
  const client = createRiskClient({ url: 'http://127.0.0.1:1', token });
  await assert.rejects(client.assess({}), e => e.status === 503);
});
