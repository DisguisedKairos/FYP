'use strict';

const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { openDatabase } = require('./db');
const { HttpError } = require('./models/errors');
const { loadSession, csrfMatches } = require('./models/security');
const auth = require('./controllers/authController');
const bank = require('./controllers/bankController');
const services = require('./controllers/servicesController');
const schedules = require('./models/schedules');
const events = require('./models/events');
const { createRiskClient, createNotificationClient } = require('./services/clients');

const BODY_LIMIT = 16 * 1024;
const FRONTEND_ROUTES = new Set(['/', '/login', '/register', '/dashboard', '/accounts', '/transfers', '/payments', '/activity', '/scheduled-payments', '/schedules', '/notifications', '/fraud-monitoring', '/fraud-rules', '/fraud', '/statements']);
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8'
};

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
  const origin = request.headers.origin;
  if (!origin) return;
  let source;
  try { source = new URL(origin); } catch { throw new HttpError(403, 'Request origin is not allowed.'); }
  const protocol = request.socket.encrypted ? 'https:' : 'http:';
  if (source.protocol !== protocol || source.host !== request.headers.host) {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let length = 0;
    let rejected = false;
    const chunks = [];
    request.on('data', chunk => {
      length += chunk.length;
      if (length > BODY_LIMIT) {
        if (!rejected) reject(new HttpError(413, 'The request is too large.'));
        rejected = true;
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      if (length === 0) return resolve({});
      const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return reject(new HttpError(415, 'Send the request as application/json.'));
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Send a valid JSON object.'));
      }
    });
    request.on('error', () => reject(new HttpError(400, 'The request could not be read.')));
    request.on('aborted', () => reject(new HttpError(400, 'The request was interrupted.')));
  });
}

function route(pathname, method, response) {
  let available;
  let protectedRoute = false;
  let accountId;
  let resourceId;
  if (pathname === '/api/session') available = { GET: auth.session };
  else if (pathname === '/api/auth/register') available = { POST: auth.register };
  else if (pathname === '/api/auth/login') available = { POST: auth.login };
  else if (pathname === '/api/auth/logout') available = { POST: auth.logout };
  else if (pathname === '/api/dashboard') { available = { GET: bank.dashboard }; protectedRoute = true; }
  else if (pathname === '/api/accounts') { available = { POST: bank.createAccount }; protectedRoute = true; }
  else if (pathname === '/api/scheduled-payments') { available = { GET: services.listSchedules, POST: services.createSchedule }; protectedRoute = true; }
  else if (/^\/api\/scheduled-payments\/[^/]+$/.test(pathname)) { resourceId = pathname.split('/').pop(); available = { DELETE: services.cancelSchedule }; protectedRoute = true; }
  else if (pathname === '/api/notifications') { available = { GET: services.notifications }; protectedRoute = true; }
  else if (/^\/api\/notifications\/[^/]+$/.test(pathname)) { resourceId = pathname.split('/').pop(); available = { PATCH: services.markRead }; protectedRoute = true; }
  else if (pathname === '/api/fraud/rules') { available = { GET: services.rules }; protectedRoute = true; }
  else if (/^\/api\/fraud\/rules\/[^/]+$/.test(pathname)) { resourceId = pathname.split('/').pop(); available = { PATCH: services.updateRule }; protectedRoute = true; }
  else if (pathname === '/api/fraud/model') { available = { GET: services.model }; protectedRoute = true; }
  else if (pathname === '/api/fraud/reviews') { available = { GET: services.reviews }; protectedRoute = true; }
  else if (/^\/api\/fraud\/reviews\/[^/]+$/.test(pathname)) { resourceId = pathname.split('/').pop(); available = { POST: services.review }; protectedRoute = true; }
  else if (/^\/api\/accounts\/\d+$/.test(pathname)) {
    accountId = pathname.split('/').pop();
    available = { PATCH: bank.renameAccount, DELETE: bank.closeAccount };
    protectedRoute = true;
  } else if (pathname === '/api/transfers') { available = { POST: bank.transfer }; protectedRoute = true; }
  else if (pathname === '/api/payments') { available = { POST: bank.payment }; protectedRoute = true; }
  else throw new HttpError(404, 'API endpoint not found.');
  if (!available[method]) {
    response.setHeader('Allow', Object.keys(available).join(', '));
    throw new HttpError(405, 'This method is not supported.');
  }
  if (resourceId) {
    try { resourceId = decodeURIComponent(resourceId); } catch { throw new HttpError(400, 'Invalid resource identifier.'); }
  }
  return { handler: available[method], protectedRoute, accountId, resourceId };
}

