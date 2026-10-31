'use strict';

// Only the banking application's known tables may be adopted by db:setup.
const TABLES = Object.freeze([
  'accounts', 'agent_runs', 'agent_tool_calls', 'audit_log', 'auth_attempts', 'billers', 'businesses',
  'fraud_assessments', 'fraud_cases', 'fraud_monitor_state', 'fraud_screenings', 'fraud_rule_audit', 'fraud_rules', 'fraud_settings',
  'legacy_imports', 'legacy_service_records', 'mfa_recovery_codes',
  'notification_outbox', 'notifications', 'payment_bindings', 'requests',
  'scheduled_payment_runs', 'scheduled_payments', 'saved_dashboard_views', 'schema_migrations',
  'sessions', 'transactions', 'user_mfa', 'users',
]);
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Use a lowercase SQL identifier containing only letters, digits and underscores.');
  return `"${value}"`;
}
async function grantRuntime(client, { ownerRole, appRole }) {
  const owner = identifier(ownerRole), app = identifier(appRole);
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(row => row.tablename);
  const known = new Set(TABLES);
  if (tables.some(table => !known.has(table))) throw new Error('Refusing to change permissions: public contains tables outside the Greenlink schema.');
  for (const table of tables) {
    await client.query(`ALTER TABLE public.${identifier(table)} OWNER TO ${owner}`);
    // Table-level REVOKE does not remove older column-level grants.
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map(row => identifier(row.column_name)).join(',');
    await client.query(`REVOKE SELECT(${columns}), INSERT(${columns}), UPDATE(${columns}), REFERENCES(${columns}) ON public.${identifier(table)} FROM ${app}, PUBLIC`);
  }
  const sequences = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public'")).rows;
  for (const { sequencename } of sequences) await client.query(`ALTER SEQUENCE public.${identifier(sequencename)} OWNER TO ${owner}`);
  await client.query(`ALTER FUNCTION public.enforce_business_account_owner() OWNER TO ${owner}`);
  await client.query(`ALTER SCHEMA public OWNER TO ${owner}`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${app}, PUBLIC`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${app}, PUBLIC`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${app}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);
  await client.query(`GRANT INSERT(name,email,password_hash,created_at), UPDATE(password_hash,auth_version) ON users TO ${app}`);
  await client.query(`GRANT INSERT(user_id,name,number,created_at), UPDATE(name,status,balance_cents,business_id) ON accounts TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE(status,created_at,completed_at,settlement_seq,review_json) ON transactions TO ${app}`);
  await client.query(`GRANT INSERT ON audit_log, payment_bindings, fraud_rule_audit TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE(status,engine,report_json,context_json,error_code,completed_at) ON agent_runs TO ${app}`);
  await client.query(`GRANT INSERT ON agent_tool_calls TO ${app}`);
  await client.query(`GRANT INSERT, DELETE ON saved_dashboard_views TO ${app}`);
  await client.query(`GRANT INSERT ON fraud_screenings TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE(screening_id,status,score,assigned_to,outcome,review_reason,version,updated_at,resolved_at) ON fraud_cases TO ${app}`);
  await client.query(`GRANT UPDATE(lease_owner,lease_until,next_run_at,last_started_at,last_completed_at,last_error,last_summary) ON fraud_monitor_state TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE(result_json) ON fraud_assessments TO ${app}`);
  await client.query(`GRANT UPDATE(enabled,threshold,action) ON fraud_rules TO ${app}`);
  await client.query(`GRANT UPDATE(version) ON fraud_settings TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE ON businesses, sessions, requests, notification_outbox, notifications, scheduled_payments, scheduled_payment_runs TO ${app}`);
  await client.query(`GRANT INSERT, UPDATE, DELETE ON auth_attempts, user_mfa, mfa_recovery_codes TO ${app}`);
}
module.exports = { TABLES, identifier, grantRuntime };
