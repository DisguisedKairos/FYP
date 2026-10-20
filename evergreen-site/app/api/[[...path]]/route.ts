import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";
const COOKIE = "evergreen_bank";
const MAX_BALANCE = 9_000_000_000_000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const billers = [
  { id: "sp-services", name: "SP Services", category: "Utilities", initials: "SP", color: "#dceae3" },
  { id: "singtel", name: "Singtel", category: "Telecommunications", initials: "S", color: "#f6e2e2" },
  { id: "pub", name: "PUB", category: "Water", initials: "P", color: "#dfeaf6" },
];
type User = { id: string; name: string; email: string; passwordHash?: string };
type Session = { tokenHash: string; namespace: string; userId: string | null; csrfToken: string; expiresAt: number };
type Account = { id: string; name: string; number: string; balanceCents: number; status: string; createdAt: string; userId?: string };
type Operation = { id: string; payloadHash: string; status: string };
type Payload = Record<string, unknown>;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new HttpError(status, message); }
function database(): D1Database {
  if (!env.DB) fail(503, "The banking database is temporarily unavailable.");
  return env.DB!;
}
function json(data: unknown, status = 200, cookie?: string) {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return Response.json(data, { status, headers });
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join(""); }
async function digest(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))), n => n.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; }
async function passwordHash(password: string, salt = randomToken().slice(0, 32)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100_000 }, key, 256);
  const hash = Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, "0")).join("");
  return `pbkdf2$100000$${salt}$${hash}`;
}
async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  return parts.length === 4 && safeEqual(await passwordHash(password, parts[2]), stored);
}
function namespaceFor(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (userId && email) return userId;
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return "local-preview";
  return fail(401, "Please sign in to this private Site to continue.");
}
function cookieValue(request: Request, token: string) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function existingSession(db: D1Database, request: Request, namespace: string) {
  const token = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare("SELECT token_hash AS tokenHash, namespace, user_id AS userId, csrf_token AS csrfToken, expires_at AS expiresAt FROM bank_sessions WHERE token_hash = ? AND namespace = ? AND expires_at > ?")
    .bind(await digest(token), namespace, Date.now()).first<Session>();
}
async function issueSession(db: D1Database, request: Request, namespace: string, userId: string | null, previous?: Session | null) {
  const token = randomToken();
  const session: Session = { tokenHash: await digest(token), namespace, userId, csrfToken: randomToken(), expiresAt: Date.now() + SESSION_MS };
  const statements = [db.prepare("INSERT INTO bank_sessions (token_hash, namespace, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)").bind(session.tokenHash, namespace, userId, session.csrfToken, session.expiresAt)];
  if (previous) statements.push(db.prepare("DELETE FROM bank_sessions WHERE token_hash = ?").bind(previous.tokenHash));
  statements.push(db.prepare("DELETE FROM bank_sessions WHERE expires_at <= ?").bind(Date.now()));
  await db.batch(statements);
  return { session, cookie: cookieValue(request, token) };
}
async function currentUser(db: D1Database, session: Session | null) {
  if (!session?.userId) return null;
  return db.prepare("SELECT id, name, email FROM bank_users WHERE id = ? AND namespace = ?").bind(session.userId, session.namespace).first<User>();
}
async function body(request: Request): Promise<Payload> {
  if (!request.headers.get("content-type")?.includes("application/json")) fail(415, "Please send JSON data.");
  const raw = await request.text();
  if (raw.length > 8192) fail(413, "The request is too large.");
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid request data."); return value; }
  catch { return fail(400, "Invalid request data."); }
}
function textValue(value: unknown, label: string, min = 1, max = 80) {
  if (typeof value !== "string") fail(400, `${label} is required.`);
  const result = value.trim();
  if (result.length < min || result.length > max) fail(400, `${label} must contain ${min}–${max} characters.`);
  return result;
}
function emailValue(value: unknown) {
  const email = textValue(value, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "Enter a valid email address.");
  return email;
}
function passwordValue(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) fail(400, "Password must contain 8–128 characters.");
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) fail(400, "Use an uppercase letter, a lowercase letter and a number in your password.");
  return value;
}
function amountValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) fail(400, "Enter a positive amount with no more than two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000) fail(400, "Amount must be between $0.01 and $1,000,000.00.");
  return cents;
}
function idValue(value: unknown) { return textValue(String(value ?? ""), "Account", 1, 100); }
const accountSelect = "SELECT id, name, number, balance_cents AS balanceCents, status, created_at AS createdAt, user_id AS userId FROM bank_accounts";
const transactionSelect = "SELECT id, account_id AS accountId, type, description, amount_cents AS amountCents, counterparty, status, created_at AS createdAt, reference FROM bank_transactions";
async function ownedAccount(db: D1Database, id: string, userId: string) {
  const account = await db.prepare(`${accountSelect} WHERE id = ? AND user_id = ? AND status = 'active'`).bind(id, userId).first<Account>();
  if (!account) fail(404, "Savings account not found.");
  return account;
}
function publicAccount(account: Account) { const { userId: _userId, ...rest } = account; return rest; }

