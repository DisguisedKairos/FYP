'use strict';

const { randomBytes, randomInt, createHash, timingSafeEqual, scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('../models/errors');

const SESSION_COOKIE = 'greenlink_session';
const SESSION_MS = 24 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const ANONYMOUS_MS = 60 * 60 * 1000;
const HASH_FORMAT = /^[a-f0-9]{32}:[a-f0-9]{128}$/;
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
const deriveKey = promisify(scrypt);

async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(value, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

function password(value, label = 'Password') {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new HttpError(400, `${label} must contain 8–128 characters.`);
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) throw new HttpError(400, `${label} must include an uppercase letter, a lowercase letter and a number.`);
  return value;
}

async function verifyPassword(value, stored) {
  const validInput = typeof value === 'string' && value.length > 0 && value.length <= 128;
  const validHash = typeof stored === 'string' && HASH_FORMAT.test(stored);
  const [salt, encoded] = (validHash ? stored : DUMMY_HASH).split(':');
  const actual = await deriveKey(validInput ? value : '', salt, 64);
  const matches = timingSafeEqual(actual, Buffer.from(encoded, 'hex'));
  return validInput && validHash && matches;
}

function emailAddress(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter your email address.');
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'Enter a valid email address.');
  return normalized;
}

function fullName(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter your full name.');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) throw new HttpError(400, 'Your name must contain 2–80 characters.');
  return normalized;
}

function token() { return randomBytes(32).toString('hex'); }
function tokenHash(value) { return createHash('sha256').update(value).digest('hex'); }
function bucketKey(scope, value) { return `${scope}:${tokenHash(String(value))}`; }
function accountNumber() { return `102${String(randomInt(0, 10000000)).padStart(7, '0')}`; }

function equalToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(actual), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(req, name = SESSION_COOKIE) {
  const cookies = String(req.headers?.cookie || '').split(';').map(part => part.trim());
  const matches = cookies.filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('Set a valid public application origin.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Set a valid public application origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('The public application origin must not contain credentials, a path, query or fragment.');
  return parsed.origin;
}

function expectedOrigin(req, configured) {
  if (configured) return normalizeOrigin(configured);
  const protocol = req.protocol || (req.socket?.encrypted ? 'https' : 'http');
  return normalizeOrigin(`${protocol}://${req.headers?.host || ''}`);
}

function assertOrigin(req, configured) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
  const actual = req.headers?.origin;
  if (actual === undefined) return;
  let origin;
  try { origin = normalizeOrigin(actual); } catch { throw new HttpError(403, 'Request origin is not allowed.'); }
  if (origin !== expectedOrigin(req, configured)) throw new HttpError(403, 'Request origin is not allowed.');
}

function assertCsrf(req, session) {
  if (!session || !equalToken(req.headers?.['x-csrf-token'], session.csrf_token)) throw new HttpError(403, 'Your security token has expired. Refresh the page and try again.');
}

function clientAddress(req) {
  // Express owns proxy trust. Never inspect X-Forwarded-For in this module.
  const value = req.ip;
  if (typeof value !== 'string' || !value || value.length > 80) throw new HttpError(400, 'A valid client address is required.');
  return value;
}

function publicUser(user) {
  return user ? { id: String(user.id), name: user.name, email: user.email, role: user.role || 'customer', ...(user.mfaEnabled === undefined ? {} : { mfaEnabled: Boolean(user.mfaEnabled) }) } : null;
}

function writeCookie(res, value, { secure = false, expiresAt, now = Date.now(), name = SESSION_COOKIE } = {}) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`);
}

module.exports = {
  HttpError, SESSION_COOKIE, SESSION_MS, IDLE_MS, ANONYMOUS_MS,
  hashPassword, verifyPassword, password, emailAddress, fullName,
  token, tokenHash, bucketKey, accountNumber, equalToken, readCookie, normalizeOrigin,
  assertOrigin, assertCsrf, clientAddress, publicUser, writeCookie,
};
