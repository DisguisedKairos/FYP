'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { Client } = require('pg');
const { createDatabase } = require('./index');
const { identifier, grantRuntime, TABLES } = require('./permissions');

function readEnvironment(filename) {
  if (!fs.existsSync(filename)) return {};
  if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing a linked environment file.');
  return parseEnv(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}
function writeEnvironment(filename, values, remove = []) {
  readEnvironment(filename); // Also checks an existing file before replacing it.
  let text = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '') : '';
  for (const key of [...Object.keys(values), ...remove]) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key.');
    text = text.replace(new RegExp(`^(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, 'gm'), '');
  }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n\x00]/.test(value)) throw new Error('Invalid multiline environment value.');
    text = text.trimEnd() + `\n${key}=${JSON.stringify(String(value))}\n`;
  }
  fs.writeFileSync(filename, text, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(filename, 0o600);
}
function connection(adminUrl, database, role, password) {
  const url = new URL(adminUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL connection URL.');
  url.pathname = '/' + database;
  if (role !== undefined) url.username = role;
  if (password !== undefined) url.password = password;
  // A setup URL always addresses the public schema of the named database.
  url.searchParams.delete('options');
  return url.href;
}
function rolePassword() { return randomBytes(32).toString('hex'); }
async function provision({ adminUrl, databaseName = 'greenlink_dft', ownerRole = 'greenlink_owner', appRole = 'greenlink_app', ownerPassword = rolePassword(), appPassword = rolePassword(), ownerKnown = false, appKnown = false, managedNeon = false }) {
  for (const name of [databaseName, ownerRole, appRole]) identifier(name);
  if (managedNeon && !new URL(adminUrl).hostname.endsWith('.neon.tech')) throw new Error('Managed Neon setup requires a Neon database endpoint.');
  if (ownerRole === appRole) throw new Error('Application and migration logins must be different.');
  // PostgreSQL role passwords cannot be query parameters. Only generated hex
  // passwords are accepted here, never arbitrary SQL fragments or logging.
  if (![ownerPassword, appPassword].every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error('Setup role credentials must be 32-byte hex secrets.');
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  let database;
  try {
    await admin.connect();
    const administrator = (await admin.query('SELECT current_user AS name')).rows[0].name;
    if ([ownerRole, appRole].includes(administrator)) throw new Error('Use a separate local PostgreSQL administrator for db:setup.');
    // Validate the entire plan before adopting roles or tables. Never take over
    // a pre-existing unrelated role merely because its name matches a default.
    const exists = (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName])).rowCount;
    if (managedNeon && !exists) throw new Error('The linked Neon database must already exist; setup does not create another cloud database.');
    for (const [name, known, secret] of [[ownerRole, ownerKnown, ownerPassword], [appRole, appKnown, appPassword]]) {
      const existing = (await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [name])).rows[0];
      if (existing && (!known || Object.values(existing).some(Boolean))) throw new Error(`Existing role ${name} was not provisioned with these saved credentials, or has elevated privileges.`);
      const memberships = await admin.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1', [name]);
      if (memberships.rowCount) throw new Error(`Existing role ${name} has unexpected role memberships.`);
      if (existing) {
        const verify = new Client({ connectionString: connection(adminUrl, exists ? databaseName : new URL(adminUrl).pathname.slice(1), name, secret), connectionTimeoutMillis: 5000 });
        try { await verify.connect(); await verify.query('SELECT 1'); } finally { await verify.end(); }
      }
    }
    if (exists) {
      const inspect = createDatabase({ connectionString: connection(adminUrl, databaseName) });
      try {
        const tables = (await inspect.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
        const known = new Set(TABLES);
        if (tables.some(row => !known.has(row.tablename))) throw new Error('Target contains unrelated tables. Choose an empty database or the existing Greenlink database.');
        // An existing matching schema must have authentic migration provenance.
        if (tables.length && !tables.some(row => row.tablename === 'schema_migrations')) throw new Error('Existing tables have no Greenlink migration record.');
      } finally { await inspect.close(); }
    }
    for (const [name, secret] of [[ownerRole, ownerPassword], [appRole, appPassword]]) {
      const present = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount;
      if (!present) await admin.query(`CREATE ROLE ${identifier(name)} LOGIN PASSWORD '${secret}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    if (!exists) await admin.query(`CREATE DATABASE ${identifier(databaseName)} OWNER ${identifier(ownerRole)} TEMPLATE template0 ENCODING 'UTF8'`);
    if (managedNeon) {
      // SQL-created roles receive no neon_superuser membership. The bootstrap
      // owner needs SET ROLE permission to assign schema objects to the migrator.
      await admin.query(`GRANT ${identifier(ownerRole)} TO ${identifier(administrator)}`);
      await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${identifier(databaseName)} TO ${identifier(ownerRole)}`);
      await admin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${identifier(ownerRole)}`);
    }
    database = createDatabase({ connectionString: connection(adminUrl, databaseName) });
    await database.migrate();
    await database.transaction(async client => {
      await grantRuntime(client, { ownerRole, appRole });
      if (!managedNeon) await client.query(`ALTER DATABASE ${identifier(databaseName)} OWNER TO ${identifier(ownerRole)}`);
      await client.query(`REVOKE ALL ON DATABASE ${identifier(databaseName)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(appRole)}`);
    });
    const ownerUrl = connection(adminUrl, databaseName, ownerRole, ownerPassword);
    const appUrl = connection(adminUrl, databaseName, appRole, appPassword);
    // Authenticate with both saved roles before declaring success.
    for (const connectionString of [ownerUrl, appUrl]) {
      const check = createDatabase({ connectionString });
      try { await check.migrate(); } finally { await check.close(); }
    }
    return { databaseName, ownerRole, appRole, ownerUrl, appUrl };
  } finally { if (database) await database.close(); await admin.end(); }
}
async function main() {
  const root = path.resolve(__dirname, '..'), appFile = path.join(root, '.env'), operatorFile = path.join(root, '.env.database-admin');
  const app = readEnvironment(appFile), operator = readEnvironment(operatorFile);
  const adminUrl = process.env.ADMIN_DATABASE_URL || operator.ADMIN_DATABASE_URL;
  if (!adminUrl) throw new Error('Set ADMIN_DATABASE_URL in ignored .env.database-admin to a local PostgreSQL administrator URL; see docs/database.md.');
  const oldOwner = operator.MIGRATION_DATABASE_URL && new URL(operator.MIGRATION_DATABASE_URL);
  const oldApp = operator.APPLICATION_DATABASE_URL && new URL(operator.APPLICATION_DATABASE_URL);
  const databaseName = process.env.DATABASE_NAME || (oldOwner ? oldOwner.pathname.slice(1) : app.DATABASE_URL ? new URL(app.DATABASE_URL).pathname.slice(1) : 'greenlink_dft');
  const ownerRole = oldOwner ? decodeURIComponent(oldOwner.username) : 'greenlink_owner';
  const appRole = oldOwner && oldApp ? decodeURIComponent(oldApp.username) : 'greenlink_app';
  const ownerPassword = oldOwner ? decodeURIComponent(oldOwner.password) : rolePassword();
  const appPassword = oldOwner && oldApp ? decodeURIComponent(oldApp.password) : rolePassword();
  // Persist new private credentials before provisioning so interruptions can be
  // retried without losing the generated role passwords.
  const ownerUrl = connection(adminUrl, databaseName, ownerRole, ownerPassword);
  const appUrl = connection(adminUrl, databaseName, appRole, appPassword);
  writeEnvironment(operatorFile, { ADMIN_DATABASE_URL: adminUrl, MIGRATION_DATABASE_URL: ownerUrl, APPLICATION_DATABASE_URL: appUrl });
  const result = await provision({ adminUrl, databaseName, ownerRole, appRole, ownerPassword, appPassword, ownerKnown: Boolean(oldOwner), appKnown: Boolean(oldOwner && oldApp) });
  // Test administrator credentials must not be inherited by the web process.
  if (app.TEST_DATABASE_URL) writeEnvironment(path.join(root, '.env.test'), { TEST_DATABASE_URL: app.TEST_DATABASE_URL });
  writeEnvironment(appFile, { DATABASE_URL: appUrl }, ['TEST_DATABASE_URL', 'ADMIN_DATABASE_URL', 'MIGRATION_DATABASE_URL']);
  console.log(`PostgreSQL ready: ${result.databaseName}; application role ${result.appRole}; migration role ${result.ownerRole}. Existing banking records were preserved.`);
  console.log('Credentials are saved privately in .env and .env.database-admin. Do not commit either file.');
}
module.exports = { provision, readEnvironment, writeEnvironment, connection };
if (require.main === module) main().catch(error => { console.error(`Database setup failed: ${error.message}`); process.exitCode = 1; });
