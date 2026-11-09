'use strict';

const crypto = require('node:crypto');
const {constants} = require('node:fs');
const defaultFs = require('node:fs/promises');
const path = require('node:path');

const IMAGE_FILES = Object.freeze([
  'scene-a-sync.webp',
  'scene-b-awakening.webp',
  'scene-c-online.webp',
  'boot-mark.webp',
  'rei-portrait.webp'
]);
const SCENE_FILES = Object.freeze(IMAGE_FILES.slice(0, 3));
const SOUNDTRACK_EXTENSIONS = new Set(['.wav', '.m4a']);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOUNDTRACK_BYTES = 32 * 1024 * 1024;
const MAX_AUDIO_SEGMENT_MS = 30_000;

function createFrozenContents(entries) {
  const snapshot = new Map(
    [...entries].map(([file, bytes]) => [file, Buffer.from(bytes)])
  );
  const readOnly = () => {
    throw new TypeError('THEME_CONTENTS_READ_ONLY');
  };
  const get = file => {
    const bytes = snapshot.get(file);
    return bytes === undefined ? undefined : Buffer.from(bytes);
  };
  const has = file => snapshot.has(file);
  const keys = () => snapshot.keys();
  const values = function* values() {
    for (const bytes of snapshot.values()) yield Buffer.from(bytes);
  };
  const contentEntries = function* contentEntries() {
    for (const [file, bytes] of snapshot) yield [file, Buffer.from(bytes)];
  };
  let contents;
  const forEach = (callback, thisArgument) => {
    for (const [file, bytes] of snapshot) {
      callback.call(thisArgument, Buffer.from(bytes), file, contents);
    }
  };
  const methods = new Map([
    ['get', get],
    ['has', has],
    ['keys', keys],
    ['values', values],
    ['entries', contentEntries],
    ['forEach', forEach],
    ['set', readOnly],
    ['delete', readOnly],
    ['clear', readOnly]
  ]);
  const target = new Map();
  contents = new Proxy(target, {
    get(map, property) {
      if (property === 'size') return snapshot.size;
      if (property === Symbol.iterator) return contentEntries;
      if (methods.has(property)) return methods.get(property);
      return Reflect.get(map, property, map);
    }
  });
  return Object.freeze(contents);
}

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
  let handle;
  try {
    handle = await fsModule.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    const rejectedStat = await fsModule.lstat(target).catch(() => null);
    if (rejectedStat?.isSymbolicLink()) {
      throw new ThemeValidationError('THEME_SYMLINK', file);
    }
    if (rejectedStat && !rejectedStat.isFile()) {
      throw new ThemeValidationError('THEME_FILE_TYPE', file);
    }
    throw new ThemeValidationError('THEME_FILE_SET', file);
  }

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ThemeValidationError('THEME_FILE_TYPE', file);
    if (stat.size > limit) throw new ThemeValidationError('THEME_SIZE', file);
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new ThemeValidationError('THEME_SIZE', file);
    return bytes;
  } catch (error) {
    if (error instanceof ThemeValidationError) throw error;
    throw new ThemeValidationError('THEME_FILE_SET', file);
  } finally {
    await handle.close().catch(() => {});
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function currentRootMatches(themeRoot, root, identity, rootHandle, fsModule) {
  try {
    const heldStat = await rootHandle.stat();
    if (!heldStat.isDirectory() || !sameIdentity(heldStat, identity)) return false;
    const pathStat = await fsModule.lstat(themeRoot);
    if (pathStat.isSymbolicLink() || !pathStat.isDirectory() ||
        !sameIdentity(pathStat, identity)) return false;
    return await fsModule.realpath(themeRoot) === root;
  } catch {
    return false;
  }
}

async function validateThemeDirectory(themeRoot, {
  fsModule = defaultFs,
  maxTextBytes = 256 * 1024
} = {}) {
  // O_NOFOLLOW makes each leaf open atomic with respect to path replacement.
  // Node has no portable openat API, so a held root handle plus before/after
  // dev/ino checks detects lasting root swaps, but not a same-permission attacker
  // that swaps the directory back before the final identity check.
  let rootHandle;
  let rootIdentity;
  try {
    rootHandle = await fsModule.open(
      themeRoot,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    rootIdentity = await rootHandle.stat();
  } catch {
    await rootHandle?.close().catch(() => {});
    throw new ThemeValidationError('THEME_ROOT');
  }
  if (!rootIdentity.isDirectory()) {
    await rootHandle.close().catch(() => {});
    throw new ThemeValidationError('THEME_ROOT');
  }

  let root;
  let entries;
  try {
    root = await fsModule.realpath(themeRoot);
    if (!await currentRootMatches(themeRoot, root, rootIdentity, rootHandle, fsModule)) {
      throw new ThemeValidationError('THEME_ROOT');
    }
    entries = (await fsModule.readdir(root)).sort();
  } catch (error) {
    await rootHandle.close().catch(() => {});
    if (error instanceof ThemeValidationError) throw error;
    throw new ThemeValidationError('THEME_ROOT');
  }

  try {
    if (!entries.includes('theme.json')) throw new ThemeValidationError('THEME_FILE_SET');
    const themeBytes = await readBoundedRegularFile(root, 'theme.json', maxTextBytes, fsModule);
    let theme;
    try {
      theme = JSON.parse(themeBytes);
    } catch {
      throw new ThemeValidationError('THEME_JSON');
    }

    if (!exactKeys(
      theme,
      ['schemaVersion', 'id', 'displayName', 'scenes', 'boot', 'assetManifest', 'artNotice']
    ) || theme.schemaVersion !== 2 ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(theme.id) ||
        typeof theme.displayName !== 'string' || theme.displayName.length < 1 ||
        theme.displayName.length > 96 || /[\r\n\0]/.test(theme.displayName) ||
        theme.assetManifest !== 'assets.json' || theme.artNotice !== 'ASSET-LICENSE.md' ||
        !exactKeys(theme.scenes, ['awakening', 'synchronization', 'online']) ||
        !exactKeys(
          theme.boot,
          ['mark', 'portrait', 'soundtrack', 'audioStartMs', 'audioEndMs']
        ) || !Number.isSafeInteger(theme.boot.audioStartMs) ||
        !Number.isSafeInteger(theme.boot.audioEndMs) || theme.boot.audioStartMs < 0 ||
        theme.boot.audioEndMs <= theme.boot.audioStartMs ||
        theme.boot.audioEndMs - theme.boot.audioStartMs > MAX_AUDIO_SEGMENT_MS) {
      throw new ThemeValidationError('THEME_SCHEMA');
    }

    const selected = Object.values(theme.scenes);
    if (new Set(selected).size !== 3 || selected.some(file =>
      typeof file !== 'string' || path.basename(file) !== file || !SCENE_FILES.includes(file)
    )) {
      throw new ThemeValidationError('THEME_PATH');
    }

    const soundtrackExtension = typeof theme.boot.soundtrack === 'string'
      ? path.extname(theme.boot.soundtrack)
      : '';
    if (theme.boot.mark !== 'boot-mark.webp' || theme.boot.portrait !== 'rei-portrait.webp' ||
        typeof theme.boot.soundtrack !== 'string' ||
        path.basename(theme.boot.soundtrack) !== theme.boot.soundtrack ||
        path.basename(theme.boot.soundtrack, soundtrackExtension) !== 'startup-reference' ||
        !SOUNDTRACK_EXTENSIONS.has(soundtrackExtension)) {
      throw new ThemeValidationError('THEME_PATH');
    }

    const binaryFiles = [...IMAGE_FILES, theme.boot.soundtrack];
    const requiredFiles = [
      'ASSET-LICENSE.md',
      'assets.json',
      ...binaryFiles,
      'theme.json'
    ].sort();
    if (JSON.stringify(entries) !== JSON.stringify(requiredFiles)) {
      throw new ThemeValidationError('THEME_FILE_SET');
    }

    const assetBytes = await readBoundedRegularFile(root, 'assets.json', maxTextBytes, fsModule);
    const noticeBytes = await readBoundedRegularFile(
      root,
      'ASSET-LICENSE.md',
      maxTextBytes,
      fsModule
    );
    let assetManifest;
    try {
      assetManifest = JSON.parse(assetBytes);
    } catch {
      throw new ThemeValidationError('THEME_JSON');
    }

    if (!exactKeys(assetManifest, ['schemaVersion', 'assets']) ||
        assetManifest.schemaVersion !== 1 || !Array.isArray(assetManifest.assets) ||
        assetManifest.assets.length !== binaryFiles.length) {
      throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
    }

    for (const asset of assetManifest.assets) {
      if (!exactKeys(asset, ['file', 'sha256']) || !binaryFiles.includes(asset.file) ||
          !/^[a-f0-9]{64}$/.test(asset.sha256)) {
        throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
      }
    }
    if (new Set(assetManifest.assets.map(asset => asset.file)).size !== binaryFiles.length) {
      throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
    }

    const hashes = new Map();
    const contentEntries = [
      ['theme.json', Buffer.from(themeBytes)],
      ['assets.json', Buffer.from(assetBytes)],
      ['ASSET-LICENSE.md', Buffer.from(noticeBytes)]
    ];
    for (const file of IMAGE_FILES) {
      const bytes = await readBoundedRegularFile(root, file, MAX_IMAGE_BYTES, fsModule);
      hashes.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
      contentEntries.push([file, Buffer.from(bytes)]);
    }
    const soundtrackBytes = await readBoundedRegularFile(
      root,
      theme.boot.soundtrack,
      MAX_SOUNDTRACK_BYTES,
      fsModule
    );
    hashes.set(
      theme.boot.soundtrack,
      crypto.createHash('sha256').update(soundtrackBytes).digest('hex')
    );
    contentEntries.push([theme.boot.soundtrack, Buffer.from(soundtrackBytes)]);

    for (const asset of assetManifest.assets) {
      if (hashes.get(asset.file) !== asset.sha256) {
        throw new ThemeValidationError('THEME_HASH', asset.file);
      }
    }

    if (!await currentRootMatches(themeRoot, root, rootIdentity, rootHandle, fsModule)) {
      throw new ThemeValidationError('THEME_ROOT');
    }
    return Object.freeze({
      root,
      id: theme.id,
      displayName: theme.displayName,
      scenes: Object.freeze({...theme.scenes}),
      boot: Object.freeze({...theme.boot}),
      files: Object.freeze([...requiredFiles]),
      contents: createFrozenContents(contentEntries)
    });
  } finally {
    await rootHandle.close().catch(() => {});
  }
}

module.exports = {ThemeValidationError, validateThemeDirectory};
