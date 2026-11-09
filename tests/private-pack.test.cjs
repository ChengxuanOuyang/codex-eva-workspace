'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {
  ThemeValidationError,
  validateThemeDirectory
} = require('../scripts/theme-contract.cjs');
const {
  preparePrivateAudio
} = require('../scripts/prepare-private-audio.cjs');

const projectRoot = path.join(__dirname, '..');
const fixtureRoot = path.join(__dirname, 'fixtures', 'private-theme-valid');
const publicLabel = 'PROJECT ZERO // PILOT CODEX WORKBENCH';
const projectEntries = [
  'app', 'assets', 'LICENSE', 'NOTICE.md', 'package.json',
  'renderer', 'THIRD_PARTY_NOTICES.md', 'workbench'
].sort();
const stagedEntries = [...projectEntries, 'node_modules'].sort();
const privateStageFiles = [
  'renderer/boot/assets/scene-a-sync.webp',
  'renderer/boot/assets/scene-b-awakening.webp',
  'renderer/boot/assets/scene-c-online.webp',
  'assets/themes/project-zero/assets.json',
  'assets/themes/project-zero/ASSET-LICENSE.md',
  'renderer/boot/index.html',
  'renderer/boot/private/boot-mark.webp',
  'renderer/boot/private/rei-portrait.webp',
  'renderer/boot/private/startup-reference.wav',
  'renderer/boot/private/theme.json'
];

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
  let captured;
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'PRIVATE_THEME_PACK_FAILED');
    assert.equal(error.message, 'PRIVATE_THEME_PACK_FAILED');
    assert.ok(error.cause instanceof Error);
    captured = error;
    return true;
  });
  return captured;
}

async function assertMissing(target) {
  await assert.rejects(fs.access(target), error => error.code === 'ENOENT');
}

function atom(type, payload) {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  payload.copy(bytes, 8);
  return bytes;
}

function syntheticM4a({timescale = 1000, duration = 20_500} = {}) {
  const ftyp = Buffer.alloc(16);
  ftyp.write('M4A ', 0, 4, 'ascii');
  ftyp.writeUInt32BE(0, 4);
  ftyp.write('M4A ', 8, 4, 'ascii');
  ftyp.write('isom', 12, 4, 'ascii');
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt8(0, 0);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(duration, 16);
  return Buffer.concat([atom('ftyp', ftyp), atom('moov', atom('mvhd', mvhd))]);
}

async function privateAudioFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-private-audio-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const input = path.join(root, 'source.mp4');
  const outputParent = path.join(root, 'output');
  const output = path.join(outputParent, 'startup-reference.m4a');
  await fs.writeFile(input, 'synthetic input');
  await fs.mkdir(outputParent);
  return {input, output, outputParent, root};
}

async function expectStableAudioFailure(operation, forbidden = []) {
  let captured;
  await assert.rejects(operation, error => {
    assert.equal(error.code, 'PRIVATE_AUDIO_PREP_FAILED');
    assert.equal(error.message, 'PRIVATE_AUDIO_PREP_FAILED');
    for (const value of forbidden) assert.equal(error.message.includes(value), false);
    captured = error;
    return true;
  });
  return captured;
}

function denyOutputWriteOpens(output) {
  let writeOpenAttempts = 0;
  return {
    fsModule: {
      ...fs,
      async open(target, flags, ...arguments_) {
        if (target === output && typeof flags === 'number' && (flags & 3) !== 0) {
          writeOpenAttempts += 1;
          const error = Error('simulated read-only output');
          error.code = 'EACCES';
          throw error;
        }
        return fs.open(target, flags, ...arguments_);
      }
    },
    get writeOpenAttempts() {
      return writeOpenAttempts;
    }
  };
}

test('prepares private audio with the exact afconvert argument array and redacted summary', async t => {
  const {input, output} = await privateAudioFixture(t);
  const calls = [];
  const logs = [];

  const result = await preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async (...arguments_) => {
      calls.push(arguments_);
      await fs.writeFile(output, syntheticM4a());
    },
    log: line => logs.push(line)
  });

  assert.deepEqual(calls, [[
    '/usr/bin/afconvert',
    [input, output, '-f', 'm4af', '-d', 'aac', '-b', '128000']
  ]]);
  assert.equal(result.bytes, syntheticM4a().length);
  assert.equal(result.durationMs, 20_500);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(logs, [
    `PRIVATE_AUDIO_READY bytes=${result.bytes} duration_ms=20500 sha256=${result.sha256}`
  ]);
  assert.equal(logs[0].includes(input), false);
  assert.equal(logs[0].includes(output), false);
});

test('private audio preparation accepts a valid 0444 generated output', async t => {
  const {input, output} = await privateAudioFixture(t);
  const readOnly = denyOutputWriteOpens(output);

  const result = await preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      await fs.writeFile(output, syntheticM4a());
      await fs.chmod(output, 0o444);
    },
    fsModule: readOnly.fsModule,
    log: () => {}
  });

  assert.equal(result.durationMs, 20_500);
  assert.equal((await fs.stat(output)).mode & 0o777, 0o444);
  assert.deepEqual(await fs.readFile(output), syntheticM4a());
});

