'use strict';

const { spawn } = require('node:child_process');
const { readSecret, databaseUrl } = require('./configuration');

function runtimeEnvironment(env = process.env, directory = '/run/secrets') {
  const result = { ...env, DATABASE_URL: databaseUrl(env, 'greenlink_app', readSecret('app_password', directory)),
    SERVICE_TOKEN: readSecret('service_token', directory), AUTH_ENCRYPTION_KEY: readSecret('auth_encryption_key', directory), SEED_DEMO: 'false' };
  for (const key of Object.keys(result)) if (/^(?:ADMIN_DATABASE_URL|MIGRATION_DATABASE_URL|APPLICATION_DATABASE_URL|TEST_DATABASE_URL|PG[A-Z_]*|GREENLINK_STAFF_PASSWORD)$/i.test(key)) delete result[key];
  return result;
}
function run() {
  const command = process.argv[2] || 'app.js';
  if (!['app.js', 'database/check.js'].includes(command)) throw new Error('Unsupported banking container command.');
  const child = spawn(process.execPath, [command], { env: runtimeEnvironment(), stdio: 'inherit', shell: false });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
module.exports = { runtimeEnvironment };
if (require.main === module) { try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
