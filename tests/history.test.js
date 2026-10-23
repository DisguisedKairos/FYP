const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createFixture, riskClientFor } = require('./helpers');

function success(result) { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; }
const query = values => new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
const statement = async (client, values) => success(await client.request(`/api/statements?${query(values)}`)).statement;
async function openAccount(client, name = 'History fixture') {
  const result = await client.request('/api/accounts', { method: 'POST', body: { name } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.account;
}
function seedLedger(fixture, account, entries, { baseline = 0, name = account.name } = {}) {
  const db = new DatabaseSync(fixture.dbPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    const add = db.prepare(`INSERT INTO transactions
      (id,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,payee)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const rows = entries.map((entry, index) => ({
      id: randomUUID(), type: entry.amountCents > 0 ? 'credit' : 'bill', status: 'completed',
      description: `History item ${index}`, counterparty: 'History provider', reference: `HIST-${index}`, internal: 0,
      ...entry,
    }));
    for (const row of rows) add.run(row.id, account.id, row.type, row.description, row.amountCents, row.counterparty,
      row.status, row.reference, row.internal, row.createdAt, row.createdAt, row.status === 'completed' ? row.createdAt : null, row.counterparty);
    const balance = baseline + rows.filter(row => row.status === 'completed').reduce((sum, row) => sum + row.amountCents, 0);
    db.prepare('UPDATE accounts SET name=?,balance_cents=?,created_at=? WHERE id=?').run(name, balance, '2023-01-01T00:00:00.000Z', account.id);
    db.exec('COMMIT');
    return rows;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
function parseCsv(input) {
  const rows = []; let row = [], cell = '', quoted = false;
  const text = input.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell.replace(/\r$/, '')); cell = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

test('server history paginates the entire ledger independently from the ten dashboard transactions', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client);
  const rows = seedLedger(fixture, account, Array.from({ length: 250 }, (_, index) => ({
    description: `Archive batch ${index}`, amountCents: 1, createdAt: '2024-05-01T00:00:00.000Z',
  })));
  const dashboard = await client.dashboard();
  assert.equal(dashboard.transactions.length, 10);
  assert.ok(JSON.stringify(dashboard).length < 40000, 'dashboard payload stays bounded');
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const result = await client.history({ accountId: account.id, page, pageSize: 50 });
    assert.deepEqual(result.pagination, { page, pageSize: 50, total: 250, totalPages: 5 });
    assert.equal(result.transactions.length, 50);
    assert.equal(result.totals.incomeCents, 250);
    assert.equal(result.totals.netCents, 250);
    all.push(...result.transactions.map(row => row.id));
  }
  assert.equal(new Set(all).size, 250);
  assert.deepEqual(new Set(all), new Set(rows.map(row => row.id)));
  assert.deepEqual((await client.history({ accountId: account.id, page: 1, pageSize: 50 })).transactions.map(row => row.id), all.slice(0, 50));
  const beyond = await client.history({ accountId: account.id, page: 6, pageSize: 50 });
  assert.equal(beyond.transactions.length, 0);
  assert.equal(beyond.pagination.total, 250);
  const oldest = rows[0];
  assert.ok(!dashboard.transactions.some(row => row.id === oldest.id));
  assert.equal(success(await client.request(`/api/transactions/${oldest.id}`)).transaction.id, oldest.id);
  const report = await statement(client, { accountId: account.id, from: '2024-05-01', to: '2024-05-01' });
  assert.equal(report.transactions.length, 250);
  assert.equal(report.openingBalanceCents, 0);
  assert.equal(report.closingBalanceCents, 250);
  assert.deepEqual(report.transactions.map(row => row.runningBalanceCents), Array.from({ length: 250 }, (_, index) => index + 1));
  const exportResult = await client.request(`/api/transactions/export?${query({ accountId: account.id, page: 2, pageSize: 1 })}`, { responseType: 'text' });
  assert.equal(exportResult.status, 200);
  assert.equal(parseCsv(exportResult.data).length, 251, 'CSV exports every filtered match, regardless of the visible page');
});

test('Singapore date bounds include leap-day edges and pending or rejected entries never change statement balances', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'SGT dates');
  const rows = seedLedger(fixture, account, [
    { amountCents: 10000, createdAt: '2024-02-27T15:59:59.999Z' },
    { amountCents: 1000, createdAt: '2024-02-27T16:00:00.000Z' },
    { amountCents: -200, createdAt: '2024-02-28T15:59:59.999Z' },
    { amountCents: -900, status: 'pending_review', createdAt: '2024-02-28T15:59:59.999Z' },
    { amountCents: -800, status: 'rejected', createdAt: '2024-02-28T15:59:59.999Z' },
    { amountCents: 500, createdAt: '2024-02-28T16:00:00.000Z' },
    { amountCents: -300, createdAt: '2024-02-29T15:59:59.999Z' },
    { amountCents: 700, createdAt: '2024-02-29T16:00:00.000Z' },
  ]);
  const feb28 = await client.history({ accountId: account.id, from: '2024-02-28', to: '2024-02-28', pageSize: 100 });
  assert.deepEqual(new Set(feb28.transactions.map(row => row.id)), new Set(rows.slice(1, 5).map(row => row.id)));
  assert.deepEqual(feb28.totals, { incomeCents: 1000, outgoingCents: 200, netCents: 800, completedCount: 2, pendingCount: 1, rejectedCount: 1 });
  const report = await statement(client, { accountId: account.id, from: '2024-02-28', to: '2024-02-29' });
  assert.equal(report.period.timeZone, 'Asia/Singapore');
  assert.equal(report.openingBalanceCents, 10000);
  assert.equal(report.closingBalanceCents, 11000);
  assert.deepEqual(report.transactions.map(row => row.id), rows.slice(1, 7).map(row => row.id), 'equal timestamp entries retain ledger insertion order');
  assert.deepEqual(report.transactions.map(row => row.runningBalanceCents), [11000, 10800, 10800, 10800, 11300, 11000]);
  const leapDay = await statement(client, { accountId: account.id, from: '2024-02-29', to: '2024-02-29' });
  assert.equal(leapDay.openingBalanceCents, 10800); assert.equal(leapDay.closingBalanceCents, 11000);
  const march = await statement(client, { accountId: account.id, from: '2024-03-01', to: '2024-03-01' });
  assert.equal(march.openingBalanceCents, 11000); assert.equal(march.closingBalanceCents, 11700);
});

test('closed-account statements retain a migrated opening baseline and exclude later completed activity from historical closing balances', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'Historical closed account');
  const rows = seedLedger(fixture, account, [
    { amountCents: 500, createdAt: '2024-02-10T00:00:00.000Z' },
    { amountCents: -1500, createdAt: '2024-03-01T00:00:00.000Z' },
  ], { baseline: 1000 });
  assert.equal((await client.request(`/api/accounts/${account.id}`, { method: 'DELETE', body: {} })).status, 200);
  const report = await statement(client, { accountId: account.id, from: '2024-02-01', to: '2024-02-29' });
  assert.equal(report.account.status, 'closed');
  assert.equal(report.openingBalanceCents, 1000); assert.equal(report.closingBalanceCents, 1500);
  assert.equal(report.transactions[0].runningBalanceCents, 1500);
  assert.equal((await client.history({ accountId: account.id })).pagination.total, 2);
  assert.equal(success(await client.request(`/api/transactions/${rows[0].id}`)).transaction.id, rows[0].id);
  const empty = await statement(client, { accountId: account.id, from: '2024-01-01', to: '2024-01-31' });
  assert.equal(empty.transactions.length, 0); assert.equal(empty.openingBalanceCents, 1000); assert.equal(empty.closingBalanceCents, 1000);
});

test('a positive legacy baseline is carried forward only when its account has opened, and an inconsistent negative baseline is rejected', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'Legacy account creation');
  seedLedger(fixture, account, [{ amountCents: 500, createdAt: '2024-02-10T00:00:00.000Z' }], { baseline: 1000 });
  const beforeCreation = await statement(client, { accountId: account.id, from: '2022-12-01', to: '2022-12-31' });
  assert.equal(beforeCreation.openingBalanceCents, 0); assert.equal(beforeCreation.closingBalanceCents, 0);
  assert.equal(beforeCreation.transactions.length, 0);
  const crossing = await statement(client, { accountId: account.id, from: '2022-12-31', to: '2023-01-01' });
  assert.equal(crossing.openingBalanceCents, 0); assert.equal(crossing.closingBalanceCents, 1000);
  assert.equal(crossing.baselineCents, 1000); assert.equal(crossing.adjustmentCents, 1000);
  assert.equal(crossing.transactions.length, 1);
  assert.equal(crossing.transactions[0].id, null); assert.equal(crossing.transactions[0].isOpeningBalance, true);
  assert.equal(crossing.transactions[0].runningBalanceCents, 1000);
  assert.equal((await client.history({ accountId: account.id })).pagination.total, 1, 'statement carry-forward never inserts a ledger transaction');
  const invalid = await openAccount(client, 'Inconsistent legacy account');
  seedLedger(fixture, invalid, [{ amountCents: 500, createdAt: '2024-02-10T00:00:00.000Z' }], { baseline: -100 });
  assert.equal((await client.request(`/api/statements?${query({ accountId: invalid.id, from: '2024-02-01', to: '2024-02-29' })}`)).status, 409);
});

test('same-timestamp review approval follows actual settlement order without changing public transaction IDs', async (t) => {
  let decision = 'allow';
  const fixedNow = Date.now() + 60000;
  const fixture = await createFixture(t, { now: () => fixedNow, riskClient: riskClientFor(() => decision) });
  const maker = fixture.client(), reviewer = fixture.client();
  await maker.login(); await reviewer.login('reviewer@greenlink.demo');
  const main = (await maker.dashboard()).accounts.find(account => account.number === '1020001001');
  const budget = await openAccount(maker, 'Settlement ordering');
  const transfer = async (from, to, description, requestId) => {
    const result = await maker.request('/api/transfers', { method: 'POST', body: {
      fromAccountId: from.id, toAccountNumber: to, amount: '20.00', description, requestId,
    } });
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data));
    return result.data.transaction;
  };
  await transfer(main, budget.number, 'First funding', 'order-fund');
  decision = 'review';
  const held = await transfer(budget, '1020002001', 'Held recipient transfer', 'order-held');
  assert.equal(held.status, 'pending_review');
  decision = 'allow';
  await transfer(budget, main.number, 'Drain budget', 'order-drain');
  await transfer(main, budget.number, 'Refill budget', 'order-refill');
  const reviewBody = { decision: 'approve', reason: 'Independently checked available funds.', authorizationPassword: 'Greenlink123!' };
  const approved = success(await reviewer.request(`/api/fraud/reviews/${held.id}`, { method: 'POST', body: reviewBody })).transaction;
  assert.equal(approved.id, held.id); assert.equal(approved.status, 'completed');
  const date = new Date(fixedNow + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const report = await statement(maker, { accountId: budget.id, from: date, to: date });
  assert.deepEqual(report.transactions.map(row => row.description), ['First funding', 'Drain budget', 'Refill budget', 'Held recipient transfer']);
  assert.deepEqual(report.transactions.map(row => row.runningBalanceCents), [2000, 0, 2000, 0]);
  assert.equal(report.openingBalanceCents, 0); assert.equal(report.closingBalanceCents, 0);
  assert.equal(success(await maker.request(`/api/transactions/${held.id}`)).transaction.status, 'completed');
  assert.equal((await transfer(budget, '1020002001', 'Held recipient transfer', 'order-held')).status, 'completed');
  assert.equal(success(await reviewer.request(`/api/fraud/reviews/${held.id}`, { method: 'POST', body: reviewBody })).transaction.id, held.id);
  assert.equal((await maker.history({ accountId: budget.id })).pagination.total, 4, 'retries never settle the held debit twice');
  await fixture.stop(); await fixture.start();
  assert.deepEqual((await statement(maker, { accountId: budget.id, from: date, to: date })).transactions, report.transactions, 'settlement order persists across restart');
});

test('statements reject completed records before account creation and irreconcilable legacy running balances', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const early = await openAccount(client, 'Invalid creation timeline');
  seedLedger(fixture, early, [{ amountCents: 100, createdAt: '2024-02-01T00:00:00.000Z' }]);
  const db = new DatabaseSync(fixture.dbPath);
  try { db.prepare('UPDATE accounts SET created_at=? WHERE id=?').run('2024-02-02T00:00:00.000Z', early.id); }
  finally { db.close(); }
  for (const from of ['2024-02-01', '2024-03-01']) {
    const result = await client.request(`/api/statements?${query({ accountId: early.id, from, to: from })}`);
    assert.equal(result.status, 409, 'a completed record cannot exist before the account opens');
    assert.match(result.data.error, /cannot be reconciled/i);
  }
  const ambiguous = await openAccount(client, 'Legacy ambiguous order');
  seedLedger(fixture, ambiguous, [
    { amountCents: 2000, createdAt: '2024-02-01T00:00:00.000Z' },
    { amountCents: -2000, createdAt: '2024-02-01T00:00:00.000Z' },
    { amountCents: -2000, createdAt: '2024-02-01T00:00:00.000Z' },
    { amountCents: 2000, createdAt: '2024-02-01T00:00:00.000Z' },
  ]);
  const invalid = await client.request(`/api/statements?${query({ accountId: ambiguous.id, from: '2024-02-01', to: '2024-02-01' })}`);
  assert.equal(invalid.status, 409, 'unknown legacy settlement order must not fabricate a negative balance or invented reordering');
  assert.match(invalid.data.error, /cannot be reconciled/i);
});

test('search treats SQL wildcard and quote characters literally while combined filters and totals use all matches', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'Literal search account');
  const rows = seedLedger(fixture, account, [
    { description: 'Discount 10%_ literal', reference: 'UNIQUE-REF', amountCents: 1000, createdAt: '2024-01-01T00:00:00.000Z' },
    { description: 'Discount 10xx wildcard', amountCents: -100, type: 'transfer', createdAt: '2024-01-02T00:00:00.000Z' },
    { description: "Quotation ' is text", amountCents: -200, status: 'pending_review', createdAt: '2024-01-03T00:00:00.000Z' },
    { description: 'Rejected transfer', amountCents: -300, type: 'transfer', status: 'rejected', createdAt: '2024-01-04T00:00:00.000Z' },
  ]);
  const literal = await client.history({ accountId: account.id, q: '%_' });
  assert.deepEqual(literal.transactions.map(row => row.id), [rows[0].id]);
  assert.equal((await client.history({ accountId: account.id, q: "' OR 1=1 --" })).pagination.total, 0);
  assert.equal((await client.history({ q: '  UNIQUE-REF  ' })).pagination.total, 1);
  assert.equal((await client.history({ q: 'Literal search account' })).pagination.total, 4);
  assert.equal((await client.history({ q: account.number })).pagination.total, 4);
  const transfers = await client.history({ accountId: account.id, type: 'transfer', status: 'completed', pageSize: 1 });
  assert.equal(transfers.pagination.total, 1); assert.equal(transfers.totals.outgoingCents, 100);
  assert.equal((await client.history({ accountId: account.id, type: 'incoming' })).pagination.total, 1);
});

test('history, detail, export and statements enforce authentication and account ownership', async (t) => {
  const fixture = await createFixture(t);
  const owner = fixture.client(); const other = fixture.client(); const anonymous = fixture.client();
  await owner.login(); await other.login('jamie@greenlink.demo');
  const account = (await owner.dashboard()).accounts[0];
  const transaction = (await owner.history()).transactions[0];
  for (const path of ['/api/transactions', `/api/transactions/${transaction.id}`, '/api/transactions/export', `/api/statements?accountId=${account.id}`]) {
    assert.equal((await anonymous.request(path)).status, 401);
  }
  for (const path of [`/api/transactions?accountId=${account.id}`, `/api/transactions/${transaction.id}`, `/api/transactions/export?accountId=${account.id}`, `/api/statements?accountId=${account.id}`]) {
    assert.equal((await other.request(path)).status, 404);
  }
  assert.equal((await owner.request(`/api/transactions/${randomUUID()}`)).status, 404);
  assert.equal((await owner.request('/api/statements')).status, 400);
  assert.equal((await other.history()).transactions.some(row => row.id === transaction.id), false);
});

test('invalid history pagination, filters and real calendar dates produce validation errors', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const accountId = (await client.dashboard()).accounts[0].id;
  for (const filters of [
    { page: 0 }, { page: -1 }, { page: '1.5' }, { pageSize: 0 }, { pageSize: 101 }, { type: 'unknown' }, { status: 'unknown' },
    { q: 'x'.repeat(121) }, { from: '2023-02-29' }, { from: '2024-02-30' }, { from: '2024-2-01' }, { from: '2024-03-02', to: '2024-03-01' },
    { accountId: '1 OR 1=1' },
  ]) assert.equal((await client.request(`/api/transactions?${query(filters)}`)).status, 400, JSON.stringify(filters));
  assert.equal((await client.request(`/api/statements?${query({ accountId, from: '2024-02-30' })}`)).status, 400);
  assert.equal((await client.request(`/api/statements?${query({ accountId, from: '2024-03-01', to: '2024-02-01' })}`)).status, 400);
  const none = await client.history({ q: randomUUID() });
  assert.equal(none.pagination.total, 0); assert.equal(none.pagination.totalPages, 0); assert.equal(none.transactions.length, 0);
});

test('CSV exports protect formula-like text, preserve multiline quoting and keep signed amounts numeric', async (t) => {
  const fixture = await createFixture(t);
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'CSV fixture');
  seedLedger(fixture, account, [
    { description: 'Opening', amountCents: 1000, createdAt: '2024-01-01T00:00:00.000Z' },
    { description: '=SUM(1,2)\nQuoted "detail"', counterparty: '+External', reference: '@REFERENCE', amountCents: -123, createdAt: '2024-01-02T00:00:00.000Z' },
  ]);
  const result = await client.request(`/api/transactions/export?${query({ accountId: account.id, type: 'bill' })}`, { responseType: 'text' });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /text\/csv/);
  assert.match(result.headers.get('content-disposition'), /attachment;.*\.csv/i);
  const [headers, row] = parseCsv(result.data);
  assert.equal(row[headers.indexOf('Description')], '\'=SUM(1,2)\nQuoted "detail"');
  assert.equal(row[headers.indexOf('Counterparty')], "'+External");
  assert.equal(row[headers.indexOf('Reference')], "'@REFERENCE");
  assert.equal(row[headers.indexOf('Amount SGD')], '-1.23');
  assert.equal(Number(row[headers.indexOf('Amount SGD')]), -1.23);
});

test('dashboard SQL insights use Singapore months and exclude internal, held and rejected activity', async (t) => {
  const fixture = await createFixture(t, { now: () => Date.parse('2024-03-01T01:00:00.000Z') });
  const client = fixture.client(); await client.login();
  const account = await openAccount(client, 'Insights fixture');
  seedLedger(fixture, account, [
    { amountCents: 1000, createdAt: '2024-02-29T15:59:59.999Z' },
    { amountCents: 200, createdAt: '2024-02-29T16:00:00.000Z' },
    { amountCents: -100, createdAt: '2024-03-01T00:00:00.000Z' },
    { amountCents: -50, internal: 1, type: 'transfer', createdAt: '2024-03-01T00:00:00.000Z' },
    { amountCents: 50, internal: 1, type: 'transfer', createdAt: '2024-03-01T00:00:00.000Z' },
    { amountCents: -300, status: 'pending_review', createdAt: '2024-03-01T00:00:00.000Z' },
    { amountCents: -400, status: 'rejected', createdAt: '2024-03-01T00:00:00.000Z' },
  ]);
  const dashboard = await client.dashboard();
  assert.equal(dashboard.insights.timeZone, 'Asia/Singapore');
  assert.equal(dashboard.insights.months.length, 6);
  const february = dashboard.insights.months.find(month => month.month === '2024-02');
  const march = dashboard.insights.months.find(month => month.month === '2024-03');
  assert.equal(february.incomeCents, 1000); assert.equal(february.outgoingCents, 0);
  assert.equal(march.incomeCents, 200); assert.equal(march.outgoingCents, 100);
});

test('fraud rule audit is administrator-only and exposes actual paginated before and after rule changes', async (t) => {
  const fixture = await createFixture(t, { riskClient: null });
  const admin = fixture.client(); const customer = fixture.client();
  await admin.login(); await customer.login('jamie@greenlink.demo');
  assert.equal((await customer.request('/api/fraud/rules/audit')).status, 403);
  let rules = success(await admin.request('/api/fraud/rules'));
  for (const threshold of [15000, 20000]) {
    rules = success(await admin.request('/api/fraud/rules/high_value', { method: 'PATCH', body: { threshold, version: rules.version } }));
  }
  const first = success(await admin.request('/api/fraud/rules/audit?ruleId=high_value&page=1&pageSize=1'));
  const second = success(await admin.request('/api/fraud/rules/audit?ruleId=high_value&page=2&pageSize=1'));
  assert.equal(first.pagination.total, 2); assert.equal(first.pagination.totalPages, 2);
  assert.equal(first.entries.length, 1); assert.equal(second.entries.length, 1);
  assert.notEqual(first.entries[0].id, second.entries[0].id);
  assert.equal(first.entries[0].after.threshold, 20000); assert.equal(first.entries[0].before.threshold, 15000);
  assert.equal(second.entries[0].before.threshold, 10000);
  assert.equal(first.entries[0].actor.id, String((await admin.dashboard()).user.id));
  assert.equal(first.entries[0].actor.name, 'Alex Morgan');
  assert.equal(JSON.stringify(first).includes('Greenlink123!'), false);
  assert.equal((await admin.request('/api/fraud/rules/audit?page=0')).status, 400);
  assert.equal((await admin.request('/api/fraud/rules/audit?pageSize=101')).status, 400);
});
