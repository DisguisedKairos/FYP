'use strict';
const path = require('node:path');
const { readEnvironment } = require('../database/setup');
const { sameTarget, secureNeonUrl } = require('../database/neon');
async function main() {
  const operator = readEnvironment(path.resolve(__dirname, '..', '.env.database-admin'));
  const direct = operator.MIGRATION_DATABASE_URL;
  secureNeonUrl(direct);
  if (!sameTarget(direct, process.env.DATABASE_URL)) throw new Error('Neon verification requires matching migration and runtime database targets.');
  process.env.TEST_DATABASE_URL = direct;
  console.log('Neon integration: using a disposable schema; production banking records are excluded.');
  await require('./platform-smoke').runIsolated();
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error('Neon integration failed: ' + error.message); process.exitCode = 1; });