test('private audio preparation safely unlinks an invalid 0444 output and permits retry', async t => {
  const {input, output} = await privateAudioFixture(t);
  const readOnly = denyOutputWriteOpens(output);

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      await fs.writeFile(output, 'invalid read-only container');
      await fs.chmod(output, 0o444);
    },
    fsModule: readOnly.fsModule,
    log: () => assert.fail('failure must not log')
  }), [input, output]);

  assert.ok(readOnly.writeOpenAttempts > 0);
  await assertMissing(output);

  const retry = await preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      await fs.writeFile(output, syntheticM4a());
      await fs.chmod(output, 0o444);
    },
    fsModule: readOnly.fsModule,
    log: () => {}
  });
  assert.equal(retry.durationMs, 20_500);
});

test('private audio preparation accepts only the exact absolute mp4 to m4a syntax', async t => {
  const {input, output} = await privateAudioFixture(t);
  const invalidArguments = [
    [],
    ['--input', input, '--output', output, '--bitrate', '64000'],
    ['--output', output, '--input', input],
    ['--input', path.basename(input), '--output', output],
    ['--input', input, '--output', path.basename(output)],
    ['--input', input.replace(/\.mp4$/, '.mov'), '--output', output],
    ['--input', input, '--output', output.replace(/\.m4a$/, '.wav')]
  ];
  let calls = 0;
  for (const argv of invalidArguments) {
    await expectStableAudioFailure(preparePrivateAudio({
      argv,
      execFile: async () => { calls += 1; },
      log: () => assert.fail('failure must not log')
    }), [input, output]);
  }
  assert.equal(calls, 0);
});

test('private audio preparation rejects linked input and linked output parents', async t => {
  const {input, output, root} = await privateAudioFixture(t);
  const inputLink = path.join(root, 'linked.mp4');
  const inputDirectory = path.join(root, 'directory.mp4');
  const outsideParent = path.join(root, 'outside');
  const parentLink = path.join(root, 'linked-output');
  await fs.mkdir(inputDirectory);
  await fs.mkdir(outsideParent);
  await fs.symlink(input, inputLink);
  await fs.symlink(outsideParent, parentLink);
  let calls = 0;

  for (const [linkedInput, linkedOutput] of [
    [inputLink, output],
    [inputDirectory, output],
    [input, path.join(parentLink, 'startup-reference.m4a')]
  ]) {
    await expectStableAudioFailure(preparePrivateAudio({
      argv: ['--input', linkedInput, '--output', linkedOutput],
      execFile: async () => { calls += 1; },
      log: () => assert.fail('failure must not log')
    }), [linkedInput, linkedOutput]);
  }
  assert.equal(calls, 0);
});

test('private audio preparation detects output-parent replacement around conversion', async t => {
  const {input, output, outputParent, root} = await privateAudioFixture(t);
  const movedParent = path.join(root, 'moved-output');

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      await fs.rename(outputParent, movedParent);
      await fs.mkdir(outputParent);
      await fs.writeFile(output, syntheticM4a());
    },
    log: () => assert.fail('failure must not log')
  }), [input, output]);
  assert.deepEqual(await fs.readFile(output), syntheticM4a());
});

test('private audio preparation removes invalid generated files and the same path can retry', async t => {
  const cases = [
    {
      name: 'oversize output',
      write: async ({output}) => {
        const handle = await fs.open(output, 'w');
        await handle.truncate(32 * 1024 * 1024 + 1);
        await handle.close();
      }
    },
    {
      name: 'invalid duration',
      write: async ({output}) => fs.writeFile(output, syntheticM4a({timescale: 0}))
    },
    {
      name: 'not an M4A',
      write: async ({output}) => fs.writeFile(output, 'not an m4a')
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async subtest => {
      const fixture = await privateAudioFixture(subtest);
      await expectStableAudioFailure(preparePrivateAudio({
        argv: ['--input', fixture.input, '--output', fixture.output],
        execFile: async () => scenario.write(fixture),
        log: () => assert.fail('failure must not log')
      }), [fixture.input, fixture.output]);
      await assertMissing(fixture.output);

      const retry = await preparePrivateAudio({
        argv: ['--input', fixture.input, '--output', fixture.output],
        execFile: async () => fs.writeFile(fixture.output, syntheticM4a()),
        log: () => {}
      });
      assert.equal(retry.durationMs, 20_500);
    });
  }
});

test('private audio preparation removes output after post-conversion input identity failure', async t => {
  const {input, output} = await privateAudioFixture(t);
  const movedInput = `${input}.moved`;

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      await fs.writeFile(output, syntheticM4a());
      await fs.rename(input, movedInput);
      await fs.writeFile(input, 'replacement input');
    },
    log: () => assert.fail('failure must not log')
  }), [input, output]);
  await assertMissing(output);

  const retry = await preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => fs.writeFile(output, syntheticM4a()),
    log: () => {}
  });
  assert.equal(retry.durationMs, 20_500);
});

