'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pythonExecutable } = require('./start-platform');
const result = spawnSync(pythonExecutable(), ['-B', '-m', 'unittest', 'discover', '-s', 'tests_python', '-v'], {
  cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'inherit', shell: false,
});
if (result.error) console.error('Python tests could not start: ' + result.error.message);
process.exitCode = result.status ?? 1;
