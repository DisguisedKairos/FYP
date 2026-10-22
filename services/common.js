'use strict';

const http = require('node:http');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { HttpError } = require('../models/errors');

function openStore(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  return db;
}

function authorized(request, token) {
  const supplied = Buffer.from(String(request.headers.authorization || ''));
  const expected = Buffer.from(`Bearer ${token || ''}`);
  return Boolean(token) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function jsonBody(request, limit = 512 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new HttpError(413, 'Service request is too large.');
    parts.push(part);
  }
  if (!size) return {};
  if (!String(request.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Send application/json.');
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Send a JSON object.'); }
}

function createServiceServer({ name, token, handler, close }) {
  if (!token || token.length < 24) throw new Error('SERVICE_TOKEN must contain at least 24 characters for networked services.');
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!authorized(request, token)) throw new HttpError(401, 'Service authentication required.');
      const url = new URL(request.url, 'http://internal');
      const result = url.pathname === '/internal/health' && request.method === 'GET'
        ? { service: name, status: 'ready' }
        : await handler(request.method, url, ['GET', 'HEAD'].includes(request.method) ? {} : await jsonBody(request));
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(`[${name}] ${error.message}`);
      response.writeHead(status);
      response.end(JSON.stringify({ error: status === 500 ? 'Service request failed.' : error.message }));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.once('close', () => close?.());
  return server;
}

function listen(server, name, defaultPort) {
  const port = Number(process.env.PORT || defaultPort);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`${name} listening on http://${host}:${port}`));
  server.on('error', error => { console.error(`[${name}] ${error.message}`); process.exitCode = 1; });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

module.exports = { openStore, authorized, jsonBody, createServiceServer, listen };