test('private audio cleanup preserves a replacement path and scrubs the held original inode', async t => {
  const {input, output} = await privateAudioFixture(t);
  const movedOutput = `${output}.moved`;
  const replacement = Buffer.from('replacement must survive');
  let replaced = false;
  let readCloseCalls = 0;
  let writeCloseCalls = 0;
  const fsModule = {
    ...fs,
    async open(target, flags, ...arguments_) {
      const handle = await fs.open(target, flags, ...arguments_);
      if (target !== output) return handle;
      if ((flags & 3) !== 0) {
        return {
          stat: (...statArguments) => handle.stat(...statArguments),
          truncate: (...truncateArguments) => handle.truncate(...truncateArguments),
          sync: (...syncArguments) => handle.sync(...syncArguments),
          async close() {
            writeCloseCalls += 1;
            return handle.close();
          }
        };
      }
      return {
        stat: (...statArguments) => handle.stat(...statArguments),
        async readFile(...readArguments) {
          const bytes = await handle.readFile(...readArguments);
          if (!replaced) {
            replaced = true;
            await fs.rename(output, movedOutput);
            await fs.writeFile(output, replacement);
          }
          return bytes;
        },
        async close() {
          readCloseCalls += 1;
          return handle.close();
        }
      };
    }
  };

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => fs.writeFile(output, syntheticM4a()),
    fsModule,
    log: () => assert.fail('failure must not log')
  }), [input, output]);

  assert.equal(replaced, true);
  assert.equal(readCloseCalls, 1);
  assert.equal(writeCloseCalls, 1);
  assert.deepEqual(await fs.readFile(output), replacement);
  assert.equal((await fs.stat(movedOutput)).size, 0);
});

test('private audio cleanup failures remain redacted and do not prevent safe unlink or close', async t => {
  const {input, output} = await privateAudioFixture(t);
  let truncateCalls = 0;
  let closeCalls = 0;
  const fsModule = {
    ...fs,
    async open(target, flags, ...arguments_) {
      const handle = await fs.open(target, flags, ...arguments_);
      if (target !== output) return handle;
      if ((flags & 3) === 0) {
        return {
          stat: (...statArguments) => handle.stat(...statArguments),
          readFile: (...readArguments) => handle.readFile(...readArguments),
          close: (...closeArguments) => handle.close(...closeArguments)
        };
      }
      return {
        stat: (...statArguments) => handle.stat(...statArguments),
        sync: (...syncArguments) => handle.sync(...syncArguments),
        async truncate() {
          truncateCalls += 1;
          throw Error(`cleanup truncate leaked ${output}`);
        },
        async close() {
          closeCalls += 1;
          await handle.close();
          throw Error(`cleanup close leaked ${input}`);
        }
      };
    }
  };

  const error = await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => fs.writeFile(output, 'invalid container'),
    fsModule,
    log: () => assert.fail('failure must not log')
  }), [input, output, 'cleanup truncate leaked', 'cleanup close leaked']);

  assert.equal(error.message, 'PRIVATE_AUDIO_PREP_FAILED');
  assert.equal(truncateCalls, 1);
  assert.equal(closeCalls, 1);
  await assertMissing(output);
});

test('private audio preparation does not unlink a generated output symlink', async t => {
  const fixture = await privateAudioFixture(t);
  const outside = path.join(fixture.root, 'outside.m4a');
  await fs.writeFile(outside, syntheticM4a());

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', fixture.input, '--output', fixture.output],
    execFile: async () => fs.symlink(outside, fixture.output),
    log: () => assert.fail('failure must not log')
  }), [fixture.input, fixture.output]);

  assert.equal((await fs.lstat(fixture.output)).isSymbolicLink(), true);
  assert.deepEqual(await fs.readFile(outside), syntheticM4a());
});

test('private audio preparation never exposes converter stderr or paths on failure', async t => {
  const {input, output} = await privateAudioFixture(t);
  const logs = [];

  await expectStableAudioFailure(preparePrivateAudio({
    argv: ['--input', input, '--output', output],
    execFile: async () => {
      throw Error(`afconvert failed: ${input} ${output} codec-private-stderr`);
    },
    log: line => logs.push(line)
  }), [input, output, 'codec-private-stderr']);
  assert.deepEqual(logs, []);
});

test('private audio CLI emits only its stable failure code', () => {
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/prepare-private-audio.cjs', '--input', 'relative.mp4', '--output', 'relative.m4a'],
    {cwd: projectRoot, encoding: 'utf8'}
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'PRIVATE_AUDIO_PREP_FAILED\n');
});

function rendererThemeFixture() {
  const properties = new Map();
  const documentElement = {
    dataset: {},
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name),
      getPropertyValue: name => properties.get(name) || ''
    }
  };
  const root = {Audio: function FakeAudio() {}, document: {documentElement}};
  root.window = root;
  const sandbox = {document: root.document, window: root};
  const source = childProcess.execFileSync(process.execPath, ['-e', [
    "const fs=require('node:fs');",
    "process.stdout.write(fs.readFileSync('renderer/workbench/themes.js'));"
  ].join('')], {cwd: projectRoot, encoding: 'utf8'});
  vm.runInNewContext(source, sandbox, {filename: 'renderer/workbench/themes.js'});
  return {documentElement, properties, themes: root.ProjectZeroThemes};
}

