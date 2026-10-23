'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture, modelStub } = require('./dft-helpers');
const workflows = require('../banking/workflows');
const { createRiskClient } = require('../banking/risk');
const { HttpError } = require('../models/errors');
const pgTest = (name, work) => test(name, { skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL for PostgreSQL workflow tests.' }, work);
const failure = status => error => error.status === status;

pgTest('DFT schedule creation cannot commit an authorization revoked before its transaction',async t=>{
  const f=await setup(t);
  const stale=async (...args)=>{const result=await f.authorize(...args);await f.db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[f.owner.id]);return result;};
  await assert.rejects(workflows.createSchedule(f.db,f.owner,f.body(),{authorize:stale,now:f.now}),failure(409));
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count),0);
});

async function setup(t, options = {}) {
  const { db } = await fixture(t, { http: false, seed: false });
  let timestamp = Date.parse('2027-01-01T04:00:00Z');
  const now = () => timestamp;
  const owner = (await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Schedule Owner',$1,'test-only','customer') RETURNING *", [`${randomUUID()}@example.test`])).rows[0];
  await require('./dft-helpers').approveBusiness(db,owner);
  const recipient = (await db.query("INSERT INTO users(name,email,password_hash) VALUES('Schedule Recipient',$1,'test-only') RETURNING *", [`${randomUUID()}@example.test`])).rows[0];
  await require('./dft-helpers').approveBusiness(db,recipient);
  const account = async (user, number, balance) => (await db.query("INSERT INTO accounts(user_id,name,number,balance_cents,opening_balance_cents,opening_provenance,created_at) VALUES($1,'Main savings',$2,$3,$3,'seed','2026-01-01T00:00:00Z') RETURNING *", [user.id, number, balance])).rows[0];
  const source = await account(owner, '9300000001', 100000), target = await account(recipient, '9300000002', 0);
  const authorize = async () => ({ method: 'password', authorizedAt: new Date(now()).toISOString(), userId: String(owner.id), authVersion: 1 });
  const riskClient = createRiskClient({ db, assessModel: options.assessModel || modelStub(options.score || 2) });
  const body = changes => ({ type: 'transfer', fromAccountId: source.id, toAccountNumber: target.number, amount: '10.00', description: 'Scheduled transfer', frequency: 'once', scheduledAt: new Date(now() + 60000).toISOString(), requestId: randomUUID(), ...changes });
  const create = changes => workflows.createSchedule(db, owner, body(changes), { authorize, now });
  const balance = async () => Number((await db.query('SELECT balance_cents FROM accounts WHERE id=$1', [source.id])).rows[0].balance_cents);
  return { db, owner, recipient, source, target, now, authorize, riskClient, body, create, balance, advance: milliseconds => { timestamp += milliseconds; }, setTime: value => { timestamp = Date.parse(value); }, tick: () => workflows.runDue(db, { riskClient, now }) };
}

pgTest('DFT schedules require consent and payload-bound idempotency, and replay current cancellation state', async t => {
  const f = await setup(t), body = f.body();
  const options = { authorize: f.authorize, now: f.now };
  const results = await Promise.all(Array.from({ length: 4 }, () => workflows.createSchedule(f.db, f.owner, body, options)));
  assert.ok(results.every(row => row.id === results[0].id));
  assert.equal(await f.balance(), 100000);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM scheduled_payments')).rows[0].count), 1);
  await assert.rejects(workflows.createSchedule(f.db, f.owner, { ...body, amount: '11.00' }, options), failure(409));
  await assert.rejects(workflows.createSchedule(f.db, f.owner, f.body(), { ...options, authorize: async () => { throw new HttpError(403, 'Wrong password'); } }), failure(403));
  await workflows.cancelSchedule(f.db, f.owner, results[0].id, { now: f.now });
  assert.equal((await workflows.createSchedule(f.db, f.owner, body, options)).status, 'cancelled');
  await assert.rejects(workflows.cancelSchedule(f.db, f.recipient, results[0].id, { now: f.now }), failure(404));
});

pgTest('DFT concurrent scheduled ticks execute once and outbox consumers deliver once', async t => {
  const f = await setup(t), schedule = await f.create();
  f.advance(60000);
  await Promise.all([f.tick(), f.tick(), f.tick()]);
  assert.equal(await f.balance(), 99000);
  const rows = await workflows.listSchedules(f.db, f.owner);
  assert.equal(rows[0].id, schedule.id);
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[0].runs.length, 1);
  assert.equal(rows[0].runs[0].status, 'completed');
  assert.ok(rows[0].runs[0].transactionId);
  await f.tick();
  assert.equal(await f.balance(), 99000);
  await workflows.dispatch(f.db, { now: f.now });
  const first = Number((await f.db.query('SELECT count(*) FROM notifications')).rows[0].count);
  assert.equal(first, 3);
  await workflows.dispatch(f.db, { now: f.now });
  assert.equal(Number((await f.db.query('SELECT count(*) FROM notifications')).rows[0].count), first);
});

