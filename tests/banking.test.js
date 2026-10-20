const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, accountNamed, totalBalance } = require('./helpers');

function successful(result) {
  assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data));
  assert.equal(result.data.ok, true);
  return result.data;
}

function rejected(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  assert.equal(typeof result.data.error, 'string');
}

async function transfer(client, fromAccountId, toAccountNumber, amount, requestId) {
  return client.request('/api/transfers', {
    method: 'POST',
    body: { fromAccountId, toAccountNumber, amount, requestId },
  });
}

test('anonymous sessions protect account data and issue a safe session cookie', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  const session = await client.session();
  rejected(await client.request('/api/dashboard'), 401);
  assert.equal(session.data.user, null);
  assert.ok(session.data.csrfToken.length >= 24);
  const cookie = session.headers.getSetCookie().find((item) => item.startsWith('evergreen_session='));
  assert.ok(cookie);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=Lax/i);
  assert.match(cookie, /;\s*Path=\//i);
});

test('registration, unique emails, login, session rotation and logout work together', async (t) => {
  const fixture = await createFixture(t, { seed: false });
  const client = fixture.client();
  await client.session();
  const details = { name: 'Taylor Lee', email: 'taylor@example.com', password: 'StrongPass123!', confirmPassword: 'StrongPass123!' };
  const registration = successful(await client.request('/api/auth/register', { method: 'POST', body: details }));
  assert.equal(registration.user.name, details.name);
  assert.equal(registration.user.email, details.email);
  assert.equal('password' in registration.user, false);
  assert.equal('passwordHash' in registration.user, false);
  const dashboard = await client.dashboard();
  assert.equal(dashboard.accounts.length, 1);
  assert.equal(totalBalance(dashboard), 0);
  assert.equal(dashboard.accounts[0].status, 'active');
  assert.match(dashboard.accounts[0].number, /^\d+$/);

  const duplicate = fixture.client();
  await duplicate.session();
  rejected(await duplicate.request('/api/auth/register', {
    method: 'POST', body: { ...details, email: 'TAYLOR@EXAMPLE.COM' },
  }), 409);
  successful(await client.request('/api/auth/logout', { method: 'POST', body: {} }));
  rejected(await client.request('/api/dashboard'), 401);
  assert.equal((await client.session()).data.user, null);

  rejected(await client.request('/api/auth/login', {
    method: 'POST', body: { email: details.email, password: 'Incorrect123!' },
  }), 401);
  const staleSession = fixture.client();
  staleSession.cookies = new Map(client.cookies);
  staleSession.csrfToken = client.csrfToken;
  await client.login(details.email, details.password);
  rejected(await staleSession.request('/api/dashboard'), 401);
  assert.equal((await client.dashboard()).user.email, details.email);
  successful(await client.request('/api/auth/logout', { method: 'POST', body: {} }));
  rejected(await client.request('/api/dashboard'), 401);
});

test('registration validates identity, password length and password confirmation', async (t) => {
  const fixture = await createFixture(t, { seed: false });
  const client = fixture.client();
  await client.session();
  const valid = { name: 'Taylor Lee', email: 'taylor@example.com', password: 'StrongPass123!' };
  for (const changes of [
    { name: '' },
    { email: 'not-an-email' },
    { password: 'short' },
    { confirmPassword: 'Different123!' },
  ]) {
    rejected(await client.request('/api/auth/register', { method: 'POST', body: { ...valid, ...changes } }), 400);
  }
  assert.equal((await client.session()).data.user, null);
  successful(await client.request('/api/auth/register', { method: 'POST', body: valid }));
});

