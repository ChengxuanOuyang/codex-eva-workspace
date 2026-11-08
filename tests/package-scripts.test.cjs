'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const pkg = require('../package.json');

test('packaged runtime artwork includes checksummed provenance and bounded art terms', async () => {
  const projectRoot = path.join(__dirname, '..');
  const manifestPath = path.join(projectRoot, 'assets', 'themes', 'project-zero', 'assets.json');
  const noticePath = path.join(projectRoot, 'assets', 'themes', 'project-zero', 'ASSET-LICENSE.md');
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  const notice = await fsPromises.readFile(noticePath, 'utf8');
  const packagedFiles = new Set(pkg.build.files);

  assert.equal(packagedFiles.has('assets/themes/project-zero/assets.json'), true);
  assert.equal(packagedFiles.has('assets/themes/project-zero/ASSET-LICENSE.md'), true);
  assert.equal(manifest.themeId, 'voidglass-pilot');
  assert.equal(manifest.subject, 'PILOT-00 / VOIDGLASS');
  assert.doesNotMatch(JSON.stringify(manifest), /\bREI\b|绫波丽|EVANGELION|\bNERV\b/iu);
  assert.equal(manifest.assets.length, 3);
  const recordedRuntimeFiles = [];
  for (const asset of manifest.assets) {
    assert.match(asset.promptSummary, /sealed graphite helmet/i);
    assert.match(asset.promptSummary, /opaque black visor/i);
    assert.match(
      asset.promptSummary,
      /no visible face, hair, eyes, text, logo, or watermark/i
    );
    assert.match(asset.runtime.file, /renderer\/boot\/assets\/scene-[abc]-.+\.webp$/);
    assert.match(asset.runtime.sha256, /^[a-f0-9]{64}$/);
    assert.match(asset.adaptation, /PNG.*WebP/i);
    const runtimePath = path.resolve(path.dirname(manifestPath), asset.runtime.file);
    const checksum = crypto.createHash('sha256')
      .update(await fsPromises.readFile(runtimePath))
      .digest('hex');
    assert.equal(checksum, asset.runtime.sha256);
    recordedRuntimeFiles.push(path.basename(runtimePath));
  }
  const runtimeFiles = (await fsPromises.readdir(path.join(projectRoot, 'renderer', 'boot', 'assets')))
    .filter(file => file.endsWith('.webp'))
    .sort();
  assert.deepEqual(recordedRuntimeFiles.sort(), runtimeFiles);
  assert.match(notice, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(notice, /only.*original expression.*extent.*own/i);
  assert.match(notice, /does not license or clear.*character.*trademark/i);
  assert.match(notice, /not.*commercial-use guarantee/i);
  assert.match(notice, /PNG.*WebP/i);
});
const {
  cleanAndPack,
  runElectronBuilder,
  unpackedApplicationDirectory
} = require('../scripts/pack.cjs');

test('unit verification cannot discover or launch Electron end-to-end tests', () => {
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(pkg.scripts.verify, 'npm run lint && npm test');
  assert.equal(pkg.scripts['test:e2e'], 'npm run pack && node --test tests/e2e/*.test.cjs');
});

test('production scripts and packaging never enable the test bridge', () => {
  const productionConfiguration = {
    build: pkg.build,
    scripts: Object.fromEntries(Object.entries(pkg.scripts).filter(([name]) => name !== 'test:e2e'))
  };

  assert.doesNotMatch(
    JSON.stringify(productionConfiguration),
    /PROJECT_ZERO_TEST_BRIDGE_MODULE|NODE_ENV=test/
  );
});

test('public theme WebP rendering is reproducible and fails closed without cwebp', async t => {
  const projectRoot = path.join(__dirname, '..');
  const scriptPath = path.join(projectRoot, 'scripts', 'render-theme-webp.sh');
  const source = await fsPromises.readFile(scriptPath, 'utf8');

  assert.match(source, /minimum_cwebp_version=['"]1\.3\.2['"]/);
  assert.match(source, /command -v cwebp/);
  assert.match(source, /brew install webp/);
  assert.match(source, /-q 90/);
  assert.match(source, /-metadata none/);
  assert.doesNotMatch(source, /\bsips\b/);
  for (const scene of ['scene-a-sync', 'scene-b-awakening', 'scene-c-online']) {
    assert.match(source, new RegExp(`${scene}\\.png`));
    assert.match(source, new RegExp(`${scene}\\.webp`));
  }

  const emptyPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'project-zero-no-cwebp-'));
  t.after(() => fsPromises.rm(emptyPath, {recursive: true, force: true}));
  const result = childProcess.spawnSync('/bin/sh', [scriptPath], {
    encoding: 'utf8',
    env: {...process.env, PATH: emptyPath}
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /brew install webp/);

  const executionRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'project-zero-cwebp-'));
  t.after(() => fsPromises.rm(executionRoot, {recursive: true, force: true}));
  const binDirectory = path.join(executionRoot, 'bin');
  const sourceDirectory = path.join(executionRoot, 'source');
  const outputDirectory = path.join(executionRoot, 'output');
  await Promise.all([
    fsPromises.mkdir(binDirectory),
    fsPromises.mkdir(sourceDirectory)
  ]);
  const fakeCwebp = path.join(binDirectory, 'cwebp');
  await fsPromises.writeFile(fakeCwebp, `#!/bin/sh
if [ "$1" = "-version" ]; then
  echo "1.3.2"
  exit 0
fi
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    output=$1
  fi
  shift
done
[ -n "$output" ] || exit 2
printf 'fake-webp' > "$output"
`);
  await fsPromises.chmod(fakeCwebp, 0o755);
  for (const scene of ['scene-a-sync', 'scene-b-awakening', 'scene-c-online']) {
    await fsPromises.writeFile(path.join(sourceDirectory, `${scene}.png`), 'fake-png');
  }
  const execution = childProcess.spawnSync(
    '/bin/sh',
    [scriptPath, sourceDirectory, outputDirectory],
    {
      encoding: 'utf8',
      env: {...process.env, PATH: `${binDirectory}:/usr/bin:/bin`}
    }
  );
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(
    (await fsPromises.readdir(outputDirectory)).sort(),
    ['scene-a-sync.webp', 'scene-b-awakening.webp', 'scene-c-online.webp']
  );
});

