'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { verifyPackage, crc32, sha256, isPackagePathAllowed, isPackageDirectoryAllowed, ROOT_DIRECTORIES, ROOT_FILES, REQUIRED_FILES, MANIFEST_NAME, MAX_FILES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES } = require('./verify-package');

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function git(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Packaging requires a Git checkout with an existing commit.'); }
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function collectSource(root) {
  const files = [];
  let total = 0;
  const realRoot = fs.realpathSync(root);
  function add(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a source symlink or junction: ${relative}`);
    if (!inside(realRoot, fs.realpathSync(absolute))) throw new Error(`Source path escapes the checkout: ${relative}`);
    if (!stat.isFile()) throw new Error(`Expected a regular source file: ${relative}`);
    if (!isPackagePathAllowed(relative)) return;
    if (stat.size > MAX_ENTRY_BYTES) throw new Error(`Source file exceeds the package limit: ${relative}`);
    const content = fs.readFileSync(absolute);
    total += content.length;
    if (total > MAX_TOTAL_BYTES || files.length >= MAX_FILES - 1) throw new Error('Source files exceed the portable package limits.');
    files.push({ path: relative, content });
  }
  function walk(absolute, relative) {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a source symlink or junction: ${relative}`);
    if (!stat.isDirectory() || !inside(realRoot, fs.realpathSync(absolute))) throw new Error(`Source directory escapes the checkout: ${relative}`);
    for (const name of fs.readdirSync(absolute).sort(compare)) {
      const child = path.join(absolute, name), childPath = `${relative}/${name}`, childStat = fs.lstatSync(child);
      if (childStat.isDirectory()) { if (isPackageDirectoryAllowed(childPath)) walk(child, childPath); }
      else if (isPackagePathAllowed(childPath)) add(child, childPath);
    }
  }
  for (const name of [...ROOT_FILES].sort(compare)) {
    const absolute = path.join(root, name);
    if (fs.existsSync(absolute)) add(absolute, name);
  }
  for (const name of [...ROOT_DIRECTORIES].sort(compare)) {
    const absolute = path.join(root, name);
    if (fs.existsSync(absolute)) walk(absolute, name);
  }
  return files.sort((a, b) => compare(a.path, b.path));
}
function createZip(entries) {
  const locals = [], central = [];
  let offset = 0, centralSize = 0;
  for (const entry of [...entries].sort((a, b) => compare(a.path, b.path))) {
    const name = Buffer.from(entry.path, 'utf8'), content = entry.content, compressed = deflateRawSync(content, { level: 9 }), checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    // Fixed DOS epoch: 1980-01-01 00:00. Source mtimes never affect the archive.
    local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0, 12); directory.writeUInt16LE(33, 14); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE((0o100644 << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(directory, name);
    offset += local.length + name.length + compressed.length; centralSize += directory.length + name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
function atomicWrite(filename, bytes) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, filename); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function buildPackage({ root = path.resolve(__dirname, '..'), outputDirectory, allowDirty = false } = {}) {
  root = fs.realpathSync(path.resolve(root));
  const repositoryRoot = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
  if (repositoryRoot.toLowerCase() !== root.toLowerCase()) throw new Error('Build from the root of the source Git checkout.');
  const gitCommit = git(root, ['rev-parse', 'HEAD']).trim();
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(config.version || '')) throw new Error('package.json must contain a portable release version.');
  const files = collectSource(root);
  const included = new Set(files.map(file => file.path));
  for (const required of REQUIRED_FILES) if (!included.has(required)) throw new Error(`Required DFT source file is missing: ${required}`);
  const tracked = new Set(git(root, ['ls-files', '-z']).split('\0').filter(Boolean));
  const dirtyTracked = Boolean(git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim());
  const untrackedSource = files.some(file => !tracked.has(file.path));
  const sourceDirty = dirtyTracked || untrackedSource;
  if (sourceDirty && !allowDirty) throw new Error('Source has tracked changes or untracked package files. Commit the source first, or use --allow-dirty for local verification.');
  const manifest = { schemaVersion: 1, name: 'greenlink-digital-bank', version: config.version, gitCommit, sourceDirty, files: files.map(file => ({ path: file.path, size: file.content.length, sha256: sha256(file.content) })) };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const archive = createZip([...files, { path: MANIFEST_NAME, content: manifestBytes }]);
  outputDirectory = path.resolve(outputDirectory || path.join(root, 'releases'));
  for (const name of ROOT_DIRECTORIES) if (inside(path.join(root, name), outputDirectory)) throw new Error('Release output must stay outside allowlisted source directories.');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, `greenlink-digital-bank-${config.version}.zip`), checksumPath = `${archivePath}.sha256`, hash = sha256(archive);
  atomicWrite(archivePath, archive); atomicWrite(checksumPath, `${hash}  ${path.basename(archivePath)}\n`);
  const verified = verifyPackage({ archivePath, checksumPath });
  return { archivePath, checksumPath, sha256: hash, bytes: archive.length, fileCount: files.length, manifest, verified: verified.valid };
}
module.exports = { buildPackage, createZip, collectSource };
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(argument => argument !== '--allow-dirty')) throw new Error('Usage: node scripts/package.js [--allow-dirty]');
    const result = buildPackage({ allowDirty: args.includes('--allow-dirty') });
    console.log(`Created ${result.archivePath}`);
    console.log(`Verified ${result.fileCount} files, ${result.bytes} bytes, SHA-256 ${result.sha256}${result.manifest.sourceDirty ? ' (local dirty-source build)' : ''}`);
  } catch (error) { console.error(`Package build failed: ${error.message}`); process.exitCode = 1; }
}
