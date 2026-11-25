'use strict';

const { createOperatorDatabase } = require('../database');

// This marker is deliberately outside the password verifier's accepted hash
// format. Keep the original hash for an operator-controlled reversal; never
// return it, include it in an audit event, or reset retained credentials.
const RETIRED_PREFIX = '!retired!';
const isRetiredPassword = hash => typeof hash === 'string' && hash.startsWith(RETIRED_PREFIX);
function accountIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw new Error('Choose between one and fifty explicit account IDs.');
  if (ids.some(id => !['string','number','bigint'].includes(typeof id) || typeof id === 'number' && !Number.isSafeInteger(id))) throw new Error('Account IDs must be exact positive PostgreSQL integers.');
  const values = ids.map(id => String(id));
  if (values.some(id => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) || new Set(values).size !== values.length) throw new Error('Account IDs must be unique positive PostgreSQL integers.');
  return values;
}
async function retireAccounts(db, ids, { apply = false, reason = 'Unneeded project account', now = Date.now } = {}) {
  ids = accountIds(ids);
  if (typeof apply !== 'boolean' || typeof reason !== 'string' || !reason.trim() || reason.length > 250 || /[\x00-\x1f]/.test(reason)) throw new Error('Choose a valid retirement reason and apply setting.');
  return db.transaction(async client => {
    // Lock administrators in a stable order before locking the targets. A
    // concurrent operator cannot independently retire the remaining admin.
    const admins = (await client.query("SELECT id::text,password_hash FROM users WHERE role='admin' ORDER BY id" + (apply ? ' FOR UPDATE' : ''))).rows;
    const rows = (await client.query('SELECT id::text,email,role,password_hash,auth_version FROM users WHERE id=ANY($1::bigint[]) ORDER BY id' + (apply ? ' FOR UPDATE' : ''), [ids])).rows;
    if (rows.length !== ids.length) throw new Error('A requested account was not found. No accounts were retired.');
    if (!admins.some(admin => !isRetiredPassword(admin.password_hash) && !ids.includes(admin.id))) throw new Error('Keep an active administrator outside the retirement list. No accounts were retired.');
    const summaries = (await client.query(`SELECT u.id::text,
      (SELECT count(*)::int FROM accounts a WHERE a.user_id=u.id) AS deposit_accounts,
      (SELECT count(*)::int FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE a.user_id=u.id) AS transactions,
      (SELECT count(*)::int FROM audit_log l WHERE l.actor_id=u.id OR l.target_user_id=u.id) AS audit_records
      FROM users u WHERE u.id=ANY($1::bigint[]) ORDER BY u.id`, [ids])).rows;
    const date = new Date(now()).toISOString();
    let retiredCount = 0;
    for (const row of rows) {
      if (!apply || isRetiredPassword(row.password_hash)) continue;
      await client.query('UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1', [row.id, RETIRED_PREFIX + row.password_hash]);
      await client.query('UPDATE sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL', [row.id, date]);
      await client.query("INSERT INTO audit_log(target_user_id,event_type,metadata,created_at) VALUES($1,'operator.account_retired',$2,$3)", [row.id, { method: 'local-operator', reason: reason.trim(), previousRole: row.role, bankingHistoryPreserved: true }, date]);
      retiredCount++;
    }
    return { applied: apply, retiredCount, accounts: rows.map(row => ({
      id: row.id, identity: row.email.toLowerCase().endsWith('@greenlink.demo') ? row.email : 'User-created account #' + row.id,
      role: row.role, retired: apply || isRetiredPassword(row.password_hash), ...Object.fromEntries(Object.entries(summaries.find(s => s.id === row.id)).filter(([key]) => key !== 'id')),
    })) };
  }, { readOnly: !apply });
}
if (require.main === module) {
  const args = process.argv.slice(2), apply = args.includes('--apply');
  if (![2, 3].includes(args.length) || args[0] !== '--ids' || (args.length === 3 && args[2] !== '--apply')) {
    console.error('Usage: npm run accounts:retire -- --ids 1,2,3 [--apply]'); process.exitCode = 1;
  } else {
    const db = createOperatorDatabase();
    retireAccounts(db, args[1].split(','), { apply }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
      console.error(error.code ? 'Account retirement failed; private database details suppressed.' : error.message); process.exitCode = 1;
    }).finally(() => db.close());
  }
}
module.exports = { RETIRED_PREFIX, isRetiredPassword, retireAccounts };
