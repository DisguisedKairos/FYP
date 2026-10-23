'use strict';

// Generate local secrets once. Existing encryption keys must never be silently rotated.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');

function configureEnvironment({ filename = path.resolve(__dirname, '..', '.env'), templatePath = path.resolve(__dirname, '..', '.env.example') } = {}) {
  const existed = fs.existsSync(filename);
  if (existed && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing to replace a linked environment file.');
  let content = existed ? fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '') : fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '') : '# Green Link Digital Bank local configuration\n';
  const configured = parseEnv(content), added = [];
  function ensure(key, value, valid) {
    if (configured[key]) {
      if (valid && !valid(configured[key])) throw new Error(`Existing ${key} is invalid. Update it deliberately; setup will not rotate saved credentials.`);
      return;
    }
    content = content.replace(new RegExp(`^(?:export\\s+)?${key}\\s*=.*(?:\\r?\\n|$)`, 'gm'), '');
    content = content.trimEnd() + `\n${key}=${value}\n`;
    configured[key] = value; added.push(key);
  }
  ensure('PORT', '3000', value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);
  ensure('HOST', '127.0.0.1');
  ensure('PUBLIC_ORIGIN', `http://localhost:${configured.PORT}`, value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; } catch { return false; } });
  ensure('FRAUD_PORT', '4011', value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);
  ensure('SERVICE_TOKEN', randomBytes(32).toString('hex'), value => /^[A-Za-z0-9._~-]{24,512}$/.test(value));
  ensure('AUTH_ENCRYPTION_KEY', randomBytes(32).toString('hex'), value => /^[a-fA-F0-9]{64}$/.test(value));
  if (!existed || added.length) {
    fs.writeFileSync(filename, content, { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(filename, 0o600);
  }
  return { created: !existed, added, databaseConfigured: Boolean(configured.DATABASE_URL) };
}
module.exports = { configureEnvironment };
if (require.main === module) {
  try {
    const result = configureEnvironment();
    console.log(result.added.length ? 'Local .env configuration is ready; existing values were preserved.' : 'Local configuration is already complete.');
    if (!result.databaseConfigured) console.log('Set DATABASE_URL in .env to your PostgreSQL connection before npm start.');
    console.log('Install Node dependencies with npm ci and Python dependencies with python -m pip install -r requirements.txt.');
  } catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; }
}
