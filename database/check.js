'use strict';

const { createDatabase } = require('./index');
const { TABLES } = require('./permissions');

async function inspectDatabase(db) {
  return db.transaction(async client => {
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role,
      current_setting('server_version') AS version, inet_server_addr()::text AS host, inet_server_port() AS port,
      r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows.map(row => row.tablename);
    const missingTables = TABLES.filter(table => !tables.includes(table));
    if (missingTables.length) return { ready: false, identity, missingTables };
    const migrations = (await client.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name);
    const counts = (await client.query(`SELECT (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM businesses)::int AS businesses,(SELECT count(*) FROM accounts)::int AS accounts,
      (SELECT count(*) FROM transactions)::int AS transactions`)).rows[0];
    // Pending/rejected requests never alter the stored balance. Every completed
    // debit/credit must reconcile with its immutable opening balance provenance.
    const discrepancies = (await client.query(`SELECT a.id::text AS account_id,
      a.balance_cents::text AS stored_cents,
      (a.opening_balance_cents+COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='completed'),0))::text AS ledger_cents
      FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id
      GROUP BY a.id HAVING a.balance_cents<>a.opening_balance_cents+COALESCE(sum(t.amount_cents) FILTER (WHERE t.status='completed'),0)
      ORDER BY a.id`)).rows;
    const controls = (await client.query(`SELECT
      has_schema_privilege(current_user,current_schema(),'CREATE') AS can_create_tables,
      has_column_privilege(current_user,'users','role','UPDATE') AS can_change_user_roles,
      has_column_privilege(current_user,'users','role','INSERT') AS can_insert_staff_roles,
      has_any_column_privilege(current_user,'audit_log','UPDATE') AS can_rewrite_audit,
      has_table_privilege(current_user,'audit_log','DELETE') AS can_delete_audit,
      has_table_privilege(current_user,'transactions','DELETE') AS can_delete_transactions,
      has_column_privilege(current_user,'transactions','amount_cents','UPDATE') AS can_rewrite_amounts,
      has_column_privilege(current_user,'accounts','opening_balance_cents','UPDATE') AS can_rewrite_opening_balances`)).rows[0];
    const elevated = ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(key => identity[key]);
    return { ready: !missingTables.length && !discrepancies.length && !elevated && !Object.values(controls).some(Boolean), identity, tables: tables.length, migrations, counts, controls, discrepancies };
  }, { isolation: 'REPEATABLE READ', readOnly: true });
}
async function main() {
  const db = createDatabase();
  try {
    await db.migrate();
    const report = await inspectDatabase(db);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  } finally { await db.close(); }
}
module.exports = { inspectDatabase };
if (require.main === module) main().catch(error => { console.error(`Database check failed: ${error.message}`); process.exitCode = 1; });
