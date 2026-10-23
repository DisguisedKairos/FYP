'use strict';

const { HttpError } = require('../models/errors');
const { accountView, transactionView, accountId, cents } = require('./ledger');
const businesses = require('./business');
const DAY_MS = 86400000;
const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROWS = 'SELECT t.*,a.name AS account_name,a.number AS account_number FROM transactions t JOIN accounts a ON a.id=t.account_id';
const JOIN = 'FROM transactions t JOIN accounts a ON a.id=t.account_id';
const DESC = 't.created_at DESC,COALESCE(t.settlement_seq,t.insert_seq) DESC,t.insert_seq DESC';
const iso = value => new Date(value).toISOString();
const dateNow = now => new Date((now || Date.now)());
const publicUser = user => ({ id: String(user.id), name: user.name, email: user.email, role: user.role || 'customer' });

function parameter(params, name) { if (params.getAll(name).length > 1) throw new HttpError(400, `Supply ${name} only once.`); return params.get(name) || ''; }
function integer(value, fallback, maximum) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) throw new HttpError(400, 'Choose valid pagination values.');
  return Number(value);
}
function pagination(params) { return { page: integer(parameter(params, 'page'), 1, 1000000), pageSize: integer(parameter(params, 'pageSize'), 10, 100) }; }
function validDate(value) {
  if (!value) return '';
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Dates must use YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'Choose a valid calendar date.');
  return value;
}
function singaporeDate(date) { return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
function dayStart(value) { return iso(`${value}T00:00:00.000+08:00`); }
function dateRange(params, defaults = {}) {
  const from = validDate(parameter(params, 'from')) || defaults.from || '', to = validDate(parameter(params, 'to')) || defaults.to || '';
  if (from && to && from > to) throw new HttpError(400, 'The end date must be on or after the start date.');
  return { from, to, start: from ? dayStart(from) : null, end: to ? iso(Date.parse(dayStart(to)) + DAY_MS) : null };
}
async function ownedAccount(db, userId, id) {
  const row = (await db.query('SELECT * FROM accounts WHERE user_id=$1 AND id=$2', [userId, accountId(id)])).rows[0];
  if (!row) throw new HttpError(404, 'Savings account not found.');
  return row;
}
async function filters(db, userId, params) {
  const values = [String(userId)], conditions = ['a.user_id=$1'];
  const add = value => { values.push(value); return `$${values.length}`; };
  const selected = parameter(params, 'accountId');
  if (selected) { const account = await ownedAccount(db, userId, selected); conditions.push(`t.account_id=${add(account.id)}`); }
  const q = parameter(params, 'q').trim();
  if (q.length > 120) throw new HttpError(400, 'Search text must contain at most 120 characters.');
  if (q) {
    const index = add(`%${q.replace(/[\\%_]/g, character => `\\${character}`)}%`);
    const columns = ['t.description', 't.counterparty', 't.reference', 'a.name', 'a.number', 't.id', 'COALESCE(t.payee,t.counterparty)'];
    conditions.push(`(${columns.map(column => `${column} ILIKE ${index} ESCAPE '\\'`).join(' OR ')})`);
  }
  const type = parameter(params, 'type');
  if (type) { if (!['transfer', 'bill', 'incoming'].includes(type)) throw new HttpError(400, 'Choose transfer, bill or incoming activity.'); conditions.push(type === 'incoming' ? 't.amount_cents>0' : `t.type=${add(type)}`); }
  const status = parameter(params, 'status');
  if (status) { if (!['completed', 'pending_review', 'rejected'].includes(status)) throw new HttpError(400, 'Choose a valid transaction status.'); conditions.push(`t.status=${add(status)}`); }
  const range = dateRange(params);
  if (range.start) conditions.push(`t.created_at>=${add(range.start)}::timestamptz`);
  if (range.end) conditions.push(`t.created_at<${add(range.end)}::timestamptz`);
  return { where: conditions.join(' AND '), values };
}
async function snapshot(db, work) { return db.transaction(work, { isolation: 'REPEATABLE READ', readOnly: true }); }
async function list(db, user, params = new URLSearchParams()) {
  return snapshot(db, async client => {
    const { where, values } = await filters(client, user.id, params), { page, pageSize } = pagination(params);
    const row = (await client.query(`SELECT count(*) AS total,
      COALESCE(SUM(t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents>0),0) AS income,
      COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.status='completed' AND t.amount_cents<0),0) AS outgoing,
      count(*) FILTER(WHERE t.status='completed') AS completed,count(*) FILTER(WHERE t.status='pending_review') AS pending,count(*) FILTER(WHERE t.status='rejected') AS rejected
      ${JOIN} WHERE ${where}`, values)).rows[0];
    const transactions = (await client.query(`${ROWS} WHERE ${where} ORDER BY ${DESC} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])).rows.map(transactionView);
    const total = cents(row.total), incomeCents = cents(row.income), outgoingCents = cents(row.outgoing);
    return { transactions, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      totals: { incomeCents, outgoingCents, netCents: incomeCents - outgoingCents, completedCount: cents(row.completed), pendingCount: cents(row.pending), rejectedCount: cents(row.rejected) } };
  });
}
async function detail(db, user, id) {
  const row = (await db.query(`${ROWS} WHERE t.id=$1 AND a.user_id=$2`, [id, user.id])).rows[0];
  if (!row) throw new HttpError(404, 'Transaction not found.');
  return transactionView(row);
}
function csvText(value) { const text = String(value ?? ''); return `"${(/^[\s\u0000-\u001f]*[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`; }
async function exportCsv(db, user, params = new URLSearchParams(), now = Date.now) {
  return snapshot(db, async client => {
    const { where, values } = await filters(client, user.id, params); pagination(params);
    const rows = (await client.query(`${ROWS} WHERE ${where} ORDER BY ${DESC}`, values)).rows;
    const headings = ['Date', 'Account', 'Account number', 'Type', 'Description', 'Counterparty', 'Amount SGD', 'Status', 'Reference', 'Transaction ID', 'Requested at', 'Completed at'];
    const lines = [headings.map(csvText).join(',')];
    for (const row of rows) {
      const fields = [iso(row.created_at), row.account_name, row.account_number, row.type, row.description, row.counterparty, null, row.status, row.reference, row.id, iso(row.requested_at), row.completed_at ? iso(row.completed_at) : ''];
      lines.push(fields.map((value, index) => index === 6 ? (cents(row.amount_cents) / 100).toFixed(2) : csvText(value)).join(','));
    }
    return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, filename: `greenlink-activity-${singaporeDate(dateNow(now))}.csv` };
  });
}
async function statement(db, user, params, now = Date.now) {
  return snapshot(db, async client => {
    const selected = parameter(params, 'accountId');
    if (!selected) throw new HttpError(400, 'Choose an account for the statement.');
    const account = await ownedAccount(client, user.id, selected), generated = dateNow(now), today = singaporeDate(generated);
    const range = dateRange(params, { from: `${today.slice(0, 7)}-01`, to: today });
    const aggregate = (await client.query("SELECT COALESCE(SUM(amount_cents),0) AS net,MIN(completed_at) AS first FROM transactions WHERE account_id=$1 AND status='completed'", [account.id])).rows[0];
    const baselineCents = cents(account.opening_balance_cents), createdAt = iso(account.created_at);
    const corrupt = () => new HttpError(409, 'Account history cannot be reconciled with its recorded balance. Contact the project administrator.');
    // Opening provenance is stored at creation/import; no read invents a baseline
    // from a mutable current balance.
    if (!['new', 'seed', 'legacy_verified'].includes(account.opening_provenance) || baselineCents < 0 || baselineCents + cents(aggregate.net) !== cents(account.balance_cents)
      || (aggregate.first && new Date(aggregate.first) < new Date(createdAt))) throw corrupt();
    async function before(cutoff) {
      if (new Date(cutoff) <= new Date(createdAt)) return 0;
      const row = (await client.query("SELECT COALESCE(SUM(amount_cents),0) AS net FROM transactions WHERE account_id=$1 AND status='completed' AND completed_at<$2::timestamptz", [account.id, cutoff])).rows[0];
      return baselineCents + cents(row.net);
    }
    const openingBalanceCents = await before(range.start), closingBalanceCents = await before(range.end);
    if (openingBalanceCents < 0 || closingBalanceCents < 0) throw corrupt();
    const rows = (await client.query(`${ROWS} WHERE t.account_id=$1 AND a.user_id=$2 AND t.created_at>=$3::timestamptz AND t.created_at<$4::timestamptz
      ORDER BY t.created_at,COALESCE(t.settlement_seq,t.insert_seq),t.insert_seq`, [account.id, user.id, range.start, range.end])).rows;
    const adjustmentCents = baselineCents && createdAt >= range.start && createdAt < range.end ? baselineCents : 0;
    let running = openingBalanceCents, added = !adjustmentCents;
    const transactions = [];
    function addOpening() {
      running += adjustmentCents;
      transactions.push({ id: null, isOpeningBalance: true, type: 'credit', description: `Opening balance (${account.opening_provenance === 'legacy_verified' ? 'verified legacy import' : 'recorded at account creation'})`,
        amountCents: adjustmentCents, counterparty: 'Opening balance', status: 'completed', accountId: String(account.id), accountName: account.name, accountNumber: account.number,
        reference: '', isInternal: false, payee: '', risk: null, authorization: null, review: null, createdAt, requestedAt: createdAt, completedAt: createdAt, runningBalanceCents: running });
      added = true;
    }
    for (const row of rows) {
      if (!added && iso(row.created_at) >= createdAt) addOpening();
      if (row.status === 'completed') running += cents(row.amount_cents);
      if (running < 0) throw corrupt();
      transactions.push({ ...transactionView(row), runningBalanceCents: running });
    }
    if (!added) addOpening();
    if (running !== closingBalanceCents) throw corrupt();
    return { account: accountView(account), business:await businesses.own(client,user), user: publicUser(user), period: { from: range.from, to: range.to, timeZone: 'Asia/Singapore' },
      openingBalanceCents, closingBalanceCents, baselineCents, adjustmentCents, openingProvenance: account.opening_provenance, transactions, generatedAt: generated.toISOString(), currency: 'SGD' };
  });
}
async function insights(db, userId, now = Date.now) {
  const generated = dateNow(now), shifted = new Date(generated.getTime() + 8 * 3600000);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 5 + index, 1));
    return { month: date.toISOString().slice(0, 7), label: LABELS[date.getUTCMonth()], incomeCents: 0, outgoingCents: 0 };
  });
  const rows = (await db.query(`SELECT to_char(t.completed_at AT TIME ZONE 'Asia/Singapore','YYYY-MM') AS month,
    COALESCE(SUM(t.amount_cents) FILTER(WHERE t.amount_cents>0),0) AS income,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.amount_cents<0),0) AS outgoing
    ${JOIN} WHERE a.user_id=$1 AND t.status='completed' AND NOT t.internal AND t.completed_at>=$2::timestamptz AND t.completed_at<=$3::timestamptz GROUP BY month`,
  [userId, dayStart(`${months[0].month}-01`), generated.toISOString()])).rows;
  for (const month of months) { const row = rows.find(row => row.month === month.month); if (row) { month.incomeCents = cents(row.income); month.outgoingCents = cents(row.outgoing); } }
  return { timeZone: 'Asia/Singapore', months };
}
async function dashboard(db, userId, { now = Date.now } = {}) {
  return snapshot(db, async client => {
    const generated = dateNow(now), since = new Date(generated.getTime() - 30 * DAY_MS).toISOString();
    const accounts = (await client.query('SELECT * FROM accounts WHERE user_id=$1 ORDER BY id', [userId])).rows;
    const transactions = (await client.query(`${ROWS} WHERE a.user_id=$1 ORDER BY ${DESC} LIMIT 10`, [userId])).rows.map(transactionView);
    const sums = (await client.query(`SELECT COALESCE(SUM(t.amount_cents) FILTER(WHERE t.amount_cents>0),0) AS income,COALESCE(SUM(-t.amount_cents) FILTER(WHERE t.amount_cents<0),0) AS outgoing
      ${JOIN} WHERE a.user_id=$1 AND t.status='completed' AND NOT t.internal AND t.completed_at>=$2::timestamptz AND t.completed_at<=$3::timestamptz`, [userId, since, generated.toISOString()])).rows[0];
    const billers = (await client.query('SELECT * FROM billers ORDER BY id')).rows;
    return { business:await businesses.own(client,{id:userId}),accounts: accounts.filter(row => row.status === 'active').map(accountView), closedAccounts: accounts.filter(row => row.status === 'closed').map(accountView), transactions, billers,
      summary: { incomeCents: cents(sums.income), outgoingCents: cents(sums.outgoing) }, insights: await insights(client, userId, () => generated) };
  });
}

module.exports = { list, detail, exportCsv, statement, insights, dashboard, ownedAccount, pagination, dateRange, snapshot };
