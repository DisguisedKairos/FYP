'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');

const ROOT_FILES = new Set(['package.json', 'package-lock.json', 'app.js', 'db.js', 'main.py', 'requirements.txt', '.env.example', '.gitignore', 'README.md', 'models/errors.js', 'services/fraud/features.js', 'services/fraud/model.json']);
const ROOT_DIRECTORIES = new Set(['banking', 'database', 'fraud_service', 'public', 'views', 'scripts', 'datasets', 'tests', 'tests_python', 'docs']);
const EXCLUDED_DIRECTORIES = new Set(['legacy', 'cloud', '.github', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', 'site-packages', '.git', '.terraform', '.terraform.d', 'node_modules', 'data', 'prototype', 'retired-site', 'releases', 'release', 'releaseoutputs', 'test-results', 'coverage', 'dist', '.wrangler', '.sites-runtime', '.openai', '.aws', '.ssh', '.codex', '.agents', 'secrets', 'tmp', '.tmp']);
const REQUIRED_FILES = new Set(['package.json', 'package-lock.json', 'app.js', 'db.js', 'main.py', 'requirements.txt', 'README.md', '.env.example', 'banking/auth.js', 'banking/business.js', 'banking/security.js', 'banking/totp.js', 'banking/ledger.js', 'banking/risk.js', 'database/index.js', 'database/setup.js', 'database/check.js', 'database/permissions.js', 'database/local.js', 'database/admin.env.example', 'docs/database.md', 'database/migrations/001_initial.sql', 'database/migrations/005_wholesale_businesses.sql', 'public/js/business.js', 'scripts/create-staff.js', 'fraud_service/__init__.py', 'fraud_service/application.py', 'fraud_service/model.py', 'fraud_service/schemas.py', 'fraud_service/model.sha256', 'models/errors.js', 'services/fraud/features.js', 'services/fraud/model.json', 'public/app.js', 'public/styles.css', 'views/index.html', 'scripts/start-platform.js']);
const MANIFEST_NAME = 'PACKAGE-MANIFEST.json';
const MAX_FILES = 10000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[n] = value >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function assertSafeArchivePath(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.endsWith('/')) throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  if (name.split('/').some(part => !part || part === '.' || part === '..') || path.posix.normalize(name) !== name) throw new Error(`Unsafe archive path: ${JSON.stringify(name)}`);
  return name;
}
function excludedName(name) {
  const lower = name.toLowerCase();
  return EXCLUDED_DIRECTORIES.has(lower) || /\.py[co]$/i.test(name) || /^Dockerfile(?:\.|$)|^compose\..*\.ya?ml$/i.test(name) || /^\.env(?:\.|$)/i.test(name) || /^(?:credentials?|secrets?|tokens?)(?:\.|$)/i.test(name) || /^id_(?:rsa|ed25519|ecdsa)(?:\.|$)/i.test(name) || /^\.terraformrc$/i.test(name) || /\.tfstate(?:\.|$)|\.tfplan(?:\.|$)/i.test(name) || (/\.tfvars(?:\.|$)/i.test(name) && !/\.tfvars\.example$/i.test(name)) || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(name) || /\.(?:pem|key|p12|pfx|log|zip)(?:\.sha256)?$/i.test(name);
}
function isPackageDirectoryAllowed(name) {
  assertSafeArchivePath(name);
  const parts = name.split('/');
  return ROOT_DIRECTORIES.has(parts[0]) && !parts.some(excludedName);
}
function isPackagePathAllowed(name) {
  assertSafeArchivePath(name);
  if (ROOT_FILES.has(name)) return true;
  const parts = name.split('/');
  if (parts[0] === 'tests' && parts.length === 2 && !/^dft[-.]/.test(parts[1]) && !['browser.e2e.js', 'chrome.js'].includes(parts[1])) return false;
  return parts.length > 1 && ROOT_DIRECTORIES.has(parts[0]) && !parts.some(excludedName);
}
function range(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) throw new Error(`Truncated ZIP ${label}.`);
}
function decodeName(bytes) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) throw new Error('ZIP filename is not valid UTF-8.');
  return assertSafeArchivePath(value);
}

