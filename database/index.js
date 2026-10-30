'use strict';

const { Pool } = require('pg');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function createDatabase({ connectionString = process.env.DATABASE_URL, poolOptions = {} } = {}) {
  if (!connectionString && !poolOptions.host) throw new Error('DATABASE_URL is required. PostgreSQL is the active banking database.');
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, ...poolOptions });
  const connectionErrors = new WeakMap();
  const reportConnectionError = error => {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,30}$/.test(error.code) ? ' [' + error.code + ']' : '';
    console.error('PostgreSQL connection interrupted' + code + '; affected work fails and the pool can reconnect.');
  };
  pool.on('error', reportConnectionError);
  // Checked-out clients can disconnect between queries, when no query promise
  // owns the error. Handle the event and refuse to commit interrupted work.
  pool.on('connect', client => client.on('error', error => { connectionErrors.set(client, error); reportConnectionError(error); }));
  const query = (text, values) => pool.query(text, values);
  async function transaction(work, { isolation = 'READ COMMITTED', readOnly = false } = {}) {
    if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolation)) throw new Error('Unsupported transaction isolation.');
    const client = await pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}${readOnly ? ' READ ONLY' : ''}`);
      await client.query("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '10s'");
      const result = await work(client);
      if (connectionErrors.has(client)) throw new Error('PostgreSQL connection interrupted before commit.');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally { client.release(connectionErrors.has(client)); }
  }
  async function migrate() {
    return transaction(async client => {
      // Serialize one schema's migrations without blocking independent schemas
      // in the same development/test database.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('greenlink:migrations:'||current_schema(),0))");
      // A restricted application login can verify an installed schema without DDL.
      if (!(await client.query("SELECT to_regclass('schema_migrations') AS relation")).rows[0].relation) {
        await client.query('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      }
      const directory = path.join(__dirname, 'migrations');
      for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
        const sql = (await readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = (await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name])).rows[0];
        if (previous) { if (previous.checksum !== checksum) throw Object.assign(new Error(`Applied migration changed: ${name}`), { code: 'MIGRATION_CHANGED' }); continue; }
        if (!(await client.query("SELECT has_schema_privilege(current_user,current_schema(),'CREATE') AS allowed")).rows[0].allowed) {
          throw Object.assign(new Error(`Database migration required: ${name}. Run npm run db:migrate with the migration credentials first.`), { code: 'MIGRATION_REQUIRED' });
        }
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      }
    });
  }
  return { pool, query, transaction, migrate, close: () => pool.end() };
}

function createOperatorDatabase(options = {}) {
  return createDatabase({ ...options, connectionString: options.connectionString || process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
}
module.exports = { createDatabase, createOperatorDatabase };
