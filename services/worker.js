'use strict';

const { createServiceServer, listen } = require('./common');
const { HttpError } = require('../models/errors');

function createWorker({ base = process.env.BANKING_SERVICE_URL || 'http://127.0.0.1:4010', token = process.env.SERVICE_TOKEN, intervalMs = Number(process.env.JOB_INTERVAL_MS || 2000) } = {}) {
  let active = false, lastSuccess = 0, timer, stopped = false;
  async function tick() {
    if (active || stopped) return;
    active = true;
    try {
      const response = await fetch(new URL('/internal/jobs/tick', base), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Banking jobs returned ${response.status}.`);
      await response.json();
      lastSuccess = Date.now();
    } catch (error) { if (!stopped) console.error(`[worker] ${error.message}; retrying automatically.`); }
    finally { active = false; }
  }
  const server = createServiceServer({ name: 'worker', token, handler: async (method, url) => {
    if (method === 'GET' && url.pathname === '/internal/status') {
      if (!lastSuccess || Date.now() - lastSuccess > 60000) throw new HttpError(503, 'Scheduled jobs have not completed recently.');
      return { lastSuccess: new Date(lastSuccess).toISOString() };
    }
    throw new HttpError(404, 'Service endpoint not found.');
  }, close: () => { stopped = true; clearInterval(timer); } });
  server.once('listening', () => { tick(); timer = setInterval(tick, Math.max(250, intervalMs)); timer.unref(); });
  return server;
}
if (require.main === module) listen(createWorker(), 'Schedule and event worker', 4013);
module.exports = { createWorker };
