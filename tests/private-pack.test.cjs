'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ThemeValidationError,
  validateThemeDirectory
} = require('../scripts/theme-contract.cjs');

const projectRoot = path.join(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'private-theme-valid');
const publicLabel = 'PROJECT ZERO // PILOT CODEX WORKBENCH';
const projectEntries = [
  'app', 'assets', 'LICENSE', 'NOTICE.md', 'package.json',
  'renderer', 'THIRD_PARTY_NOTICES.md', 'workbench'
].sort();

function loadPacker() {
  return require('../scripts/pack-private-theme.cjs');
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function publicHashes(root) {
  const files = [
    'renderer/boot/index.html',
    'renderer/boot/assets/scene-a-sync.webp',
    'renderer/boot/assets/scene-b-awakening.webp',
    'renderer/boot/assets/scene-c-online.webp',
    'assets/themes/project-zero/assets.json',
    'assets/themes/project-zero/ASSET-LICENSE.md',
    'package.json'
  ];
  return Object.fromEntries(await Promise.all(files.map(async file => [
    file,
    await sha256(path.join(root, file))
  ])));
}

async function isolatedTheme(t) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-pack-theme-'));
  t.after(() => fs.rm(temporaryRoot, {recursive: true, force: true}));
  const themeRoot = path.join(temporaryRoot, 'theme');
  await fs.cp(fixtureRoot, themeRoot, {recursive: true});
  return themeRoot;
}

async function isolatedProject(t, prefix = 'project-zero-pack-project-') {
  const temporaryProject = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(temporaryProject, {recursive: true, force: true}));
  for (const entry of projectEntries) {
    await fs.cp(path.join(projectRoot, entry), path.join(temporaryProject, entry), {recursive: true});
  }
  return temporaryProject;
}

async function expectStablePackFailure(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'PRIVATE_THEME_PACK_FAILED');
    assert.equal(error.message, 'PRIVATE_THEME_PACK_FAILED');
    assert.ok(error.cause instanceof Error);
    return true;
  });
}

test('validates before creating staging and leaves no staging on validation failure', async t => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-pack-order-'));
  t.after(() => fs.rm(temporaryRoot, {recursive: true, force: true}));
  const events = [];
  const fsModule = {
    ...fs,
    async mkdir(...arguments_) {
      events.push('mkdir');
      return fs.mkdir(...arguments_);
    }
  };

  const {packPrivateTheme} = loadPacker();
  await assert.rejects(
    packPrivateTheme({
      projectRoot: temporaryRoot,
      themeRoot: '/invalid-theme',
      fsModule,
      validateTheme: async () => {
        events.push('validate');
        throw new ThemeValidationError('THEME_ROOT');
      }
    }),
    error => error.code === 'THEME_ROOT'
  );
  assert.deepEqual(events, ['validate']);
  await assert.rejects(fs.access(path.join(temporaryRoot, '.private-build')));
});

test('stages only fixed project entries and privately replaces exact validated content', async t => {
  const themeRoot = await isolatedTheme(t);
  const before = await publicHashes(projectRoot);
  const expectedTheme = await validateThemeDirectory(themeRoot);
  const oldOutput = path.join(projectRoot, 'dist-private', 'stale.txt');
  await fs.mkdir(path.dirname(oldOutput), {recursive: true});
  await fs.writeFile(oldOutput, 'stale');
  t.after(async () => {
    await fs.rm(path.join(projectRoot, '.private-build'), {recursive: true, force: true});
    await fs.rm(path.join(projectRoot, 'dist-private'), {recursive: true, force: true});
  });
  let builderCall;

  const {packPrivateTheme} = loadPacker();
  const output = await packPrivateTheme({
    projectRoot,
    themeRoot,
    environment: {
      SAFE_VALUE: 'kept',
      PROJECT_ZERO_LOCAL_THEME_DIR: themeRoot,
      PROJECT_ZERO_TEST_BRIDGE_MODULE: '/private/test-bridge.cjs',
      PROJECT_ZERO_TEST_TRACE: '/private/trace.json'
    },
    runBuilder: async call => {
      builderCall = {
        ...call,
        topLevel: (await fs.readdir(call.projectRoot)).sort(),
        index: await fs.readFile(path.join(call.projectRoot, 'renderer', 'boot', 'index.html'), 'utf8'),
        packageJson: JSON.parse(await fs.readFile(path.join(call.projectRoot, 'package.json'))),
        stagedContents: new Map()
      };
      await assert.rejects(fs.access(oldOutput));
      for (const file of expectedTheme.contents.keys()) {
        if (file === 'theme.json') continue;
        const directory = file.endsWith('.webp')
          ? path.join(call.projectRoot, 'renderer', 'boot', 'assets')
          : path.join(call.projectRoot, 'assets', 'themes', 'project-zero');
        builderCall.stagedContents.set(file, await fs.readFile(path.join(directory, file)));
      }
    }
  });

  assert.equal(output, path.join(projectRoot, 'dist-private'));
  assert.notEqual(output, path.join(projectRoot, 'dist'));
  assert.equal(builderCall.projectRoot.startsWith(path.join(projectRoot, '.private-build', 'stage-')), true);
  assert.deepEqual(builderCall.arguments, ['--dir']);
  assert.deepEqual(builderCall.environment, {SAFE_VALUE: 'kept'});
  assert.equal(builderCall.environment.PROJECT_ZERO_LOCAL_THEME_DIR, undefined);
  assert.deepEqual(builderCall.topLevel, projectEntries);
  assert.equal(builderCall.index.includes(publicLabel), false);
  assert.equal(builderCall.index.includes(expectedTheme.displayName), true);
  assert.equal(builderCall.packageJson.build.directories.output, output);
  for (const [file, bytes] of expectedTheme.contents) {
    if (file === 'theme.json') continue;
    assert.deepEqual(builderCall.stagedContents.get(file), bytes);
  }
  assert.deepEqual(await publicHashes(projectRoot), before);
  assert.deepEqual(await fs.readdir(path.join(projectRoot, '.private-build')), []);
});

