'use strict';

const bank = require('./banking');
const { HttpError } = require('./errors');
const { publicUser } = require('./security');
const { instant } = require('./events');

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROWS = `SELECT t.*, a.name AS account_name, a.number AS account_number
  FROM transactions t JOIN accounts a ON a.id = t.account_id`;
const JOIN = 'FROM transactions t JOIN accounts a ON a.id = t.account_id';

function ensureIndexes(db) {
  db.exec(`CREATE INDEX IF NOT EXISTS transactions_history_account_status_date ON transactions(account_id, status, created_at);
    CREATE INDEX IF NOT EXISTS transactions_history_date ON transactions(created_at);`);
}

// All work inside this snapshot is synchronous. No shared-connection read
// transaction survives a response write or an asynchronous service request.
function readSnapshot(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function parameter(params, name) {
  if (params.getAll(name).length > 1) throw new HttpError(400, `Supply ${name} only once.`);
  return params.get(name) || '';
}

function positiveInteger(value, name, fallback, maximum) {
  if (value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `Choose a valid ${name}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new HttpError(400, `Choose a ${name} from 1 to ${maximum}.`);
  return parsed;
}

function dateValue(value, name) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${name} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `Choose a valid ${name.toLowerCase()}.`);
  return value;
}

function singaporeDate(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dayStart(value) {
  return new Date(`${value}T00:00:00.000+08:00`).toISOString();
}

function nextDayStart(value) {
  return new Date(Date.parse(dayStart(value)) + DAY_MS).toISOString();
}

function dateRange(params, defaults = {}) {
  const from = dateValue(parameter(params, 'from'), 'From date') || defaults.from || '';
  const to = dateValue(parameter(params, 'to'), 'To date') || defaults.to || '';
  if (from && to && from > to) throw new HttpError(400, 'The end date must be on or after the start date.');
  return { from, to, start: from ? dayStart(from) : null, end: to ? nextDayStart(to) : null };
}

function filters(db, userId, params) {
  const conditions = ['a.user_id = ?'], values = [userId];
  const selected = parameter(params, 'accountId');
  if (selected) {
    const account = bank.ownedAccount(db, userId, selected, { active: false });
    conditions.push('t.account_id = ?'); values.push(account.id);
  }
  const q = parameter(params, 'q').trim();
  if (q.length > 120) throw new HttpError(400, 'Search text must contain at most 120 characters.');
  if (q) {
    const search = `%${q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const columns = ['t.description', 't.counterparty', 't.reference', 'a.name', 'a.number', 't.id', 'COALESCE(t.payee, t.counterparty)'];
    conditions.push(`(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    values.push(...columns.map(() => search));
  }
  const type = parameter(params, 'type');
  if (type) {
    if (!['transfer', 'bill', 'incoming'].includes(type)) throw new HttpError(400, 'Choose transfer, bill or incoming activity.');
    if (type === 'incoming') conditions.push('t.amount_cents > 0');
    else { conditions.push('t.type = ?'); values.push(type); }
  }
  const status = parameter(params, 'status');
  if (status) {
    if (!['completed', 'pending_review', 'rejected'].includes(status)) throw new HttpError(400, 'Choose a valid transaction status.');
    conditions.push('t.status = ?'); values.push(status);
  }
  const range = dateRange(params);
  if (range.start) { conditions.push('t.created_at >= ?'); values.push(range.start); }
  if (range.end) { conditions.push('t.created_at < ?'); values.push(range.end); }
  return { where: conditions.join(' AND '), values };
}

function pagination(params) {
  return {
    page: positiveInteger(parameter(params, 'page'), 'page', 1, 1000000),
    pageSize: positiveInteger(parameter(params, 'pageSize'), 'page size', 10, 100)
  };
}

function list(db, user, params) {
  return readSnapshot(db, () => {
    const { where, values } = filters(db, user.id, params);
    const { page, pageSize } = pagination(params);
    const stats = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS incomeCents,
      COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END), 0) AS outgoingCents,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS completedCount,
      COALESCE(SUM(CASE WHEN t.status = 'pending_review' THEN 1 ELSE 0 END), 0) AS pendingCount,
      COALESCE(SUM(CASE WHEN t.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejectedCount
      ${JOIN} WHERE ${where}`).get(...values);
    const transactions = db.prepare(`${ROWS} WHERE ${where} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`)
      .all(...values, pageSize, (page - 1) * pageSize).map(bank.transactionView);
    const { total, ...totals } = stats;
    return { transactions, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      totals: { ...totals, netCents: totals.incomeCents - totals.outgoingCents } };
  });
}

function detail(db, user, id) {
  const row = db.prepare(`${ROWS} WHERE t.id = ? AND a.user_id = ?`).get(id, user.id);
  if (!row) throw new HttpError(404, 'Transaction not found.');
  return bank.transactionView(row);
}

function csvText(value) {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(db, user, params, now = Date.now) {
  return readSnapshot(db, () => {
    const { where, values } = filters(db, user.id, params);
    pagination(params); // Export ignores pagination but validates supplied parameters.
    const rows = db.prepare(`SELECT t.created_at, a.name AS account_name, a.number AS account_number,
      t.type, t.description, t.counterparty, t.amount_cents, t.status, t.reference, t.id,
      COALESCE(t.requested_at, t.created_at) AS requested_at,
      COALESCE(t.completed_at, CASE WHEN t.status = 'completed' THEN t.created_at END) AS completed_at
      ${JOIN} WHERE ${where} ORDER BY t.created_at DESC, t.rowid DESC`).all(...values);
    const headings = ['Date', 'Account', 'Account number', 'Type', 'Description', 'Counterparty', 'Amount SGD', 'Status', 'Reference', 'Transaction ID', 'Requested at', 'Completed at'];
    const lines = [headings.map(csvText).join(',')];
    for (const row of rows) {
      const fields = [row.created_at, row.account_name, row.account_number, row.type, row.description,
        row.counterparty, null, row.status, row.reference, row.id, row.requested_at, row.completed_at];
      // The amount column remains numeric, including its legitimate minus sign.
      lines.push(fields.map((value, index) => index === 6 ? (row.amount_cents / 100).toFixed(2) : csvText(value)).join(','));
    }
    return { csv: `\uFEFF${lines.join('\r\n')}\r\n`, filename: `greenlink-activity-${singaporeDate(instant(now))}.csv` };
  });
}

function statement(db, user, params, now = Date.now) {
  return readSnapshot(db, () => {
    const selected = parameter(params, 'accountId');
    if (!selected) throw new HttpError(400, 'Choose an account for the statement.');
    const account = bank.ownedAccount(db, user.id, selected, { active: false });
    const generated = instant(now), today = singaporeDate(generated);
    const range = dateRange(params, { from: `${today.slice(0, 7)}-01`, to: today });
    const completed = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS net, MIN(created_at) AS firstCompletedAt FROM transactions WHERE account_id = ? AND status = 'completed'").get(account.id);
    const baselineCents = account.balance_cents - completed.net;
    const unreconciled = () => new HttpError(409, 'Account history cannot be reconciled with its recorded balance. Contact the project administrator.');
    if (baselineCents < 0 || (completed.firstCompletedAt !== null && completed.firstCompletedAt < account.created_at)) throw unreconciled();
    const before = cutoff => cutoff <= account.created_at ? 0 : baselineCents + db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS net FROM transactions WHERE account_id = ? AND status = 'completed' AND created_at < ?").get(account.id, cutoff).net;
    const openingBalanceCents = before(range.start), closingBalanceCents = before(range.end);
    if (openingBalanceCents < 0 || closingBalanceCents < 0) throw unreconciled();
    const rows = db.prepare(`${ROWS} WHERE t.account_id = ? AND a.user_id = ? AND t.created_at >= ? AND t.created_at < ? ORDER BY t.created_at, t.rowid`)
      .all(account.id, user.id, range.start, range.end);
    const adjustmentCents = baselineCents && account.created_at >= range.start && account.created_at < range.end ? baselineCents : 0;
    let running = openingBalanceCents;
    const transactions = [];
    const addOpening = () => {
      running += adjustmentCents;
      transactions.push({ id: null, isOpeningBalance: true, type: 'credit', description: 'Opening balance carried forward (legacy records)',
        amountCents: adjustmentCents, counterparty: 'Opening balance', status: 'completed', accountId: account.id,
        accountName: account.name, accountNumber: account.number, reference: '', isInternal: false, payee: '',
        risk: null, authorization: null, review: null, createdAt: account.created_at, requestedAt: account.created_at,
        completedAt: account.created_at, runningBalanceCents: running });
    };
    let adjustmentAdded = !adjustmentCents;
    for (const row of rows) {
      if (!adjustmentAdded && row.created_at >= account.created_at) { addOpening(); adjustmentAdded = true; }
      if (row.status === 'completed') running += row.amount_cents;
      if (running < 0) throw unreconciled();
      transactions.push({ ...bank.transactionView(row), runningBalanceCents: running });
    }
    if (!adjustmentAdded) addOpening();
    if (running !== closingBalanceCents) throw unreconciled();
    return { account: bank.accountView(account), user: publicUser(user), period: { from: range.from, to: range.to, timeZone: 'Asia/Singapore' },
      openingBalanceCents, closingBalanceCents, baselineCents, adjustmentCents, transactions,
      generatedAt: generated.toISOString(), currency: 'SGD' };
  });
}

function insights(db, userId, now = Date.now) {
  const generated = instant(now), shifted = new Date(generated.getTime() + 8 * 60 * 60 * 1000);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 5 + index, 1));
    return { month: date.toISOString().slice(0, 7), label: MONTH_LABELS[date.getUTCMonth()], incomeCents: 0, outgoingCents: 0 };
  });
  const aggregates = db.prepare(`SELECT strftime('%Y-%m', t.created_at, '+8 hours') AS month,
    SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS incomeCents,
    SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS outgoingCents
    ${JOIN} WHERE a.user_id = ? AND t.status = 'completed' AND t.internal = 0 AND t.created_at >= ? AND t.created_at <= ?
    GROUP BY month`).all(userId, dayStart(`${months[0].month}-01`), generated.toISOString());
  for (const month of months) {
    const aggregate = aggregates.find(row => row.month === month.month);
    if (aggregate) { month.incomeCents = aggregate.incomeCents; month.outgoingCents = aggregate.outgoingCents; }
  }
  return { timeZone: 'Asia/Singapore', months };
}

module.exports = { ensureIndexes, readSnapshot, list, detail, exportCsv, statement, insights };
