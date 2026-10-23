'use strict';

const bank = require('../models/banking');
const money = require('../models/money');
const history = require('../models/history');
const { publicUser } = require('../models/security');

function dashboard(context) {
  return { user: publicUser(context.user), ...bank.dashboard(context.db, context.user.id, { now: context.now }) };
}

function transactions(context) {
  return history.list(context.db, context.user, context.url.searchParams);
}

function transactionDetails(context) {
  return { transaction: history.detail(context.db, context.user, context.resourceId) };
}

function statement(context) {
  return { statement: history.statement(context.db, context.user, context.url.searchParams, context.now) };
}

function exportTransactions(context) {
  const { csv, filename } = history.exportCsv(context.db, context.user, context.url.searchParams, context.now);
  context.response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(csv), 'Cache-Control': 'no-store'
  });
  context.response.end(csv);
}

function createAccount(context) {
  return { account: bank.createAccount(context.db, context.user.id, context.body.name) };
}

function renameAccount(context) {
  return { account: bank.renameAccount(context.db, context.user.id, context.accountId, context.body.name) };
}

function closeAccount(context) {
  return { account: bank.closeAccount(context.db, context.user.id, context.accountId) };
}

async function transfer(context) {
  return { transaction: await money.submit(context.db, context.user, 'transfer', context.body, context) };
}

async function payment(context) {
  return { transaction: await money.submit(context.db, context.user, 'bill', context.body, context) };
}

module.exports = { dashboard, transactions, transactionDetails, statement, exportTransactions, createAccount, renameAccount, closeAccount, transfer, payment };
