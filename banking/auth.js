'use strict';

const security = require('./security');
const totp = require('./totp');
const businesses = require('./business');
const { HttpError } = security;

const LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LIMITS = Object.freeze({ loginAccount: 8, loginIp: 40, reauthAccount: 8, reauthIp: 40, registerIp: 20, sessionIp: 60 });
const timestamp = now => new Date(typeof now === 'function' ? now() : now);
const milliseconds = value => new Date(value).getTime();

function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Send a valid JSON object.');
  return value;
}

function rateError(expires, now) {
  const error = new HttpError(429, 'Too many authentication attempts. Try again later.');
  error.retryAfter = Math.max(1, Math.ceil((milliseconds(expires) - now.getTime()) / 1000));
  return error;
}

async function consumeLimits(db, buckets, now) {
  return db.transaction(async client => {
    const locked = [];
    // A stable lock order also protects concurrent attempts using overlapping
    // account and IP buckets on separate PostgreSQL connections.
    for (const bucket of [...buckets].sort((left, right) => left.key.localeCompare(right.key))) {
      const expires = new Date(now.getTime() + LIMIT_WINDOW_MS);
      await client.query(`INSERT INTO auth_attempts(bucket_key,attempts,window_started_at,expires_at)
        VALUES($1,0,$2,$3) ON CONFLICT(bucket_key) DO NOTHING`, [bucket.key, now, expires]);
      const row = (await client.query('SELECT * FROM auth_attempts WHERE bucket_key=$1 FOR UPDATE', [bucket.key])).rows[0];
      const expired = milliseconds(row.expires_at) <= now.getTime();
      const attempts = expired ? 0 : row.attempts;
      if ((!expired && row.locked_until && milliseconds(row.locked_until) > now.getTime()) || attempts >= bucket.maximum) throw rateError(row.expires_at, now);
      locked.push({ ...bucket, attempts: attempts + 1, started: expired ? now : row.window_started_at, expires: expired ? expires : row.expires_at });
    }
    for (const bucket of locked) await client.query(`UPDATE auth_attempts SET attempts=$2,window_started_at=$3,expires_at=$4,locked_until=$5 WHERE bucket_key=$1`,
      [bucket.key, bucket.attempts, bucket.started, bucket.expires, bucket.attempts >= bucket.maximum ? bucket.expires : null]);
  });
}

function buckets(kind, ip, subject) {
  if (kind === 'login') return [
    { key: security.bucketKey('login:account', subject), maximum: LIMITS.loginAccount },
    { key: security.bucketKey('login:ip', ip), maximum: LIMITS.loginIp },
  ];
  if (kind === 'reauth' || kind === 'mfa') return [
    { key: security.bucketKey(`${kind}:account`, subject), maximum: LIMITS.reauthAccount },
    { key: security.bucketKey(`${kind}:ip`, ip), maximum: LIMITS.reauthIp },
  ];
  return [{ key: security.bucketKey(`${kind}:ip`, ip), maximum: kind === 'register' ? LIMITS.registerIp : LIMITS.sessionIp }];
}

async function audit(client, type, { userId = null, ip = null, metadata = {}, now = new Date() } = {}) {
  await client.query(`INSERT INTO audit_log(actor_id,target_user_id,event_type,ip_address,metadata,created_at) VALUES($1,$1,$2,$3,$4,$5)`,
    [userId, type, ip, metadata, now]);
}

async function authorize(db, user, value, now = Date.now, { ip = 'internal', purpose = 'payment' } = {}) {
  const date = timestamp(now);
  await consumeLimits(db, buckets('reauth', ip, String(user?.id || 'unknown')), date);
  const record = user?.id ? (await db.query('SELECT id,password_hash,auth_version FROM users WHERE id=$1', [user.id])).rows[0] : null;
  const valid = await security.verifyPassword(value, record?.password_hash);
  if (!record || !valid || (user.auth_version !== undefined && record.auth_version !== user.auth_version)) {
    await audit(db, 'auth.reauthorization.failed', { userId: record?.id || null, ip, metadata: { purpose }, now: date });
    throw new HttpError(403, 'The authorization password is incorrect.');
  }
  // Successful attempts do not erase the IP quota, which bounds hashing work.
  await db.query('DELETE FROM auth_attempts WHERE bucket_key=$1', [security.bucketKey('reauth:account', String(record.id))]);
  await audit(db, 'auth.reauthorization.succeeded', { userId: record.id, ip, metadata: { purpose }, now: date });
  return { method: 'password', authorizedAt: date.toISOString(), userId: String(record.id), authVersion: record.auth_version, purpose };
}