// The verifier reads bounded buffers and never extracts a path to the filesystem.
function readZip(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_ARCHIVE_BYTES || bytes.length < 22) throw new Error('Unsupported ZIP archive size.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error('ZIP end-of-central-directory signature is missing.');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) throw new Error('Multi-disk ZIP archives are unsupported.');
  if (!count || count > MAX_FILES || centralOffset === 0xffffffff || centralSize === 0xffffffff || centralOffset + centralSize !== end) throw new Error('Invalid ZIP central-directory bounds.');
  range(bytes, centralOffset, centralSize, 'central directory');
  const files = new Map(), names = new Set(), localRanges = [];
  let offset = centralOffset, total = 0;
  for (let index = 0; index < count; index++) {
    range(bytes, offset, 46, 'central header');
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central-header signature.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), checksum = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24), nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32), localOffset = bytes.readUInt32LE(offset + 42);
    if (flags !== 0x800 || ![0, 8].includes(method) || bytes.readUInt16LE(offset + 34) || compressedSize === 0xffffffff || size > MAX_ENTRY_BYTES) throw new Error('Unsupported ZIP entry settings.');
    range(bytes, offset + 46, nameLength + extraLength + commentLength, 'entry name');
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength), name = decodeName(rawName), folded = name.toLowerCase();
    if (names.has(folded)) throw new Error(`Duplicate archive path: ${name}`);
    names.add(folded);
    if (name !== MANIFEST_NAME && !isPackagePathAllowed(name)) throw new Error(`Package path is not allowlisted: ${name}`);
    const unixType = (bytes.readUInt32LE(offset + 38) >>> 16) & 0o170000;
    if (unixType && unixType !== 0o100000) throw new Error(`Non-regular ZIP entry: ${name}`);
    range(bytes, localOffset, 30, 'local header');
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP local-header signature.');
    if (bytes.readUInt16LE(localOffset + 6) !== flags || bytes.readUInt16LE(localOffset + 8) !== method || bytes.readUInt32LE(localOffset + 14) !== checksum || bytes.readUInt32LE(localOffset + 18) !== compressedSize || bytes.readUInt32LE(localOffset + 22) !== size) throw new Error(`ZIP header mismatch: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26), localExtraLength = bytes.readUInt16LE(localOffset + 28), dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    range(bytes, localOffset + 30, localNameLength + localExtraLength, 'local name');
    if (!bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(rawName)) throw new Error('ZIP local filename differs from central filename.');
    range(bytes, dataOffset, compressedSize, 'entry data');
    if (dataOffset + compressedSize > centralOffset) throw new Error('ZIP file data overlaps its central directory.');
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('ZIP uncompressed data exceeds the verification limit.');
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    try { content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES }); }
    catch { throw new Error(`Cannot inflate ZIP entry: ${name}`); }
    if (content.length !== size || crc32(content) !== checksum) throw new Error(`ZIP CRC or size mismatch: ${name}`);
    files.set(name, content); localRanges.push({ start: localOffset, end: dataOffset + compressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) throw new Error('ZIP central-directory length mismatch.');
  localRanges.sort((a, b) => a.start - b.start);
  let boundary = 0;
  for (const entry of localRanges) { if (entry.start !== boundary) throw new Error('ZIP local entries overlap or contain unlisted data.'); boundary = entry.end; }
  if (boundary !== centralOffset) throw new Error('ZIP contains unlisted local data.');
  return files;
}
function verifyManifest(files) {
  const content = files.get(MANIFEST_NAME);
  if (!content) throw new Error('Package manifest is missing.');
  let manifest;
  try { manifest = JSON.parse(content.toString('utf8')); } catch { throw new Error('Package manifest is not valid JSON.'); }
  if (manifest.schemaVersion !== 1 || manifest.name !== 'greenlink-digital-bank' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || '') || !/^[a-f0-9]{40,64}$/.test(manifest.gitCommit || '') || typeof manifest.sourceDirty !== 'boolean' || !Array.isArray(manifest.files)) throw new Error('Package manifest metadata is invalid.');
  if (manifest.files.length !== files.size - 1) throw new Error('Manifest file count does not match the archive.');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!entry || !isPackagePathAllowed(entry.path) || seen.has(entry.path)) throw new Error('Manifest contains an invalid or duplicate path.');
    seen.add(entry.path);
    const bytes = files.get(entry.path);
    if (!bytes || !Number.isSafeInteger(entry.size) || entry.size !== bytes.length || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || sha256(bytes) !== entry.sha256) throw new Error(`Manifest hash or size mismatch: ${entry.path}`);
  }
  for (const required of REQUIRED_FILES) if (!files.has(required)) throw new Error(`Required DFT source file is missing: ${required}`);
  let config, lock;
  try { config = JSON.parse(files.get('package.json').toString('utf8').replace(/^\uFEFF/, '')); lock = JSON.parse(files.get('package-lock.json').toString('utf8').replace(/^\uFEFF/, '')); } catch { throw new Error('Package dependency manifests must contain valid JSON.'); }
  if (config.name !== manifest.name || config.version !== manifest.version || lock.name !== config.name || lock.version !== config.version || lock.packages?.['']?.version !== config.version) throw new Error('Package dependency manifests and release version do not match.');
  return manifest;
}
function verifyPackage({ archivePath, checksumPath = `${archivePath}.sha256`, requireChecksum = true } = {}) {
  if (!archivePath) throw new Error('Supply an archivePath.');
  const absolute = path.resolve(archivePath), stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Unsupported ZIP archive size.');
  const bytes = fs.readFileSync(absolute), files = readZip(bytes), manifest = verifyManifest(files), hash = sha256(bytes);
  if (requireChecksum) {
    const line = fs.readFileSync(checksumPath, 'utf8').trim();
    const match = line.match(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/i);
    if (!match || match[1].toLowerCase() !== hash || match[2] !== path.basename(absolute)) throw new Error('Archive SHA-256 checksum does not match its companion file.');
  }
  return { valid: true, archivePath: absolute, sha256: hash, fileCount: manifest.files.length, totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0), manifest };
}
module.exports = { verifyPackage, readZip, verifyManifest, crc32, sha256, assertSafeArchivePath, isPackagePathAllowed, isPackageDirectoryAllowed, ROOT_DIRECTORIES, ROOT_FILES, REQUIRED_FILES, MANIFEST_NAME, MAX_FILES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const version = require('../package.json').version;
    const archivePath = args[0] || path.resolve(__dirname, '..', 'releases', `greenlink-digital-bank-${version}.zip`);
    const result = verifyPackage({ archivePath, ...(args[1] ? { checksumPath: args[1] } : {}) });
    console.log(`Verified ${path.basename(result.archivePath)}: ${result.fileCount} source files, SHA-256 ${result.sha256}`);
  } catch (error) { console.error(`Package verification failed: ${error.message}`); process.exitCode = 1; }
}
