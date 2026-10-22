'use strict';

const bank = require('../models/banking');
const money = require('../models/money');
const { publicUser } = require('../models/security');

function dashboard(context) {
  return { user: publicUser(context.user), ...bank.dashboard(context.db, context.user.id) };
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

module.exports = { dashboard, createAccount, renameAccount, closeAccount, transfer, payment };
