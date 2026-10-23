'use strict';

const { spawnSync } = require('node:child_process');
const { collectSource } = require('./package');
let checked = 0;
for (const file of collectSource(require('node:path').resolve(__dirname, '..'))) {
  if (!file.path.endsWith('.js')) continue;
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + (file.path.startsWith('public/') ? 'module' : 'commonjs')],
    { input: file.content, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) { console.error(file.path, result.stderr || result.error?.message); process.exit(1); }
  checked++;
}
console.log(`Syntax checked ${checked} JavaScript source files.`);
