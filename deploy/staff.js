'use strict';

const { createStaff } = require('../scripts/create-staff');
const { readSecret, databaseUrl } = require('./configuration');
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--email' || args[2] !== '--name') throw new Error('Usage: staff-admin --email operator@example.com --name "Bank Operations"; provide GREENLINK_STAFF_PASSWORD privately.');
  const user = await createStaff({ email: args[1], name: args[3], password: process.env.GREENLINK_STAFF_PASSWORD,
    connectionString: databaseUrl(process.env, 'greenlink_owner', readSecret('owner_password')) });
  console.log(`Created bank operations user ${user.email}. No business or deposit account was created.`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
