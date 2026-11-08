'use strict';

const crypto = require('node:crypto');
const defaultFs = require('node:fs/promises');
const path = require('node:path');

const SCENE_FILES = Object.freeze([
  'scene-a-sync.webp',
  'scene-b-awakening.webp',
  'scene-c-online.webp'
]);
const REQUIRED_FILES = Object.freeze([
  'ASSET-LICENSE.md',
  'assets.json',
  ...SCENE_FILES,
  'theme.json'
].sort());

class ThemeValidationError extends Error {
  constructor(code, file = null) {
    super(file ? `${code}: ${file}` : code);
    this.name = 'ThemeValidationError';
    this.code = code;
    this.file = file;
  }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function readBoundedRegularFile(root, file, limit, fsModule) {
  const target = path.join(root, file);
  const stat = await fsModule.lstat(target).catch(() => null);
  if (!stat) throw new ThemeValidationError('THEME_FILE_SET', file);
  if (stat.isSymbolicLink()) throw new ThemeValidationError('THEME_SYMLINK', file);
  if (!stat.isFile()) throw new ThemeValidationError('THEME_FILE_TYPE', file);
  if (stat.size > limit) throw new ThemeValidationError('THEME_SIZE', file);
  try {
    return await fsModule.readFile(target);
  } catch {
    throw new ThemeValidationError('THEME_FILE_SET', file);
  }
}

async function validateThemeDirectory(themeRoot, {
  fsModule = defaultFs,
  maxWebpBytes = 12 * 1024 * 1024,
  maxTextBytes = 256 * 1024
} = {}) {
  const rootStat = await fsModule.lstat(themeRoot).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ThemeValidationError('THEME_ROOT');
  }

  let root;
  let entries;
  try {
    root = await fsModule.realpath(themeRoot);
    entries = (await fsModule.readdir(root)).sort();
  } catch {
    throw new ThemeValidationError('THEME_ROOT');
  }
  if (JSON.stringify(entries) !== JSON.stringify(REQUIRED_FILES)) {
    throw new ThemeValidationError('THEME_FILE_SET');
  }

  const themeBytes = await readBoundedRegularFile(root, 'theme.json', maxTextBytes, fsModule);
  const assetBytes = await readBoundedRegularFile(root, 'assets.json', maxTextBytes, fsModule);
  const noticeBytes = await readBoundedRegularFile(
    root,
    'ASSET-LICENSE.md',
    maxTextBytes,
    fsModule
  );
  let theme;
  let assetManifest;
  try {
    theme = JSON.parse(themeBytes);
    assetManifest = JSON.parse(assetBytes);
  } catch {
    throw new ThemeValidationError('THEME_JSON');
  }

  if (!exactKeys(
    theme,
    ['schemaVersion', 'id', 'displayName', 'scenes', 'assetManifest', 'artNotice']
  ) || theme.schemaVersion !== 1 ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(theme.id) ||
      typeof theme.displayName !== 'string' || theme.displayName.length < 1 ||
      theme.displayName.length > 96 || /[\r\n\0]/.test(theme.displayName) ||
      theme.assetManifest !== 'assets.json' || theme.artNotice !== 'ASSET-LICENSE.md' ||
      !exactKeys(theme.scenes, ['awakening', 'synchronization', 'online'])) {
    throw new ThemeValidationError('THEME_SCHEMA');
  }

  const selected = Object.values(theme.scenes);
  if (new Set(selected).size !== 3 || selected.some(file =>
    typeof file !== 'string' || path.basename(file) !== file || !SCENE_FILES.includes(file)
  )) {
    throw new ThemeValidationError('THEME_PATH');
  }

  if (!exactKeys(assetManifest, ['schemaVersion', 'assets']) ||
      assetManifest.schemaVersion !== 1 || !Array.isArray(assetManifest.assets) ||
      assetManifest.assets.length !== 3) {
    throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
  }

  const hashes = new Map();
  const contents = new Map([
    ['theme.json', Buffer.from(themeBytes)],
    ['assets.json', Buffer.from(assetBytes)],
    ['ASSET-LICENSE.md', Buffer.from(noticeBytes)]
  ]);
  for (const file of SCENE_FILES) {
    const bytes = await readBoundedRegularFile(root, file, maxWebpBytes, fsModule);
    hashes.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
    contents.set(file, Buffer.from(bytes));
  }

  for (const asset of assetManifest.assets) {
    if (!exactKeys(asset, ['file', 'sha256']) || !SCENE_FILES.includes(asset.file) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
    }
    if (hashes.get(asset.file) !== asset.sha256) {
      throw new ThemeValidationError('THEME_HASH', asset.file);
    }
  }
  if (new Set(assetManifest.assets.map(asset => asset.file)).size !== 3) {
    throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
  }

  return Object.freeze({
    root,
    id: theme.id,
    displayName: theme.displayName,
    scenes: Object.freeze({...theme.scenes}),
    files: Object.freeze([...REQUIRED_FILES]),
    contents
  });
}

module.exports = {ThemeValidationError, validateThemeDirectory};
