'use strict';

const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const token = process.env.SERVICE_TOKEN || randomBytes(32).toString('hex');
if (token.length < 24) throw new Error('SERVICE_TOKEN must contain at least 24 characters.');
const basePort = Number(process.env.INTERNAL_BASE_PORT || 4010);
const publicPort = Number(process.env.PORT || 3000);
if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65532) throw new Error('INTERNAL_BASE_PORT must be an integer from 1 to 65532.');
if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535 || (publicPort >= basePort && publicPort <= basePort + 3)) throw new Error('PORT must be a valid port outside the four internal service ports.');
const urls = {
  banking: `http://127.0.0.1:${basePort}`,
  fraud: `http://127.0.0.1:${basePort + 1}`,
  notifications: `http://127.0.0.1:${basePort + 2}`,
};
const shared = { ...process.env, HOST: '127.0.0.1', SERVICE_TOKEN: token, BANKING_SERVICE_URL: urls.banking, FRAUD_SERVICE_URL: urls.fraud, NOTIFICATION_SERVICE_URL: urls.notifications, DATA_DIR: process.env.DATA_DIR || path.join(root, 'data') };
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  process.exitCode = code;
}
function start(file, port, additions = {}) {
  const child = spawn(process.execPath, [file], { cwd: root, env: { ...shared, PORT: String(port), ...additions }, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`${file} stopped unexpectedly (${code}).`); stop(code || 1); } });
  return child;
}
async function waitFor(base, internal = true) {
  const deadline = Date.now() + 25000;
  while (!stopping && Date.now() < deadline) {
    try {
      const r = await fetch(new URL(internal ? '/internal/health' : '/health', base), { headers: internal ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(1500) });
      await r.arrayBuffer();
      if (r.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Service readiness timed out: ${base}`);
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
(async () => {
  try {
    start('services/fraud/server.js', basePort + 1);
    start('services/notifications/server.js', basePort + 2);
    await Promise.all([waitFor(urls.fraud), waitFor(urls.notifications)]);
    start('app.js', basePort);
    await waitFor(urls.banking, false);
    start('services/worker.js', basePort + 3);
    const port = publicPort;
    start('services/gateway.js', port, { HOST: process.env.HOST || '127.0.0.1' });
    await waitFor(`http://127.0.0.1:${port}`, false);
    console.log(`\nEvergreen platform ready: http://localhost:${port}\nDemo customer/admin: alex@evergreen.demo / Evergreen123!\nIndependent reviewer: reviewer@evergreen.demo / Evergreen123!\n`);
  } catch (error) { console.error(error.message); stop(1); }
})();
