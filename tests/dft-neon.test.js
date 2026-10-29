'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuration, secureNeonUrl, sameTarget } = require('../database/neon');
const { childEnvironment } = require('../scripts/start-platform');

const endpoint = 'ep-greenlink.aws.neon.tech';
const url = (role, host = endpoint, database = 'neondb', password = 'a'.repeat(64)) =>
  'postgresql://' + role + ':' + password + '@' + host + '/' + database + '?sslmode=require&channel_binding=require';
const application = () => ({ DATABASE_URL: url('neondb_owner', 'ep-greenlink-pooler.aws.neon.tech'), DATABASE_URL_UNPOOLED: url('neondb_owner') });

test('Neon setup preserves endpoint identity, verifies TLS, and separates pooled runtime from direct operator credentials', () => {
  const input = application(), settings = configuration(input, {});
  assert.equal(settings.managedNeon, true);
  assert.equal(settings.databaseName, 'neondb');
  assert.equal(settings.ownerKnown, false);
  assert.equal(settings.appKnown, false);
  assert.match(settings.ownerPassword, /^[a-f0-9]{64}$/);
  assert.match(settings.appPassword, /^[a-f0-9]{64}$/);
  assert.notEqual(settings.ownerPassword, settings.appPassword);
  for (const key of ['adminUrl', 'ownerUrl', 'appUrl', 'appDirectUrl']) assert.equal(new URL(settings[key]).searchParams.get('sslmode'), 'verify-full');
  assert.equal(new URL(settings.appUrl).hostname, 'ep-greenlink-pooler.aws.neon.tech');
  assert.equal(new URL(settings.ownerUrl).hostname, endpoint);
  assert.equal(new URL(settings.appDirectUrl).hostname, endpoint);
  assert.equal(new URL(settings.appUrl).username, 'greenlink_app');
  assert.equal(new URL(settings.ownerUrl).username, 'greenlink_owner');
  assert.equal(new URL(settings.appUrl).searchParams.get('channel_binding'), 'require');
  assert.equal(new URL(input.DATABASE_URL).username, 'neondb_owner');
});

test('Neon setup reuses saved credentials only for the same branch and database', () => {
  const ownerPassword = 'b'.repeat(64), appPassword = 'c'.repeat(64);
  const operator = { ADMIN_DATABASE_URL: url('neondb_owner'), MIGRATION_DATABASE_URL: url('greenlink_owner', endpoint, 'neondb', ownerPassword), APPLICATION_DATABASE_URL: url('greenlink_app', endpoint, 'neondb', appPassword) };
  const settings = configuration(application(), operator);
  assert.equal(settings.ownerKnown, true);
  assert.equal(settings.appKnown, true);
  assert.equal(settings.ownerPassword, ownerPassword);
  assert.equal(settings.appPassword, appPassword);
  const current = { DATABASE_URL: settings.appUrl, DATABASE_URL_UNPOOLED: settings.appDirectUrl };
  assert.equal(configuration(current, operator).adminUrl, settings.adminUrl);
  const other = { ...operator, MIGRATION_DATABASE_URL: url('greenlink_owner', 'ep-other.aws.neon.tech') };
  assert.equal(configuration(application(), other).ownerKnown, false);
  assert.equal(sameTarget(url('greenlink_app', endpoint, 'other_database'), settings.adminUrl), false);
  assert.equal(sameTarget(url('greenlink_app', 'ep-other.aws.neon.tech'), settings.adminUrl), false);
  assert.equal(sameTarget('postgresql://local:local@localhost/greenlink_dft', settings.adminUrl), false);
});

test('Neon setup rejects local, spoofed, mismatched and pooled bootstrap endpoints before any DDL', () => {
  for (const value of ['postgresql://user:pass@localhost/database', 'postgresql://user:pass@evilneon.tech/database', 'postgresql://user:pass@valid.neon.tech.evil.test/database', 'https://user:pass@valid.neon.tech/database']) assert.throws(() => secureNeonUrl(value));
  assert.throws(() => configuration({ ...application(), DATABASE_URL_UNPOOLED: url('neondb_owner', 'ep-other.aws.neon.tech') }, {}), /same linked database/);
  assert.throws(() => configuration({ ...application(), DATABASE_URL_UNPOOLED: url('neondb_owner', 'ep-greenlink-pooler.aws.neon.tech') }, {}), /direct Neon/);
  const input = application();
  input.DATABASE_URL = url('neondb_owner');
  assert.equal(new URL(configuration(input, {}).appUrl).hostname, 'ep-greenlink-pooler.aws.neon.tech');
});

test('Neither banking nor Python inherits Neon API keys or direct bootstrap connections', () => {
  const supplied = { DATABASE_URL: 'runtime-only', DATABASE_URL_UNPOOLED: 'private-owner', NEON_API_KEY: 'private-api-key', NEON_ACCESS_TOKEN: 'private-token', MIGRATION_DATABASE_URL: 'private-migrator', PATH: 'native-tools' };
  for (const service of ['banking', 'fraud']) {
    const child = childEnvironment(supplied, service);
    for (const key of ['DATABASE_URL_UNPOOLED', 'NEON_API_KEY', 'NEON_ACCESS_TOKEN', 'MIGRATION_DATABASE_URL']) assert.equal(child[key], undefined);
    assert.equal(child.PATH, 'native-tools');
    assert.equal(child.DATABASE_URL, service === 'banking' ? supplied.DATABASE_URL : undefined);
  }
  assert.equal(supplied.NEON_API_KEY, 'private-api-key');
});


test('Neon fixture identity matches direct and pooled client endpoints despite internal address differences', async () => {
  const { assertSameTarget } = require('../scripts/feature-accounts');
  const database = (connectionString, address, schema = 'public') => ({ pool: { options: { connectionString } }, query: async () => ({ rows: [{ database: 'neondb', schema, address, port: 5432 }] }) });
  const owner = database(url('greenlink_owner'), '169.254.254.254/32');
  const runtime = database(url('greenlink_app', 'ep-greenlink-pooler.aws.neon.tech'), '::1/128');
  const target = await assertSameTarget(owner, runtime);
  assert.equal(target.address, endpoint);
  assert.equal(target.database, 'neondb');
  await assert.rejects(assertSameTarget(owner, database(url('greenlink_app', 'ep-other.aws.neon.tech'), '169.254.254.254/32')), /same Neon endpoint/);
  await assert.rejects(assertSameTarget(owner, database(url('greenlink_app'), '169.254.254.254/32', 'other_schema')), /same database\/schema/);
});
