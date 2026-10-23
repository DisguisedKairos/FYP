'use strict';

const { provision } = require('../database/setup');
const { createDatabase } = require('../database');
const { seedDemo } = require('../scripts/seed-demo');
const { readSecret, databaseUrl } = require('./configuration');

async function prepareDatabase(env = process.env, directory = '/run/secrets') {
  const result = await provision({
    adminUrl: databaseUrl(env, 'postgres', readSecret('postgres_password', directory), 'postgres'),
    databaseName: env.DB_NAME || 'greenlink_dft',
    ownerRole: 'greenlink_owner', appRole: 'greenlink_app',
    ownerPassword: readSecret('owner_password', directory), appPassword: readSecret('app_password', directory),
    ownerKnown: true, appKnown: true,
  });
  if (env.GREENLINK_SEED_DEMO === 'true') {
    const database = createDatabase({ connectionString: result.ownerUrl });
    try { await seedDemo(database); } finally { await database.close(); }
  }
  console.log('Container PostgreSQL schema and restricted runtime grants are ready.');
}
module.exports = { prepareDatabase };
if (require.main === module) prepareDatabase().catch(error => { console.error(error.message); process.exitCode = 1; });
