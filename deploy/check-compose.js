'use strict';

const assert = require('node:assert/strict');
function validateTmpfs(mounts) {
  assert.ok(Array.isArray(mounts) && mounts.length === 1, 'Runtime must have exactly one temporary filesystem mount.');
  assert.match(mounts[0], /^\/tmp:.*\bnoexec\b.*\bnosuid\b.*\bsize=32m\b/, 'Temporary filesystem options must remain attached to the absolute /tmp mount path.');
}
function validateCompose(model) {
  const services = model.services;
  for (const name of ['banking', 'fraud', 'ollama', 'database-setup', 'nginx']) {
    const service = services[name];
    assert.ok(service?.read_only, `${name} must have a read-only root filesystem.`);
    validateTmpfs(service.tmpfs);
    assert.ok(service.cap_drop.includes('ALL'));
    assert.ok(service.security_opt.includes('no-new-privileges:true'));
  }
  const secrets = name => services[name].secrets.map(secret => secret.source).sort();
  assert.deepEqual(secrets('banking'), ['app_password', 'auth_encryption_key', 'service_token']);
  assert.deepEqual(secrets('fraud'), ['service_token']);
  assert.deepEqual(secrets('database-setup'), ['app_password', 'owner_password', 'postgres_password']);
  if (services['staff-admin']) assert.deepEqual(secrets('staff-admin'), ['owner_password']);
  assert.deepEqual(Object.keys(services).filter(name => services[name].ports?.length), ['nginx']);
  assert.equal(services.nginx.ports[0].host_ip, '127.0.0.1');
  assert.equal(model.networks.backend.internal, true);
  assert.equal(services.ollama.environment.OLLAMA_NO_CLOUD,'1');
  assert.equal(services.banking.environment.AGENT_MODEL,services.fraud.environment.AGENT_MODEL);
  assert.equal(services.banking.environment.AGENT_OLLAMA_URL,'http://ollama:11434');
  assert.equal(services.fraud.environment.AGENT_OLLAMA_URL,'http://ollama:11434');
  assert.equal(services.banking.environment.FRAUD_SERVICE_URL, 'http://fraud:4011');
  assert.equal(services.banking.environment.TRUST_PROXY, services.nginx.networks.frontend.ipv4_address + '/32');
  console.log('Compose boundaries verified: temporary mounts, private service ports, trusted proxy and service-specific credentials.');
}
module.exports = { validateTmpfs, validateCompose };
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try { validateCompose(JSON.parse(input)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  });
}
