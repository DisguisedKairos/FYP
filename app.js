'use strict';

const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { createDatabase } = require('./database');
const { createAuth } = require('./banking/auth');
const security = require('./banking/security');
const ledger = require('./banking/ledger');
const history = require('./banking/history');
const workflows = require('./banking/workflows');
const businesses = require('./banking/business');
const { createAgents } = require('./banking/agents');
const { createRiskClient } = require('./banking/risk');
const fraudCases = require('./banking/fraud-cases');
const { seedDemo } = require('./scripts/seed-demo');
const { HttpError } = require('./models/errors');

function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
}
function trustProxy(value) {
  if (!value) return false;
  if (typeof value !== 'string' || /^(true|\*|\d+)$/i.test(value.trim())) throw new Error('TRUST_PROXY must name exact trusted proxy IP addresses or CIDR ranges.');
  const entries = value.split(',').map(value => value.trim()).filter(Boolean);
  if (!entries.length || entries.some(value => !/^[a-fA-F0-9:.]+(?:\/\d{1,3})?$/.test(value) || /\/0$/.test(value))) throw new Error('TRUST_PROXY must name exact trusted proxy IP addresses or narrow CIDR ranges.');
  return entries;
}
const send = (res, value, status = 200) => res.status(status).json({ ok: true, ...value });
const query = req => new URL(req.originalUrl, 'http://banking.local').searchParams;
function accountName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter an account name.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'Account names must contain 2–40 characters.');
  return name;
}

