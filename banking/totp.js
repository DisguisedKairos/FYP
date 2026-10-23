'use strict';

const { randomBytes, createHmac, createCipheriv, createDecipheriv, createHash, timingSafeEqual } = require('node:crypto');
const { HttpError } = require('./security');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_MS = 30000;

function base32(bytes) {
  let accumulator = 0, bits = 0, result = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(accumulator >>> bits) & 31]; }
  }
  if (bits) result += ALPHABET[(accumulator << (5 - bits)) & 31];
  return result;
}

function decode32(secret) {
  if (typeof secret !== 'string' || !/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error('Invalid authenticator secret.');
  let accumulator = 0, bits = 0; const bytes = [];
  for (const char of secret) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

function newSecret() { return base32(randomBytes(20)); }

function codeForCounter(secret, counter, digits = 6) {
  if (!Number.isSafeInteger(counter) || counter < 0 || ![6, 8].includes(digits)) throw new Error('Invalid authenticator counter.');
  const value = Buffer.alloc(8); value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decode32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}

function verifyCode(secret, code, { now = Date.now(), lastCounter = -1 } = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(new Date(now).getTime() / PERIOD_MS);
  if (!Number.isSafeInteger(current) || current < 0) return null;
  let matched = null;
  for (const offset of [-1, 0, 1]) {
    const counter = current + offset;
    if (counter < 0 || counter <= Number(lastCounter)) continue;
    if (timingSafeEqual(Buffer.from(codeForCounter(secret, counter)), Buffer.from(code))) matched = counter;
  }
  return matched;
}

function encryptionKey(key) {
  if (typeof key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(key)) throw new HttpError(503, 'Authenticator security is not configured. Contact the administrator.');
  return Buffer.from(key, 'hex');
}

function encryptSecret(secret, key, userId) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(`greenlink-totp:${String(userId)}`));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptSecret(value, key, userId) {
  const material = encryptionKey(key);
  try {
    if (typeof value !== 'string' || !/^v1\.[a-f0-9]{24}\.[a-f0-9]{32}\.[a-f0-9]+$/.test(value)) throw new Error('Invalid ciphertext');
    const [, iv, tag, encrypted] = value.split('.');
    const cipher = createDecipheriv('aes-256-gcm', material, Buffer.from(iv, 'hex'));
    cipher.setAAD(Buffer.from(`greenlink-totp:${String(userId)}`)); cipher.setAuthTag(Buffer.from(tag, 'hex'));
    const secret = Buffer.concat([cipher.update(Buffer.from(encrypted, 'hex')), cipher.final()]).toString('utf8');
    decode32(secret);
    return secret;
  } catch { throw new HttpError(503, 'Authenticator security is unavailable. Contact the administrator.'); }
}

function recoveryCodes() {
  return Array.from({ length: 10 }, () => randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
}

function recoveryHash(code, userId) {
  if (typeof code !== 'string' || !/^[A-Fa-f0-9-]{20,24}$/.test(code)) return null;
  const normalized = code.replace(/-/g, '').toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(normalized)) return null;
  return createHash('sha256').update(`greenlink-recovery:${String(userId)}:${normalized}`).digest('hex');
}

function enrollmentUrl(secret, email) {
  return `otpauth://totp/${encodeURIComponent(`Greenlink Digital Bank:${email}`)}?${new URLSearchParams({ secret, issuer: 'Greenlink Digital Bank', algorithm: 'SHA1', digits: '6', period: '30' })}`;
}

module.exports = { PERIOD_MS, base32, newSecret, codeForCounter, verifyCode, encryptSecret, decryptSecret, recoveryCodes, recoveryHash, enrollmentUrl };
