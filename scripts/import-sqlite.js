'use strict';

// Explicit operator import; normal requests never read the legacy database.
const { DatabaseSync } = require('node:sqlite');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createOperatorDatabase: createDatabase } = require('../database');
const { canonicalHash, transactionView } = require('../banking/ledger');
const iso = value => value === null || value === undefined ? null : new Date(value).toISOString();
const parse = value => value === null || value === undefined ? null : typeof value === 'string' ? JSON.parse(value) : value;
const money = value => { const result = Number(value); if (!Number.isSafeInteger(result)) throw new Error('Legacy money exceeds the supported integer range.'); return result; };

function readSource(filename, tableNames) {
  if (!existsSync(filename)) throw new Error(`Legacy source does not exist: ${path.basename(filename)}`);
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec('BEGIN');
    const tables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const data = {};
    for (const name of tableNames) data[name] = tables.has(name) ? source.prepare(`SELECT rowid AS _legacy_rowid,* FROM ${name} ORDER BY rowid`).all() : [];
    source.exec('COMMIT');
    return data;
  } catch (error) { try { source.exec('ROLLBACK'); } catch {} throw error; }
  finally { source.close(); }
}

function validateSnapshot(snapshot) {
  const users = new Set(snapshot.users.map(row => String(row.id)));
  const accounts = new Map(snapshot.accounts.map(row => [String(row.id), row]));
  const balances = new Map();
  for (const account of snapshot.accounts) {
    if (!users.has(String(account.user_id))) throw new Error('Legacy account owner is missing.');
    const entries = snapshot.transactions.filter(row => String(row.account_id) === String(account.id) && row.status === 'completed')
      .sort((a, b) => Date.parse(a.completed_at || a.created_at) - Date.parse(b.completed_at || b.created_at) || a._legacy_rowid - b._legacy_rowid);
    const net = entries.reduce((sum, row) => sum + money(row.amount_cents), 0), opening = money(account.balance_cents) - net;
    if (!Number.isSafeInteger(opening) || opening < 0 || opening > 9000000000000) throw new Error('Legacy account has a negative or unsupported opening gap. Import refused.');
    let running = opening;
    for (const entry of entries) {
      if (Date.parse(entry.completed_at || entry.created_at) < Date.parse(account.created_at)) throw new Error('Legacy completed transaction predates its account. Import refused.');
      running += money(entry.amount_cents);
      if (!Number.isSafeInteger(running) || running < 0 || running > 9000000000000) throw new Error('Legacy chronology produces an invalid balance. Import refused.');
    }
    if (running !== money(account.balance_cents)) throw new Error('Legacy account cannot be reconciled.');
    balances.set(String(account.id), opening);
  }
  for (const entry of snapshot.transactions) if (!accounts.has(String(entry.account_id))) throw new Error('Legacy transaction account is missing.');
  return balances;
}