async function createApplication(options = {}) {
  const originValue = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const publicOrigin = originValue ? security.normalizeOrigin(originValue) : null;
  const configuredProxy = trustProxy(options.trustProxy ?? process.env.TRUST_PROXY);
  const db = options.db || createDatabase({ connectionString: options.connectionString });
  if (options.migrate !== false) await db.migrate();
  const now = options.now || Date.now;
  if (options.seed ?? process.env.SEED_DEMO === 'true') await seedDemo(db, { now });
  const auth = createAuth({ db, now, publicOrigin, secureCookies: publicOrigin?.startsWith('https://'), authEncryptionKey: options.authEncryptionKey ?? process.env.AUTH_ENCRYPTION_KEY });
  const riskClient = options.riskClient || createRiskClient({ db });
  const agents = createAgents({ db, now, ...(options.agentModel ? { model: options.agentModel } : {}) });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', configuredProxy);
  app.use((req, res, next) => {
    headers(res);
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error();
      new URL(req.url, 'http://banking.local');
    } catch { return res.status(400).json({ error: 'Invalid request URL.' }); }
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/health', async (_req, res) => { await db.query('SELECT 1'); send(res, { service: 'banking', database: 'postgresql', status: 'ready' }); });
  app.use('/internal', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) && !req.is('application/json')) throw new HttpError(415, 'Send application/json.');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', async (req, _res, next) => {
    const current = await auth.load(req);
    req.banking = { ...current, db, now, riskClient };
    const publicPath = ['/session', '/auth/login', '/auth/register'].includes(req.path);
    if (!publicPath && !current.user) throw new HttpError(401, 'Sign in to continue.');
    if (!['GET', 'HEAD'].includes(req.method)) auth.assertWrite(req, current.session, { csrf: !['/auth/login', '/auth/register'].includes(req.path) });
    next();
  });
  const route = (method, url, work, status = 200) => app[method](url, async (req, res) => {
    const value = await work(req, res);
    if (!res.headersSent) send(res, value, status);
  });
  const authorizeFor = req => (_db, user, password, _clock) => auth.authorize(user, password, { ip: req.ip, purpose: 'payment' });
  const financialOptions = req => ({ riskClient, now, authorize: authorizeFor(req) });
  route('get','/api/business',async req=>({business:await businesses.own(db,req.banking.user)}));
  route('post','/api/business/profile',async req=>({business:await businesses.submit(db,req.banking.user,req.body,financialOptions(req))}));
  route('get','/api/business/applications',async req=>({applications:await businesses.applications(db,req.banking.user,{status:req.query.status})}));
  route('post','/api/business/applications/:id/review',async req=>({business:await businesses.review(db,req.banking.user,req.params.id,req.body,financialOptions(req))}));
  route('get', '/api/session', async (req, res) => {
    const session = await auth.bootstrap(req, res, req.banking);
    const demo = (await db.query("SELECT EXISTS(SELECT 1 FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.email='alex@greenlink.demo' AND u.role='admin' AND u.auth_version=1 AND a.opening_provenance='seed') AS available")).rows[0];
    return { ...session, demoAvailable: demo.available };
  });
  route('post', '/api/auth/register', (req, res) => auth.register(req, res, req.body), 201);
  route('post', '/api/auth/login', (req, res) => auth.login(req, res, req.body));
  route('post', '/api/auth/logout', (req, res) => auth.logout(req, res));
  route('post', '/api/auth/password', (req, res) => auth.changePassword(req, res, req.body, req.banking));
  route('post', '/api/auth/revoke-sessions', (req, res) => auth.revokeAll(req, res, req.body, req.banking));
  for (const [endpoint, method] of [['setup', 'mfaSetup'], ['confirm', 'mfaConfirm'], ['disable', 'mfaDisable']]) {
    route('post', `/api/auth/mfa/${endpoint}`, (req, res) => {
      if (!auth[method]) throw new HttpError(503, 'Authenticator management is unavailable.');
      return auth[method](req, res, req.body, req.banking);
    });
  }
  route('get', '/api/auth/security', async req => {
    const events = (await db.query('SELECT id,event_type,created_at FROM audit_log WHERE target_user_id=$1 OR actor_id=$1 ORDER BY id DESC LIMIT 25', [req.banking.user.id])).rows;
    const mfa = (await db.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1', [req.banking.user.id])).rows[0];
    return { security: { mfaEnabled: Boolean(mfa?.enabled_at), events: events.map(row => ({ id: String(row.id), type: row.event_type, createdAt: new Date(row.created_at).toISOString() })) } };
  });
  route('get', '/api/dashboard', async req => ({ ...await history.dashboard(db, req.banking.user.id, { now }), user: security.publicUser(req.banking.user) }));
  route('get', '/api/transactions', req => history.list(db, req.banking.user, query(req)));
  route('get', '/api/transactions/export', async (req, res) => {
    const result = await history.exportCsv(db, req.banking.user, query(req), now);
    res.type('text/csv').set('Content-Disposition', `attachment; filename="${result.filename}"`).send(result.csv);
  });
  route('get', '/api/transactions/:id', async req => ({ transaction: await history.detail(db, req.banking.user, req.params.id) }));
  route('get', '/api/statements', async req => ({ statement: await history.statement(db, req.banking.user, query(req), now) }));
  route('post', '/api/accounts', async req => db.transaction(async client => {
    const name = accountName(req.body?.name), user = req.banking.user;
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    await businesses.assertApproved(client,user);
    if (Number((await client.query("SELECT count(*) AS count FROM accounts WHERE user_id=$1 AND status='active'", [user.id])).rows[0].count) >= 8) throw new HttpError(409, 'You can have up to eight active savings accounts.');
    let account;
    for (let attempt = 0; attempt < 10 && !account; attempt++) account = (await client.query('INSERT INTO accounts(user_id,name,number) VALUES($1,$2,$3) ON CONFLICT(number) DO NOTHING RETURNING *', [user.id, name, security.accountNumber()])).rows[0];
    if (!account) throw new HttpError(503, 'Account number allocation is temporarily unavailable.');
    await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,'account.opened',$2)", [user.id, { accountId: String(account.id) }]);
    return { account: ledger.accountView(account) };
  }), 201);
  for (const method of ['patch', 'delete']) route(method, '/api/accounts/:id', async req => db.transaction(async client => {
    const user = req.banking.user, id = ledger.accountId(req.params.id);
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const account = (await client.query('SELECT * FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, user.id])).rows[0];
    if (!account) throw new HttpError(404, 'Savings account not found.');
    await businesses.assertApproved(client,user,{accountId:account.id});
    if (account.status !== 'active') throw new HttpError(409, 'This savings account is closed.');
    let updated;
    if (method === 'delete') {
      if (Number(account.balance_cents) !== 0) throw new HttpError(409, 'Transfer the remaining balance before closing this account.');
      if (Number((await client.query("SELECT count(*) AS count FROM accounts WHERE user_id=$1 AND status='active'", [user.id])).rows[0].count) <= 1) throw new HttpError(409, 'Keep at least one savings account open.');
      if ((await client.query("SELECT id FROM scheduled_payments WHERE user_id=$1 AND status='active' AND payload_json->>'fromId'=$2 LIMIT 1", [user.id, String(account.id)])).rowCount) throw new HttpError(409, 'Cancel active instructions before closing this account.');
      updated = (await client.query("UPDATE accounts SET status='closed' WHERE id=$1 RETURNING *", [id])).rows[0];
    } else updated = (await client.query('UPDATE accounts SET name=$2 WHERE id=$1 RETURNING *', [id, accountName(req.body?.name)])).rows[0];
    await client.query('INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES($1,$1,$2,$3)', [user.id, method === 'delete' ? 'account.closed' : 'account.renamed', { accountId: String(id) }]);
    return { account: ledger.accountView(updated) };
  }));
  route('post', '/api/transfers', async req => ({ transaction: await ledger.submit(db, req.banking.user, 'transfer', req.body, financialOptions(req)) }));
  route('post', '/api/payments', async req => ({ transaction: await ledger.submit(db, req.banking.user, 'bill', req.body, financialOptions(req)) }));
  route('get', '/api/scheduled-payments', async req => ({ schedules: await workflows.listSchedules(db, req.banking.user) }));
  route('post', '/api/scheduled-payments', async req => ({ schedule: await workflows.createSchedule(db, req.banking.user, req.body, financialOptions(req)) }), 201);
  route('delete', '/api/scheduled-payments/:id', async req => ({ schedule: await workflows.cancelSchedule(db, req.banking.user, req.params.id, { now }) }));
  route('get', '/api/notifications', async req => { await workflows.dispatch(db, { now }); return workflows.notifications(db, req.banking.user, { unreadOnly: req.query.unreadOnly === 'true' }); });
  route('patch', '/api/notifications/:id', req => {
    if (req.body?.read !== undefined && req.body.read !== true) throw new HttpError(400, 'Notifications can only be marked read.');
    return workflows.markRead(db, req.banking.user, req.params.id, { now });
  });
  route('get', '/api/fraud/rules', req => { ledger.requireAdmin(req.banking.user); return riskClient.getRules(); });
  route('get', '/api/fraud/rules/audit', req => { ledger.requireAdmin(req.banking.user); return riskClient.getAudit(Object.fromEntries(query(req))); });
  route('patch', '/api/fraud/rules/:id', async req => {
    ledger.requireAdmin(req.banking.user);
    await auth.authorize(req.banking.user, req.body.authorizationPassword, { ip: req.ip, purpose: 'rule_change' });
    const { authorizationPassword, ...patch } = req.body;
    return riskClient.updateRule(req.params.id, patch, req.banking.user);
  });
  route('get', '/api/fraud/model', async req => { ledger.requireAdmin(req.banking.user); return { model: await riskClient.getModelInfo() }; });
  route('get', '/api/fraud/model-activity', async req => {
    ledger.requireAdmin(req.banking.user);
    return { activity: await require('./banking/fraud-monitoring').modelActivity(db, req.banking.user, { days: query(req).get('days') ?? '30', now, activeModel: await riskClient.getModelInfo() }) };
  });
  route('get', '/api/fraud/reviews', async req => ({ reviews: await ledger.reviews(db, req.banking.user) }));
  route('get', '/api/fraud/cases', req => fraudCases.list(db, req.banking.user, Object.fromEntries(query(req))));
  route('get', '/api/fraud/cases/:id', async req => ({ case: await fraudCases.detail(db, req.banking.user, req.params.id) }));
  route('get', '/api/fraud/analysis/:id', async req => ({ analysis: await fraudCases.analysis(db, req.banking.user, req.params.id) }));
  route('post', '/api/fraud/scan', async req => {
    ledger.requireAdmin(req.banking.user);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(k => !['limit','transactionId'].includes(k))) throw new HttpError(400, 'Only a batch limit and optional outgoing transaction ID may be supplied.');
    return { scan: await fraudCases.scan(db, riskClient, { actor: req.banking.user, now, force: true, limit: req.body.limit ?? 25, transactionId:req.body.transactionId ?? null, validateSession: async () => {
      const current = await auth.load(req);
      if (!current.user || String(current.user.id) !== String(req.banking.user.id)) throw new HttpError(401, 'Your session ended. Sign in again.');
    } }) };
  });
  route('post', '/api/fraud/cases/:id/review', async req => {
    ledger.requireAdmin(req.banking.user);
    const { authorizationPassword, ...body } = req.body || {};
    const authorization = body.action === 'close' ? await auth.authorize(req.banking.user, authorizationPassword, { ip: req.ip, purpose: 'fraud_case_review' }) : null;
    return { case: await fraudCases.decide(db, req.banking.user, req.params.id, body, { now, authorization }) };
  });
  route('post', '/api/fraud/reviews/:id', async req => ({ transaction: await ledger.review(db, req.banking.user, req.params.id, req.body, financialOptions(req)) }));
  const runAgent = (req, kind) => agents.execute(req.banking.user, kind, req.body, { ip: req.ip, validateSession: async () => {
    const active = await auth.load(req);
    if (!active.user || String(active.user.id) !== String(req.banking.user.id)) throw new HttpError(401, 'Your session ended. Sign in again.');
  } });
  // Compatibility endpoint uses the same local model and security boundaries.
  route('post', '/api/assistant/messages', req => runAgent(req, 'assistant'));
  route('get','/api/ai-audit',req=>require('./banking/ai-audit').list(db,req.banking.user,query(req),{now}));
  route('get','/api/ai-audit/:kind/:id',async req=>({record:await require('./banking/ai-audit').detail(db,req.banking.user,req.params.kind,req.params.id)}));
  route('get', '/api/agents/status', async () => ({ agent: await agents.status() }));
  route('get', '/api/agents/runs', async req => ({ runs: await agents.list(req.banking.user) }));
  route('get', '/api/agents/runs/:id', async req => ({ run: await agents.detail(req.banking.user, req.params.id) }));
  for (const kind of ['assistant','fraud_investigation','liquidity','rule_simulation','reconciliation']) {
    route('post', `/api/agents/${kind}`, req => runAgent(req, kind));
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false, redirect: false }));
  const pages = new Set(['/', '/login', '/register', '/dashboard', '/business', '/business-onboarding', '/accounts', '/transfers', '/payments', '/activity', '/scheduled-payments', '/notifications', '/fraud-monitoring', '/fraud-rules', '/assistant', '/banking-insights', '/ai-audit']);
  app.use((req, res, next) => { if (['GET', 'HEAD'].includes(req.method) && pages.has(req.path)) return res.sendFile(path.join(__dirname, 'views', 'index.html')); next(); });
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = error instanceof HttpError ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError && error.status === 400 ? 400 : 500;
    if (status === 429) res.setHeader('Retry-After', '900');
    if (status === 500) console.error('Banking request failed:', error.code || error.name);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : status === 413 ? 'The request is too large.' : error.message, ...(error.code && error instanceof HttpError ? { code: error.code, mfaRequired: error.code === 'MFA_REQUIRED' } : {}) });
  });
  const server = http.createServer(app);
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  let activeJobs = null, timer, stopped = false;
  server.runJobs = () => activeJobs || (activeJobs = (async () => {
    const schedules = await workflows.runDue(db, { riskClient, now });
    // Surveillance outages must not stop durable notification delivery or schedules.
    let monitoring;
    try { monitoring = await fraudCases.scan(db, riskClient, { now }); }
    catch { monitoring = { unavailable: true }; }
    return { ...schedules, fraudMonitoring: monitoring, ...await workflows.dispatch(db, { now }) };
  })().finally(() => { activeJobs = null; }));
  server.db = db; server.auth = auth; server.riskClient = riskClient; server.app = app;
  server.closeResources = async () => { stopped = true; clearInterval(timer); if (activeJobs) await activeJobs.catch(() => {}); await riskClient.close?.(); if (!options.db) await db.close(); };
  server.once('listening', () => {
    if (options.backgroundJobs !== false) {
      const tick = () => { if (!stopped) server.runJobs().catch(error => console.error('Banking jobs failed:', error.code || error.name)); };
      timer = setInterval(tick, Math.max(1000, Number(process.env.JOB_INTERVAL_MS) || 2000)); timer.unref(); tick();
    }
  });
  server.once('close', () => { stopped = true; clearInterval(timer); });
  return server;
}
module.exports = { createApplication, trustProxy };
if (require.main === module) (async () => {
  const server = await createApplication(), port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Green Link Digital Bank DFT banking: http://${host}:${port}`));
  const stop = () => server.close(async () => { await server.closeResources(); process.exit(0); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
