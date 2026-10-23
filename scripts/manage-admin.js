'use strict';

// Operator-only bootstrap: run on the ledger host, never through a public API.
const { DatabaseSync } = require('node:sqlite');
const { existsSync } = require('node:fs');
const path = require('node:path');

function grant({ dbPath, email }) {
  if (!existsSync(dbPath)) throw new Error('Banking database does not exist. Start the app and register the intended administrator first.');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide the email of an existing registered user.');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!user) throw new Error('Registered user not found. No account or password was created.');
    db.exec(`CREATE TABLE IF NOT EXISTS operator_role_audit (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), email TEXT NOT NULL,
      previous_role TEXT NOT NULL, new_role TEXT NOT NULL, changed_at TEXT NOT NULL, method TEXT NOT NULL
    );`);
    if (user.role !== 'admin') {
      db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
      db.prepare("INSERT INTO operator_role_audit(user_id,email,previous_role,new_role,changed_at,method) VALUES(?,?,?,'admin',?,'local-operator')")
        .run(user.id, user.email, user.role, new Date().toISOString());
    }
    db.exec('COMMIT');
    return { email: user.email, role: 'admin', changed: user.role !== 'admin' };
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email') { console.error('Usage: npm run admin:grant -- --email registered@example.com'); process.exitCode = 1; }
  else {
    try {
      const dbPath = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'banking.sqlite');
      const result = grant({ dbPath, email: args[1] });
      console.log(`${result.email} ${result.changed ? 'granted' : 'already has'} the administrator role. Sign out and sign in again.`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { grant };
