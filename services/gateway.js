'use strict';

const http = require('node:http');
const { listen } = require('./common');

function createGateway({ target = process.env.BANKING_SERVICE_URL || 'http://127.0.0.1:4010', dependencies = [], token = process.env.SERVICE_TOKEN } = {}) {
  const upstream = new URL(target);
  if (upstream.protocol !== 'http:') throw new Error('The private banking service must use an HTTP origin.');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://gateway').pathname;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/health' && request.method === 'GET') {
      const checks = await Promise.allSettled([fetch(new URL('/health', upstream), { signal: AbortSignal.timeout(3000) }), ...dependencies.map(url => fetch(new URL('/internal/health', url), { signal: AbortSignal.timeout(3000), headers: { Authorization: `Bearer ${token}` } }))]);
      const ready = checks.every(check => check.status === 'fulfilled' && check.value.ok);
      await Promise.allSettled(checks.filter(check => check.status === 'fulfilled').map(check => check.value.arrayBuffer()));
      response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ service: 'gateway', status: ready ? 'ready' : 'degraded' }));
      return;
    }
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { decoded = '/internal'; }
    if (decoded.startsWith('/internal')) {
      response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Endpoint not found.' }));
      return;
    }
    const headers = { ...request.headers };
    for (const key of Object.keys(headers)) {
      if (['authorization', 'connection', 'proxy-authorization', 'proxy-connection', 'upgrade'].includes(key) || key.startsWith('x-internal-') || key.startsWith('x-forwarded-')) delete headers[key];
    }
    // Preserve the browser's Host so the banking service can verify Origin and CSRF.
    const proxy = http.request({ hostname: upstream.hostname, port: upstream.port || 80, path: request.url, method: request.method, headers, agent }, result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    proxy.setTimeout(30000, () => proxy.destroy(new Error('Upstream timed out.')));
    proxy.on('error', () => {
      if (response.headersSent) return response.destroy();
      response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Banking services are temporarily unavailable. Please try again.' }));
    });
    request.on('aborted', () => proxy.destroy());
    request.pipe(proxy);
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 15000;
  server.once('close', () => agent.destroy());
  return server;
}
if (require.main === module) listen(createGateway({ dependencies: [process.env.FRAUD_SERVICE_URL, process.env.NOTIFICATION_SERVICE_URL].filter(Boolean) }), 'API gateway', 3000);
module.exports = { createGateway };