test('CSRF and Origin checks reject writes without changing account state', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.session();
  rejected(await client.request('/api/auth/login', {
    method: 'POST', csrf: false, headers: { Origin: 'https://untrusted.example' },
    body: { email: 'alex@evergreen.demo', password: 'Evergreen123!' },
  }), 403);
  await client.login();
  const before = await client.dashboard();
  rejected(await client.request('/api/accounts', { method: 'POST', csrf: false, body: { name: 'Unwanted account' } }), 403);
  const token = client.csrfToken;
  client.csrfToken = 'invalid-csrf-token';
  rejected(await client.request('/api/accounts', { method: 'POST', body: { name: 'Unwanted account' } }), 403);
  client.csrfToken = token;
  rejected(await client.request('/api/accounts', {
    method: 'POST', body: { name: 'Unwanted account' }, headers: { Origin: 'https://untrusted.example' },
  }), 403);
  assert.deepEqual((await client.dashboard()).accounts, before.accounts);
});

test('an internal transfer updates both balances and creates matching debit and credit entries', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const source = accountNamed(before, 'Main savings');
  const destination = accountNamed(before, 'Rainy day');
  const result = successful(await transfer(client, source.id, destination.number, '123.45', 'internal-transfer-1'));
  assert.equal(result.transaction.type, 'transfer');
  assert.equal(result.transaction.amountCents, -12345);
  assert.equal(result.transaction.accountId, source.id);
  const after = await client.dashboard();
  assert.equal(accountNamed(after, source.name).balanceCents, source.balanceCents - 12345);
  assert.equal(accountNamed(after, destination.name).balanceCents, destination.balanceCents + 12345);
  assert.equal(totalBalance(after), totalBalance(before));
  const newTransactions = after.transactions.filter((entry) => !before.transactions.some((old) => old.id === entry.id));
  assert.equal(newTransactions.length, 2);
  assert.deepEqual(newTransactions.map((entry) => entry.amountCents).sort((a, b) => a - b), [-12345, 12345]);
  assert.ok(newTransactions.every((entry) => entry.status === 'completed'));
});

test('transfers between users persist recipient funds without exposing either user accounts', async (t) => {
  const fixture = await createFixture(t);
  const alex = fixture.client();
  const jamie = fixture.client();
  await alex.login();
  await jamie.login('jamie@evergreen.demo');
  const alexBefore = await alex.dashboard();
  const jamieBefore = await jamie.dashboard();
  const source = accountNamed(alexBefore, 'Main savings');
  const recipient = jamieBefore.accounts[0];
  successful(await transfer(alex, source.id, recipient.number, '45.67', 'cross-user-transfer-1'));
  const alexAfter = await alex.dashboard();
  const jamieAfter = await jamie.dashboard();
  assert.equal(totalBalance(alexAfter), totalBalance(alexBefore) - 4567);
  assert.equal(totalBalance(jamieAfter), totalBalance(jamieBefore) + 4567);
  assert.equal(totalBalance(alexAfter) + totalBalance(jamieAfter), totalBalance(alexBefore) + totalBalance(jamieBefore));
  assert.ok(alexAfter.accounts.every((account) => !jamieAfter.accounts.some((other) => other.id === account.id)));
  const receipt = jamieAfter.transactions.filter((entry) => !jamieBefore.transactions.some((old) => old.id === entry.id));
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].amountCents, 4567);
  assert.equal(receipt[0].accountId, recipient.id);
});

test('bill payments debit the chosen account once and preserve a payment reference', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const account = accountNamed(before, 'Main savings');
  const payment = { fromAccountId: account.id, billerId: 'sp-services', reference: 'SP-123456789', amount: '86.42', requestId: 'bill-payment-1' };
  const first = successful(await client.request('/api/payments', { method: 'POST', body: payment }));
  assert.equal(first.transaction.type, 'bill');
  assert.equal(first.transaction.amountCents, -8642);
  assert.equal(first.transaction.reference, payment.reference);
  const repeat = successful(await client.request('/api/payments', { method: 'POST', body: payment }));
  assert.equal(repeat.transaction.id, first.transaction.id);
  const after = await client.dashboard();
  assert.equal(totalBalance(after), totalBalance(before) - 8642);
  assert.equal(after.transactions.filter((entry) => entry.id === first.transaction.id).length, 1);
  rejected(await client.request('/api/payments', { method: 'POST', body: { ...payment, amount: '86.43' } }), 409);
  assert.equal(totalBalance(await client.dashboard()), totalBalance(after));
});

