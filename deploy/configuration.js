'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const NAMES = ['postgres_password', 'owner_password', 'app_password', 'service_token', 'auth_encryption_key'];

function readSecret(name, directory = '/run/secrets') {
  if (!NAMES.includes(name)) throw new Error('Unknown delivery secret name.');
  const filename = path.join(directory, name);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128) throw new Error(`Invalid delivery secret file: ${name}`);
  const value = fs.readFileSync(filename, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`Delivery secret must be 32-byte lowercase hex: ${name}`);
  return value;
}

function setupSecrets(directory = path.resolve(__dirname, '..', 'data', 'devops', 'secrets')) {
  // Inspect each existing ancestor before writing, including junctions on Windows.
  let ancestor = directory;
  while (true) {
    if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Delivery secret directory must not contain links.');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Validate all existing values before creating anything; never rotate on rerun.
  for (const name of NAMES) if (fs.existsSync(path.join(directory, name))) readSecret(name, directory);
  const created = [];
  for (const name of NAMES) {
    const filename = path.join(directory, name);
    if (!fs.existsSync(filename)) {
      // File secrets are bind-mounted by Compose. Non-root service users need
      // read permission; the host directory itself is private (0700).
      fs.writeFileSync(filename, randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o444 });
      created.push(name);
    }
  }
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  return { created: created.length, retained: NAMES.length - created.length };
}

function databaseUrl(env, role, password, database = env.DB_NAME || 'greenlink_dft') {
  const host = env.DB_HOST || 'postgres', port = Number(env.DB_PORT || 5432);
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid delivery database address.');
  if (![role, database].every(value => /^[a-z][a-z0-9_]{0,62}$/.test(value))) throw new Error('Invalid delivery database identifier.');
  const url = new URL(`postgresql://${host}:${port}/${database}`);
  url.username = role; url.password = password;
  return url.href;
}
module.exports = { readSecret, setupSecrets, databaseUrl, NAMES };
if (require.main === module) {
  try { console.log('Compose secrets ready:', setupSecrets(), '(values kept private)'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
