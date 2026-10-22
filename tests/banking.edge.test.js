const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createFixture, accountNamed } = require('./helpers');

const send = (client, path, body, method = 'POST') => client.request(path, { method, body });
function success(result) { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data)); return result.data; }

test('an account holder must keep one account and can have at most eight active accounts', async (t) => {
  const fixture = await createFixture(t, { seed: false });
  const client = fixture.client();
  await client.session();
  const registration = success(await send(client, '/api/auth/register', { name: 'Account Limits', email: 'limits@example.com', password: 'StrongPass123!' }));
  assert.equal((await send(client, `/api/accounts/${registration.account.id}`, {}, 'DELETE')).status, 409);
  const opened = [];
  for (let index = 0; index < 7; index++) opened.push(success(await send(client, '/api/accounts', { name: `Goal ${index + 1}` })).account);
  assert.equal((await client.dashboard()).accounts.length, 8);
  assert.equal((await send(client, '/api/accounts', { name: 'One too many' })).status, 409);
  success(await send(client, `/api/accounts/${opened[0].id}`, {}, 'DELETE'));
  success(await send(client, '/api/accounts', { name: 'Replacement goal' }));
  assert.equal((await client.dashboard()).accounts.length, 8);
});

test('an expired session cannot read balances and bootstrap creates a new anonymous session', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const oldCookie = client.cookies.get('evergreen_session');
  const db = new DatabaseSync(fixture.dbPath);
  try { db.prepare('UPDATE sessions SET expires_at = 0').run(); } finally { db.close(); }
  assert.equal((await client.request('/api/dashboard')).status, 401);
  assert.equal((await client.session()).data.user, null);
  assert.notEqual(client.cookies.get('evergreen_session'), oldCookie);
  assert.equal((await send(client, '/api/accounts', { name: 'Unauthorized' })).status, 401);
});

test('a failed recipient ledger insert rolls back both balances, ledger entries and idempotency claim', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const main = accountNamed(before, 'Main savings');
  const rainy = accountNamed(before, 'Rainy day');
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec("CREATE TRIGGER reject_test_credit BEFORE INSERT ON transactions WHEN NEW.amount_cents > 0 BEGIN SELECT RAISE(ABORT, 'Test credit failure'); END;");
    const errorLog = t.mock.method(console, 'error', () => {});
    const payload = { fromAccountId: main.id, toAccountNumber: rainy.number, amount: '10.00', requestId: 'rollback-ledger' };
    assert.equal((await send(client, '/api/transfers', payload)).status, 500);
    assert.equal(errorLog.mock.callCount(), 1);
    const afterFailure = await client.dashboard();
    assert.deepEqual(afterFailure.accounts, before.accounts);
    assert.deepEqual(afterFailure.transactions, before.transactions);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM requests WHERE request_id = ?').get(payload.requestId).count, 0);
    db.exec('DROP TRIGGER reject_test_credit');
    success(await send(client, '/api/transfers', payload));
    assert.equal(accountNamed(await client.dashboard(), main.name).balanceCents, main.balanceCents - 1000);
  } finally { db.close(); }
});

test('completed transfer and bill retries return receipts after the source is closed or recipient renamed', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const dashboard = await client.dashboard();
  const main = accountNamed(dashboard, 'Main savings');
  const rainy = accountNamed(dashboard, 'Rainy day');
  const source = success(await send(client, '/api/accounts', { name: 'Temporary source' })).account;
  success(await send(client, '/api/transfers', { fromAccountId: main.id, toAccountNumber: source.number, amount: '100.00', requestId: 'retry-funding' }));
  const bill = { fromAccountId: source.id, billerId: 'sp-services', reference: 'RETRY123', amount: '1.00', requestId: 'retry-closed-bill' };
  const billReceipt = success(await send(client, '/api/payments', bill)).transaction;
  const transfer = { fromAccountId: source.id, toAccountNumber: rainy.number, amount: '99.00', requestId: 'retry-closed-transfer' };
  const transferReceipt = success(await send(client, '/api/transfers', transfer)).transaction;
  success(await send(client, `/api/accounts/${source.id}`, {}, 'DELETE'));
  success(await send(client, `/api/accounts/${rainy.id}`, { name: 'Renamed recipient' }, 'PATCH'));
  const expected = await client.dashboard();
  assert.equal(success(await send(client, '/api/payments', bill)).transaction.id, billReceipt.id);
  assert.equal(success(await send(client, '/api/transfers', transfer)).transaction.id, transferReceipt.id);
  assert.deepEqual((await client.dashboard()).accounts, expected.accounts);
  assert.deepEqual((await client.dashboard()).transactions, expected.transactions);
});

