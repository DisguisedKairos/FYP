'use strict';
const { createDatabase } = require('../database');

// Local database operator only; creates no user, password, or HTTP endpoint.
async function grant({ db: suppliedDatabase, email, connectionString } = {}) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Provide the email of an existing registered user.');
  const db = suppliedDatabase || createDatabase({ connectionString });
  try {
    return await db.transaction(async client => {
      const user = (await client.query('SELECT id,email,role FROM users WHERE lower(email)=$1 FOR UPDATE', [email.trim().toLowerCase()])).rows[0];
      if (!user) throw new Error('Registered user not found. No account or password was created.');
      if (user.role === 'admin') return { email: user.email, role: 'admin', changed: false };
      await client.query("UPDATE users SET role='admin',auth_version=auth_version+1 WHERE id=$1", [user.id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
      await client.query("INSERT INTO audit_log(actor_id,target_user_id,event_type,metadata) VALUES(NULL,$1,'operator.role_granted',$2)", [user.id, { email: user.email, previousRole: user.role, role: 'admin', method: 'local-operator' }]);
      return { email: user.email, role: 'admin', changed: true };
    });
  } finally { if (!suppliedDatabase) await db.close(); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email') { console.error('Usage: npm run admin:grant -- --email registered@example.com'); process.exitCode = 1; }
  else grant({ email: args[1] }).then(result => console.log(`${result.email} ${result.changed ? 'granted' : 'already has'} the administrator role. Sign in again.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { grant };
