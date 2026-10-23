'use strict';

const { transaction } = require('../db');
const { HttpError } = require('../models/errors');
const { createAccount } = require('../models/banking');
const { hashPassword, verifyUserPassword, createSession, publicUser } = require('../models/security');
const { findLoginUser } = require('../models/demoIdentity');

function emailAddress(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter your email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function createLoginLimiter() {
  const attempts = new Map();
  const windowMs = 15 * 60 * 1000;
  return (request, email) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
    const address = request.socket.remoteAddress || 'unknown';
    const keys = [[`ip:${address}`, 40], [`account:${address}:${email}`, 8]];
    for (const [key, maximum] of keys) {
      const value = attempts.get(key);
      if (value && value.count >= maximum) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    }
    for (const [key] of keys) {
      const value = attempts.get(key) || { count: 0, expires: now + windowMs };
      value.count += 1;
      attempts.set(key, value);
    }
    // Bound memory even if a client cycles through many email addresses.
    while (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  };
}

function session(context) {
  const { db, request, response } = context;
  const current = context.session || createSession(db, request, response, null, { secure: context.secureCookies });
  return { user: publicUser(context.user), csrfToken: current.csrf_token };
}

async function register(context) {
  const { db, request, response, body } = context;
  if (typeof body.name !== 'string') throw new HttpError(400, 'Enter your full name.');
  const name = body.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new HttpError(400, 'Your name must be 2–80 characters.');
  const email = emailAddress(body.email);
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    throw new HttpError(400, 'Use a password with 8–128 characters.');
  }
  if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) {
    throw new HttpError(400, 'The passwords do not match.');
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists.');
  const passwordHash = await hashPassword(body.password);
  const result = transaction(db, () => {
    // Recheck after hashing because another registration may have completed meanwhile.
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists.');
    const inserted = db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(name, email, passwordHash, new Date().toISOString());
    const user = { id: Number(inserted.lastInsertRowid), name, email, role: 'customer' };
    const account = createAccount(db, user.id, 'Main savings');
    return { user, account };
  });
  const current = createSession(db, request, response, result.user.id, { secure: context.secureCookies });
  return { ...result, csrfToken: current.csrf_token };
}

async function login(context) {
  const { db, request, response, body } = context;
  const email = emailAddress(body.email);
  if (typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) {
    throw new HttpError(400, 'Enter your password.');
  }
  const user = findLoginUser(db, email);
  context.limitLogin(request, user?.email || email);
  const matches = await verifyUserPassword(db, user, body.password);
  if (!user || !matches) throw new HttpError(401, 'The email or password is incorrect.');
  const current = createSession(db, request, response, user.id, { secure: context.secureCookies });
  return { user: publicUser(user), csrfToken: current.csrf_token };
}

function logout(context) {
  const { db, request, response } = context;
  const current = createSession(db, request, response, null, { secure: context.secureCookies });
  return { user: null, csrfToken: current.csrf_token };
}

module.exports = { session, register, login, logout, createLoginLimiter };