function fixedPrivateConfig(overrides = {}) {
  return {
    displayName: 'PROJECT ZERO // TEST PRIVATE THEME',
    mark: '/private/boot-mark.webp',
    portrait: '/private/rei-portrait.webp',
    soundtrack: '/private/startup-reference.wav',
    audioStartMs: 0,
    audioEndMs: 20_500,
    ...overrides
  };
}

test('workbench portrait is enabled only by the exact fixed private config', () => {
  const {documentElement, themes} = rendererThemeFixture();

  assert.equal(themes.applyPrivateConfig(fixedPrivateConfig()), true);
  assert.equal(documentElement.dataset.privateWorkbench, 'true');
  assert.equal(
    documentElement.style.getPropertyValue('--theme-workbench-portrait'),
    'url("/private/rei-portrait.webp")'
  );

  themes.apply({
    id: 'untrusted-theme',
    colors: {},
    portrait: 'https://example.test/arbitrary.webp'
  });
  assert.equal(
    documentElement.style.getPropertyValue('--theme-workbench-portrait'),
    'url("/private/rei-portrait.webp")'
  );

  assert.equal(themes.applyPrivateConfig(null), false);
  assert.equal(documentElement.dataset.privateWorkbench, 'false');
  assert.equal(documentElement.style.getPropertyValue('--theme-workbench-portrait'), '');
});

test('workbench rejects arbitrary private portrait and soundtrack URLs', () => {
  const {documentElement, themes} = rendererThemeFixture();
  const invalid = [
    fixedPrivateConfig({portrait: '/private/another.webp'}),
    fixedPrivateConfig({portrait: 'https://example.test/rei.webp'}),
    fixedPrivateConfig({soundtrack: '/private/another.wav'}),
    fixedPrivateConfig({extra: 'field'})
  ];

  for (const config of invalid) {
    assert.equal(themes.applyPrivateConfig(config), false);
    assert.equal(documentElement.style.getPropertyValue('--theme-workbench-portrait'), '');
  }
});

test('private portrait layout stays decorative, bounded, and below all functional panels', async () => {
  const html = await fs.readFile(path.join(projectRoot, 'renderer', 'boot', 'index.html'), 'utf8');
  const css = await fs.readFile(path.join(projectRoot, 'renderer', 'workbench', 'workbench.css'), 'utf8');

  assert.match(html, /class="workbench-portrait"[^>]*aria-hidden="true"/);
  assert.match(css, /\.workbench-portrait\s*\{[^}]*position:\s*fixed[^}]*right:\s*0[^}]*bottom:\s*0/s);
  assert.match(css, /\.workbench-portrait\s*\{[^}]*width:\s*min\(34vw,\s*520px\)/s);
  assert.match(css, /\.workbench-portrait\s*\{[^}]*opacity:\s*(?:\.3[0-8]|0\.3[0-8])/s);
  assert.match(css, /\.workbench-portrait\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /html\[data-private-workbench="false"\] \.workbench-portrait[^}]*display:\s*none/s);
  assert.match(css, /\.workbench-header,\s*\.core-workbench\s*\{[^}]*position:\s*relative[^}]*z-index:\s*[2-9]/s);
  assert.match(css, /@media \(max-width:\s*680px\)[\s\S]*\.workbench-portrait[^}]*display:\s*none/s);
});

function stagedContentTarget(stageRoot, theme, file) {
  if (Object.values(theme.scenes).includes(file)) {
    return path.join(stageRoot, 'renderer', 'boot', 'assets', file);
  }
  if (file === theme.boot.mark) {
    return path.join(stageRoot, 'renderer', 'boot', 'private', 'boot-mark.webp');
  }
  if (file === theme.boot.portrait) {
    return path.join(stageRoot, 'renderer', 'boot', 'private', 'rei-portrait.webp');
  }
  if (file === theme.boot.soundtrack) {
    return path.join(
      stageRoot,
      'renderer',
      'boot',
      'private',
      `startup-reference${path.extname(file)}`
    );
  }
  if (file === 'assets.json' || file === 'ASSET-LICENSE.md') {
    return path.join(stageRoot, 'assets', 'themes', 'project-zero', file);
  }
  return null;
}

