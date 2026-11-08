'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ThemeValidationError,
  validateThemeDirectory
} = require('../scripts/theme-contract.cjs');

const fixtureRoot = path.join(__dirname, 'fixtures', 'private-theme-valid');
const maxImageBytes = 12 * 1024 * 1024;
const maxSoundtrackBytes = 32 * 1024 * 1024;
const requiredFiles = [
  'ASSET-LICENSE.md',
  'assets.json',
  'boot-mark.webp',
  'rei-portrait.webp',
  'scene-a-sync.webp',
  'scene-b-awakening.webp',
  'scene-c-online.webp',
  'startup-reference.wav',
  'theme.json'
].sort();
const allowedCodes = new Set([
  'THEME_ROOT',
  'THEME_FILE_SET',
  'THEME_SYMLINK',
  'THEME_FILE_TYPE',
  'THEME_SIZE',
  'THEME_JSON',
  'THEME_SCHEMA',
  'THEME_PATH',
  'THEME_HASH'
]);

async function isolatedTheme(t) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-theme-'));
  t.after(() => fs.rm(temporaryRoot, {recursive: true, force: true}));
  const themeRoot = path.join(temporaryRoot, 'theme');
  await fs.cp(fixtureRoot, themeRoot, {recursive: true});
  return {temporaryRoot, themeRoot};
}

async function readJson(themeRoot, file) {
  return JSON.parse(await fs.readFile(path.join(themeRoot, file), 'utf8'));
}

async function writeJson(themeRoot, file, value) {
  await fs.writeFile(path.join(themeRoot, file), `${JSON.stringify(value, null, 2)}\n`);
}

async function expectThemeError(promise, code, {file = null, root = null, forbidden = []} = {}) {
  let error;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ThemeValidationError, `expected ThemeValidationError, got ${error}`);
  assert.equal(allowedCodes.has(error.code), true);
  assert.equal(error.code, code);
  assert.equal(error.file, file);
  assert.equal(error.message, file ? `${code}: ${file}` : code);
  if (root) assert.equal(error.message.includes(root), false);
  for (const value of forbidden.filter(Boolean)) {
    assert.equal(error.message.includes(value), false);
  }
}

test('accepts the exact synthetic private theme contract without depending on cwd', async t => {
  const {themeRoot} = await isolatedTheme(t);
  const result = await validateThemeDirectory(themeRoot);

  assert.equal(result.root, await fs.realpath(themeRoot));
  assert.equal(result.id, 'test-private');
  assert.equal(result.displayName, 'PROJECT ZERO // TEST PRIVATE THEME');
  assert.deepEqual(result.scenes, {
    awakening: 'scene-b-awakening.webp',
    synchronization: 'scene-a-sync.webp',
    online: 'scene-c-online.webp'
  });
  assert.deepEqual(result.boot, {
    mark: 'boot-mark.webp',
    portrait: 'rei-portrait.webp',
    soundtrack: 'startup-reference.wav',
    audioStartMs: 0,
    audioEndMs: 20500
  });
  assert.deepEqual(result.files, requiredFiles);
  assert.deepEqual([...result.contents.keys()].sort(), requiredFiles);
  for (const value of result.contents.values()) assert.equal(Buffer.isBuffer(value), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scenes), true);
  assert.equal(Object.isFrozen(result.boot), true);
  assert.equal(result.contents instanceof Map, true);
  assert.equal(Object.isFrozen(result.contents), true);
  assert.equal(Object.isFrozen(result.files), true);

  const returnedBytes = result.contents.get('boot-mark.webp');
  const firstByte = returnedBytes[0];
  returnedBytes[0] ^= 0xff;
  assert.equal(result.contents.get('boot-mark.webp')[0], firstByte);
  assert.throws(() => result.contents.set('boot-mark.webp', Buffer.from('replacement')), TypeError);
  assert.throws(() => { result.boot.mark = 'replacement.webp'; }, TypeError);
});

