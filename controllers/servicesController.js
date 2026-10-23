'use strict';

const money = require('../models/money');
const schedules = require('../models/schedules');
const { HttpError } = require('../models/errors');

async function rules(context) {
  money.requireAdmin(context.user);
  return { ...await context.riskClient.getRules() };
}
async function updateRule(context) {
  money.requireAdmin(context.user);
  return { ...await context.riskClient.updateRule(context.resourceId, context.body, { id: context.user.id, name: context.user.name }) };
}
async function ruleAudit(context) {
  money.requireAdmin(context.user);
  const parameters = {};
  for (const name of ['page', 'pageSize', 'ruleId']) {
    if (context.url.searchParams.getAll(name).length > 1) throw new HttpError(400, `Supply ${name} only once.`);
    if (context.url.searchParams.has(name)) parameters[name] = context.url.searchParams.get(name);
  }
  return { ...await context.riskClient.getAudit(parameters) };
}
async function model(context) {
  money.requireAdmin(context.user);
  return { model: await context.riskClient.getModelInfo() };
}
function reviews(context) {
  return { reviews: money.reviews(context.db, context.user) };
}
async function review(context) {
  return { transaction: await money.review(context.db, context.user, context.resourceId, context.body, context) };
}
async function notifications(context) {
  await context.deliverNotifications();
  return { ...await context.notificationClient.list(context.user.id, { unreadOnly: context.url.searchParams.get('unreadOnly') === 'true' }) };
}
async function markRead(context) {
  if (context.body.read !== undefined && context.body.read !== true) throw new HttpError(400, 'Notifications can only be marked as read.');
  return { ...await context.notificationClient.markRead(context.user.id, context.resourceId) };
}
function listSchedules(context) {
  return { schedules: schedules.list(context.db, context.user) };
}
async function createSchedule(context) {
  return { schedule: await schedules.create(context.db, context.user, context.body, context) };
}
function cancelSchedule(context) {
  return { schedule: schedules.cancel(context.db, context.user, context.resourceId, context) };
}

module.exports = { rules, updateRule, ruleAudit, model, reviews, review, notifications, markRead, listSchedules, createSchedule, cancelSchedule };
