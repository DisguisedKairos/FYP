'use strict';

const { randomBytes, createHash, scrypt, scryptSync, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { DEMO_PASSWORD, LEGACY_DEMO_PASSWORD, isKnownDemo } = require('./demoIdentity');

const deriveKey = promisify(scrypt);
const SESSION_COOKIE = 'evergreen_session';
const USER_SESSION_MS = 24 * 60 * 60 * 1000;
const ANONYMOUS_SESSION_MS = 60 * 60 * 1000;

function hashPasswordSync(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  // A dummy derivation also runs when the account does not exist.
  const [salt, encoded] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const expected = Buffer.from(encoded, 'hex');
  const actual = await deriveKey(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function verifyPasswordSync(password, stored) {
  if (typeof stored !== 'string' || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
  const [salt, encoded] = stored.split(':');
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(encoded, 'hex');
  return timingSafeEqual(actual, expected);
}

async function verifyUserPassword(db, user, password) {
  if (await verifyPassword(password, user?.password_hash)) return Boolean(user);
  // Legacy compatibility is limited to the seeded identities while their
  // current password is the public demo default. A custom password disables it.
  return Boolean(user && password === LEGACY_DEMO_PASSWORD && isKnownDemo(db, user)
    && await verifyPassword(DEMO_PASSWORD, user.password_hash));
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(request) {
  const cookies = String(request.headers.cookie || '').split(';');
  const entry = cookies.map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return null;
  const token = entry.slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function loadSession(db, request) {
  const token = readCookie(request);
  if (!token) return null;
  const hash = tokenHash(token);
  const record = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
  if (!record) return null;
  if (record.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  return record;
}

function createSession(db, request, response, userId = null, { secure = Boolean(request.socket.encrypted) } = {}) {
  const previous = readCookie(request);
  if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(previous));
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  const lifetime = userId ? USER_SESSION_MS : ANONYMOUS_SESSION_MS;
  const expiresAt = Date.now() + lifetime;
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, csrfToken, expiresAt);
  const secureFlag = secure ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(lifetime / 1000)}${secureFlag}`);
  return { token_hash: tokenHash(token), user_id: userId, csrf_token: csrfToken, expires_at: expiresAt };
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email, role: user.role || 'customer' } : null;
}

function csrfMatches(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const actual = Buffer.from(received);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

module.exports = {
  hashPasswordSync, hashPassword, verifyPassword, verifyPasswordSync, verifyUserPassword, loadSession, createSession,
  publicUser, csrfMatches
};
