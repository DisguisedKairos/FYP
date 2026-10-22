const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createFixture, riskClientFor, accountNamed, totalBalance } = require('./helpers');

const send = (client, path, body, options = {}) => client.request(path, { method: 'POST', body, ...options });
function success(result) { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data)); return result.data; }
function outboxCount(path) { const db = new DatabaseSync(path); try { return db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count; } finally { db.close(); } }
const reviewBody = (decision = 'approve') => ({ decision, reason: 'Independently verified the payment request.', authorizationPassword: 'Evergreen123!' });

test('financial writes require the current password before screening or any balance, ledger or outbox change', async (t) => {
  const risk = riskClientFor();
  let assessments = 0;
  const assess = risk.assess;
  risk.assess = async (input) => { assessments++; return assess(input); };
  const fixture = await createFixture(t, { riskClient: risk });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const source = accountNamed(before, 'Main savings');
  const events = outboxCount(fixture.dbPath);
  for (const [path, body] of [
    ['/api/transfers', { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '10.00' }],
    ['/api/payments', { fromAccountId: source.id, billerId: 'sp-services', reference: 'AUTH123', amount: '10.00' }],
  ]) {
    assert.equal((await send(client, path, body, { authorize: false })).status, 403);
    assert.equal((await send(client, path, { ...body, authorizationPassword: 'WrongPass123!' })).status, 403);
  }
  assert.equal(assessments, 0);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.deepEqual((await client.dashboard()).transactions, before.transactions);
  assert.equal(outboxCount(fixture.dbPath), events);
  const approved = success(await send(client, '/api/transfers', { fromAccountId: source.id, toAccountNumber: '1020002001', amount: '10.00' })).transaction;
  assert.equal(approved.status, 'completed');
  assert.equal(approved.authorization.method, 'password');
  assert.equal(approved.risk.score, 12);
  assert.equal(assessments, 1);
  assert.equal(JSON.stringify(approved).includes('Evergreen123!'), false);
});

test('screening failure or an invalid score fails closed without a financial or notification event', async (t) => {
  let result = null;
  const fixture = await createFixture(t, { riskClient: { async assess() { if (result === null) throw new Error('Screening unavailable'); return result; } } });
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const events = outboxCount(fixture.dbPath);
  const payload = { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '10.00', requestId: 'screen-failure' };
  assert.equal((await send(client, '/api/transfers', payload)).status, 503);
  result = { score: 101, decision: 'allow', reasons: [] };
  assert.equal((await send(client, '/api/transfers', payload)).status, 503);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.deepEqual((await client.dashboard()).transactions, before.transactions);
  assert.equal(outboxCount(fixture.dbPath), events);
});

test('held and blocked transactions keep funds unchanged and preserve their risk explanation', async (t) => {
  let decision = 'review';
  const fixture = await createFixture(t, { riskClient: riskClientFor(() => decision) });
  const client = fixture.client();
  const recipient = fixture.client();
  await client.login();
  await recipient.login('jamie@evergreen.demo');
  const before = await client.dashboard();
  const recipientBefore = await recipient.dashboard();
  const base = { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '10.00' };
  const held = success(await send(client, '/api/transfers', { ...base, requestId: 'held-payment' })).transaction;
  assert.equal(held.status, 'pending_review');
  assert.equal(held.completedAt, null);
  assert.equal(held.risk.decision, 'review');
  assert.equal(held.risk.score, 65);
  decision = 'block';
  const blocked = success(await send(client, '/api/transfers', { ...base, requestId: 'blocked-payment' })).transaction;
  assert.equal(blocked.status, 'rejected');
  assert.equal(blocked.risk.decision, 'block');
  assert.equal(blocked.risk.score, 99);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
  assert.deepEqual((await recipient.dashboard()).accounts, recipientBefore.accounts);
  const repeat = success(await send(client, '/api/transfers', { ...base, requestId: 'blocked-payment' })).transaction;
  assert.equal(repeat.id, blocked.id);
  assert.equal((await client.dashboard()).transactions.filter(transaction => transaction.id === blocked.id).length, 1);
  const reviewer = fixture.client();
  await reviewer.login('reviewer@evergreen.demo');
  const reviews = success(await reviewer.request('/api/fraud/reviews')).reviews;
  assert.ok(reviews.some(transaction => transaction.id === held.id));
  assert.ok(!reviews.some(transaction => transaction.id === blocked.id));
  assert.equal((await send(reviewer, `/api/fraud/reviews/${blocked.id}`, reviewBody())).status, 409);
});