test('accepts an exact m4a soundtrack alternative', async t => {
  const {themeRoot} = await isolatedTheme(t);
  await fs.rename(
    path.join(themeRoot, 'startup-reference.wav'),
    path.join(themeRoot, 'startup-reference.m4a')
  );
  const theme = await readJson(themeRoot, 'theme.json');
  theme.boot.soundtrack = 'startup-reference.m4a';
  await writeJson(themeRoot, 'theme.json', theme);
  const manifest = await readJson(themeRoot, 'assets.json');
  manifest.assets.find(asset => asset.file === 'startup-reference.wav').file =
    'startup-reference.m4a';
  await writeJson(themeRoot, 'assets.json', manifest);

  const result = await validateThemeDirectory(themeRoot);
  assert.equal(result.boot.soundtrack, 'startup-reference.m4a');
  assert.equal(result.files.includes('startup-reference.m4a'), true);
  assert.equal(result.files.includes('startup-reference.wav'), false);
});

test('rejects missing and extra top-level files with a stable file-set error', async t => {
  await t.test('missing file', async subtest => {
    const {themeRoot} = await isolatedTheme(subtest);
    await fs.rm(path.join(themeRoot, 'ASSET-LICENSE.md'));
    await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_FILE_SET', {root: themeRoot});
  });
  await t.test('extra file', async subtest => {
    const {themeRoot} = await isolatedTheme(subtest);
    await fs.writeFile(path.join(themeRoot, 'extra.txt'), 'not allowed');
    await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_FILE_SET', {root: themeRoot});
  });
});

test('rejects missing, non-directory, and symlinked theme roots without leaking paths', async t => {
  const {temporaryRoot, themeRoot} = await isolatedTheme(t);
  const missingRoot = path.join(temporaryRoot, 'missing-private-theme');
  await expectThemeError(validateThemeDirectory(missingRoot), 'THEME_ROOT', {root: missingRoot});

  const regularRoot = path.join(temporaryRoot, 'regular-file');
  await fs.writeFile(regularRoot, 'not a directory');
  await expectThemeError(validateThemeDirectory(regularRoot), 'THEME_ROOT', {root: regularRoot});

  const linkedRoot = path.join(temporaryRoot, 'linked-theme');
  await fs.symlink(themeRoot, linkedRoot, 'dir');
  await expectThemeError(validateThemeDirectory(linkedRoot), 'THEME_ROOT', {root: linkedRoot});
});

test('rejects a symlink in every required file position', async t => {
  for (const file of requiredFiles) {
    await t.test(file, async subtest => {
      const {temporaryRoot, themeRoot} = await isolatedTheme(subtest);
      const outside = path.join(temporaryRoot, `outside-${file.replaceAll('/', '-')}`);
      await fs.writeFile(outside, 'outside theme content');
      await fs.rm(path.join(themeRoot, file));
      await fs.symlink(outside, path.join(themeRoot, file));
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SYMLINK', {
        file,
        root: themeRoot
      });
    });
  }
});

test('rejects a directory in every required file position', async t => {
  for (const file of requiredFiles) {
    await t.test(file, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      await fs.rm(path.join(themeRoot, file));
      await fs.mkdir(path.join(themeRoot, file));
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_FILE_TYPE', {
        file,
        root: themeRoot
      });
    });
  }
});

test('rejects extra keys at every manifest object boundary without echoing payloads', async t => {
  const cases = [
    ['theme top level', 'theme.json', value => { value.untrustedPayload = 'TOP_LEVEL_SECRET'; }],
    ['scene map', 'theme.json', value => { value.scenes.untrusted = 'SCENE_SECRET'; }],
    ['boot map', 'theme.json', value => { value.boot.untrusted = 'BOOT_SECRET'; }],
    ['asset manifest', 'assets.json', value => { value.untrustedPayload = 'ASSET_TOP_SECRET'; }],
    ['asset entry', 'assets.json', value => { value.assets[0].untrusted = 'ASSET_ENTRY_SECRET'; }]
  ];
  for (const [name, file, mutate] of cases) {
    await t.test(name, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const value = await readJson(themeRoot, file);
      mutate(value);
      await writeJson(themeRoot, file, value);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SCHEMA', {
        file: file === 'assets.json' ? 'assets.json' : null,
        root: themeRoot,
        forbidden: [
          'TOP_LEVEL_SECRET', 'SCENE_SECRET', 'BOOT_SECRET',
          'ASSET_TOP_SECRET', 'ASSET_ENTRY_SECRET'
        ]
      });
    });
  }
});

test('requires every exact boot identity field', async t => {
  for (const field of ['mark', 'portrait', 'soundtrack']) {
    await t.test(field, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const theme = await readJson(themeRoot, 'theme.json');
      delete theme.boot[field];
      await writeJson(themeRoot, 'theme.json', theme);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SCHEMA', {
        root: themeRoot
      });
    });
  }
});