// Seed data is deliberately outside schema migrations. Stable IDs and INSERT OR IGNORE
// make concurrent first visits safe without ever resetting an existing demo balance.
async function seed(db: D1Database, namespace: string) {
  const prefix = (await digest(namespace)).slice(0, 24);
  const alex = `${prefix}-alex`, jamie = `${prefix}-jamie`;
  if (await db.prepare("SELECT id FROM bank_users WHERE id = ?").bind(alex).first()) return;
  const hash = await passwordHash("Evergreen123!");
  const now = new Date().toISOString();
  const date = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const account1 = `${prefix}-main`, account2 = `${prefix}-rainy`, recipient = `${prefix}-recipient`;
  const statements = [
    db.prepare("INSERT OR IGNORE INTO bank_users (id, namespace, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(alex, namespace, "Alex Morgan", "alex@evergreen.demo", hash, now),
    db.prepare("INSERT OR IGNORE INTO bank_users (id, namespace, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(jamie, namespace, "Jamie Lee", "jamie@evergreen.demo", hash, now),
    db.prepare("INSERT OR IGNORE INTO bank_accounts (id, namespace, user_id, name, number, balance_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)").bind(account1, namespace, alex, "Main savings", "1020001001", 2485050, date(180)),
    db.prepare("INSERT OR IGNORE INTO bank_accounts (id, namespace, user_id, name, number, balance_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)").bind(account2, namespace, alex, "Rainy day", "1020001002", 520000, date(120)),
    db.prepare("INSERT OR IGNORE INTO bank_accounts (id, namespace, user_id, name, number, balance_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)").bind(recipient, namespace, jamie, "Main savings", "1020002001", 120000, date(180)),
  ];
  const history: [string, string, string, number, string, number, number][] = [
    [account1, "credit", "Monthly salary", 480000, "Acme Studio", 2, 0],
    [account1, "bill", "SP Services bill", -8750, "SP Services", 4, 0],
    [account1, "transfer", "Move to Rainy day", -50000, "Rainy day", 6, 1],
    [account2, "transfer", "Savings top-up", 50000, "Main savings", 6, 1],
    [account1, "transfer", "Dinner with Jamie", -4250, "Jamie Lee", 8, 0],
    [account1, "bill", "Singtel mobile bill", -6500, "Singtel", 10, 0],
    [account1, "credit", "Project payment", 125000, "Studio North", 14, 0],
  ];
  history.forEach(([accountId, type, description, amount, counterparty, days, internal], index) => {
    statements.push(db.prepare("INSERT OR IGNORE INTO bank_transactions (id, account_id, type, description, amount_cents, counterparty, status, created_at, reference, is_internal) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)")
      .bind(`${prefix}-history-${index}`, accountId, type, description, amount, counterparty, date(days), `EG-DEMO-${index + 1}`, internal));
  });
  await db.batch(statements);
}

async function executeMoney(db: D1Database, user: User, namespace: string, payload: Payload, kind: "transfer" | "bill") {
  const fromId = idValue(payload.fromAccountId);
  const amount = amountValue(payload.amount);
  const requestId = textValue(payload.requestId, "Request ID", 8, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) fail(400, "Invalid request ID.");
  let toNumber = "", reference = "", description = "", counterparty = "", target: Account | null = null;
  const source = await ownedAccount(db, fromId, user.id);
  let internal = 0;
  if (kind === "transfer") {
    toNumber = textValue(payload.toAccountNumber, "Recipient account number", 6, 30).replace(/[\s-]/g, "");
    target = await db.prepare(`${accountSelect} WHERE namespace = ? AND number = ? AND status = 'active'`).bind(namespace, toNumber).first<Account>();
    if (!target) fail(404, "Recipient account not found. Try Jamie's demo account 1020002001.");
    if (target.id === fromId) fail(400, "Choose a different destination account.");
    const recipient = await db.prepare("SELECT name FROM bank_users WHERE id = ?").bind(target.userId!).first<{ name: string }>();
    counterparty = target.userId === user.id ? target.name : recipient!.name;
    internal = target.userId === user.id ? 1 : 0;
    description = payload.description ? textValue(payload.description, "Description", 1, 120) : `Transfer to ${counterparty}`;
  } else {
    const biller = billers.find(item => item.id === payload.billerId);
    if (!biller) fail(400, "Select a valid biller.");
    reference = textValue(payload.reference, "Bill reference", 3, 60);
    counterparty = biller.name;
    description = `${biller.name} bill payment`;
  }
  const payloadHash = await digest(JSON.stringify({ kind, fromId, amount, toNumber, billerId: payload.billerId ?? null, reference, description }));
  const findOperation = () => db.prepare("SELECT id, payload_hash AS payloadHash, status FROM bank_operations WHERE user_id = ? AND request_id = ?").bind(user.id, requestId).first<Operation>();
  let operation = await findOperation();
  if (operation) {
    if (operation.payloadHash !== payloadHash) fail(409, "This request ID was already used for a different transaction.");
    const transaction = await db.prepare(`${transactionSelect} WHERE operation_id = ? AND account_id = ?`).bind(operation.id, fromId).first();
    return json({ ok: true, transaction });
  }
  const operationId = crypto.randomUUID(), outgoingId = crypto.randomUUID(), incomingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const paymentReference = reference || `EG-${operationId.slice(0, 8).toUpperCase()}`;
  // Every batch runs as one D1 transaction. The conditional claim, debit, credit,
  // ledgers and completion cannot interleave with another transfer or account close.
  const claim = kind === "transfer"
    ? db.prepare("INSERT INTO bank_operations (id, user_id, request_id, payload_hash, status, created_at) SELECT ?, ?, ?, ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM bank_accounts WHERE id = ? AND user_id = ? AND status = 'active' AND balance_cents >= ?) AND EXISTS (SELECT 1 FROM bank_accounts WHERE id = ? AND namespace = ? AND status = 'active' AND balance_cents <= ?) ON CONFLICT(user_id, request_id) DO NOTHING")
      .bind(operationId, user.id, requestId, payloadHash, now, fromId, user.id, amount, target!.id, namespace, MAX_BALANCE - amount)
    : db.prepare("INSERT INTO bank_operations (id, user_id, request_id, payload_hash, status, created_at) SELECT ?, ?, ?, ?, 'pending', ? WHERE EXISTS (SELECT 1 FROM bank_accounts WHERE id = ? AND user_id = ? AND status = 'active' AND balance_cents >= ?) ON CONFLICT(user_id, request_id) DO NOTHING")
      .bind(operationId, user.id, requestId, payloadHash, now, fromId, user.id, amount);
  const pending = "EXISTS (SELECT 1 FROM bank_operations WHERE id = ? AND status = 'pending')";
  const statements = [claim,
    db.prepare(`UPDATE bank_accounts SET balance_cents = balance_cents - ? WHERE id = ? AND ${pending}`).bind(amount, fromId, operationId),
  ];
  if (target) statements.push(db.prepare(`UPDATE bank_accounts SET balance_cents = balance_cents + ? WHERE id = ? AND ${pending}`).bind(amount, target.id, operationId));
  statements.push(db.prepare(`INSERT INTO bank_transactions (id, account_id, operation_id, type, description, amount_cents, counterparty, status, created_at, reference, is_internal) SELECT ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ? WHERE ${pending}`)
    .bind(outgoingId, fromId, operationId, kind, description, -amount, counterparty, now, paymentReference, internal, operationId));
  if (target) statements.push(db.prepare(`INSERT INTO bank_transactions (id, account_id, operation_id, type, description, amount_cents, counterparty, status, created_at, reference, is_internal) SELECT ?, ?, ?, 'transfer', ?, ?, ?, 'completed', ?, ?, ? WHERE ${pending}`)
    .bind(incomingId, target.id, operationId, description, amount, user.name, now, paymentReference, internal, operationId));
  statements.push(db.prepare("UPDATE bank_operations SET status = 'completed' WHERE id = ? AND status = 'pending'").bind(operationId));
  await db.batch(statements);
  operation = await findOperation();
  if (!operation) fail(400, "Insufficient funds or the destination account is unavailable.");
  if (operation.payloadHash !== payloadHash) fail(409, "This request ID was already used for a different transaction.");
  const transaction = await db.prepare(`${transactionSelect} WHERE operation_id = ? AND account_id = ?`).bind(operation.id, fromId).first();
  return json({ ok: true, transaction });
}

async function handle(request: Request) {
  try {
    const db = database(), namespace = namespaceFor(request);
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    const method = request.method;
    let session = await existingSession(db, request, namespace);
    if (method === "GET" && path === "/api/session") {
      let cookie: string | undefined;
      if (!session) { const issued = await issueSession(db, request, namespace, null); session = issued.session; cookie = issued.cookie; }
      return json({ ok: true, user: await currentUser(db, session), csrfToken: session.csrfToken }, 200, cookie);
    }
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) fail(403, "This request could not be verified.");
      if (!session || !safeEqual(request.headers.get("x-csrf-token") ?? "", session.csrfToken)) fail(403, "Your session has expired. Refresh the page and try again.");
    }
    if (method === "POST" && (path === "/api/auth/register" || path === "/api/auth/login")) {
      const payload = await body(request);
      const email = emailValue(payload.email);
      const password = typeof payload.password === "string" ? payload.password : "";
      if (!password || password.length > 128) fail(400, "Enter your password.");
      await seed(db, namespace);
      if (path.endsWith("register")) {
        const name = textValue(payload.name, "Full name", 2, 80);
        passwordValue(password);
        if (payload.confirmPassword !== undefined && payload.confirmPassword !== password) fail(400, "The passwords do not match.");
        if (await db.prepare("SELECT id FROM bank_users WHERE namespace = ? AND email = ?").bind(namespace, email).first()) fail(409, "An account with this email already exists. Please sign in.");
        const id = crypto.randomUUID(), accountId = crypto.randomUUID(), now = new Date().toISOString();
        const number = String(2000000000 + crypto.getRandomValues(new Uint32Array(1))[0] % 7000000000);
        try {
          await db.batch([
            db.prepare("INSERT INTO bank_users (id, namespace, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, namespace, name, email, await passwordHash(password), now),
            db.prepare("INSERT INTO bank_accounts (id, namespace, user_id, name, number, balance_cents, status, created_at) VALUES (?, ?, ?, 'Main savings', ?, 0, 'active', ?)").bind(accountId, namespace, id, number, now),
          ]);
        } catch (error) { if (String(error).includes("UNIQUE")) fail(409, "An account with this email already exists. Please sign in."); throw error; }
        const issued = await issueSession(db, request, namespace, id, session);
        const account = await ownedAccount(db, accountId, id);
        return json({ ok: true, user: { id, name, email }, csrfToken: issued.session.csrfToken, account: publicAccount(account) }, 201, issued.cookie);
      }
      const attemptKey = await digest(`${namespace}:${email}`), now = Date.now();
      const attempts = await db.prepare("SELECT attempts, reset_at AS resetAt FROM bank_auth_attempts WHERE key = ?").bind(attemptKey).first<{ attempts: number; resetAt: number }>();
      if (attempts && attempts.resetAt > now && attempts.attempts >= 8) fail(429, "Too many sign-in attempts. Please try again in 15 minutes.");
      const user = await db.prepare("SELECT id, name, email, password_hash AS passwordHash FROM bank_users WHERE namespace = ? AND email = ?").bind(namespace, email).first<User>();
      // Hash a dummy password for absent users to avoid an email-enumeration timing shortcut.
      const valid = user ? await verifyPassword(password, user.passwordHash!) : (await passwordHash(password), false);
      if (!valid || !user) {
        await db.prepare("INSERT INTO bank_auth_attempts (key, attempts, reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN reset_at <= ? THEN 1 ELSE attempts + 1 END, reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END").bind(attemptKey, now + 900000, now, now).run();
        fail(401, "Email or password is incorrect.");
      }
      await db.prepare("DELETE FROM bank_auth_attempts WHERE key = ?").bind(attemptKey).run();
      const issued = await issueSession(db, request, namespace, user.id, session);
      return json({ ok: true, user: { id: user.id, name: user.name, email: user.email }, csrfToken: issued.session.csrfToken }, 200, issued.cookie);
    }
    if (method === "POST" && path === "/api/auth/logout") {
      const issued = await issueSession(db, request, namespace, null, session);
      return json({ ok: true, user: null, csrfToken: issued.session.csrfToken }, 200, issued.cookie);
    }
    const user = await currentUser(db, session);
    if (!user) fail(401, "Please sign in to continue.");
    if (method === "GET" && path === "/api/dashboard") {
      const accountRows = await db.prepare(`${accountSelect} WHERE user_id = ? AND status = 'active' ORDER BY created_at, number`).bind(user.id).all<Account>();
      const transactions = await db.prepare(`${transactionSelect} WHERE account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?) ORDER BY created_at DESC, id DESC LIMIT 100`).bind(user.id).all();
      const summary = await db.prepare("SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS incomeCents, COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS outgoingCents FROM bank_transactions WHERE is_internal = 0 AND account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?) AND created_at >= ?").bind(user.id, new Date(Date.now() - 30 * 86400000).toISOString()).first();
      return json({ ok: true, user, accounts: accountRows.results.map(publicAccount), transactions: transactions.results, billers, summary });
    }
    if (method === "POST" && path === "/api/accounts") {
      const payload = await body(request), name = textValue(payload.name, "Account name", 2, 40);
      const id = crypto.randomUUID(), now = new Date().toISOString();
      const number = String(2000000000 + crypto.getRandomValues(new Uint32Array(1))[0] % 7000000000);
      const result = await db.prepare("INSERT INTO bank_accounts (id, namespace, user_id, name, number, balance_cents, status, created_at) SELECT ?, ?, ?, ?, ?, 0, 'active', ? WHERE (SELECT COUNT(*) FROM bank_accounts WHERE user_id = ? AND status = 'active') < 5")
        .bind(id, namespace, user.id, name, number, now, user.id).run();
      if (!result.meta.changes) fail(400, "You can have up to five active savings accounts.");
      return json({ ok: true, account: publicAccount(await ownedAccount(db, id, user.id)) }, 201);
    }
    const accountMatch = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (accountMatch && (method === "PATCH" || method === "DELETE")) {
      const account = await ownedAccount(db, decodeURIComponent(accountMatch[1]), user.id);
      if (method === "PATCH") {
        const payload = await body(request), name = textValue(payload.name, "Account name", 2, 40);
        const result = await db.prepare("UPDATE bank_accounts SET name = ? WHERE id = ? AND user_id = ? AND status = 'active'").bind(name, account.id, user.id).run();
        if (!result.meta.changes) fail(409, "This savings account is no longer active.");
        return json({ ok: true, account: publicAccount({ ...account, name }) });
      }
      const result = await db.prepare("UPDATE bank_accounts SET status = 'closed' WHERE id = ? AND user_id = ? AND status = 'active' AND balance_cents = 0").bind(account.id, user.id).run();
      if (!result.meta.changes) fail(400, "Transfer the remaining balance before closing this account.");
      return json({ ok: true, account: publicAccount({ ...account, status: "closed" }) });
    }
    if (method === "POST" && path === "/api/transfers") return await executeMoney(db, user, namespace, await body(request), "transfer");
    if (method === "POST" && path === "/api/payments") return await executeMoney(db, user, namespace, await body(request), "bill");
    return json({ error: "This endpoint was not found." }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Bank API error", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "We could not complete the request. Please try again." }, 500);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