test('only an independent administrator can approve a held payment, and repeated approval cannot spend twice', async (t) => {
  const fixture = await createFixture(t, { riskClient: riskClientFor('review') });
  const maker = fixture.client();
  const reviewer = fixture.client();
  const customer = fixture.client();
  await maker.login();
  await reviewer.login('reviewer@evergreen.demo');
  await customer.login('jamie@evergreen.demo');
  const before = await maker.dashboard();
  const recipientBefore = await customer.dashboard();
  const payload = { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '12.34', requestId: 'independent-approval' };
  const held = success(await send(maker, '/api/transfers', payload)).transaction;
  assert.equal((await maker.request('/api/fraud/reviews')).data.reviews.some(transaction => transaction.id === held.id), false);
  assert.equal((await send(maker, `/api/fraud/reviews/${held.id}`, reviewBody())).status, 403);
  assert.equal((await customer.request('/api/fraud/reviews')).status, 403);
  assert.equal((await customer.request('/api/fraud/rules')).status, 403);
  assert.equal((await customer.request('/api/fraud/rules/high_value', { method: 'PATCH', body: { threshold: 1, version: 1 } })).status, 403);
  assert.equal((await send(customer, `/api/fraud/reviews/${held.id}`, reviewBody())).status, 403);
  assert.equal((await send(reviewer, `/api/fraud/reviews/${held.id}`, { ...reviewBody(), authorizationPassword: 'Incorrect123!' })).status, 403);
  assert.equal((await send(reviewer, `/api/fraud/reviews/${held.id}`, { ...reviewBody(), reason: '' })).status, 400);
  assert.equal(totalBalance(await maker.dashboard()), totalBalance(before));
  const approved = success(await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody())).transaction;
  assert.equal(approved.status, 'completed');
  assert.equal(approved.risk.decision, 'review');
  assert.equal(approved.review.decision, 'approve');
  assert.equal(approved.review.reviewedBy.id, (await reviewer.dashboard()).user.id);
  assert.equal(totalBalance(await maker.dashboard()), totalBalance(before) - 1234);
  assert.equal(totalBalance(await customer.dashboard()), totalBalance(recipientBefore) + 1234);
  const events = outboxCount(fixture.dbPath);
  assert.equal(success(await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody())).transaction.id, held.id);
  assert.equal(outboxCount(fixture.dbPath), events);
  const replay = success(await send(maker, '/api/transfers', payload)).transaction;
  assert.equal(replay.status, 'completed');
  assert.equal(replay.review.decision, 'approve');
  assert.equal((await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody('reject'))).status, 409);
  assert.equal(totalBalance(await maker.dashboard()), totalBalance(before) - 1234);
});

test('rejecting a held bill preserves balances and returns its final state on a duplicate submission', async (t) => {
  const fixture = await createFixture(t, { riskClient: riskClientFor('review') });
  const maker = fixture.client();
  const reviewer = fixture.client();
  await maker.login();
  await reviewer.login('reviewer@evergreen.demo');
  const before = await maker.dashboard();
  const payload = { fromAccountId: before.accounts[0].id, billerId: 'sp-services', reference: 'REVIEW-BILL', amount: '20.00', requestId: 'reject-held-bill' };
  const held = success(await send(maker, '/api/payments', payload)).transaction;
  assert.equal(held.status, 'pending_review');
  const rejected = success(await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody('reject'))).transaction;
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.review.decision, 'reject');
  assert.equal(rejected.completedAt, null);
  assert.deepEqual((await maker.dashboard()).accounts, before.accounts);
  assert.equal(success(await send(maker, '/api/payments', payload)).transaction.status, 'rejected');
});

