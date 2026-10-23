'use strict';

const DEMO_PASSWORD = 'Greenlink123!';
const LEGACY_DEMO_PASSWORD = 'Evergreen123!';
const DEMO_IDENTITIES = [
  { email: 'alex@greenlink.demo', legacyEmail: 'alex@evergreen.demo', number: '1020001001' },
  { email: 'jamie@greenlink.demo', legacyEmail: 'jamie@evergreen.demo', number: '1020002001' },
  { email: 'reviewer@greenlink.demo', legacyEmail: 'reviewer@evergreen.demo', number: '1020009001' }
];

function isKnownDemo(db, user) {
  if (!user) return false;
  const identity = DEMO_IDENTITIES.find(item => item.email === user.email || item.legacyEmail === user.email);
  return Boolean(identity && db.prepare('SELECT id FROM accounts WHERE user_id = ? AND number = ?').get(user.id, identity.number));
}

function findLoginUser(db, email) {
  const direct = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (direct) return direct;
  const identity = DEMO_IDENTITIES.find(item => item.email === email || item.legacyEmail === email);
  if (!identity) return null;
  const alternate = db.prepare('SELECT * FROM users WHERE email = ?').get(email === identity.email ? identity.legacyEmail : identity.email);
  return isKnownDemo(db, alternate) ? alternate : null;
}

module.exports = { DEMO_PASSWORD, LEGACY_DEMO_PASSWORD, DEMO_IDENTITIES, isKnownDemo, findLoginUser };
