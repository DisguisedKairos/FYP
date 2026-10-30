'use strict';

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { attachDatabasePool, ipAddress } = require('@vercel/functions');
const { createApplication } = require('../app');
const { createDatabase } = require('../database');
const { createRiskClient } = require('../banking/risk');
const { normalizeOrigin } = require('../banking/security');

function configuration(env) {
  if (!env.DATABASE_URL || !/^postgres(?:ql)?:/.test(env.DATABASE_URL)) throw new Error('Set the restricted PostgreSQL DATABASE_URL.');
  if (!/^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY || '')) throw new Error('Set a persistent AUTH_ENCRYPTION_KEY.');
  if (!/^[A-Za-z0-9._~-]{24,512}$/.test(env.SERVICE_TOKEN || '')) throw new Error('Set a persistent SERVICE_TOKEN shared with fraud.');
  if (!env.FRAUD_SERVICE_BINDING_URL) throw new Error('The banking service requires its Vercel fraud binding at runtime.');
  const platformDomain = env.VERCEL_ENV === 'preview' ? env.VERCEL_URL : env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const publicOrigin = normalizeOrigin(env.PUBLIC_ORIGIN || (platformDomain ? 'https://' + platformDomain : ''));
  if (env.VERCEL_ENV !== 'development' && !publicOrigin.startsWith('https://')) throw new Error('Hosted banking requires an HTTPS PUBLIC_ORIGIN.');
  return { publicOrigin };
}

function authorizedJob(req, secret) {
  if (!/^[A-Za-z0-9._~-]{32,512}$/.test(secret || '')) return false;
  const count = (req.rawHeaders || []).filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length;
  if (count !== 1) return false;
  const supplied = Buffer.from(req.get('authorization') || ''), expected = Buffer.from('Bearer ' + secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function createHostedApplication({ environment = process.env, databaseFactory = createDatabase, applicationFactory = createApplication, attachPool = attachDatabasePool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let initialization;
  // Build/import is inert. Bindings and database connections are read only in a request.
  async function banking() {
    if (!initialization) {
      initialization = (async () => {
        const settings = configuration(environment);
        const db = databaseFactory({ connectionString: environment.DATABASE_URL, poolOptions: { max: 5, idleTimeoutMillis: 5000, allowExitOnIdle: true } });
        let riskClient;
        try {
          attachPool(db.pool);
          riskClient = createRiskClient({ db, bindingUrl: environment.FRAUD_SERVICE_BINDING_URL, token: environment.SERVICE_TOKEN });
          const server = await applicationFactory({ db, riskClient, seed: false, backgroundJobs: false, publicOrigin: settings.publicOrigin, trustProxy: '', authEncryptionKey: environment.AUTH_ENCRYPTION_KEY });
          return { server, db };
        } catch (error) {
          await riskClient?.close?.();
          await db.close();
          throw error;
        }
      })().catch(error => { initialization = undefined; throw error; });
    }
    return initialization;
  }
  app.use((req, res, next) => {
    // Vercel overwrites this platform header. Local servers keep Express socket IPs.
    if (environment.VERCEL === '1' && environment.VERCEL_ENV !== 'development') {
      const address = ipAddress(new Headers({ 'x-real-ip': req.get('x-real-ip') || '' }));
      if (isIP(address || '')) Object.defineProperty(req, 'ip', { value: address, configurable: true });
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.all('/api/jobs/run', async (req, res) => {
    if (req.method !== 'GET') return res.status(405).set('Allow', 'GET').json({ error: 'Use GET for scheduled jobs.' });
    if (!authorizedJob(req, environment.CRON_SECRET)) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Job authentication required.' });
    const { server } = await banking();
    return res.json({ ok: true, ...await server.runJobs() });
  });
  app.use(async (req, res, next) => {
    const { server } = await banking();
    server.app(req, res, next);
  });
  app.use((error, _req, res, _next) => {
    console.error('Hosted banking request failed:', error.code || error.name || 'Error');
    if (res.headersSent) return res.end();
    res.status(503).json({ error: 'The banking service is temporarily unavailable. Please try again.' });
  });
  app.closeResources = async () => {
    if (!initialization) return;
    const { server, db } = await initialization;
    await server.closeResources();
    await db.close();
    initialization = undefined;
  };
  return app;
}

module.exports = createHostedApplication();
module.exports.createHostedApplication = createHostedApplication;
module.exports.configuration = configuration;