test('a completed transfer retry remains valid after its recipient account has been closed', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const main = accountNamed(await client.dashboard(), 'Main savings');
  const target = success(await send(client, '/api/accounts', { name: 'Temporary recipient' })).account;
  const payload = { fromAccountId: main.id, toAccountNumber: target.number, amount: '10.00', requestId: 'retry-closed-recipient' };
  const receipt = success(await send(client, '/api/transfers', payload)).transaction;
  success(await send(client, '/api/transfers', { fromAccountId: target.id, toAccountNumber: main.number, amount: '10.00', requestId: 'empty-recipient' }));
  success(await send(client, `/api/accounts/${target.id}`, {}, 'DELETE'));
  const expected = await client.dashboard();
  assert.equal(success(await send(client, '/api/transfers', payload)).transaction.id, receipt.id);
  assert.deepEqual((await client.dashboard()).accounts, expected.accounts);
});

test('amount, note and reference boundaries are validated without floating point rounding', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const main = accountNamed(await client.dashboard(), 'Main savings');
  const base = { fromAccountId: main.id, toAccountNumber: '1020001002', amount: '1.00' };
  assert.equal((await send(client, '/api/transfers', { ...base, amount: '90000000000.00' })).status, 409);
  assert.equal((await send(client, '/api/transfers', { ...base, amount: '90000000000.01' })).status, 400);
  assert.equal((await send(client, '/api/transfers', { ...base, amount: 0.1 + 0.2 })).status, 400);
  assert.equal((await send(client, '/api/transfers', { ...base, description: 'x'.repeat(101) })).status, 400);
  const numeric = success(await send(client, '/api/transfers', { ...base, amount: 0.29, description: 'x'.repeat(100), requestId: 'numeric-cents' })).transaction;
  assert.equal(numeric.amountCents, -29);
  const bill = { fromAccountId: main.id, billerId: 'sp-services', reference: 'R'.repeat(64), amount: '0.01' };
  assert.equal((await send(client, '/api/payments', { ...bill, reference: 'R'.repeat(65) })).status, 400);
  assert.equal(success(await send(client, '/api/payments', bill)).transaction.amountCents, -1);
});

test('failure to create the durable notification rolls back the transfer and both ledger entries', async (t) => {
  const fixture = await createFixture(t);
  const sender = fixture.client();
  const recipient = fixture.client();
  await sender.login();
  await recipient.login('jamie@evergreen.demo');
  const before = await sender.dashboard();
  const recipientBefore = await recipient.dashboard();
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec("CREATE TRIGGER reject_test_outbox BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT, 'Test outbox failure'); END;");
    t.mock.method(console, 'error', () => {});
    const payload = { fromAccountId: before.accounts[0].id, toAccountNumber: '1020002001', amount: '10.00', requestId: 'outbox-atomicity' };
    assert.equal((await send(sender, '/api/transfers', payload)).status, 500);
    assert.deepEqual((await sender.dashboard()).accounts, before.accounts);
    assert.deepEqual((await sender.dashboard()).transactions, before.transactions);
    assert.deepEqual((await recipient.dashboard()).accounts, recipientBefore.accounts);
    assert.deepEqual((await recipient.dashboard()).transactions, recipientBefore.transactions);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM requests WHERE request_id = ?').get(payload.requestId).count, 0);
    db.exec('DROP TRIGGER reject_test_outbox');
    assert.equal(success(await send(sender, '/api/transfers', payload)).transaction.status, 'completed');
  } finally { db.close(); }
});
