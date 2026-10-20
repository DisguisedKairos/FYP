'use strict';

const bank = require('../models/banking');
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

function transfer(context) {
  return { transaction: bank.transfer(context.db, context.user, context.body) };
}

function payment(context) {
  return { transaction: bank.payment(context.db, context.user, context.body) };
}

module.exports = { dashboard, createAccount, renameAccount, closeAccount, transfer, payment };