function expectedPrivateConfig(theme) {
  const soundtrackExtension = path.extname(theme.boot.soundtrack);
  return {
    displayName: theme.displayName,
    mark: '/private/boot-mark.webp',
    portrait: '/private/rei-portrait.webp',
    soundtrack: `/private/startup-reference${soundtrackExtension}`,
    audioStartMs: theme.boot.audioStartMs,
    audioEndMs: theme.boot.audioEndMs
  };
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
  const temporaryProject = await isolatedProject(t);
  const realTemporaryProject = await fs.realpath(temporaryProject);
  const before = await publicHashes(temporaryProject);
  const expectedTheme = await validateThemeDirectory(themeRoot);
  const oldOutput = path.join(temporaryProject, 'dist-private', 'stale.txt');
  await fs.mkdir(path.dirname(oldOutput), {recursive: true});
  await fs.writeFile(oldOutput, 'stale');
  let builderCall;

  const {packPrivateTheme} = loadPacker();
  const output = await packPrivateTheme({
    projectRoot: temporaryProject,
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
        privateEntries: (await fs.readdir(
          path.join(call.projectRoot, 'renderer', 'boot', 'private')
        )).sort(),
        privateConfigBytes: await fs.readFile(
          path.join(call.projectRoot, 'renderer', 'boot', 'private', 'theme.json')
        ),
        stagedContents: new Map()
      };
      await assert.rejects(fs.access(oldOutput));
      for (const file of expectedTheme.contents.keys()) {
        if (file === 'theme.json') continue;
        builderCall.stagedContents.set(
          file,
          await fs.readFile(stagedContentTarget(call.projectRoot, expectedTheme, file))
        );
      }
    }
  });

  assert.equal(output, path.join(realTemporaryProject, 'dist-private'));
  assert.notEqual(output, path.join(realTemporaryProject, 'dist'));
  assert.equal(
    builderCall.projectRoot.startsWith(path.join(realTemporaryProject, '.private-build', 'stage-')),
    true
  );
  assert.deepEqual(builderCall.arguments, ['--dir']);
  assert.deepEqual(builderCall.environment, {SAFE_VALUE: 'kept'});
  assert.equal(builderCall.environment.PROJECT_ZERO_LOCAL_THEME_DIR, undefined);
  assert.deepEqual(builderCall.topLevel, stagedEntries);
  assert.equal(builderCall.index.includes(publicLabel), false);
  assert.equal(builderCall.index.includes(expectedTheme.displayName), true);
  assert.equal(
    builderCall.index.includes('PROJECT ZERO <span>//</span> TEST PRIVATE THEME'),
    true
  );
  assert.equal(builderCall.packageJson.build.directories.output, output);
  assert.equal(builderCall.packageJson.build.npmRebuild, false);
  assert.deepEqual(builderCall.privateEntries, [
    'boot-mark.webp',
    'rei-portrait.webp',
    'startup-reference.wav',
    'theme.json'
  ]);
  const privateConfigText = builderCall.privateConfigBytes.toString('utf8');
  assert.deepEqual(JSON.parse(privateConfigText), expectedPrivateConfig(expectedTheme));
  assert.equal(privateConfigText.includes(themeRoot), false);
  assert.equal(privateConfigText.includes(expectedTheme.root), false);
  for (const [file, bytes] of expectedTheme.contents) {
    if (file === 'theme.json') continue;
    assert.deepEqual(builderCall.stagedContents.get(file), bytes);
  }
  assert.deepEqual(await publicHashes(temporaryProject), before);
  await assertMissing(path.join(temporaryProject, '.private-build'));
});

test('stages an m4a soundtrack only at its fixed private URL', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-m4a-');
  await fs.rename(
    path.join(themeRoot, 'startup-reference.wav'),
    path.join(themeRoot, 'startup-reference.m4a')
  );
  const themePath = path.join(themeRoot, 'theme.json');
  const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
  theme.boot.soundtrack = 'startup-reference.m4a';
  await fs.writeFile(themePath, `${JSON.stringify(theme, null, 2)}\n`);
  const manifestPath = path.join(themeRoot, 'assets.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.assets.find(asset => asset.file === 'startup-reference.wav').file =
    'startup-reference.m4a';
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let config;

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async ({projectRoot: stageRoot}) => {
      const privateRoot = path.join(stageRoot, 'renderer', 'boot', 'private');
      config = JSON.parse(await fs.readFile(path.join(privateRoot, 'theme.json'), 'utf8'));
      assert.deepEqual((await fs.readdir(privateRoot)).sort(), [
        'boot-mark.webp',
        'rei-portrait.webp',
        'startup-reference.m4a',
        'theme.json'
      ]);
      await assertMissing(path.join(privateRoot, 'startup-reference.wav'));
    }
  });

  assert.equal(config.soundtrack, '/private/startup-reference.m4a');
});

test('isolated private packing leaves the real tracked public assets unchanged', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t);
  const before = await publicHashes(projectRoot);

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {}
  });

  assert.deepEqual(await publicHashes(projectRoot), before);
});

test('successful packing truncates and closes every held private inode', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-success-scrub-');
  let builderFinished = false;
  const truncated = new Set();
  const closed = new Set();
  const fsModule = {
    ...fs,
    async open(target, ...arguments_) {
      const handle = await fs.open(target, ...arguments_);
      const privateFile = privateStageFiles.find(file => target.endsWith(file));
      return {
        stat: (...statArguments) => handle.stat(...statArguments),
        truncate: async (...truncateArguments) => {
          const result = await handle.truncate(...truncateArguments);
          if (privateFile && builderFinished) truncated.add(privateFile);
          return result;
        },
        writeFile: (...writeArguments) => handle.writeFile(...writeArguments),
        sync: (...syncArguments) => handle.sync(...syncArguments),
        async close() {
          if (privateFile && builderFinished) {
            assert.equal((await handle.stat()).size, 0);
            closed.add(privateFile);
          }
          return handle.close();
        }
      };
    }
  };

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => {
      builderFinished = true;
    }
  });

  assert.deepEqual([...truncated].sort(), [...privateStageFiles].sort());
  assert.deepEqual([...closed].sort(), [...privateStageFiles].sort());
});