test('concurrent duplicate transfer requests cannot move funds twice or reuse an id for different details', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const source = accountNamed(before, 'Main savings');
  const destination = accountNamed(before, 'Rainy day');
  const results = await Promise.all([
    transfer(client, source.id, destination.number, '12.34', 'duplicate-transfer-1'),
    transfer(client, source.id, destination.number, '12.34', 'duplicate-transfer-1'),
  ]);
  const transactions = results.map((result) => successful(result).transaction);
  assert.equal(transactions[0].id, transactions[1].id);
  const after = await client.dashboard();
  assert.equal(accountNamed(after, source.name).balanceCents, source.balanceCents - 1234);
  assert.equal(accountNamed(after, destination.name).balanceCents, destination.balanceCents + 1234);
  rejected(await transfer(client, source.id, destination.number, '12.35', 'duplicate-transfer-1'), 409);
  assert.deepEqual((await client.dashboard()).accounts, after.accounts);
});

test('invalid amounts, insufficient funds and invalid destinations leave balances and ledger unchanged', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const source = accountNamed(before, 'Main savings');
  const destination = accountNamed(before, 'Rainy day');
  for (const [index, amount] of ['-1.00', '0', '1.001', '1e2', 'NaN', 'Infinity', '', '100000000000000000000'].entries()) {
    rejected(await transfer(client, source.id, destination.number, amount, `invalid-amount-${index}`), 400);
  }
  rejected(await transfer(client, source.id, destination.number, '9999999.99', 'insufficient-transfer-1'), 409);
  rejected(await transfer(client, source.id, source.number, '1.00', 'self-transfer-1'), 409);
  rejected(await transfer(client, source.id, '9999999999', '1.00', 'missing-destination-1'), 404);
  rejected(await client.request('/api/payments', {
    method: 'POST', body: { fromAccountId: source.id, billerId: 'unknown-biller', reference: '12345', amount: '1.00' },
  }), 400);
  rejected(await client.request('/api/payments', {
    method: 'POST', body: { fromAccountId: source.id, billerId: 'sp-services', reference: '', amount: '1.00' },
  }), 400);
  rejected(await client.request('/api/payments', {
    method: 'POST', body: { fromAccountId: source.id, billerId: 'sp-services', reference: '12345', amount: '9999999.99' },
  }), 409);
  const after = await client.dashboard();
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.transactions, before.transactions);
});

test('users cannot rename, close, spend or pay bills from somebody else account', async (t) => {
  const fixture = await createFixture(t);
  const alex = fixture.client();
  const jamie = fixture.client();
  await alex.login();
  await jamie.login('jamie@evergreen.demo');
  const alexBefore = await alex.dashboard();
  const jamieBefore = await jamie.dashboard();
  const victim = alexBefore.accounts[0];
  rejected(await jamie.request(`/api/accounts/${victim.id}`, { method: 'PATCH', body: { name: 'Stolen account' } }), 404);
  rejected(await jamie.request(`/api/accounts/${victim.id}`, { method: 'DELETE' }), 404);
  rejected(await transfer(jamie, victim.id, jamieBefore.accounts[0].number, '100.00', 'unauthorized-transfer'), 404);
  rejected(await jamie.request('/api/payments', {
    method: 'POST', body: { fromAccountId: victim.id, billerId: 'sp-services', reference: '12345', amount: '100.00' },
  }), 404);
  assert.deepEqual((await alex.dashboard()).accounts, alexBefore.accounts);
  assert.deepEqual((await jamie.dashboard()).accounts, jamieBefore.accounts);
});