test('rejects boot paths and extensions outside the fixed contract', async t => {
  const cases = [
    ['mark extension', 'mark', 'boot-mark.png'],
    ['portrait extension', 'portrait', 'rei-portrait.jpg'],
    ['soundtrack extension', 'soundtrack', 'startup-reference.mp3'],
    ['mark escape', 'mark', '../boot-mark.webp'],
    ['portrait nesting', 'portrait', 'nested/rei-portrait.webp'],
    ['soundtrack absolute path', 'soundtrack', '/private/startup-reference.wav']
  ];
  for (const [name, field, value] of cases) {
    await t.test(name, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const theme = await readJson(themeRoot, 'theme.json');
      theme.boot[field] = value;
      await writeJson(themeRoot, 'theme.json', theme);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_PATH', {
        root: themeRoot,
        forbidden: [value]
      });
    });
  }
});

test('rejects invalid and overlong audio segments', async t => {
  const cases = [
    ['negative start', -1, 20_500],
    ['equal endpoints', 20_500, 20_500],
    ['reversed endpoints', 20_500, 20_499],
    ['over 30 seconds', 0, 30_001],
    ['fractional start', 0.5, 20_500],
    ['non-numeric end', 0, '20500']
  ];
  for (const [name, audioStartMs, audioEndMs] of cases) {
    await t.test(name, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const theme = await readJson(themeRoot, 'theme.json');
      theme.boot.audioStartMs = audioStartMs;
      theme.boot.audioEndMs = audioEndMs;
      await writeJson(themeRoot, 'theme.json', theme);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SCHEMA', {
        root: themeRoot
      });
    });
  }
});

test('rejects malformed JSON using one redacted stable code', async t => {
  for (const file of ['theme.json', 'assets.json']) {
    await t.test(file, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const payload = '{"leaked":"MANIFEST_PAYLOAD"';
      await fs.writeFile(path.join(themeRoot, file), payload);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_JSON', {
        root: themeRoot,
        forbidden: [payload, 'MANIFEST_PAYLOAD']
      });
    });
  }
});

test('rejects invalid display names without including their value in the error', async t => {
  const invalidNames = ['', 'line one\nline two', 'nul\0byte', 'x'.repeat(97), 42];
  for (const displayName of invalidNames) {
    await t.test(JSON.stringify(displayName), async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const theme = await readJson(themeRoot, 'theme.json');
      theme.displayName = displayName;
      await writeJson(themeRoot, 'theme.json', theme);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SCHEMA', {
        root: themeRoot,
        forbidden: [String(displayName)]
      });
    });
  }
});

test('rejects scene path escapes and non-basename selections', async t => {
  for (const selected of [
    '../scene-a-sync.webp',
    '/private/scene-a-sync.webp',
    'nested/scene-a-sync.webp',
    'not-a-scene.webp'
  ]) {
    await t.test(selected, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      const theme = await readJson(themeRoot, 'theme.json');
      theme.scenes.synchronization = selected;
      await writeJson(themeRoot, 'theme.json', theme);
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_PATH', {
        root: themeRoot,
        forbidden: [selected]
      });
    });
  }
});

test('rejects duplicate scene file selections', async t => {
  const {themeRoot} = await isolatedTheme(t);
  const theme = await readJson(themeRoot, 'theme.json');
  theme.scenes.online = theme.scenes.awakening;
  await writeJson(themeRoot, 'theme.json', theme);
  await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_PATH', {root: themeRoot});
});

test('enforces separate bounded sizes for text, image, and soundtrack files', async t => {
  await t.test('text limit', async subtest => {
    const {themeRoot} = await isolatedTheme(subtest);
    await expectThemeError(
      validateThemeDirectory(themeRoot, {maxTextBytes: 1}),
      'THEME_SIZE',
      {file: 'theme.json', root: themeRoot}
    );
  });
  await t.test('image limit', async subtest => {
    const {themeRoot} = await isolatedTheme(subtest);
    await fs.truncate(path.join(themeRoot, 'boot-mark.webp'), maxImageBytes + 1);
    await expectThemeError(
      validateThemeDirectory(themeRoot),
      'THEME_SIZE',
      {file: 'boot-mark.webp', root: themeRoot}
    );
  });
  await t.test('soundtrack limit', async subtest => {
    const {themeRoot} = await isolatedTheme(subtest);
    await fs.truncate(path.join(themeRoot, 'startup-reference.wav'), maxSoundtrackBytes + 1);
    await expectThemeError(
      validateThemeDirectory(themeRoot),
      'THEME_SIZE',
      {file: 'startup-reference.wav', root: themeRoot}
    );
  });
});