test('escapes a validator-approved display name in document and visible titles', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-title-escape-');
  const themePath = path.join(themeRoot, 'theme.json');
  const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
  theme.displayName = `PROJECT ZERO // </title><img src=x>&"'`;
  await fs.writeFile(themePath, `${JSON.stringify(theme, null, 2)}\n`);
  let index;

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async ({projectRoot: stageRoot}) => {
      index = await fs.readFile(path.join(stageRoot, 'renderer', 'boot', 'index.html'), 'utf8');
    }
  });

  assert.doesNotMatch(index, /<img src=x>/);
  assert.match(
    index,
    /<title>PROJECT ZERO \/\/ &lt;\/title&gt;&lt;img src=x&gt;&amp;&quot;&#39;<\/title>/
  );
  assert.match(
    index,
    /PROJECT ZERO <span>\/\/<\/span> &lt;\/title&gt;&lt;img src=x&gt;&amp;&quot;&#39;/
  );
});

test('snapshots validated bytes before staging even if source and returned Map are replaced', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t);
  const validated = await validateThemeDirectory(themeRoot);
  const expected = new Map([...validated.contents].map(([file, bytes]) => [file, Buffer.from(bytes)]));
  const expectedTheme = {
    displayName: validated.displayName,
    scenes: {...validated.scenes},
    boot: {...validated.boot},
    contents: new Map([...validated.contents])
  };
  let mutated = false;
  const fsModule = {
    ...fs,
    async mkdir(...arguments_) {
      if (!mutated) {
        mutated = true;
        expectedTheme.displayName = 'MUTATED RETURNED DISPLAY NAME';
        expectedTheme.boot.audioEndMs = 1;
        for (const file of expectedTheme.contents.keys()) {
          expectedTheme.contents.set(file, Buffer.from('mutated-returned-map'));
          await fs.writeFile(path.join(themeRoot, file), 'mutated-source');
        }
      }
      return fs.mkdir(...arguments_);
    }
  };
  let staged;
  let privateConfig;

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    validateTheme: async () => expectedTheme,
    runBuilder: async ({projectRoot: stageRoot}) => {
      staged = new Map();
      for (const file of expected.keys()) {
        if (file === 'theme.json') continue;
        staged.set(file, await fs.readFile(stagedContentTarget(stageRoot, validated, file)));
      }
      privateConfig = JSON.parse(await fs.readFile(
        path.join(stageRoot, 'renderer', 'boot', 'private', 'theme.json'),
        'utf8'
      ));
    }
  });

  for (const [file, bytes] of expected) {
    if (file !== 'theme.json') assert.deepEqual(staged.get(file), bytes);
  }
  assert.deepEqual(privateConfig, expectedPrivateConfig(validated));
  await assertMissing(path.join(temporaryProject, '.private-build'));
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
  await assertMissing(path.join(temporaryProject, '.private-build'));
});

test('removes a dist-private symlink without following its outside target', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-output-link-');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-output-outside-'));
  t.after(() => fs.rm(outside, {recursive: true, force: true}));
  const marker = path.join(outside, 'marker.txt');
  await fs.writeFile(marker, 'outside');
  const output = path.join(temporaryProject, 'dist-private');
  await fs.symlink(outside, output);
  let builderCalled = false;

  const {packPrivateTheme} = loadPacker();
  await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {
      builderCalled = true;
      await assertMissing(output);
      assert.equal(await fs.readFile(marker, 'utf8'), 'outside');
    }
  });
  assert.equal(builderCalled, true);
  assert.equal(await fs.readFile(marker, 'utf8'), 'outside');
});

test('fails closed when a frozen output victim is swapped before final unlink', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-output-swap-');
  const output = path.join(await fs.realpath(temporaryProject), 'dist-private');
  const victim = path.join(output, 'old-private.txt');
  const movedVictim = `${victim}.moved`;
  await fs.mkdir(output);
  await fs.writeFile(victim, 'old-private');
  let victimStats = 0;
  let builderCalled = false;
  const fsModule = {
    ...fs,
    async lstat(target, ...arguments_) {
      if (target === victim) {
        victimStats += 1;
        if (victimStats === 2) {
          await fs.rename(victim, movedVictim);
          await fs.mkdir(victim);
          await fs.writeFile(path.join(victim, 'keep.txt'), 'replacement');
        }
      }
      return fs.lstat(target, ...arguments_);
    }
  };

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => {
      builderCalled = true;
    }
  }));
  assert.equal(builderCalled, false);
  assert.equal(await fs.readFile(movedVictim, 'utf8'), 'old-private');
  assert.equal(await fs.readFile(path.join(victim, 'keep.txt'), 'utf8'), 'replacement');
});

