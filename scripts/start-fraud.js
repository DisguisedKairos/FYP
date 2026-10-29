'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { pythonExecutable, childEnvironment } = require('./start-platform');

const child = spawn(pythonExecutable(), ['-B', 'main.py'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...childEnvironment(process.env, 'fraud'), FRAUD_HOST: '127.0.0.1', PYTHONDONTWRITEBYTECODE: '1' },
  windowsHide: true, shell: false, stdio: 'inherit',
});
child.once('error', error => {
  console.error('Python fraud service could not start: ' + error.message);
  console.error('Create .venv and install requirements.txt using its Python interpreter.');
  process.exitCode = 1;
});
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill('SIGTERM'));