test('pack cleans the output and packaged smoke selects the exact current architecture', async () => {
  assert.equal(pkg.scripts.pack, 'node scripts/pack.cjs');
  assert.equal(pkg.scripts['pack:private'], 'node scripts/pack-private-theme.cjs');

  const calls = [];
  await cleanAndPack({
    projectRoot: '/repo',
    environment: {
      SAFE_VALUE: 'kept',
      PROJECT_ZERO_TEST_BRIDGE_MODULE: '/private/fake.cjs'
    },
    remove: async (target, options) => calls.push({target, options}),
    runBuilder: async options => calls.push(options)
  });
  assert.deepEqual(calls, [
    {target: '/repo/dist', options: {recursive: true, force: true}},
    {
      projectRoot: '/repo',
      environment: {SAFE_VALUE: 'kept'},
      arguments: ['--dir']
    }
  ]);
  assert.equal(
    unpackedApplicationDirectory('/repo', {platform: 'darwin', architecture: 'arm64'}),
    '/repo/dist/mac-arm64'
  );
  assert.equal(
    unpackedApplicationDirectory('/repo', {platform: 'darwin', architecture: 'x64'}),
    '/repo/dist/mac'
  );

  const smokeSource = fs.readFileSync(
    path.join(__dirname, 'e2e', 'packaged-smoke.test.cjs'),
    'utf8'
  );

  assert.match(smokeSource, /unpackedApplicationDirectory/);
  assert.doesNotMatch(smokeSource, /readdir\(|\.sort\(/);
});

test('electron-builder runner uses argv without a shell and strips test-only environment', async () => {
  let spawnCall;
  const fakeChild = new (require('node:events').EventEmitter)();
  const completion = runElectronBuilder({
    projectRoot: '/repo',
    environment: {
      SAFE_VALUE: 'kept',
      PROJECT_ZERO_TEST_BRIDGE_MODULE: '/private/fake.cjs',
      PROJECT_ZERO_TEST_TRACE: '/private/trace.json',
      PROJECT_ZERO_TEST_DISCONNECT_SIGNAL: 'SIGUSR2'
    },
    arguments: ['--dir'],
    spawnProcess(command, arguments_, options) {
      spawnCall = {command, arguments_, options};
      process.nextTick(() => fakeChild.emit('exit', 0, null));
      return fakeChild;
    }
  });
  await completion;

  assert.equal(spawnCall.command, process.execPath);
  assert.match(spawnCall.arguments_[0], /electron-builder\/out\/cli\/cli\.js$/);
  assert.deepEqual(spawnCall.arguments_.slice(1), ['--dir']);
  assert.equal(spawnCall.options.cwd, '/repo');
  assert.equal(spawnCall.options.stdio, 'inherit');
  assert.equal(spawnCall.options.shell, undefined);
  assert.deepEqual(spawnCall.options.env, {SAFE_VALUE: 'kept'});
});

test('public pack has no private theme input or validator path', async () => {
  const packSource = await fsPromises.readFile(path.join(__dirname, '..', 'scripts', 'pack.cjs'), 'utf8');
  assert.doesNotMatch(packSource, /theme-contract|validateThemeDirectory|LOCAL_THEME_DIR/);

  const calls = [];
  await cleanAndPack({
    projectRoot: '/repo',
    environment: {SAFE_VALUE: 'kept'},
    remove: async target => calls.push(['remove', target]),
    runBuilder: async options => calls.push(['builder', options])
  });
  assert.deepEqual(calls.map(call => call[0]), ['remove', 'builder']);
});