test('snapshots validated bytes before staging even if source and returned Map are replaced', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t);
  const validated = await validateThemeDirectory(themeRoot);
  const expected = new Map([...validated.contents].map(([file, bytes]) => [file, Buffer.from(bytes)]));
  let mutated = false;
  const fsModule = {
    ...fs,
    async mkdir(...arguments_) {
      if (!mutated) {
        mutated = true;
        for (const file of validated.contents.keys()) {
          validated.contents.set(file, Buffer.from('mutated-returned-map'));
          await fs.writeFile(path.join(themeRoot, file), 'mutated-source');
        }
      }
      return fs.mkdir(...arguments_);
    }
  };
  let staged;

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    validateTheme: async () => validated,
    runBuilder: async ({projectRoot: stageRoot}) => {
      staged = new Map();
      for (const file of expected.keys()) {
        if (file === 'theme.json') continue;
        const directory = file.endsWith('.webp')
          ? path.join(stageRoot, 'renderer', 'boot', 'assets')
          : path.join(stageRoot, 'assets', 'themes', 'project-zero');
        staged.set(file, await fs.readFile(path.join(directory, file)));
      }
    }
  });

  for (const [file, bytes] of expected) {
    if (file !== 'theme.json') assert.deepEqual(staged.get(file), bytes);
  }
  assert.deepEqual(await fs.readdir(path.join(temporaryProject, '.private-build')), []);
});

test('cleans staging after builder failure and removes stale private output first', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-failure-');
  const staleOutput = path.join(temporaryProject, 'dist-private', 'stale.txt');
  await fs.mkdir(path.dirname(staleOutput), {recursive: true});
  await fs.writeFile(staleOutput, 'stale');

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {
      await assert.rejects(fs.access(staleOutput));
      throw Error('BUILDER_FAILED');
    }
  }));
  assert.deepEqual(await fs.readdir(path.join(temporaryProject, '.private-build')), []);
});

test('rejects a symlink copied through a fixed project entry before invoking the builder', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-symlink-');
  const outside = path.join(temporaryProject, 'outside-secret.txt');
  await fs.writeFile(outside, 'outside-secret');
  await fs.symlink(outside, path.join(temporaryProject, 'app', 'outside-link'));
  let builderCalled = false;

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {
      builderCalled = true;
    }
  }));
  assert.equal(builderCalled, false);
  assert.deepEqual(await fs.readdir(path.join(temporaryProject, '.private-build')), []);
});

test('rejects an outside staging-parent symlink before mkdtemp or copying', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-parent-link-');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-pack-outside-'));
  t.after(() => fs.rm(outside, {recursive: true, force: true}));
  const marker = path.join(outside, 'keep.txt');
  await fs.writeFile(marker, 'keep');
  await fs.symlink(outside, path.join(temporaryProject, '.private-build'));
  let mkdtempCalls = 0;
  let copyCalls = 0;
  const fsModule = {
    ...fs,
    async mkdtemp(...arguments_) {
      mkdtempCalls += 1;
      return fs.mkdtemp(...arguments_);
    },
    async cp(...arguments_) {
      copyCalls += 1;
      return fs.cp(...arguments_);
    }
  };

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => assert.fail('builder must not run')
  }));
  assert.equal(mkdtempCalls, 0);
  assert.equal(copyCalls, 0);
  assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep');
  assert.equal((await fs.lstat(path.join(temporaryProject, '.private-build'))).isSymbolicLink(), true);
});