pgTest('DFT screening outages retry the same occurrence without debit or duplicate payment', async t => {
  let available = false;
  const f = await setup(t, { assessModel: async input => { if (!available) throw new Error('Model unavailable'); return modelStub()(input); } });
  await f.create(); f.advance(60000); await f.tick();
  let schedule = (await workflows.listSchedules(f.db, f.owner))[0];
  assert.equal(schedule.status, 'active'); assert.equal(schedule.runs[0].status, 'retrying');
  assert.equal(schedule.runs[0].attempts, 1); assert.equal(await f.balance(), 100000);
  available = true; await f.tick(); assert.equal(await f.balance(), 100000);
  f.advance(2000); await f.tick();
  schedule = (await workflows.listSchedules(f.db, f.owner))[0];
  assert.equal(schedule.status, 'completed'); assert.equal(schedule.runs[0].attempts, 2);
  assert.equal(await f.balance(), 99000);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM requests WHERE kind=$1', ['transfer'])).rows[0].count), 1);
});

pgTest('DFT terminal insufficient funds and held scheduled transactions never debit balances', async t => {
  const f = await setup(t); await f.create();
  await f.db.query('UPDATE accounts SET balance_cents=0,opening_balance_cents=0 WHERE id=$1', [f.source.id]);
  f.advance(60000); await f.tick();
  assert.equal((await workflows.listSchedules(f.db, f.owner))[0].status, 'failed');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
  const held = await setup(t, { score: 70 }); await held.create(); held.advance(60000); await held.tick();
  const schedule = (await workflows.listSchedules(held.db, held.owner))[0];
  assert.equal(schedule.runs[0].status, 'pending_review'); assert.equal(await held.balance(), 100000);
});

pgTest('DFT cancelling during asynchronous screening prevents any later debit', async t => {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await setup(t, { assessModel: async input => { enter(); await gate; return modelStub()(input); } });
  const schedule = await f.create(); f.advance(60000);
  const running = f.tick(); await entered;
  await workflows.cancelSchedule(f.db, f.owner, schedule.id, { now: f.now });
  release(); await running;
  assert.equal(await f.balance(), 100000);
  const result = (await workflows.listSchedules(f.db, f.owner))[0];
  assert.equal(result.status, 'cancelled'); assert.equal(result.runs[0].status, 'cancelled');
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 0);
});

pgTest('DFT an expired worker cannot overwrite a replacement worker or execute twice', async t => {
  let enter, release, calls = 0;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = await setup(t, { assessModel: async input => { if (++calls === 1) { enter(); await gate; } return modelStub()(input); } });
  await f.create(); f.advance(60000);
  const oldWorker = f.tick(); await entered;
  f.advance(300001); await f.tick();
  assert.equal(await f.balance(), 99000);
  release(); await oldWorker;
  const result = (await workflows.listSchedules(f.db, f.owner))[0];
  assert.equal(result.status, 'completed'); assert.equal(result.runs[0].attempts, 2);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count), 2);
  assert.equal(await f.balance(), 99000);
});

pgTest('DFT cancellation recovers a ledger committed before run bookkeeping crashed', async t => {
  const f = await setup(t), schedule = await f.create(); f.advance(60000); await f.tick();
  await f.db.query("UPDATE scheduled_payments SET status='active',next_run_at=$2,lease_owner='crashed',lease_until=$2 WHERE id=$1", [schedule.id, schedule.scheduledAt]);
  await f.db.query("UPDATE scheduled_payment_runs SET status='processing',transaction_id=NULL,completed_at=NULL WHERE schedule_id=$1", [schedule.id]);
  const cancelled = await workflows.cancelSchedule(f.db, f.owner, schedule.id, { now: f.now });
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.runs[0].status, 'completed');
  assert.ok(cancelled.runs[0].transactionId); assert.equal(await f.balance(), 99000);
  await f.tick(); assert.equal(await f.balance(), 99000);
});

pgTest('DFT monthly recurrence preserves the original day through short months', async t => {
  const f = await setup(t); f.setTime('2027-01-30T04:00:00Z');
  await f.create({ frequency: 'monthly', scheduledAt: '2027-01-31T04:00:00.000Z', amount: '1.00' });
  for (const [date, expected] of [['2027-01-31T04:00:00Z', '2027-02-28T04:00:00.000Z'], ['2027-02-28T04:00:00Z', '2027-03-31T04:00:00.000Z']]) {
    f.setTime(date); await f.tick(); assert.equal((await workflows.listSchedules(f.db, f.owner))[0].nextRunAt, expected);
  }
  assert.equal(await f.balance(), 99800);
});

pgTest('DFT notification delivery rollback retains pending events for a later retry', async t => {
  const f = await setup(t); await f.create();
  await f.db.query('ALTER TABLE notifications ADD CONSTRAINT forced_consumer_failure CHECK(false) NOT VALID');
  await assert.rejects(workflows.dispatch(f.db, { now: f.now }));
  assert.equal((await f.db.query('SELECT status FROM notification_outbox')).rows[0].status, 'pending');
  await f.db.query('ALTER TABLE notifications DROP CONSTRAINT forced_consumer_failure');
  assert.equal((await workflows.dispatch(f.db, { now: f.now })).notificationsDelivered, 1);
  const unread = await workflows.notifications(f.db, f.owner); assert.equal(unread.unreadCount, 1);
  await assert.rejects(workflows.markRead(f.db, f.recipient, unread.notifications[0].id, { now: f.now }), failure(404));
  assert.equal((await workflows.markRead(f.db, f.owner, 'all', { now: f.now })).unreadCount, 0);
});
