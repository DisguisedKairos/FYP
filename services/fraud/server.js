'use strict';

const path = require('node:path');
const { FraudEngine } = require('./engine');
const { createServiceServer, listen } = require('../common');
const { HttpError } = require('../../models/errors');

function createFraudServer({ token = process.env.SERVICE_TOKEN, dbPath = process.env.FRAUD_DB_PATH || path.join(process.env.DATA_DIR || 'data', 'fraud.sqlite') } = {}) {
  const engine = new FraudEngine({ dbPath });
  return createServiceServer({ name: 'fraud', token, close: () => engine.close(), handler: async (method, url, body) => {
    if (method === 'POST' && url.pathname === '/internal/assess') return { risk: engine.assess(body) };
    if (method === 'GET' && url.pathname === '/internal/rules') return engine.getRules();
    if (method === 'GET' && url.pathname === '/internal/rules/audit') return engine.getAudit(Object.fromEntries(url.searchParams));
    if (method === 'GET' && url.pathname === '/internal/model') return { model: engine.getModelInfo() };
    const rule = /^\/internal\/rules\/([a-z_]+)$/.exec(url.pathname);
    if (method === 'PATCH' && rule) return engine.updateRule(rule[1], body.patch || {}, body.actor);
    throw new HttpError(404, 'Service endpoint not found.');
  } });
}

if (require.main === module) listen(createFraudServer(), 'Fraud scoring service', 4011);
module.exports = { createFraudServer };
