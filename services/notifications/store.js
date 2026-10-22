'use strict';

const { openStore } = require('../common');
const { HttpError } = require('../../models/errors');

class NotificationStore {
  constructor({ dbPath = ':memory:' } = {}) {
    this.isRemote = false;
    this.db = openStore(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
      message TEXT NOT NULL, transaction_id TEXT, created_at TEXT NOT NULL, read_at TEXT, metadata_json TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS notifications_user_date ON notifications(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS notifications_unread ON notifications(user_id) WHERE read_at IS NULL;`);
  }
  publish(event) {
    if (!event || !String(event.id || '').trim() || !String(event.userId || '').trim() || !String(event.title || '').trim() || !String(event.message || '').trim()) throw new HttpError(400, 'A notification event needs an identifier, recipient, title and message.');
    if (String(event.title).length > 180 || String(event.message).length > 2000 || String(event.id).length > 200) throw new HttpError(400, 'Notification event is too large.');
    const existing = this.db.prepare('SELECT user_id FROM notifications WHERE id=?').get(String(event.id));
    if (existing && existing.user_id !== String(event.userId)) throw new HttpError(409, 'Notification event identifier is already in use.');
    const result = this.db.prepare('INSERT OR IGNORE INTO notifications(id,user_id,type,title,message,transaction_id,created_at,metadata_json) VALUES(?,?,?,?,?,?,?,?)').run(String(event.id), String(event.userId), String(event.type || 'account'), String(event.title), String(event.message), event.transactionId ? String(event.transactionId) : null, new Date(event.createdAt || Date.now()).toISOString(), JSON.stringify(event.metadata || {}));
    return { id: String(event.id), duplicate: !Boolean(result.changes) };
  }
  list(userId, { unreadOnly = false } = {}) {
    const rows = this.db.prepare(`SELECT * FROM notifications WHERE user_id=? ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC,rowid DESC LIMIT 200`).all(String(userId));
    return { notifications: rows.map(row => ({ id: row.id, type: row.type, title: row.title, message: row.message, transactionId: row.transaction_id, createdAt: row.created_at, isRead: Boolean(row.read_at), readAt: row.read_at, metadata: JSON.parse(row.metadata_json) })), unreadCount: this.db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL').get(String(userId)).count };
  }
  markRead(userId, id) {
    if (id === 'all') this.db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(new Date().toISOString(), String(userId));
    else {
      const row = this.db.prepare('SELECT id FROM notifications WHERE id=? AND user_id=?').get(String(id), String(userId));
      if (!row) throw new HttpError(404, 'Notification not found.');
      this.db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').run(new Date().toISOString(), String(id), String(userId));
    }
    return this.list(userId);
  }
  close() { this.db.close(); }
}
module.exports = { NotificationStore };