test('rejects staging identities replaced while the builder is running', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-root-swap-');
  const stageParent = path.join(temporaryProject, '.private-build');
  const movedParent = path.join(temporaryProject, '.private-build-moved');

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {
      await fs.rename(stageParent, movedParent);
      await fs.mkdir(stageParent);
    }
  }));
});

test('maps missing entries and native staging failures to one stable pack error', async t => {
  const themeRoot = await isolatedTheme(t);
  const phases = ['missing-entry', 'mkdir', 'cp', 'writeFile', 'rejectSymlinks'];

  for (const phase of phases) {
    await t.test(phase, async subtest => {
      const temporaryProject = await isolatedProject(subtest, `project-zero-pack-${phase}-`);
      const fsModule = {...fs};
      if (phase === 'missing-entry') await fs.rm(path.join(temporaryProject, 'app'), {recursive: true});
      if (phase === 'mkdir') {
        fsModule.mkdir = async target => {
          throw Object.assign(Error(`native mkdir leaked ${target}`), {code: 'EACCES'});
        };
      }
      if (phase === 'cp') {
        fsModule.cp = async source => {
          throw Object.assign(Error(`native cp leaked ${source}`), {code: 'EIO'});
        };
      }
      if (phase === 'writeFile') {
        fsModule.writeFile = async target => {
          throw Object.assign(Error(`native write leaked ${target}`), {code: 'ENOSPC'});
        };
      }
      if (phase === 'rejectSymlinks') {
        await fs.symlink(
          path.join(temporaryProject, 'LICENSE'),
          path.join(temporaryProject, 'app', 'linked-license')
        );
      }

      const {packPrivateTheme} = loadPacker();
      await expectStablePackFailure(packPrivateTheme({
        projectRoot: temporaryProject,
        themeRoot,
        fsModule,
        runBuilder: async () => assert.fail('builder must not run')
      }));
    });
  }
});

test('CLI reporter prints only stable codes for contract and native failures', async () => {
  const {runPrivateThemeCli} = loadPacker();
  const failures = [
    new ThemeValidationError('THEME_ROOT'),
    Object.assign(Error(`ENOENT: ${projectRoot} ${fixtureRoot} SECRET_PAYLOAD`), {code: 'ENOENT'})
  ];
  for (const failure of failures) {
    const lines = [];
    const exitCode = await runPrivateThemeCli({
      arguments_: ['--theme', fixtureRoot],
      projectRoot,
      packTheme: async () => { throw failure; },
      writeError: line => lines.push(line)
    });
    assert.equal(exitCode, 1);
    assert.equal(lines.length, 1);
    const expected = failure instanceof ThemeValidationError
      ? 'THEME_ROOT'
      : 'PRIVATE_THEME_PACK_FAILED';
    assert.equal(lines[0], `[PROJECT ZERO] Private packaging failed: ${expected}`);
    assert.doesNotMatch(lines[0], /SECRET_PAYLOAD/);
    assert.doesNotMatch(lines[0], new RegExp(projectRoot.replaceAll('/', '\\/')));
    assert.doesNotMatch(lines[0], new RegExp(fixtureRoot.replaceAll('/', '\\/')));
  }
});

test('CLI rejects missing, unknown, duplicate, empty, and environment-only themes', () => {
  const script = path.join(projectRoot, 'scripts', 'pack-private-theme.cjs');
  const cases = [
    [],
    ['--unknown'],
    ['--theme', fixtureRoot, '--theme', fixtureRoot],
    ['--theme', ''],
    ['--theme']
  ];
  for (const arguments_ of cases) {
    const result = childProcess.spawnSync(process.execPath, [script, ...arguments_], {
      encoding: 'utf8',
      env: {...process.env, PROJECT_ZERO_LOCAL_THEME_DIR: fixtureRoot}
    });
    assert.equal(result.status, 1, `${arguments_.join(' ')}\n${result.stderr}`);
    assert.match(result.stderr, /PRIVATE_THEME_ARGUMENTS/);
    assert.doesNotMatch(result.stderr, new RegExp(fixtureRoot.replaceAll('/', '\\/')));
  }
});
