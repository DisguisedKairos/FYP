'use strict';

const { HttpError } = require('../models/errors');
const { FraudEngine } = require('./fraud/engine');
const { NotificationStore } = require('./notifications/store');

function transport(base, token = process.env.SERVICE_TOKEN) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Service URLs must be HTTP origins without credentials.');
  if (!token || token.length < 24) throw new Error('SERVICE_TOKEN must contain at least 24 characters.');
  return async (pathname, body, method = 'POST') => {
    try {
      const response = await fetch(new URL(pathname, url), { method: body === undefined ? 'GET' : method, redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json();
      if (!response.ok) throw new HttpError(response.status, result.error || 'Internal service request failed.');
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'A required service is temporarily unavailable. Please try again.');
    }
  };
}

function createRiskClient({ dbPath = ':memory:', url = process.env.FRAUD_SERVICE_URL, token } = {}) {
  if (!url) return new FraudEngine({ dbPath });
  const request = transport(url, token);
  return {
    isRemote: true,
    async assess(input) { return (await request('/internal/assess', input)).risk; },
    async getRules() { return request('/internal/rules'); },
    async updateRule(id, patch, actor) { return request('/internal/rules/' + encodeURIComponent(id), { patch, actor }, 'PATCH'); },
    async getModelInfo() { return (await request('/internal/model')).model; },
    close() {},
  };
}
function createNotificationClient({ dbPath = ':memory:', url = process.env.NOTIFICATION_SERVICE_URL, token } = {}) {
  if (!url) return new NotificationStore({ dbPath });
  const request = transport(url, token);
  return {
    isRemote: true,
    async list(userId, { unreadOnly = false } = {}) { return request(`/internal/notifications?userId=${encodeURIComponent(userId)}&unreadOnly=${unreadOnly}`); },
    async markRead(userId, id) { return request('/internal/notifications', { userId, id }, 'PATCH'); },
    async publish(event) { return request('/internal/events', event); },
    close() {},
  };
}
module.exports = { createRiskClient, createNotificationClient, transport };