async function assertCurrentUser(db,user,{lock=false}={}) {
  const current=(await db.query('SELECT id,name,email,role,auth_version FROM users WHERE id=$1'+(lock?' FOR UPDATE':''),[user?.id])).rows[0];
  if(!current || current.auth_version!==user.auth_version)throw new HttpError(409,'Account security changed. Sign in again.');
  return current;
}

function createAuth({ db, now = Date.now, publicOrigin = null, secureCookies = false, authEncryptionKey = process.env.AUTH_ENCRYPTION_KEY } = {}) {
  if (!db?.query || !db?.transaction) throw new Error('Authentication requires the PostgreSQL database adapter.');
  const origin = publicOrigin ? security.normalizeOrigin(publicOrigin) : null;
  const secure = secureCookies || Boolean(origin?.startsWith('https:'));

  function assertWrite(req, session, { csrf = true } = {}) {
    security.assertOrigin(req, origin);
    if (csrf) security.assertCsrf(req, session);
  }

  async function load(req) {
    const raw = security.readCookie(req);
    if (!raw) return { session: null, user: null };
    const date = timestamp(now), idleBoundary = new Date(date.getTime() - security.IDLE_MS);
    const row = (await db.query(`WITH touched AS (
      UPDATE sessions s SET last_seen_at=$2 WHERE s.token_hash=$1 AND s.revoked_at IS NULL
        AND s.expires_at>$2 AND s.last_seen_at>$3
        AND (s.user_id IS NULL OR EXISTS(SELECT 1 FROM users v WHERE v.id=s.user_id AND v.auth_version=s.auth_version))
      RETURNING s.*)
      SELECT touched.*,u.name AS user_name,u.email AS user_email,u.role AS user_role,u.auth_version AS user_auth_version,m.enabled_at AS mfa_enabled_at
      FROM touched LEFT JOIN users u ON u.id=touched.user_id LEFT JOIN user_mfa m ON m.user_id=touched.user_id`, [security.tokenHash(raw), date, idleBoundary])).rows[0];
    if (!row) return { session: null, user: null };
    const user = row.user_id ? { id: String(row.user_id), name: row.user_name, email: row.user_email, role: row.user_role, auth_version: row.user_auth_version, mfaEnabled: Boolean(row.mfa_enabled_at) } : null;
    return { session: row, user };
  }

  async function insertSession(client, req, user, date, mfaVerifiedAt = null) {
    const previous = security.readCookie(req);
    if (previous) await client.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE token_hash=$1', [security.tokenHash(previous), date]);
    const raw = security.token(), csrfToken = security.token();
    const expires = new Date(date.getTime() + (user ? security.SESSION_MS : security.ANONYMOUS_MS));
    await client.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,auth_version,created_at,last_seen_at,expires_at,mfa_verified_at)
      VALUES($1,$2,$3,$4,$5,$5,$6,$7)`, [security.tokenHash(raw), user?.id || null, csrfToken, user?.auth_version || 1, date, expires, mfaVerifiedAt]);
    return { raw, csrfToken, expires, secure: secure || Boolean(req.socket?.encrypted) };
  }

  function finish(res, session, user, extras = {}) {
    security.writeCookie(res, session.raw, { secure: session.secure, expiresAt: session.expires, now: timestamp(now).getTime() });
    return { user: security.publicUser(user), csrfToken: session.csrfToken, ...extras };
  }

  async function bootstrap(req, res) {
    const context = await load(req);
    if (context.session) return { user: security.publicUser(context.user), csrfToken: context.session.csrf_token };
    const date = timestamp(now), ip = security.clientAddress(req);
    await consumeLimits(db, buckets('session', ip), date);
    const session = await db.transaction(client => insertSession(client, req, null, date));
    return finish(res, session, null);
  }

  async function register(req, res, body) {
    assertWrite(req, null, { csrf: false });
    objectBody(body);
    const name = security.fullName(body.name), email = security.emailAddress(body.email), value = security.password(body.password);
    const businessProfile = businesses.normalize(body.business);
    if (body.confirmPassword !== undefined && body.confirmPassword !== value) throw new HttpError(400, 'The passwords do not match.');
    const ip = security.clientAddress(req), date = timestamp(now);
    await consumeLimits(db, buckets('register', ip), date);
    const hash = await security.hashPassword(value);
    let result;
    try {
      result = await db.transaction(async client => {
        const user = (await client.query(`INSERT INTO users(name,email,password_hash,created_at) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,auth_version`, [name, email, hash, date])).rows[0];
        const business = await businesses.create(client,user,businessProfile,{now});
        let account;
        for (let attempt = 0; attempt < 10 && !account; attempt++) account = (await client.query(`INSERT INTO accounts(user_id,name,number,created_at)
          VALUES($1,'Operating savings',$2,$3) ON CONFLICT(number) DO NOTHING RETURNING *`, [user.id, security.accountNumber(), date])).rows[0];
        if (!account) throw new Error('A unique savings account number could not be allocated.');
        user.mfaEnabled = false;
        const session = await insertSession(client, req, user, date);
        await audit(client, 'auth.registered', { userId: user.id, ip, now: date });
        return { user, account, session, business };
      });
    } catch (error) { if (error.code === '23505') throw new HttpError(409, 'An application with this email or business registration number already exists.'); throw error; }
    return finish(res, result.session, result.user, { business: result.business, account: { id: String(result.account.id), name: result.account.name, number: result.account.number, balanceCents: 0, status: result.account.status, productType: 'business_savings', businessId: result.business.id, createdAt: timestamp(result.account.created_at).toISOString() } });
  }

  async function login(req, res, body) {
    assertWrite(req, null, { csrf: false });
    objectBody(body);
    const email = security.emailAddress(body.email), ip = security.clientAddress(req), date = timestamp(now);
    await consumeLimits(db, buckets('login', ip, email), date);
    const user = (await db.query('SELECT id,name,email,role,auth_version,password_hash FROM users WHERE lower(email)=$1', [email])).rows[0];
    if (!await security.verifyPassword(body.password, user?.password_hash)) {
      await audit(db, 'auth.login.failed', { userId: user?.id || null, ip, now: date });
      throw new HttpError(401, 'The email or password is incorrect.');
    }
    let result;
    try {
      result = await db.transaction(async client => {
        const current = (await client.query('SELECT id,name,email,role,auth_version,password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
        if (!current || current.password_hash !== user.password_hash) throw new HttpError(401, 'The email or password is incorrect.');
        const verified = await verifyMfa(client, current.id, body, date);
        current.mfaEnabled = verified;
        await client.query('DELETE FROM auth_attempts WHERE bucket_key=$1', [security.bucketKey('login:account', email)]);
        await audit(client, 'auth.login.succeeded', { userId: user.id, ip, metadata: { mfaVerified: verified }, now: date });
        return { session: await insertSession(client, req, current, date, verified ? date : null), user: current };
      });
    } catch (error) {
      if (error.mfaRequired) await audit(db, 'auth.mfa.failed', { userId: user.id, ip, now: date });
      throw error;
    }
    return finish(res, result.session, result.user);
  }

  async function logout(req, res) {
    const current = await load(req);
    assertWrite(req, current.session);
    const date = timestamp(now), ip = security.clientAddress(req);
    const session = await db.transaction(async client => {
      const previous = security.readCookie(req);
      const old = previous ? (await client.query('SELECT user_id FROM sessions WHERE token_hash=$1', [security.tokenHash(previous)])).rows[0] : null;
      const next = await insertSession(client, req, null, date);
      await audit(client, 'auth.logout', { userId: old?.user_id || null, ip, now: date });
      return next;
    });
    return finish(res, session, null);
  }

  async function authenticated(req, context) {
    const current = context || await load(req);
    if (!current.user || !current.session) throw new HttpError(401, 'Sign in to continue.');
    assertWrite(req, current.session);
    return current;
  }

  function mfaError(required = false, status = 401) {
    const error = new HttpError(status, required ? 'Enter your authenticator code or an unused recovery code.' : 'The authenticator or recovery code is invalid or has already been used.');
    error.code = required ? 'MFA_REQUIRED' : 'MFA_INVALID';
    error.mfaRequired = true;
    return error;
  }

  async function verifyMfa(client, userId, body, date, { required = false, status = 401 } = {}) {
    const row = (await client.query('SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!row?.enabled_at) {
      if (required) throw new HttpError(409, 'Authenticator verification is not enabled.');
      return false;
    }
    if (body.otp && body.recoveryCode) throw new HttpError(400, 'Enter either an authenticator code or a recovery code.');
    if (!body.otp && !body.recoveryCode) throw mfaError(true, status);
    if (body.otp) {
      const secret = totp.decryptSecret(row.secret_encrypted, authEncryptionKey, userId);
      const counter = totp.verifyCode(secret, body.otp, { now: date, lastCounter: row.last_counter });
      if (counter === null) throw mfaError(false, status);
      await client.query('UPDATE user_mfa SET last_counter=$2 WHERE user_id=$1', [userId, counter]);
    } else {
      const hash = totp.recoveryHash(body.recoveryCode, userId);
      if (!hash || !(await client.query('UPDATE mfa_recovery_codes SET used_at=$3 WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash', [userId, hash, date])).rowCount) throw mfaError(false, status);
    }
    return true;
  }

  async function lockCurrentUser(client, context) {
    return assertCurrentUser(client,context.user,{lock:true});
  }

  async function mfaSetup(req, res, body, context) {
    objectBody(body);
    const current = await authenticated(req, context), ip = security.clientAddress(req);
    await authorize(db, current.user, body.currentPassword, now, { ip, purpose: 'mfa_setup' });
    const date = timestamp(now), expires = new Date(date.getTime() + 10 * 60 * 1000);
    const secret = totp.newSecret(), encrypted = totp.encryptSecret(secret, authEncryptionKey, current.user.id);
    await db.transaction(async client => {
      await lockCurrentUser(client, current);
      const existing = (await client.query('SELECT enabled_at FROM user_mfa WHERE user_id=$1 FOR UPDATE', [current.user.id])).rows[0];
      if (existing?.enabled_at) throw new HttpError(409, 'Authenticator verification is already enabled.');
      await client.query(`INSERT INTO user_mfa(user_id,pending_secret_encrypted,pending_expires_at) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET pending_secret_encrypted=$2,pending_expires_at=$3`, [current.user.id, encrypted, expires]);
      await audit(client, 'auth.mfa.setup_started', { userId: current.user.id, ip, now: date });
    });
    return { secret, otpauthUrl: totp.enrollmentUrl(secret, current.user.email), expiresAt: expires.toISOString() };
  }

  async function mfaConfirm(req, res, body, context) {
    objectBody(body);
    const current = await authenticated(req, context), ip = security.clientAddress(req), date = timestamp(now);
    await consumeLimits(db, buckets('mfa', ip, current.user.id), date);
    const result = await db.transaction(async client => {
      const user = await lockCurrentUser(client, current);
      const row = (await client.query('SELECT * FROM user_mfa WHERE user_id=$1 FOR UPDATE', [user.id])).rows[0];
      if (row?.enabled_at) throw new HttpError(409, 'Authenticator verification is already enabled.');
      if (!row?.pending_secret_encrypted || milliseconds(row.pending_expires_at) <= date.getTime()) throw new HttpError(400, 'Authenticator setup expired. Start a new setup.');
      const secret = totp.decryptSecret(row.pending_secret_encrypted, authEncryptionKey, user.id);
      const counter = totp.verifyCode(secret, body.otp, { now: date });
      if (counter === null) throw new HttpError(403, 'The authenticator code is invalid.');
      await client.query(`UPDATE user_mfa SET secret_encrypted=pending_secret_encrypted,pending_secret_encrypted=NULL,
        pending_expires_at=NULL,enabled_at=$2,last_counter=$3 WHERE user_id=$1`, [user.id, date, counter]);
      const codes = totp.recoveryCodes();
      await client.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [user.id]);
      for (const code of codes) await client.query('INSERT INTO mfa_recovery_codes(user_id,code_hash,created_at) VALUES($1,$2,$3)', [user.id, totp.recoveryHash(code, user.id), date]);
      const updated = (await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1 RETURNING id,name,email,role,auth_version', [user.id])).rows[0];
      updated.mfaEnabled = true;
      await client.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [user.id, date]);
      const session = await insertSession(client, req, updated, date, date);
      await audit(client, 'auth.mfa.enabled', { userId: user.id, ip, metadata: { recoveryCodeCount: codes.length }, now: date });
      return { user: updated, session, codes };
    });
    return finish(res, result.session, result.user, { recoveryCodes: result.codes });
  }

  async function mfaDisable(req, res, body, context) {
    objectBody(body);
    const current = await authenticated(req, context), ip = security.clientAddress(req), date = timestamp(now);
    const authorization = await authorize(db, current.user, body.currentPassword, now, { ip, purpose: 'mfa_disable' });
    await consumeLimits(db, buckets('mfa', ip, current.user.id), date);
    const result = await db.transaction(async client => {
      const user = await lockCurrentUser(client, current);
      if (user.auth_version !== authorization.authVersion) throw new HttpError(409, 'Account security changed. Sign in again.');
      await verifyMfa(client, user.id, { otp: body.otp }, date, { required: true, status: 403 });
      await client.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [user.id]);
      await client.query('DELETE FROM user_mfa WHERE user_id=$1', [user.id]);
      const updated = (await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1 RETURNING id,name,email,role,auth_version', [user.id])).rows[0];
      updated.mfaEnabled = false;
      await client.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [user.id, date]);
      const session = await insertSession(client, req, updated, date);
      await audit(client, 'auth.mfa.disabled', { userId: user.id, ip, now: date });
      return { user: updated, session };
    });
    return finish(res, result.session, result.user);
  }

  async function changePassword(req, res, body, context) {
    objectBody(body);
    const current = await authenticated(req, context), ip = security.clientAddress(req);
    const nextPassword = security.password(body.newPassword, 'New password');
    if (body.confirmPassword !== undefined && body.confirmPassword !== nextPassword) throw new HttpError(400, 'The passwords do not match.');
    if (nextPassword === body.currentPassword) throw new HttpError(400, 'Choose a different password.');
    const authorization = await authorize(db, current.user, body.currentPassword, now, { ip, purpose: 'password_change' });
    const nextHash = await security.hashPassword(nextPassword), date = timestamp(now);
    const result = await db.transaction(async client => {
      const user = (await client.query('SELECT id,name,email,role,auth_version FROM users WHERE id=$1 FOR UPDATE', [current.user.id])).rows[0];
      if (!user || user.auth_version !== authorization.authVersion) throw new HttpError(409, 'Account security changed. Sign in again before changing the password.');
      const updated = (await client.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1 RETURNING id,name,email,role,auth_version', [user.id, nextHash])).rows[0];
      await client.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [user.id, date]);
      updated.mfaEnabled = current.user.mfaEnabled;
      const session = await insertSession(client, req, updated, date, current.session.mfa_verified_at);
      await audit(client, 'auth.password_changed', { userId: user.id, ip, metadata: { revokedOtherSessions: true }, now: date });
      return { user: updated, session };
    });
    return finish(res, result.session, result.user);
  }

  async function revokeAll(req, res, body, context) {
    objectBody(body);
    const current = await authenticated(req, context), ip = security.clientAddress(req);
    const authorization = await authorize(db, current.user, body.currentPassword, now, { ip, purpose: 'revoke_sessions' });
    const date = timestamp(now);
    const session = await db.transaction(async client => {
      const user = (await client.query('SELECT auth_version FROM users WHERE id=$1 FOR UPDATE', [current.user.id])).rows[0];
      if (!user || user.auth_version !== authorization.authVersion) throw new HttpError(409, 'Account security changed. Sign in again.');
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [current.user.id]);
      await client.query('UPDATE sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [current.user.id, date]);
      const next = await insertSession(client, req, null, date);
      await audit(client, 'auth.sessions_revoked', { userId: current.user.id, ip, now: date });
      return next;
    });
    return finish(res, session, null);
  }

  return {
    load, bootstrap, register, login, logout, changePassword, revokeAll, mfaSetup, mfaConfirm, mfaDisable, assertWrite,
    authorize: (user, value, options) => authorize(db, user, value, now, options),
  };
}

module.exports = { createAuth, assertCurrentUser, authorize, consumeLimits, LIMITS };
