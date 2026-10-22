'use strict';

const path = require('node:path');
const { NotificationStore } = require('./store');
const { createServiceServer, listen } = require('../common');
const { HttpError } = require('../../models/errors');

function createNotificationServer({ token = process.env.SERVICE_TOKEN, dbPath = process.env.NOTIFICATION_DB_PATH || path.join(process.env.DATA_DIR || 'data', 'notifications.sqlite') } = {}) {
  const store = new NotificationStore({ dbPath });
  return createServiceServer({ name: 'notifications', token, close: () => store.close(), handler: async (method, url, body) => {
    if (method === 'POST' && url.pathname === '/internal/events') return store.publish(body);
    if (method === 'GET' && url.pathname === '/internal/notifications') return store.list(url.searchParams.get('userId'), { unreadOnly: url.searchParams.get('unreadOnly') === 'true' });
    if (method === 'PATCH' && url.pathname === '/internal/notifications') return store.markRead(body.userId, body.id);
    throw new HttpError(404, 'Service endpoint not found.');
  } });
}
if (require.main === module) listen(createNotificationServer(), 'Notification service', 4012);
module.exports = { createNotificationServer };