async function importSqlite({ sourcePath, db: suppliedDatabase, connectionString, withAdjacentStores = false, confirmEmptyTarget = false } = {}) {
  if (!confirmEmptyTarget) throw new Error('Explicit --confirm-empty-target is required.');
  if (typeof sourcePath !== 'string' || !sourcePath) throw new Error('Provide the legacy banking.sqlite path.');
  const filename = path.resolve(sourcePath);
  const snapshot = readSource(filename, ['users', 'accounts', 'transactions', 'billers', 'requests', 'scheduled_payments', 'scheduled_payment_runs', 'notification_outbox', 'operator_role_audit']);
  const openings = validateSnapshot(snapshot), adjacent = {};
  if (withAdjacentStores) {
    for (const [name, tables] of Object.entries({ fraud: ['fraud_rules', 'fraud_settings', 'fraud_rule_audit', 'fraud_assessments'], notifications: ['notifications'] })) {
      const adjacentPath = path.join(path.dirname(filename), `${name}.sqlite`);
      if (existsSync(adjacentPath)) adjacent[name] = readSource(adjacentPath, tables);
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ snapshot, adjacent })).digest('hex');
  const counts = Object.fromEntries(Object.entries(snapshot).map(([name, rows]) => [name, rows.length]));
  const db = suppliedDatabase || createDatabase({ connectionString });
  try {
    await db.migrate();
    return await db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(783456121)');
      await client.query('LOCK TABLE users,accounts,transactions,requests,notifications,scheduled_payments,scheduled_payment_runs,notification_outbox,audit_log,payment_bindings,fraud_assessments,legacy_imports IN ACCESS EXCLUSIVE MODE');
      const previous = (await client.query('SELECT counts FROM legacy_imports WHERE fingerprint=$1', [fingerprint])).rows[0];
      if (previous) return { duplicate: true, fingerprint, counts: previous.counts };
      const occupied = (await client.query(`SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM accounts)+(SELECT count(*) FROM transactions)+(SELECT count(*) FROM requests)+(SELECT count(*) FROM notifications)+(SELECT count(*) FROM scheduled_payments)+(SELECT count(*) FROM audit_log) AS count`)).rows[0];
      if (Number(occupied.count)) throw new Error('PostgreSQL target is not empty. No legacy rows were imported.');
      await client.query('INSERT INTO legacy_imports(fingerprint,source_name,counts) VALUES($1,$2,$3)', [fingerprint, path.basename(filename), counts]);
      for (const user of snapshot.users) await client.query('INSERT INTO users(id,name,email,password_hash,role,auth_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [user.id, user.name, user.email, user.password_hash, user.role || 'customer', user.auth_version || 1, iso(user.created_at)]);
      for (const account of snapshot.accounts) await client.query("INSERT INTO accounts(id,user_id,name,number,balance_cents,opening_balance_cents,opening_provenance,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'legacy_verified',$7,$8)", [account.id, account.user_id, account.name, account.number, account.balance_cents, openings.get(String(account.id)), account.status, iso(account.created_at)]);
      for (const biller of snapshot.billers) await client.query('INSERT INTO billers(id,name,category,initials,color) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,initials=EXCLUDED.initials,color=EXCLUDED.color', [biller.id, biller.name, biller.category, biller.initials, biller.color]);
      const completed = [...snapshot.transactions].filter(row => row.status === 'completed').sort((a, b) => Date.parse(a.completed_at || a.created_at) - Date.parse(b.completed_at || b.created_at) || a._legacy_rowid - b._legacy_rowid);
      const settlementOrder = new Map(completed.map((row, index) => [row.id, index + 1]));
      const transactionIds = new Set(snapshot.transactions.map(row => row.id));
      for (const row of snapshot.transactions) await client.query(`INSERT INTO transactions(id,insert_seq,settlement_seq,account_id,type,description,amount_cents,counterparty,status,reference,internal,created_at,requested_at,completed_at,risk_json,authorization_json,review_json,to_account_id,biller_id,payee)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [row.id, row._legacy_rowid, settlementOrder.get(row.id) || null, row.account_id, row.type, row.description, row.amount_cents, row.counterparty, row.status, row.reference || '', Boolean(row.internal), iso(row.created_at), iso(row.requested_at || row.created_at), row.status === 'completed' ? iso(row.completed_at || row.created_at) : null,
        parse(row.risk_json), parse(row.authorization_json), parse(row.review_json), row.to_account_id || null, row.biller_id || null, row.payee || null]);
      for (const row of snapshot.scheduled_payments) {
        const payload = parse(row.payload_json); payload.fromId = String(payload.fromId);
        await client.query(`INSERT INTO scheduled_payments(id,user_id,type,payload_json,amount_cents,frequency,scheduled_at,next_run_at,status,authorization_json,created_at,last_run_at,last_status,last_error,lease_owner,lease_until)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,NULL)`, [row.id, row.user_id, row.type, payload, row.amount_cents, row.frequency, iso(row.scheduled_at), iso(row.next_run_at), row.status, parse(row.authorization_json), iso(row.created_at), iso(row.last_run_at), row.last_status, row.last_error]);
      }
      for (const row of snapshot.scheduled_payment_runs) await client.query('INSERT INTO scheduled_payment_runs(id,schedule_id,due_at,status,transaction_id,error,created_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, row.schedule_id, iso(row.due_at), row.status, row.transaction_id, row.error, iso(row.created_at), iso(row.completed_at)]);
      for (const row of snapshot.requests) {
        let result = parse(row.result_json), payload = null;
        if (['transfer', 'payment'].includes(row.kind)) {
          const original = snapshot.transactions.find(entry => entry.id === result.id);
          if (!original) throw new Error('Legacy idempotency receipt has no transaction.');
          payload = row.kind === 'transfer' ? { fromId: String(original.account_id), number: original.payee, amountCents: -money(original.amount_cents), note: original.description }
            : { fromId: String(original.account_id), amountCents: -money(original.amount_cents), billerId: original.biller_id || original.payee, reference: original.reference };
          if (!payload.number && row.kind === 'transfer') throw new Error('Legacy transfer receipt lacks an immutable destination.');
          const selected = (await client.query('SELECT t.*,a.name AS account_name,a.number AS account_number FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.id=$1', [result.id])).rows[0];
          result = transactionView(selected);
        } else if (row.kind === 'schedule') {
          const schedule = snapshot.scheduled_payments.find(item => item.id === result.id);
          if (!schedule) throw new Error('Legacy schedule receipt has no schedule.');
          const saved = parse(schedule.payload_json); saved.fromId = String(saved.fromId);
          payload = { type: schedule.type, payload: saved, frequency: schedule.frequency, scheduledAt: iso(schedule.scheduled_at) };
          if (result.fromAccountId !== undefined) result.fromAccountId = String(result.fromAccountId);
        } else throw new Error('Unsupported legacy idempotency action. Import refused.');
        const hash = canonicalHash(row.user_id, row.kind, payload);
        await client.query('INSERT INTO requests(user_id,request_id,kind,payload_hash,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6)', [row.user_id, row.request_id, row.kind, hash, result, iso(row.created_at)]);
        if (['transfer', 'payment'].includes(row.kind)) await client.query('INSERT INTO payment_bindings(user_id,request_id,kind,payload_hash,canonical_json,assessment_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [row.user_id, row.request_id, row.kind, hash, payload, result.id, iso(row.created_at)]);
      }
      for (const row of snapshot.notification_outbox) {
        const event = parse(row.payload_json); event.userId = String(event.userId);
        await client.query('INSERT INTO notification_outbox(id,user_id,payload_json,status,attempts,available_at,locked_until,created_at,delivered_at,last_error) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9)', [row.id, row.user_id, event, row.status === 'processing' ? 'pending' : row.status, row.attempts || 0, iso(row.available_at || Date.now()), iso(row.created_at), iso(row.delivered_at), row.last_error]);
      }
      for (const row of snapshot.operator_role_audit) await client.query("INSERT INTO audit_log(target_user_id,event_type,metadata,created_at) VALUES($1,'legacy.operator_role_granted',$2,$3)", [row.user_id, { previousRole: row.previous_role, role: row.new_role, method: row.method }, iso(row.changed_at)]);
      if (adjacent.notifications) for (const row of adjacent.notifications.notifications) await client.query('INSERT INTO notifications(id,user_id,type,title,message,transaction_id,metadata,created_at,read_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [row.id, row.user_id, row.type, row.title, row.message, row.transaction_id && transactionIds.has(row.transaction_id) ? row.transaction_id : null, parse(row.metadata_json) || {}, iso(row.created_at), iso(row.read_at)]);
      if (adjacent.fraud) {
        for (const row of adjacent.fraud.fraud_rules) {
          const rule = parse(row.value_json);
          const result = await client.query('UPDATE fraud_rules SET name=$2,description=$3,enabled=$4,threshold=$5,unit=$6,action=$7 WHERE id=$1', [rule.id, rule.name, rule.description, rule.enabled, rule.threshold, rule.unit, rule.action]);
          if (!result.rowCount) throw new Error('Legacy store contains an unsupported fraud rule.');
        }
        await client.query('UPDATE fraud_settings SET version=$1 WHERE id=1', [adjacent.fraud.fraud_settings[0]?.version || 1]);
        for (const row of adjacent.fraud.fraud_rule_audit) await client.query('INSERT INTO fraud_rule_audit(id,rule_id,version,actor_id,actor_name,before_json,after_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [row.id, row.rule_id, row.version, snapshot.users.some(user => String(user.id) === String(row.actor_id)) ? row.actor_id : null, row.actor_name || `Legacy user ${row.actor_id}`, parse(row.before_json), parse(row.after_json), iso(row.created_at)]);
        // Old assessments lack canonical source/payload binding; archive only.
        for (const row of adjacent.fraud.fraud_assessments) await client.query("INSERT INTO legacy_service_records(source,table_name,record_key,record_json,import_fingerprint) VALUES('fraud','fraud_assessments',$1,$2,$3)", [row.id, { ...row, result_json: parse(row.result_json) }, fingerprint]);
      }
      for (const [table, column] of [['users', 'id'], ['accounts', 'id'], ['transactions', 'insert_seq'], ['fraud_rule_audit', 'id']]) await client.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'),GREATEST(COALESCE(MAX(${column}),0),1),COALESCE(MAX(${column}),0)>0) FROM ${table}`);
      await client.query("SELECT setval('settlement_sequence',$1,$2)", [Math.max(1, completed.length), completed.length > 0]);
      await client.query("INSERT INTO audit_log(event_type,metadata) VALUES('legacy.import_completed',$1)", [{ fingerprint, counts, sessionsImported: false, openingProvenance: 'legacy_verified' }]);
      return { duplicate: false, fingerprint, counts };
    });
  } finally { if (!suppliedDatabase) await db.close(); }
}

if (require.main === module) {
  const args = process.argv.slice(2), sourceIndex = args.indexOf('--source');
  const allowed = new Set(['--source', '--confirm-empty-target', '--with-adjacent-stores']);
  const invalid = args.some((value, index) => index !== sourceIndex + 1 && !allowed.has(value));
  if (sourceIndex < 0 || !args[sourceIndex + 1] || invalid) { console.error('Usage: node scripts/import-sqlite.js --source legacy/banking.sqlite --confirm-empty-target [--with-adjacent-stores]'); process.exitCode = 1; }
  else importSqlite({ sourcePath: args[sourceIndex + 1], confirmEmptyTarget: args.includes('--confirm-empty-target'), withAdjacentStores: args.includes('--with-adjacent-stores') }).then(result => console.log(`${result.duplicate ? 'Already imported' : 'Imported'} snapshot ${result.fingerprint}; users=${result.counts.users}, accounts=${result.counts.accounts}, transactions=${result.counts.transactions}. Existing passwords retained; sign in again.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { importSqlite, readSource, validateSnapshot };