test('does not recursively remove a nonempty output replacement at final rmdir', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-output-rmdir-swap-');
  const output = path.join(await fs.realpath(temporaryProject), 'dist-private');
  const movedOutput = `${output}.moved`;
  const marker = path.join(output, 'keep.txt');
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'old-private.txt'), 'old-private');
  let swapped = false;
  let builderCalled = false;
  const fsModule = {
    ...fs,
    async rmdir(target, ...arguments_) {
      if (target === output && !swapped) {
        swapped = true;
        await fs.rename(output, movedOutput);
        await fs.mkdir(output);
        await fs.writeFile(marker, 'replacement');
      }
      return fs.rmdir(target, ...arguments_);
    }
  };

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => {
      builderCalled = true;
    }
  }));
  assert.equal(swapped, true);
  assert.equal(builderCalled, false);
  assert.equal(await fs.readFile(marker, 'utf8'), 'replacement');
  assert.deepEqual(await fs.readdir(movedOutput), []);
});

test('private pack source contains no recursive removal', async () => {
  const source = await fs.readFile(path.join(projectRoot, 'scripts', 'pack-private-theme.cjs'), 'utf8');
  assert.doesNotMatch(source, /fsModule\.rm\s*\(/);
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
  await assertMissing(path.join(temporaryProject, '.private-build'));
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
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-pack-swap-outside-'));
  t.after(() => fs.rm(outside, {recursive: true, force: true}));
  const outsideMarker = path.join(outside, 'outside-marker.txt');
  await fs.writeFile(outsideMarker, 'outside');

  const {packPrivateTheme} = loadPacker();
  const error = await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async () => {
      await fs.rename(stageParent, movedParent);
      await fs.mkdir(stageParent);
      await fs.writeFile(path.join(stageParent, 'replacement-marker.txt'), 'replacement');
      await fs.symlink(outside, path.join(stageParent, 'outside-link'));
    }
  }));
  assert.ok(error.cleanupCause instanceof Error);
  const movedEntries = await fs.readdir(movedParent);
  assert.equal(movedEntries.length, 1);
  const movedStage = path.join(movedParent, movedEntries[0]);
  for (const file of privateStageFiles) {
    assert.equal((await fs.stat(path.join(movedStage, file))).size, 0);
  }
  assert.equal(await fs.readFile(path.join(stageParent, 'replacement-marker.txt'), 'utf8'), 'replacement');
  assert.equal((await fs.lstat(path.join(stageParent, 'outside-link'))).isSymbolicLink(), true);
  assert.equal(await fs.readFile(outsideMarker, 'utf8'), 'outside');
});

test('rolls back a newly-created stage when opening its identity fails', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-stage-open-');
  let stageTarget;
  const fsModule = {
    ...fs,
    async mkdtemp(...arguments_) {
      stageTarget = await fs.mkdtemp(...arguments_);
      return stageTarget;
    },
    async open(target, ...arguments_) {
      if (target === stageTarget) {
        throw Object.assign(Error(`open leaked ${target}`), {code: 'EACCES'});
      }
      return fs.open(target, ...arguments_);
    }
  };

  const {packPrivateTheme} = loadPacker();
  await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => assert.fail('builder must not run')
  }));
  assert.ok(stageTarget);
  await assertMissing(path.join(temporaryProject, '.private-build'));
});

test('keeps work failure primary when private scrub operations also fail and closes handles', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-double-failure-');
  const primary = Error('PRIMARY_BUILDER_FAILURE');
  const cleanup = Object.assign(Error('SECONDARY_SCRUB_FAILURE'), {code: 'EIO'});
  let opened = 0;
  let closed = 0;
  let builderStarted = false;
  const scrubAttempts = {sync: 0, truncate: 0, close: 0};
  const fsModule = {
    ...fs,
    async open(target, ...arguments_) {
      const handle = await fs.open(target, ...arguments_);
      opened += 1;
      const isPrivate = privateStageFiles.some(file => target.endsWith(file));
      return {
        stat: (...statArguments) => handle.stat(...statArguments),
        truncate: async (...truncateArguments) => {
          if (isPrivate && builderStarted) {
            scrubAttempts.truncate += 1;
            throw cleanup;
          }
          return handle.truncate(...truncateArguments);
        },
        writeFile: (...writeArguments) => handle.writeFile(...writeArguments),
        sync: async (...syncArguments) => {
          if (isPrivate && builderStarted) {
            scrubAttempts.sync += 1;
            throw cleanup;
          }
          return handle.sync(...syncArguments);
        },
        async close() {
          closed += 1;
          await handle.close();
          if (isPrivate && builderStarted) {
            scrubAttempts.close += 1;
            throw cleanup;
          }
        }
      };
    }
  };

  const {packPrivateTheme} = loadPacker();
  const error = await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    fsModule,
    runBuilder: async () => {
      builderStarted = true;
      throw primary;
    }
  }));
  assert.equal(error.cause, primary);
  assert.ok(error.cleanupCause instanceof Error);
  assert.equal(scrubAttempts.truncate, privateStageFiles.length);
  assert.equal(scrubAttempts.sync, privateStageFiles.length * 2);
  assert.equal(scrubAttempts.close, privateStageFiles.length);
  assert.equal(opened, privateStageFiles.length + 3);
  assert.equal(closed, opened);
});