async function serveFrontend(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    throw new HttpError(405, 'This method is not supported.');
  }
  let file;
  let type;
  if (FRONTEND_ROUTES.has(pathname)) {
    file = path.join(__dirname, 'views', 'index.html');
    type = 'text/html; charset=utf-8';
  } else {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Invalid file path.'); }
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) {
      throw new HttpError(404, 'File not found.');
    }
    const extension = path.extname(decoded).toLowerCase();
    type = CONTENT_TYPES[extension];
    if (!type) throw new HttpError(404, 'File not found.');
    const root = path.resolve(__dirname, 'public');
    file = path.resolve(root, `.${decoded}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new HttpError(404, 'File not found.');
  }
  let bytes;
  try { bytes = await readFile(file); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') throw new HttpError(404, 'File not found.');
    throw error;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
  response.end(request.method === 'HEAD' ? undefined : bytes);
}

function createApplication({ dbPath = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'banking.sqlite'), seed = process.env.SEED_DEMO !== 'false', riskClient: suppliedRisk = null, notificationClient: suppliedNotifications = null, now = Date.now } = {}) {
  const db = openDatabase(dbPath, { seed });
  const servicePath = name => dbPath === ':memory:' ? ':memory:' : path.join(path.dirname(path.resolve(dbPath)), `${name}.sqlite`);
  const riskClient = suppliedRisk || createRiskClient({ dbPath: servicePath('fraud') });
  const notificationClient = suppliedNotifications || createNotificationClient({ dbPath: servicePath('notifications') });
  const limitLogin = auth.createLoginLimiter();
  let jobsPromise = null;
  const deliverNotifications = () => events.dispatch(db, notificationClient, now);
  // Only the explicitly synchronous embedded client participates in HTTP writes.
  // Networked and unknown clients are delivered by the durable worker instead.
  const deliverImmediateNotifications = () => notificationClient.isRemote === false
    ? events.dispatch(db, notificationClient, now, { timeBudgetMs: 50 })
    : Promise.resolve({ notificationsDelivered: 0, notificationsFailed: 0 });
  const runJobs = () => {
    if (!jobsPromise) jobsPromise = (async () => ({ ...await schedules.runDue(db, { riskClient, now }), ...await deliverNotifications() }))().finally(() => { jobsPromise = null; });
    return jobsPromise;
  };
  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    try {
      let target;
      try { target = new URL(request.url, 'http://localhost'); } catch { throw new HttpError(400, 'Invalid request URL.'); }
      const pathname = target.pathname;
      if (pathname === '/health') {
        if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); throw new HttpError(405, 'This method is not supported.'); }
        db.prepare('SELECT 1').get();
        return sendJson(response, 200, { ok: true, service: 'banking', database: 'ready' });
      }
      if (pathname === '/internal/jobs/tick') {
        const token = process.env.SERVICE_TOKEN;
        if (!token) throw new HttpError(404, 'Endpoint not found.');
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new HttpError(405, 'This method is not supported.'); }
        if (!csrfMatches(request.headers.authorization, `Bearer ${token}`)) throw new HttpError(401, 'Service authorization is required.');
        const input = await readJson(request);
        if (Object.keys(input).length) throw new HttpError(400, 'Job ticks do not accept clock or payment inputs.');
        return sendJson(response, 200, { ok: true, ...await runJobs() });
      }
      if (!pathname.startsWith('/api/')) return await serveFrontend(request, response, pathname);
      const selected = route(pathname, request.method, response);
      const currentSession = loadSession(db, request);
      const user = currentSession?.user_id
        ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(currentSession.user_id)
        : null;
      if (selected.protectedRoute && !user) throw new HttpError(401, 'Sign in to continue.');
      const write = !['GET', 'HEAD'].includes(request.method);
      if (write) {
        sameOrigin(request);
        const authEntry = pathname === '/api/auth/login' || pathname === '/api/auth/register';
        if (!authEntry && (!currentSession || !csrfMatches(request.headers['x-csrf-token'], currentSession.csrf_token))) {
          throw new HttpError(403, 'Your security token has expired. Refresh the page and try again.');
        }
      }
      const body = write ? await readJson(request) : {};
      const context = {
        db, request, response, body, session: currentSession, user,
        accountId: selected.accountId, resourceId: selected.resourceId, limitLogin, url: target,
        riskClient, notificationClient, now, deliverNotifications: deliverImmediateNotifications
      };
      const result = await selected.handler(context);
      if (write) await deliverImmediateNotifications();
      sendJson(response, pathname === '/api/auth/register' || (['/api/accounts', '/api/scheduled-payments'].includes(pathname) && request.method === 'POST') ? 201 : 200, { ok: true, ...result });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 429) response.setHeader('Retry-After', '900');
      if (status === 500) console.error('Request failed:', error);
      sendJson(response, status, { error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 1000;
  server.runJobs = runJobs;
  server.once('close', () => { riskClient.close?.(); notificationClient.close?.(); db.close(); });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer from 1 to 65535.');
    process.exitCode = 1;
  } else {
    const server = createApplication();
    const host = process.env.HOST || '127.0.0.1';
    server.on('error', error => {
      console.error(`Unable to start Evergreen: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log(`Evergreen Banking demo is running at http://${host}:${port}`);
      console.log('Demo sign in: alex@evergreen.demo / Evergreen123!');
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}

module.exports = { createApplication };