test('rejects image and soundtrack content whose SHA-256 does not match', async t => {
  for (const file of ['scene-a-sync.webp', 'boot-mark.webp', 'startup-reference.wav']) {
    await t.test(file, async subtest => {
      const {themeRoot} = await isolatedTheme(subtest);
      await fs.writeFile(path.join(themeRoot, file), 'changed synthetic bytes');
      await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_HASH', {
        file,
        root: themeRoot
      });
    });
  }
});

test('requires assets.json to cover all six binary files exactly once', async t => {
  const {themeRoot} = await isolatedTheme(t);
  const assets = await readJson(themeRoot, 'assets.json');
  assets.assets[5] = {...assets.assets[0]};
  await writeJson(themeRoot, 'assets.json', assets);
  await expectThemeError(validateThemeDirectory(themeRoot), 'THEME_SCHEMA', {
    file: 'assets.json',
    root: themeRoot
  });
});

test('does not follow a theme file swapped to an outside symlink before reading', async t => {
  const {temporaryRoot, themeRoot} = await isolatedTheme(t);
  const realRoot = await fs.realpath(themeRoot);
  const themeTarget = path.join(realRoot, 'theme.json');
  const outsideTheme = path.join(temporaryRoot, 'outside-theme.json');
  const outsidePayload = await readJson(themeRoot, 'theme.json');
  outsidePayload.displayName = 'OUTSIDE SYMLINK PAYLOAD';
  await writeJson(temporaryRoot, 'outside-theme.json', outsidePayload);
  let swapped = false;
  let outsideBytesRead = false;

  async function swapLeaf() {
    if (swapped) return;
    swapped = true;
    await fs.rm(themeTarget);
    await fs.symlink(outsideTheme, themeTarget);
  }

  const fsModule = {
    ...fs,
    async open(target, ...arguments_) {
      if (target === themeTarget) await swapLeaf();
      return fs.open(target, ...arguments_);
    },
    async readFile(target, ...arguments_) {
      if (target === themeTarget) {
        await swapLeaf();
        outsideBytesRead = true;
      }
      return fs.readFile(target, ...arguments_);
    }
  };

  await expectThemeError(
    validateThemeDirectory(themeRoot, {fsModule}),
    'THEME_SYMLINK',
    {file: 'theme.json', root: themeRoot, forbidden: ['OUTSIDE SYMLINK PAYLOAD']}
  );
  assert.equal(outsideBytesRead, false);
});

test('rejects a theme root whose directory identity changes during validation', async t => {
  const {temporaryRoot, themeRoot} = await isolatedTheme(t);
  const realRoot = await fs.realpath(themeRoot);
  const themeTarget = path.join(realRoot, 'theme.json');
  const movedRoot = path.join(temporaryRoot, 'original-theme-moved');
  const replacementRoot = path.join(temporaryRoot, 'replacement-theme');
  await fs.cp(fixtureRoot, replacementRoot, {recursive: true});
  const replacementTheme = await readJson(replacementRoot, 'theme.json');
  replacementTheme.displayName = 'OUTSIDE ROOT PAYLOAD';
  await writeJson(replacementRoot, 'theme.json', replacementTheme);
  let swapped = false;
  let replacementBytesReadByPath = false;

  async function swapRoot() {
    if (swapped) return;
    swapped = true;
    await fs.rename(themeRoot, movedRoot);
    await fs.rename(replacementRoot, themeRoot);
  }

  const fsModule = {
    ...fs,
    async open(target, ...arguments_) {
      if (target === themeTarget) await swapRoot();
      return fs.open(target, ...arguments_);
    },
    async readFile(target, ...arguments_) {
      if (target === themeTarget) {
        await swapRoot();
        replacementBytesReadByPath = true;
      }
      return fs.readFile(target, ...arguments_);
    }
  };

  await expectThemeError(
    validateThemeDirectory(themeRoot, {fsModule}),
    'THEME_ROOT',
    {root: themeRoot, forbidden: ['OUTSIDE ROOT PAYLOAD']}
  );
  assert.equal(replacementBytesReadByPath, false);
});
