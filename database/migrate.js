'use strict';
const { createDatabase } = require('./index');
async function main() {
  const database = createDatabase();
  try { await database.migrate(); console.log('PostgreSQL schema is up to date.'); }
  finally { await database.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
