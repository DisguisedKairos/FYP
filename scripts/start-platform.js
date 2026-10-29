'use strict';

// Local DFT runtime: PostgreSQL is configured separately; only Python and Express are children.
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function port(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} must be an integer from 1 to 65535.`);
  return parsed;
}
function pythonExecutable(env = process.env, root = ROOT, platform = process.platform) {
  if (env.PYTHON) return env.PYTHON;
  const candidates = platform === 'win32' ? [path.join(root, '.venv', 'Scripts', 'python.exe')] : [path.join(root, '.venv', 'bin', 'python')];
  return candidates.find(filename => existsSync(filename)) || 'python';
}
function childEnvironment(env, service) {
  const result = { ...env };
  // Local operator/test credentials never belong in either service process.
  for (const key of Object.keys(result)) {
    if (/^(?:AGENT_[A-Z_]+|OLLAMA_[A-Z_]+|GREENLINK_OLLAMA_[A-Z_]+|GREENLINK_AI_PROVIDER|ADMIN_DATABASE_URL|MIGRATION_DATABASE_URL|APPLICATION_DATABASE_URL|DATABASE_URL_UNPOOLED|NEON_[A-Z_]+|TEST_DATABASE_URL|GREENLINK_STAFF_PASSWORD|PGPASSWORD|PGPASSFILE|PGSERVICE|PGSERVICEFILE)$/i.test(key)
      || (service === 'fraud' && /^(?:DATABASE_URL|AUTH_ENCRYPTION_KEY|PG[A-Z_]*)$/i.test(key))) delete result[key];
  }
  return result;
}
function configuration(env = process.env, root = ROOT) {
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { throw new Error('Set DATABASE_URL to your PostgreSQL connection before starting the application.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must point to PostgreSQL.');
  const token = env.SERVICE_TOKEN || randomBytes(32).toString('hex');
  if (!/^[A-Za-z0-9._~-]{24,512}$/.test(token)) throw new Error('SERVICE_TOKEN must contain 24-512 visible token characters.');
  if (!/^[a-fA-F0-9]{64}$/.test(env.AUTH_ENCRYPTION_KEY || '')) throw new Error('Run npm run setup or supply the persistent AUTH_ENCRYPTION_KEY before starting.');
  const publicPort = port(env.PORT || 3000, 'PORT');
  const fraudPort = port(env.FRAUD_PORT || 4011, 'FRAUD_PORT');
  if (fraudPort === publicPort) throw new Error('PORT and FRAUD_PORT must use different ports.');
  const fraudUrl = `http://127.0.0.1:${fraudPort}`;
  if (env.FRAUD_SERVICE_URL && new URL(env.FRAUD_SERVICE_URL).href !== fraudUrl + '/') throw new Error('The local launcher requires FRAUD_SERVICE_URL to match the loopback FRAUD_PORT.');
  let publicOrigin;
  try { publicOrigin = new URL(env.PUBLIC_ORIGIN); } catch { throw new Error('Set PUBLIC_ORIGIN to the exact browser origin, such as http://localhost:3000.'); }
  if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) throw new Error('PUBLIC_ORIGIN must be an exact HTTP(S) origin without a path or credentials.');
  return { python: pythonExecutable(env, root), publicPort, fraudPort, fraudUrl, publicOrigin: publicOrigin.origin,
    shared: { ...env, SERVICE_TOKEN: token, FRAUD_SERVICE_URL: fraudUrl, FRAUD_HOST: '127.0.0.1', FRAUD_PORT: String(fraudPort), PYTHONDONTWRITEBYTECODE: '1' } };
}

async function startPlatform({ env = process.env, root = ROOT } = {}) {
  const config = configuration(env, root), children = [];
  let stopping = false;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true; process.exitCode = code;
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const force = setTimeout(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5000);
    force.unref();
  }
  function start(label, executable, args, additions = {}, service = 'banking') {
    const child = spawn(executable, args, { cwd: root, env: childEnvironment({ ...config.shared, ...additions }, service), windowsHide: true, shell: false, stdio: ['ignore', 'inherit', 'inherit'] });
    children.push(child);
    child.once('error', error => { console.error(`${label} could not start: ${error.message}`); stop(1); });
    child.once('exit', (code, signal) => { if (!stopping) { console.error(`${label} stopped unexpectedly (${signal || code}).`); stop(code || 1); } });
  }
  async function ready(base, pathname, service, authenticated) {
    const deadline = Date.now() + 30000;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(new URL(pathname, base), { headers: authenticated ? { Authorization: `Bearer ${config.shared.SERVICE_TOKEN}` } : {}, redirect: 'error', signal: AbortSignal.timeout(1500) });
        const result = await response.json();
        if (response.ok && result.ok === true && result.service === service) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`${service} did not become ready. Check its startup error above.`);
  }
  process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
  try {
    start('Python fraud service', config.python, ['-B', 'main.py'], {}, 'fraud');
    await ready(config.fraudUrl, '/internal/health', 'fraud', true);
    start('Express banking', process.execPath, ['app.js'], { HOST: env.HOST || '127.0.0.1', PORT: String(config.publicPort) });
    await ready(`http://127.0.0.1:${config.publicPort}`, '/health', 'banking', false);
    console.log(`\nGreen Link Digital Bank ready: ${config.publicOrigin}\nExpress + PostgreSQL banking and private Python FastAPI scoring.\n`);
    if (env.SEED_DEMO === 'true') console.log('Demo: alex@greenlink.demo / Greenlink123!; independent reviewer: reviewer@greenlink.demo.');
    return { stop, children };
  } catch (error) { stop(1); throw error; }
}

module.exports = { configuration, pythonExecutable, childEnvironment, startPlatform };
if (require.main === module) startPlatform().catch(error => { console.error(error.message); process.exitCode = 1; });