test('approval checks available funds again and an unsuccessful approval stays available for rejection', async (t) => {
  let decision = 'allow';
  const fixture = await createFixture(t, { riskClient: riskClientFor(() => decision) });
  const maker = fixture.client();
  const reviewer = fixture.client();
  await maker.login();
  await reviewer.login('reviewer@evergreen.demo');
  const main = accountNamed(await maker.dashboard(), 'Main savings');
  const budget = success(await send(maker, '/api/accounts', { name: 'Approval budget' })).account;
  success(await send(maker, '/api/transfers', { fromAccountId: main.id, toAccountNumber: budget.number, amount: '20.00' }));
  decision = 'review';
  const held = success(await send(maker, '/api/transfers', { fromAccountId: budget.id, toAccountNumber: '1020002001', amount: '20.00', requestId: 'pending-budget' })).transaction;
  decision = 'allow';
  success(await send(maker, '/api/transfers', { fromAccountId: budget.id, toAccountNumber: main.number, amount: '20.00' }));
  const beforeReview = await maker.dashboard();
  assert.equal((await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody())).status, 409);
  assert.deepEqual((await maker.dashboard()).accounts, beforeReview.accounts);
  assert.equal((await maker.dashboard()).transactions.find(transaction => transaction.id === held.id).status, 'pending_review');
  assert.equal(success(await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody('reject'))).transaction.status, 'rejected');
});

test('concurrent payments cannot bypass a daily control assessed before the other payment commits', async (t) => {
  const risk = riskClientFor('allow');
  const assess = risk.assess;
  risk.assess = async input => ({ ...await assess(input), controls: { dailyLimitCents: 15000 } });
  const fixture = await createFixture(t, { riskClient: risk });
  const sender = fixture.client();
  const recipient = fixture.client();
  await sender.login();
  await recipient.login('jamie@evergreen.demo');
  const before = await sender.dashboard();
  const recipientBefore = await recipient.dashboard();
  const base = { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '100.00' };
  const attempts = await Promise.all([
    send(sender, '/api/transfers', { ...base, requestId: 'daily-cap-first' }),
    send(sender, '/api/transfers', { ...base, requestId: 'daily-cap-second' }),
  ]);
  const transactions = attempts.map(result => success(result).transaction);
  assert.equal(transactions.filter(transaction => transaction.status === 'completed').length, 1);
  const blocked = transactions.find(transaction => transaction.status === 'rejected');
  assert.ok(blocked);
  assert.equal(blocked.risk.decision, 'block');
  assert.ok(blocked.risk.score >= 95);
  assert.equal(totalBalance(await sender.dashboard()), totalBalance(before) - 10000);
  assert.equal(totalBalance(await recipient.dashboard()), totalBalance(recipientBefore) + 10000);
  const requestId = transactions[0].id === blocked.id ? 'daily-cap-first' : 'daily-cap-second';
  assert.equal(success(await send(sender, '/api/transfers', { ...base, requestId })).transaction.status, 'rejected');
  assert.equal(totalBalance(await sender.dashboard()), totalBalance(before) - 10000);
});

test('review approval applies current hard rules and a denied approval cannot alter the held transaction', async (t) => {
  const risk = riskClientFor('review');
  let threshold = 5;
  risk.getRules = async () => ({ version: 2, rules: [{ id: 'daily_limit', enabled: true, action: 'block', threshold }] });
  const fixture = await createFixture(t, { riskClient: risk });
  const maker = fixture.client();
  const reviewer = fixture.client();
  await maker.login();
  await reviewer.login('reviewer@evergreen.demo');
  const before = await maker.dashboard();
  const held = success(await send(maker, '/api/transfers', { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '10.00' })).transaction;
  assert.equal(held.status, 'pending_review');
  const eventsBefore = outboxCount(fixture.dbPath);
  assert.equal((await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody())).status, 409);
  assert.deepEqual((await maker.dashboard()).accounts, before.accounts);
  assert.equal((await maker.dashboard()).transactions.find(transaction => transaction.id === held.id).status, 'pending_review');
  assert.equal(outboxCount(fixture.dbPath), eventsBefore);
  threshold = 20;
  assert.equal(success(await send(reviewer, `/api/fraud/reviews/${held.id}`, reviewBody())).transaction.status, 'completed');
  assert.equal(totalBalance(await maker.dashboard()), totalBalance(before) - 1000);
});
