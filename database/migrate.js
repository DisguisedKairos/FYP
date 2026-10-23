'use strict';
const { createOperatorDatabase } = require('./index');
const { grantRuntime } = require('./permissions');
async function main() {
  const database = createOperatorDatabase();
  try {
    await database.migrate();
    if (process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL) {
      const ownerRole = decodeURIComponent(new URL(process.env.MIGRATION_DATABASE_URL).username);
      const appRole = decodeURIComponent(new URL(process.env.DATABASE_URL).username);
      if (ownerRole !== appRole) await database.transaction(client => grantRuntime(client, { ownerRole, appRole }));
    }
    console.log('PostgreSQL schema and application permissions are up to date.');
  }
  finally { await database.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
