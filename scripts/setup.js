'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const file = path.resolve(__dirname, '..', '.env');
let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'PORT=3000\nHOST=127.0.0.1\nSEED_DEMO=true\n';
if (!/^SERVICE_TOKEN=.{24,}$/m.test(content)) {
  content = content.replace(/^SERVICE_TOKEN=.*\r?\n?/m, '');
  fs.writeFileSync(file, content.trimEnd() + '\nSERVICE_TOKEN=' + randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  console.log('Created local service authentication settings in the ignored .env file.');
} else console.log('Local service authentication is already configured.');
