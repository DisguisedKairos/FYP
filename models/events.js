'use strict';

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { transaction } = require('../db');

function instant(clock = Date.now) {
  const date = new Date(clock());
  if (!Number.isFinite(date.getTime())) throw new Error('The application clock returned an invalid date.');
  return date;
}

// Called inside the same transaction as the balance/lifecycle change.
function enqueue(db, { userId, type, title, message, transactionId = null, metadata = {}, createdAt = new Date().toISOString(), id = randomUUID() }) {
  const event = { id, userId, type, title, message, transactionId, metadata, createdAt };
  db.prepare('INSERT INTO notification_outbox (id, user_id, payload_json, created_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, JSON.stringify(event), createdAt);
  return event;
}

async function dispatch(db, client, clock = Date.now, { maxEvents = 100, timeBudgetMs = 1000 } = {}) {
  const started = performance.now();
  let delivered = 0, failed = 0;
  for (let index = 0; index < maxEvents; index++) {
    if (index && performance.now() - started >= timeBudgetMs) break;
    const now = instant(clock).getTime();
    // Claim only the event being attempted. Unprocessed events remain immediately
    // available to another worker when this batch reaches its time budget.
    const row = transaction(db, () => {
      const next = db.prepare("SELECT * FROM notification_outbox WHERE (status = 'pending' AND available_at <= ?) OR (status = 'processing' AND locked_until <= ?) ORDER BY created_at, rowid LIMIT 1").get(now, now);
      if (next) db.prepare("UPDATE notification_outbox SET status = 'processing', locked_until = ? WHERE id = ?").run(now + 60000, next.id);
      return next;
    });
    if (!row) break;
    try {
      await client.publish(JSON.parse(row.payload_json));
      db.prepare("UPDATE notification_outbox SET status = 'delivered', delivered_at = ?, locked_until = 0, last_error = NULL WHERE id = ?").run(instant(clock).toISOString(), row.id);
      delivered++;
    } catch (error) {
      const attempts = row.attempts + 1;
      db.prepare("UPDATE notification_outbox SET status = 'pending', attempts = ?, available_at = ?, locked_until = 0, last_error = ? WHERE id = ?")
        .run(attempts, now + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)), String(error.message || error).slice(0, 500), row.id);
      failed++;
      // A notification outage should consume one transport timeout per tick,
      // rather than one timeout for every event in the durable backlog.
      break;
    }
  }
  return { notificationsDelivered: delivered, notificationsFailed: failed };
}

module.exports = { instant, enqueue, dispatch };
