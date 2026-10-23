'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { buildPackage, createZip } = require('../scripts/package');
const { verifyPackage, readZip, MAX_ENTRY_BYTES, REQUIRED_FILES } = require('../scripts/verify-package');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function write(root, name, content) {
  const filename = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(t) {
  // Keep realpath-based packaging checks inside the writable workspace, even
  // when the OS temporary directory lives under a restricted user profile.
  const fixtureDirectory = path.resolve(__dirname, '..', 'test-results');
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  if (path.relative(fixtureDirectory, fs.realpathSync(fixtureDirectory)) !== '') throw new Error('Unexpected package-test fixture directory.');
  const root = fs.mkdtempSync(path.join(fixtureDirectory, 'greenlink-package-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== fixtureDirectory || !path.basename(resolved).startsWith('greenlink-package-test-')
      || fs.lstatSync(resolved).isSymbolicLink() || path.relative(resolved, fs.realpathSync(resolved)) !== '') throw new Error('Unexpected package-test cleanup path.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const source = {
    'package.json': JSON.stringify({ name: 'greenlink-digital-bank', version: '2.0.0' }),
    'app.js': "console.log('Greenlink Digital Bank');\n",
    'README.md': '# Greenlink Digital Bank\n',
    '.gitignore': 'releases/\n',
    '.env.example': 'PORT=3000\n',
    'banking/ledger.js': 'module.exports = {};\n',
    'package-lock.json': JSON.stringify({name:'greenlink-digital-bank',version:'2.0.0',lockfileVersion:3,packages:{'':{name:'greenlink-digital-bank',version:'2.0.0'}}}),
    'public/app.js': 'export const bank = "Greenlink";\n',
    'views/index.html': '<!doctype html><title>Greenlink</title>\n',
    'services/fraud/model.json': '{"version":"synthetic-baseline"}\n',
    'datasets/fraud-history.csv': 'amount,label\n25,0\n',
    'scripts/start.js': "console.log('start');\n",
    'tests/dft-example.test.js': "require('node:test')('example', () => {});\n",
    'docs/architecture.md': 'Local services\n',
    'fraud_service/model.sha256': 'approved-model-checksum\n',
    'tests_python/requirements.txt': '-r ../requirements.txt\n',
  };
  for (const required of REQUIRED_FILES) if (!(required in source)) source[required] = required.endsWith('.py') ? '# Python source fixture\n' : 'DFT source fixture\n';
  const excluded = {
    'legacy/sqlite-db.js': 'DO_NOT_PACKAGE_LEGACY_DB',
    'Dockerfile': 'DO_NOT_PACKAGE_DOCKER',
    'compose.yaml': 'DO_NOT_PACKAGE_COMPOSE',
    'compose.cloud.yaml': 'DO_NOT_PACKAGE_COMPOSE_CLOUD',
    '.github/workflows/ci.yml': 'DO_NOT_PACKAGE_CICD',
    'cloud/README.md': 'DO_NOT_PACKAGE_CLOUD',
    'retired-site/app/route.ts': 'DO_NOT_PACKAGE_HOSTED_PROTOTYPE',
    'services/gateway.js': 'DO_NOT_PACKAGE_OLD_GATEWAY',
    'services/fraud/engine.js': 'DO_NOT_PACKAGE_JS_RUNTIME',
    'models/assistant.js': 'DO_NOT_PACKAGE_OLD_MODEL',
    'controllers/authController.js': 'DO_NOT_PACKAGE_OLD_CONTROLLER',
    'tests/banking.test.js': 'DO_NOT_PACKAGE_OLD_TESTS',
    'fraud_service/__pycache__/model.pyc': 'DO_NOT_PACKAGE_PYTHON_CACHE',
    'fraud_service/model.pyc': 'DO_NOT_PACKAGE_PYC',
    'fraud_service/venv/lib/fake.py': 'DO_NOT_PACKAGE_VENV',
    'fraud_service/.venv/lib/fake.py': 'DO_NOT_PACKAGE_HIDDEN_VENV',
    'tests_python/.pytest_cache/state': 'DO_NOT_PACKAGE_PYTEST_CACHE',
    'public/legacy/old.js': 'DO_NOT_PACKAGE_NESTED_LEGACY',
    '.env': 'DO_NOT_PACKAGE_ENV',
    'data/banking.sqlite': 'DO_NOT_PACKAGE_DATABASE',
    'node_modules/unwanted/index.js': 'DO_NOT_PACKAGE_DEPENDENCY',
    'prototype/old.js': 'DO_NOT_PACKAGE_PROTOTYPE',
    'secrets/token.txt': 'DO_NOT_PACKAGE_TOKEN',
    'controllers/.env': 'DO_NOT_PACKAGE_NESTED_ENV',
    'public/data/private.sqlite': 'DO_NOT_PACKAGE_PUBLIC_DATA',
    'docs/signing.key': 'DO_NOT_PACKAGE_KEY',
    'cloud/.terraform/providers/fake': 'DO_NOT_PACKAGE_PROVIDER',
    'cloud/terraform.tfstate': 'DO_NOT_PACKAGE_TFSTATE',
    'cloud/terraform.tfstate.backup': 'DO_NOT_PACKAGE_TFSTATE_BACKUP',
    'cloud/production.tfvars': 'DO_NOT_PACKAGE_TFVARS',
    'cloud/production.tfvars.json': 'DO_NOT_PACKAGE_TFVARS_JSON',
    'cloud/deploy.tfplan': 'DO_NOT_PACKAGE_TFPLAN',
    'cloud/crash.log': 'DO_NOT_PACKAGE_CRASH',
    'tests/fixtures/bank.sqlite-wal': 'DO_NOT_PACKAGE_WAL',
    'tests/fixtures/bank.sqlite-shm': 'DO_NOT_PACKAGE_SHM',
    'public/old-release.zip': 'DO_NOT_PACKAGE_ZIP',
    'public/old-release.zip.sha256': 'DO_NOT_PACKAGE_CHECKSUM',
  };
  for (const [name, content] of Object.entries({ ...source, ...excluded })) write(root, name, content);
  git(root, 'init', '--quiet');
  git(root, 'add', '--all');
  git(root, '-c', 'user.name=Package Test', '-c', 'user.email=package-test@example.invalid', 'commit', '--quiet', '-m', 'Package fixture');
  return { root, source, excluded };
}
function saveArchive(root, bytes, name = 'tampered.zip') {
  const filename = path.join(root, name);
  fs.writeFileSync(filename, bytes);
  fs.writeFileSync(`${filename}.sha256`, `${hash(bytes)}  ${path.basename(filename)}\n`);
  return filename;
}

test('portable package includes only source allowlist, excludes secrets/runtime/DIT sources, and is deterministic', t => {
  const { root, source, excluded } = fixture(t);
  const first = buildPackage({ root });
  assert.match(first.archivePath, /greenlink-digital-bank-2\.0\.0\.zip$/);
  assert.equal(first.manifest.sourceDirty, false);
  assert.equal(first.verified, true);
  const original = fs.readFileSync(first.archivePath), entries = readZip(original);
  for (const name of Object.keys(source)) assert.ok(entries.has(name), `${name} included`);
  for (const name of Object.keys(excluded)) assert.equal(entries.has(name), false, `${name} excluded`);
  assert.equal([...entries.values()].some(bytes => bytes.includes(Buffer.from('DO_NOT_PACKAGE'))), false);
  assert.equal(first.manifest.files.length, Object.keys(source).length);
  for (const item of first.manifest.files) {
    assert.equal(item.size, entries.get(item.path).length);
    assert.equal(item.sha256, hash(entries.get(item.path)));
  }
  fs.utimesSync(path.join(root, 'app.js'), new Date(0), new Date());
  const second = buildPackage({ root, outputDirectory: path.join(root, 'another-release') });
  assert.deepEqual(fs.readFileSync(second.archivePath), original, 'contents and Git revision determine output, not file mtimes/output location');
  assert.equal(verifyPackage({ archivePath: second.archivePath }).sha256, hash(original));
});

test('packaging requires clean tracked source and explicitly marks local dirty builds', t => {
  const { root } = fixture(t);
  fs.appendFileSync(path.join(root, 'app.js'), '// local edit\n');
  assert.throws(() => buildPackage({ root }), /Commit the source first/);
  const result = buildPackage({ root, allowDirty: true });
  assert.equal(result.manifest.sourceDirty, true);
  assert.equal(verifyPackage({ archivePath: result.archivePath }).manifest.sourceDirty, true);
});

test('untracked allowlisted source cannot silently appear in a clean release', t => {
  const { root } = fixture(t);
  write(root, 'public/new-feature.js', 'export const feature = true;\n');
  assert.throws(() => buildPackage({ root }), /untracked package files/);
  const result = buildPackage({ root, allowDirty: true });
  assert.equal(result.manifest.sourceDirty, true);
  assert.ok(readZip(fs.readFileSync(result.archivePath)).has('public/new-feature.js'));
});

test('verification detects archive signatures, corrupted payloads, manifest tampering and checksum mismatch', t => {
  const { root } = fixture(t), result = buildPackage({ root });
  const original = fs.readFileSync(result.archivePath);
  const badSignature = Buffer.from(original); badSignature.writeUInt32LE(0, 0);
  assert.throws(() => readZip(badSignature), /local-header signature/);
  const badPayload = Buffer.from(original), payloadOffset = 30 + badPayload.readUInt16LE(26) + badPayload.readUInt16LE(28);
  badPayload[payloadOffset] ^= 0xff;
  assert.throws(() => readZip(badPayload), /inflate|CRC|size mismatch/);
  const entries = readZip(original), manifest = JSON.parse(entries.get('PACKAGE-MANIFEST.json'));
  manifest.files.find(file => file.path === 'app.js').sha256 = '0'.repeat(64);
  entries.set('PACKAGE-MANIFEST.json', Buffer.from(JSON.stringify(manifest)));
  const rewritten = createZip([...entries].map(([name, content]) => ({ path: name, content })));
  const tampered = saveArchive(root, rewritten);
  assert.throws(() => verifyPackage({ archivePath: tampered }), /Manifest hash or size mismatch: app\.js/);
  fs.writeFileSync(result.checksumPath, `${'0'.repeat(64)}  ${path.basename(result.archivePath)}\n`);
  assert.throws(() => verifyPackage({ archivePath: result.archivePath }), /SHA-256 checksum/);
});

test('verification rejects traversal, absolute paths, duplicate portable names and unallowlisted secrets without extraction', () => {
  for (const name of ['../escape.txt', '/absolute.txt', 'C:/drive.txt', 'public\\escape.js', 'public/../models/escape.js', 'public//double.js']) {
    const bytes = createZip([{ path: name, content: Buffer.from('payload') }]);
    assert.throws(() => readZip(bytes), /Unsafe archive path/, name);
  }
  assert.throws(() => readZip(createZip([{ path: 'cloud/terraform.tfstate', content: Buffer.from('secret') }])), /not allowlisted/);
  assert.throws(() => readZip(createZip([{ path: 'public/app.js', content: Buffer.from('one') }, { path: 'public/APP.js', content: Buffer.from('two') }])), /Duplicate archive path/);
  const oversized = createZip([{ path: 'public/app.js', content: Buffer.from('tiny') }]);
  const central = oversized.readUInt32LE(oversized.length - 22 + 16); oversized.writeUInt32LE(MAX_ENTRY_BYTES + 1, central + 24);
  assert.throws(() => readZip(oversized), /Unsupported ZIP entry settings/);
});

test('packaging rejects source junctions and refuses output under shipped source directories', t => {
  const { root } = fixture(t), link = path.join(root, 'public', 'outside');
  try { fs.symlinkSync(path.join(root, 'secrets'), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Creating symlinks is unavailable on this host.'); return; } throw error; }
  assert.throws(() => buildPackage({ root, allowDirty: true }), /symlink or junction/);
  fs.unlinkSync(link);
  assert.throws(() => buildPackage({ root, outputDirectory: path.join(root, 'public', 'releases') }), /outside allowlisted source directories/);
});

test('DFT package requires the PostgreSQL, Python, model approval and locked dependency source', t => {
  const { root } = fixture(t);
  for (const name of ['package-lock.json', 'main.py', 'requirements.txt', 'database/index.js', 'fraud_service/model.sha256', 'banking/totp.js']) {
    const filename = path.join(root, ...name.split('/')), bytes = fs.readFileSync(filename);
    fs.unlinkSync(filename);
    assert.throws(() => buildPackage({ root, allowDirty: true }), /Required DFT source file is missing/);
    fs.writeFileSync(filename, bytes);
  }
  const result = buildPackage({ root }), entries = readZip(fs.readFileSync(result.archivePath));
  const manifest = JSON.parse(entries.get('PACKAGE-MANIFEST.json'));
  entries.delete('requirements.txt');
  manifest.files = manifest.files.filter(file => file.path !== 'requirements.txt');
  entries.set('PACKAGE-MANIFEST.json', Buffer.from(JSON.stringify(manifest)));
  const incomplete = saveArchive(root, createZip([...entries].map(([name, content]) => ({ path: name, content }))), 'incomplete.zip');
  assert.throws(() => verifyPackage({ archivePath: incomplete }), /Required DFT source file is missing: requirements/);
});

test('DFT package rejects dependency lockfiles for a different application version', t => {
  const { root } = fixture(t);
  const lockfile = path.join(root, 'package-lock.json'), lock = JSON.parse(fs.readFileSync(lockfile, 'utf8'));
  lock.packages[''].version = '1.1.0';
  fs.writeFileSync(lockfile, JSON.stringify(lock));
  assert.throws(() => buildPackage({ root, allowDirty: true }), /dependency manifests and release version do not match/);
});
