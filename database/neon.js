'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { provision, readEnvironment, writeEnvironment, connection } = require('./setup');

function secureNeonUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Pull the linked Neon PostgreSQL environment variables before setup.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')
      || !url.username || !url.password || url.pathname.length < 2 || url.hash) {
    throw new Error('Neon setup requires an authenticated Neon PostgreSQL connection.');
  }
  url.searchParams.set('sslmode', 'verify-full');
  return url;
}
function sameTarget(first, second) {
  try {
    const a = secureNeonUrl(first), b = secureNeonUrl(second);
    return a.hostname.replace('-pooler.', '.') === b.hostname.replace('-pooler.', '.')
      && (a.port || '5432') === (b.port || '5432') && a.pathname === b.pathname;
  } catch { return false; }
}
function configuration(application, operator) {
  const applicationTarget = secureNeonUrl(application.DATABASE_URL);
  const savedAdmin = operator.ADMIN_DATABASE_URL;
  const admin = secureNeonUrl(sameTarget(savedAdmin, applicationTarget.href) ? savedAdmin : application.DATABASE_URL_UNPOOLED);
  if (!sameTarget(admin.href, applicationTarget.href) || admin.hostname.includes('-pooler.')) {
    throw new Error('Use a direct Neon bootstrap connection for the same linked database.');
  }
  const ownerKnown = sameTarget(operator.MIGRATION_DATABASE_URL, admin.href);
  const appKnown = sameTarget(operator.APPLICATION_DATABASE_URL, admin.href);
  const oldOwner = ownerKnown ? new URL(operator.MIGRATION_DATABASE_URL) : null;
  const oldApp = appKnown ? new URL(operator.APPLICATION_DATABASE_URL) : null;
  const ownerRole = oldOwner ? decodeURIComponent(oldOwner.username) : 'greenlink_owner';
  const appRole = oldApp ? decodeURIComponent(oldApp.username) : 'greenlink_app';
  const ownerPassword = oldOwner ? decodeURIComponent(oldOwner.password) : randomBytes(32).toString('hex');
  const appPassword = oldApp ? decodeURIComponent(oldApp.password) : randomBytes(32).toString('hex');
  const databaseName = decodeURIComponent(admin.pathname.slice(1));
  const ownerUrl = connection(admin.href, databaseName, ownerRole, ownerPassword);
  const appDirectUrl = connection(admin.href, databaseName, appRole, appPassword);
  const appUrl = new URL(appDirectUrl);
  appUrl.hostname = applicationTarget.hostname.includes('-pooler.') ? applicationTarget.hostname : applicationTarget.hostname.replace(/^([^.]+)\./, '$1-pooler.');
  return { adminUrl: admin.href, databaseName, ownerRole, appRole, ownerPassword, appPassword,
    ownerKnown, appKnown, ownerUrl, appDirectUrl, appUrl: appUrl.href, managedNeon: true };
}
async function configureNeon({ root = path.resolve(__dirname, '..') } = {}) {
  const applicationFile = path.join(root, '.env'), operatorFile = path.join(root, '.env.database-admin');
  const application = readEnvironment(applicationFile), operator = readEnvironment(operatorFile);
  const settings = configuration(application, operator);
  // Save new credentials before DDL so a failed or interrupted setup can resume.
  writeEnvironment(operatorFile, { ADMIN_DATABASE_URL: settings.adminUrl,
    MIGRATION_DATABASE_URL: settings.ownerUrl, APPLICATION_DATABASE_URL: settings.appUrl });
  const result = await provision(settings);
  writeEnvironment(applicationFile, { DATABASE_URL: settings.appUrl, DATABASE_URL_UNPOOLED: settings.appDirectUrl },
    ['ADMIN_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'APPLICATION_DATABASE_URL', 'TEST_DATABASE_URL']);
  console.log('Neon PostgreSQL ready: ' + result.databaseName + '; application role ' + result.appRole + '; migration role ' + result.ownerRole + '.');
  console.log('TLS hostname verification is enabled. Runtime uses pooling; operator credentials remain in ignored .env.database-admin.');
  return result;
}
module.exports = { secureNeonUrl, sameTarget, configuration, configureNeon };
if (require.main === module) configureNeon().catch(error => {
  console.error('Neon database setup failed: ' + error.message);
  process.exitCode = 1;
});
