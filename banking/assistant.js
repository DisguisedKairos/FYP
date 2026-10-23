'use strict';

// Deliberately bounded, local intent parsing. No prompts, conversations or
// banking records are sent to a model provider, and this module has no write API.
const bank = require('./ledger');
const history = require('./history');
const schedules = require('./workflows');
const { HttpError } = require('../models/errors');

const SENSITIVE = /\b(password|passcode|otp|pin|cvv|secret|api[ -]?key|access[ -]?token)\b|\b[A-Za-z]{5,40}123!|\bsk-[A-Za-z0-9_-]{8,}/i;
const SUGGESTIONS = ['What is my balance?', 'Show recent transactions', 'Show scheduled payments', 'Explain my latest flagged transaction'];
const navigate = (page, label, filters) => ({ type: 'navigate', page, label, ...(filters ? { filters } : {}) });
const result = (intent, reply, extra = {}) => ({ ok: true, intent, reply, actions: [], suggestions: SUGGESTIONS,
  privacy: { sessionOnly: true, externalServices: false }, ...extra });
const formatMoney = cents => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(cents / 100);

async function accounts(db, user) {
  return (await db.query("SELECT * FROM accounts WHERE user_id=$1 AND status='active' ORDER BY id", [user.id])).rows;
}

function accountItem(row) {
  return { type: 'account', id: row.id, title: row.name, accountNumber: row.number, amountCents: Number(row.balance_cents), status: row.status };
}

function transactionItem(row) {
  return { type: 'transaction', id: row.id, title: row.description, subtitle: row.counterparty,
    amountCents: row.amountCents, status: row.status, date: row.createdAt };
}

function ownedSource(rows, name) {
  if (!name) return rows[0];
  const text = name.trim().toLowerCase().replace(/^my\s+/, '');
  return rows.find(row => row.number === text || row.name.toLowerCase() === text);
}

function draftAmount(value) {
  try { return bank.parseAmount(value.replace(/,/g, '')); } catch { return null; }
}

function transferDraft(message, rows, db, user) {
  const match = message.match(/^(?:please\s+)?(?:transfer|send|move)\s+(?:(?:SGD|S\$|\$)\s*)?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\s+(?:for|with\s+note)\s+(.+))?[.!]?$/i);
  if (!match) return result('draft_transfer', 'Open the transfer form to choose your business savings account, recipient and amount. Review the details and authorize with your password.', { actions: [navigate('transfers', 'Prepare transfer')], requiresAuthorization: true });
  const cents = draftAmount(match[1]), source = ownedSource(rows, match[2]);
  if (!source || !cents) return result('draft_transfer', 'Choose one of your active savings accounts and a positive amount with up to two decimal places in the transfer form.', { actions: [navigate('transfers', 'Prepare transfer')], requiresAuthorization: true });
  const target = match[3].trim().replace(/^my\s+/i, '');
  const ownTarget = rows.find(row => row.name.toLowerCase() === target.toLowerCase() || row.number === target);
  // Harbour Supplies is an explicitly published demo business, never a customer directory.
  // Only an owned seeded demo identity receives this demo convenience.
  const isDemo = user.email === 'alex@greenlink.demo' && rows.some(row => row.number === '1020001001' && row.opening_provenance === 'seed');
  const demoTarget = /^harbour supplies(?: pte\.? ltd\.?)?$/i.test(target) && isDemo ? '1020002001' : '';
  const number = ownTarget?.number || (/^\d{10}$/.test(target) ? target : demoTarget);
  if (!number) return result('draft_transfer', 'Please enter the recipient’s 10-digit account number in the transfer form. I cannot look up other customers by name.', { actions: [navigate('transfers', 'Choose recipient')], requiresAuthorization: true });
  if (number === source.number) return result('draft_transfer', 'Choose a different destination account in the transfer form.', { actions: [navigate('transfers', 'Prepare transfer')], requiresAuthorization: true });
  if (cents > source.balance_cents) return result('draft_transfer', 'That amount exceeds the available balance in your selected savings account. Adjust the amount or choose another account in the transfer form.', { actions: [navigate('transfers', 'Adjust transfer')], requiresAuthorization: true });
  return result('draft_transfer', `I prepared a draft for ${formatMoney(cents)} from ${source.name}. Check the recipient in the transfer form, then review and authorize. No money has moved.`, {
    requiresAuthorization: true, actions: [{ type: 'draft_transfer', label: 'Review transfer draft', draft: {
      fromAccountId: source.id, toAccountNumber: number, amount: (cents / 100).toFixed(2), description: (match[4] || 'Assistant draft').slice(0, 100)
    } }]
  });
}