test('savings accounts can be opened, renamed and closed only with a zero balance', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const main = accountNamed(await client.dashboard(), 'Main savings');
  rejected(await client.request(`/api/accounts/${main.id}`, { method: 'DELETE' }), 409);
  const created = successful(await client.request('/api/accounts', { method: 'POST', body: { name: 'Holiday fund' } })).account;
  assert.equal(created.balanceCents, 0);
  assert.equal(created.status, 'active');
  const renamed = successful(await client.request(`/api/accounts/${created.id}`, { method: 'PATCH', body: { name: 'Travel fund' } })).account;
  assert.equal(renamed.name, 'Travel fund');
  const closed = successful(await client.request(`/api/accounts/${created.id}`, { method: 'DELETE' })).account;
  assert.equal(closed.status, 'closed');
  rejected(await transfer(client, main.id, created.number, '1.00', 'closed-destination'), 409);
  rejected(await transfer(client, created.id, main.number, '1.00', 'closed-source'), 409);
  rejected(await client.request('/api/payments', {
    method: 'POST', body: { fromAccountId: created.id, billerId: 'sp-services', reference: '12345', amount: '1.00' },
  }), 409);
  assert.equal(accountNamed(await client.dashboard(), main.name).balanceCents, main.balanceCents);
});

test('concurrent distinct requests cannot overspend an account', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const main = accountNamed(await client.dashboard(), 'Main savings');
  const budget = successful(await client.request('/api/accounts', { method: 'POST', body: { name: 'Transfer budget' } })).account;
  successful(await transfer(client, main.id, budget.number, '100.00', 'fund-budget'));
  const requests = await Promise.all([
    transfer(client, budget.id, '1020002001', '100.00', 'spend-budget-1'),
    transfer(client, budget.id, '1020002001', '100.00', 'spend-budget-2'),
  ]);
  assert.equal(requests.filter((result) => result.status >= 200 && result.status < 300).length, 1);
  assert.equal(requests.filter((result) => result.status === 409).length, 1);
  assert.equal(accountNamed(await client.dashboard(), budget.name).balanceCents, 0);
  const recipient = fixture.client();
  await recipient.login('jamie@evergreen.demo');
  assert.equal(totalBalance(await recipient.dashboard()), 130000);
});

test('balances, transaction history, account names and registrations survive a restart', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client();
  await client.login();
  const before = await client.dashboard();
  const main = accountNamed(before, 'Main savings');
  const rainy = accountNamed(before, 'Rainy day');
  successful(await transfer(client, main.id, rainy.number, '2.34', 'persist-transfer'));
  successful(await client.request('/api/payments', {
    method: 'POST', body: { fromAccountId: main.id, billerId: 'sp-services', reference: 'PERSIST123', amount: '5.67', requestId: 'persist-payment' },
  }));
  successful(await client.request(`/api/accounts/${rainy.id}`, { method: 'PATCH', body: { name: 'Emergency savings' } }));
  const expected = await client.dashboard();
  const newcomer = fixture.client();
  await newcomer.session();
  successful(await newcomer.request('/api/auth/register', {
    method: 'POST', body: { name: 'Persistence Test', email: 'persistent@example.com', password: 'StrongPass123!' },
  }));
  await fixture.stop();
  await fixture.start();
  const returning = fixture.client();
  await returning.login();
  const actual = await returning.dashboard();
  assert.deepEqual(actual.accounts, expected.accounts);
  assert.deepEqual(actual.transactions, expected.transactions);
  const repeated = successful(await transfer(returning, main.id, rainy.number, '2.34', 'persist-transfer'));
  assert.ok(expected.transactions.some((entry) => entry.id === repeated.transaction.id));
  assert.deepEqual((await returning.dashboard()).accounts, expected.accounts);
  const registered = fixture.client();
  await registered.login('persistent@example.com', 'StrongPass123!');
  assert.equal((await registered.dashboard()).accounts.length, 1);
});