test('renamed private derivatives are truncated through held handles and every handle closes', async t => {
  const themeRoot = await isolatedTheme(t);
  for (const privateFile of privateStageFiles) {
    await t.test(privateFile, async subtest => {
      const temporaryProject = await isolatedProject(subtest, 'project-zero-pack-private-rename-');
      let opened = 0;
      let closed = 0;
      let moved;
      const fsModule = {
        ...fs,
        async open(...arguments_) {
          const handle = await fs.open(...arguments_);
          opened += 1;
          return {
            stat: (...statArguments) => handle.stat(...statArguments),
            truncate: (...truncateArguments) => handle.truncate(...truncateArguments),
            writeFile: (...writeArguments) => handle.writeFile(...writeArguments),
            sync: (...syncArguments) => handle.sync(...syncArguments),
            async close() {
              closed += 1;
              return handle.close();
            }
          };
        }
      };

      const {packPrivateTheme} = loadPacker();
      const error = await expectStablePackFailure(packPrivateTheme({
        projectRoot: temporaryProject,
        themeRoot,
        fsModule,
        runBuilder: async ({projectRoot: stageRoot}) => {
          const target = path.join(stageRoot, privateFile);
          moved = `${target}.moved`;
          await fs.rename(target, moved);
        }
      }));
      assert.ok(error.cleanupCause instanceof Error);
      assert.equal((await fs.stat(moved)).size, 0);
      assert.equal(closed, opened);
    });
  }
});

test('final cleanup truncates every swapped victim without deleting its replacement', async t => {
  for (const victimSuffix of privateStageFiles) {
    await t.test(victimSuffix, async subtest => {
      const themeRoot = await isolatedTheme(subtest);
      const temporaryProject = await isolatedProject(
        subtest,
        'project-zero-pack-final-swap-'
      );
      const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), 'project-zero-pack-final-outside-')
      );
      subtest.after(() => fs.rm(outside, {recursive: true, force: true}));
      const outsideMarker = path.join(outside, 'marker.txt');
      await fs.writeFile(outsideMarker, 'outside');
      let builderFinished = false;
      let swapped = false;
      let movedVictim;
      const fsModule = {
        ...fs,
        async lstat(target, ...arguments_) {
          if (builderFinished && !swapped && target.endsWith(victimSuffix)) {
            swapped = true;
            movedVictim = `${target}.moved`;
            await fs.rename(target, movedVictim);
            await fs.symlink(outsideMarker, target);
          }
          return fs.lstat(target, ...arguments_);
        }
      };

      const {packPrivateTheme} = loadPacker();
      const error = await expectStablePackFailure(packPrivateTheme({
        projectRoot: temporaryProject,
        themeRoot,
        fsModule,
        runBuilder: async () => {
          builderFinished = true;
        }
      }));
      assert.ok(error.cleanupCause instanceof Error);
      assert.equal((await fs.stat(movedVictim)).size, 0);
      const replacement = movedVictim.slice(0, -'.moved'.length);
      assert.equal((await fs.lstat(replacement)).isSymbolicLink(), true);
      assert.equal(await fs.readFile(outsideMarker, 'utf8'), 'outside');
    });
  }
});

test('inventory cleanup never recursively removes replacement directories', async t => {
  const themeRoot = await isolatedTheme(t);
  for (const kind of ['empty', 'nonempty', 'symlink']) {
    await t.test(kind, async subtest => {
      const temporaryProject = await isolatedProject(subtest, `project-zero-pack-dir-${kind}-`);
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-pack-dir-outside-'));
      subtest.after(() => fs.rm(outside, {recursive: true, force: true}));
      const marker = path.join(outside, 'marker.txt');
      await fs.writeFile(marker, 'outside');
      let replacement;

      const {packPrivateTheme} = loadPacker();
      const error = await expectStablePackFailure(packPrivateTheme({
        projectRoot: temporaryProject,
        themeRoot,
        runBuilder: async ({projectRoot: stageRoot}) => {
          const victim = path.join(stageRoot, 'app');
          await fs.rename(victim, `${victim}.moved`);
          replacement = victim;
          if (kind === 'symlink') await fs.symlink(outside, replacement);
          else await fs.mkdir(replacement);
          if (kind === 'nonempty') await fs.writeFile(path.join(replacement, 'keep.txt'), 'keep');
        }
      }));
      assert.ok(error.cleanupCause instanceof Error);
      if (kind === 'symlink') assert.equal((await fs.lstat(replacement)).isSymbolicLink(), true);
      else assert.equal((await fs.lstat(replacement)).isDirectory(), true);
      if (kind === 'nonempty') assert.equal(await fs.readFile(path.join(replacement, 'keep.txt'), 'utf8'), 'keep');
      assert.equal(await fs.readFile(marker, 'utf8'), 'outside');
    });
  }
});

test('inventory cleanup fails closed on an unknown builder file', async t => {
  const themeRoot = await isolatedTheme(t);
  const temporaryProject = await isolatedProject(t, 'project-zero-pack-unknown-file-');
  let unknown;
  const {packPrivateTheme} = loadPacker();
  const error = await expectStablePackFailure(packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: async ({projectRoot: stageRoot}) => {
      unknown = path.join(stageRoot, 'app', 'builder-unknown.txt');
      await fs.writeFile(unknown, 'keep');
    }
  }));
  assert.ok(error.cleanupCause instanceof Error);
  assert.equal(await fs.readFile(unknown, 'utf8'), 'keep');
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
