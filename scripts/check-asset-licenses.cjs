'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.wav', '.mp3', '.m4a',
  '.woff', '.woff2', '.ttf', '.otf'
]);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function walk(directory, files = []) {
  if (!(await exists(directory))) return files;
  const entries = await fs.readdir(directory, {withFileTypes: true});
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(target, files);
    else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
  }
  return files;
}

async function nearestManifest(file, assetsRoot) {
  let directory = path.dirname(file);
  while (directory.startsWith(assetsRoot)) {
    const candidate = path.join(directory, 'LICENSES.json');
    if (await exists(candidate)) return candidate;
    if (directory === assetsRoot) break;
    directory = path.dirname(directory);
  }
  return null;
}

async function loadManifest(manifestPath, cache) {
  if (cache.has(manifestPath)) return cache.get(manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    parsed = {assets: []};
  }
  const records = new Map();
  if (Array.isArray(parsed.assets)) {
    for (const record of parsed.assets) {
      if (!record || typeof record.file !== 'string') continue;
      records.set(record.file.split(path.sep).join('/'), record);
    }
  }
  cache.set(manifestPath, records);
  return records;
}

async function digest(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function checkAssetLicenses({root} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('root must be an absolute path');
  const assetsRoot = path.join(root, 'assets');
  const files = await walk(assetsRoot);
  const missing = [];
  const digestMismatches = [];
  const cache = new Map();

  for (const file of files) {
    const displayPath = path.relative(assetsRoot, file).split(path.sep).join('/');
    const manifestPath = await nearestManifest(file, assetsRoot);
    if (!manifestPath) {
      missing.push(displayPath);
      continue;
    }
    const relativeToManifest = path.relative(path.dirname(manifestPath), file).split(path.sep).join('/');
    const record = (await loadManifest(manifestPath, cache)).get(relativeToManifest);
    const validRecord = record && typeof record.license === 'string' && record.license.trim()
      && typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256);
    if (!validRecord) {
      missing.push(displayPath);
      continue;
    }
    if (await digest(file) !== record.sha256) digestMismatches.push(displayPath);
  }

  return {missing: missing.sort(), digestMismatches: digestMismatches.sort()};
}

async function main() {
  const result = await checkAssetLicenses({root: path.resolve(__dirname, '..')});
  if (result.missing.length || result.digestMismatches.length) {
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Asset license records and digests verified.\n');
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = {checkAssetLicenses};
