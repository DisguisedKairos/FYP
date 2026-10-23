'use strict';

// Local development helper only; never controls an external/cloud database.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function main(action = process.argv[2]) {
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('Usage: node database/local.js start|stop|status');
  const data = path.join(root, 'data', 'postgresql');
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) throw new Error('No project-owned cluster at data/postgresql. See docs/database.md to initialize it, or start your existing PostgreSQL installation separately.');
  // Reject junctions/symlinks before controlling a cluster through its data path.
  if (path.relative(data, fs.realpathSync(data)) !== '' || fs.lstatSync(path.dirname(data)).isSymbolicLink()) throw new Error('Refusing a linked PostgreSQL data directory.');
  const binary = path.join(process.env.POSTGRES_BIN || path.join(root, '.local', 'postgresql', 'bin'), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  if (!fs.existsSync(binary)) throw new Error('Set POSTGRES_BIN to the directory containing pg_ctl (PostgreSQL 16+).');
  const port = process.env.LOCAL_DATABASE_PORT || '55432';
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('LOCAL_DATABASE_PORT must be between 1024 and 65535.');
  const run = (args, stdio = 'pipe') => spawnSync(binary, ['-D', data, ...args], { windowsHide: true, encoding: 'utf8', timeout: 45000, stdio });
  const status = run(['status']);
  if (status.error) throw status.error;
  if (action === 'start' && status.status === 0) { console.log('Project PostgreSQL is already running.'); return; }
  if (action === 'stop' && status.status === 3) { console.log('Project PostgreSQL is already stopped.'); return; }
  // On Windows the detached server can inherit pg_ctl's pipe handles. Using
  // null handles on start lets spawnSync return when pg_ctl finishes waiting.
  // PostgreSQL writes startup diagnostics to the explicit server log instead.
  const result = action === 'status' ? status : action === 'start'
    ? run(['-l', path.join(root, 'data', 'postgresql.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], 'ignore')
    : run(['-m', 'fast', '-w', 'stop']);
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (action === 'start') console.log(result.status === 0 ? `Project PostgreSQL started on 127.0.0.1:${port}.` : 'PostgreSQL start failed; inspect data/postgresql.log.');
  process.exitCode = result.status ?? 1;
}
module.exports = { main };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
