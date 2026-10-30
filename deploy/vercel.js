'use strict';

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { attachDatabasePool, ipAddress } = require('@vercel/functions');
const { createApplication, serveFrontend, headers } = require('../application');
const { createDatabase } = require('../database');
const { createRiskClient, fraudServiceUrl } = require('../banking/risk');
const { normalizeOrigin } = require('../banking/security');

const CONFIGURATION_ERRORS = Object.freeze({
  DATABASE_URL: 'Set the restricted PostgreSQL DATABASE_URL in the Vercel project environment.',
  AUTH_ENCRYPTION_KEY: 'Set the existing persistent 64-character hexadecimal AUTH_ENCRYPTION_KEY.',
  SERVICE_TOKEN: 'Set a persistent SERVICE_TOKEN shared by banking and fraud.',
  FRAUD_SERVICE_BINDING_URL: 'The Vercel fraud service binding is missing or invalid. Check banking bindings; do not set its URL manually.',
  PUBLIC_ORIGIN: 'Set PUBLIC_ORIGIN to the exact HTTPS website origin, without a path, or use the Vercel domain fallback.'
});
class HostedConfigurationError extends Error {
  constructor(setting) { super(CONFIGURATION_ERRORS[setting]); this.code = 'CONFIGURATION_' + setting; }
}
const RUNTIME_ERRORS = Object.freeze({
  '28P01': 'Database authentication failed. Check the restricted DATABASE_URL credentials.',
  '28000': 'Database authentication failed. Check the restricted DATABASE_URL credentials.',
  '3D000': 'The configured PostgreSQL database does not exist.',
  '42501': 'The runtime database role lacks required permissions. Apply the documented runtime grants separately.',
  '42P01': 'The banking schema is missing. Run migrations with the migration role before deploying.',
  MIGRATION_REQUIRED: 'Database migrations are pending. Run migrations with the migration role before deploying.',
  MIGRATION_CHANGED: 'An applied migration checksum differs from the packaged SQL. Restore the matching migration files.',
  ENOENT: 'A required runtime file is missing. Check that the function bundle includes views and database/migrations.',
  ECONNREFUSED: 'A service connection was refused. Check the hosted database URL and runtime service configuration.',
  ETIMEDOUT: 'A service connection timed out. Check database availability and network access.',
  ENOTFOUND: 'A configured service hostname could not be resolved. Check the hosted database URL.',
  EAI_AGAIN: 'Service hostname resolution temporarily failed. Retry and check database availability.',
  CERT_HAS_EXPIRED: 'The database TLS certificate has expired. Keep TLS verification enabled and check the database endpoint.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The database TLS certificate is untrusted. Use the Neon TLS endpoint without disabling verification.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The database TLS certificate could not be verified. Check the configured TLS endpoint.'
});
function failureDiagnostic(error) {
  if (error instanceof HostedConfigurationError) return error.code + ': ' + error.message;
  if (Object.hasOwn(RUNTIME_ERRORS, error?.code)) return error.code + ': ' + RUNTIME_ERRORS[error.code];
  // Never log arbitrary driver messages, stacks, connection strings or error codes.
  return 'BANKING_STARTUP_FAILED: Banking initialization or a hosted job failed. Check runtime configuration, database access and installed migrations.';
}
function configuration(env) {
  if (!env.DATABASE_URL || !/^postgres(?:ql)?:/.test(env.DATABASE_URL)) throw new HostedConfigurationError('DATABASE_URL');
  if (!/^[a-f0-9]{64}$/i.test(env.AUTH_ENCRYPTION_KEY || '')) throw new HostedConfigurationError('AUTH_ENCRYPTION_KEY');
  if (!/^[A-Za-z0-9._~-]{24,512}$/.test(env.SERVICE_TOKEN || '')) throw new HostedConfigurationError('SERVICE_TOKEN');
  if (!env.FRAUD_SERVICE_BINDING_URL) throw new HostedConfigurationError('FRAUD_SERVICE_BINDING_URL');
  try { fraudServiceUrl({ bindingUrl: env.FRAUD_SERVICE_BINDING_URL }); }
  catch { throw new HostedConfigurationError('FRAUD_SERVICE_BINDING_URL'); }
  const platformDomain = env.VERCEL_ENV === 'preview' ? env.VERCEL_URL : env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  let publicOrigin;
  try { publicOrigin = normalizeOrigin(env.PUBLIC_ORIGIN || (platformDomain ? 'https://' + platformDomain : '')); }
  catch { throw new HostedConfigurationError('PUBLIC_ORIGIN'); }
  if (env.VERCEL_ENV !== 'development' && !publicOrigin.startsWith('https://')) throw new HostedConfigurationError('PUBLIC_ORIGIN');
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
    headers(res);
    next();
  });
  // Public pages and assets must not wait for database/configuration startup.
  // Browser module imports arrive concurrently; none of them should open a pool.
  serveFrontend(app);
  app.use((req, res, next) => {
    if(req.path==='/health' || req.path==='/api' || req.path.startsWith('/api/'))return next();
    return res.status(404).json({error:'Endpoint not found.'});
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
    console.error('Hosted banking request failed:', failureDiagnostic(error));
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