async function paymentDraft(message, rows, db) {
  const match = message.match(/^(?:please\s+)?pay\s+(?:(?:SGD|S\$|\$)\s*)?(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(?:to\s+)?(.+?)(?:\s+(?:reference|ref)\s+([A-Za-z0-9 _./-]{1,64}))?[.!]?$/i);
  const billers = (await db.query('SELECT id, name FROM billers')).rows;
  const biller = match && billers.find(row => row.name.toLowerCase() === match[2].trim().toLowerCase());
  const cents = match && draftAmount(match[1]), source = rows[0];
  if (!source || !biller || !cents) return result('draft_payment', 'Choose SP Services, Singtel or PUB in the bill payment form, then enter the amount and billing reference. Your password is required at review.', { actions: [navigate('payments', 'Prepare bill payment')], requiresAuthorization: true });
  if (cents > source.balance_cents) return result('draft_payment', 'That amount exceeds the available balance in your main savings account. Choose another account or adjust the amount in the bill payment form.', { actions: [navigate('payments', 'Adjust bill payment')], requiresAuthorization: true });
  return result('draft_payment', `I prepared a ${formatMoney(cents)} bill payment draft for ${biller.name}. Check the account and billing reference, then review and authorize. No money has moved.`, {
    requiresAuthorization: true, actions: [{ type: 'draft_payment', label: 'Review bill payment draft', draft: {
      fromAccountId: source.id, billerId: biller.id, reference: match[3]?.trim() || '', amount: (cents / 100).toFixed(2)
    } }]
  });
}

async function answer(context) {
  const { db, user, body = {} } = context;
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) throw new HttpError(400, 'Enter a message of 1–1,000 characters.');
  const message = body.message.trim();
  if (SENSITIVE.test(message)) return result('privacy', 'Keep passwords, PINs and security codes out of chat. Use the password field in the banking review screen to authorize a payment. Your message was not retained.', { sensitiveInput: true });
  if (/\b(?:privacy|private|data sharing|external|store.*chat|save.*chat)\b/i.test(message)) return result('privacy', 'I process supported banking questions locally using your signed-in records. Chat messages stay in browser memory until you clear them, sign out or reload. They are not stored by this service or sent to an external AI provider.');
  // Ambiguous authorizations and operational changes always hand off.
  if (/\b(?:approve|confirm|authorize|authorise|execute|cancel|delete|change.*rule|disable.*rule|ignore.*rule)\b/i.test(message)) return result('handoff', 'Use the banking screen to review and carry out that action. Chat cannot authorize transactions, cancel schedules or change fraud rules.', { actions: [navigate(/rule|fraud|review/i.test(message) && user.role === 'admin' ? 'fraud' : /schedul/i.test(message) ? 'schedules' : 'activity', 'Open banking screen')] });
  const rows = await accounts(db, user);
  if (/\bschedul|\bupcoming\b/i.test(message)) {
    if (/\b(?:create|set up|new|pay|transfer|send)\b/i.test(message)) return result('schedules', 'Choose a future date and frequency in the scheduled payment form. Review and authorize there; chat has not created a schedule.', { actions: [navigate('schedules', 'Open scheduled payments')], requiresAuthorization: true });
    const selected = (await schedules.listSchedules(db, user)).slice(0, 5);
    return result('schedules', selected.length ? 'Here are your most recent payment schedules. Open scheduled payments for their complete run history.' : 'You have no scheduled payments yet.', {
      items: selected.map(row => ({ type: 'schedule', id: row.id, title: row.billerName || row.description || 'Scheduled transfer', amountCents: -row.amountCents, status: row.status, date: row.nextRunAt || row.scheduledAt, subtitle: row.frequency })), actions: [navigate('schedules', 'View scheduled payments')]
    });
  }
  if (/^(?:please\s+)?(?:transfer|send|move)\b/i.test(message) || /\bhelp.*transfer\b/i.test(message)) return transferDraft(message, rows, db, user);
  if (/^(?:please\s+)?pay\b/i.test(message) || /\b(?:bill payment|pay.*bill)\b/i.test(message)) return paymentDraft(message, rows, db);
  // Explicit read references are checked before intent handling. Even an admin
  // assistant cannot inspect another customer's account or transaction.
  const accountNumber = message.match(/\b\d{10}\b/)?.[0];
  const referencedAccount = accountNumber ? (await db.query('SELECT * FROM accounts WHERE user_id=$1 AND number=$2', [user.id, accountNumber])).rows[0] : null;
  if (accountNumber && !referencedAccount) return result('privacy', 'I can show only accounts linked to your signed-in business. Open your account dashboard to see your balances.', { actions: [navigate('accounts', 'Your accounts')] });
  if (/\b(?:balance|accounts?|savings)\b/i.test(message) && !/\b(?:transaction|search|find|flag|risk)\b/i.test(message)) {
    if (!referencedAccount && /(?:\b(?:their|his|her|someone|another|other customer)\b|\b\w+[’']s\s+(?:account|balance)|\bbalance\s+(?:of|for)\s+(?!my\b|me\b|account\b))/i.test(message)) return result('privacy', 'I can show only accounts linked to your signed-in business.', { actions: [navigate('accounts', 'Your accounts')] });
    const selected = referencedAccount ? [referencedAccount] : rows;
    return result(/balance/i.test(message) ? 'balance' : 'accounts', `Your available savings balance is ${formatMoney(selected.reduce((sum, row) => sum + Number(row.balance_cents), 0))}.`, { items: selected.map(accountItem), actions: [navigate('accounts', 'Manage savings accounts')] });
  }
  if (/\b(?:flagged|risk|fraud|suspicious|declined|rejected)\b/i.test(message)) {
    const id = message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
    let selected;
    if (id) {
      try { selected = await history.detail(db, user, id); } catch (error) { if (error.status !== 404) throw error; }
    } else {
      const row = (await db.query(`SELECT t.id FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=$1 AND t.risk_json IS NOT NULL AND t.status IN ('pending_review','rejected') ORDER BY t.created_at DESC,t.insert_seq DESC LIMIT 1`, [user.id])).rows[0];
      if (row) selected = await history.detail(db, user, row.id);
    }
    if (!selected?.risk) return result('risk_explanation', 'I could not find a scored, flagged transaction in your own activity for that request. Open transaction history to select a receipt.', { actions: [navigate('activity', 'Open transaction history')] });
    return result('risk_explanation', `This transaction has risk score ${selected.risk.score} out of 100 and status ${selected.status.replace(/_/g, ' ')}. The score supports a review decision; it does not prove fraud. Pending or rejected payments do not debit your balance.`, {
      items: [{ ...transactionItem(selected), type: 'risk', score: selected.risk.score, reasons: (selected.risk.reasons || []).map(reason => typeof reason === 'string' ? reason : reason.message).filter(Boolean) }], actions: [navigate('activity', 'View transaction receipt')]
    });
  }
  if (/\b(?:notifications?|alerts?|unread)\b/i.test(message)) {
    const response = await context.notificationClient.list(user.id);
    return result('notifications', `You have ${response.unreadCount} unread notification${response.unreadCount === 1 ? '' : 's'}.`, { items: response.notifications.slice(0, 5).map(row => ({ type: 'notification', id: row.id, title: row.title, subtitle: row.message, date: row.createdAt, status: row.isRead ? 'read' : 'unread' })), actions: [navigate('notifications', 'View notifications')] });
  }
  if (/\b(?:transactions?|activity|history|search|find|statements?)\b/i.test(message)) {
    if (/\bstatement\b/i.test(message)) return result('transactions', 'Open activity to select an account and date range, then download a statement or export matching transactions as CSV.', { actions: [navigate('activity', 'Download a statement')] });
    const search = message.match(/\b(?:search|find)\s+(?:(?:my\s+)?transactions?\s+)?(?:for\s+|about\s+|matching\s+)?(.+?)\??$/i)?.[1]?.trim().slice(0, 120) || '';
    const params = new URLSearchParams({ pageSize: '5', ...(search ? { q: search } : {}) });
    if (referencedAccount) params.set('accountId', String(referencedAccount.id));
    const response = await history.list(db, user, params);
    return result('transactions', response.pagination.total ? `Showing ${response.transactions.length} of ${response.pagination.total} matching transactions from your accounts.` : 'No matching transactions were found in your accounts.', { items: response.transactions.map(transactionItem), actions: [navigate('activity', 'View transaction history', search ? { q: search } : undefined)] });
  }
  return result('help', 'I can show your business savings balances, search activity, explain a flagged transaction, list schedules and notifications, or prepare a transfer or bill payment draft. Try “Transfer SGD 25 to 1020002001” or “Pay SGD 86.42 to SP Services reference SP-12345”. Payment drafts always require your review and password.', { actions: [navigate('overview', 'Open dashboard')] });
}

module.exports = { answer, SENSITIVE };
