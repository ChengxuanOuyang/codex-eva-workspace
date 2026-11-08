'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
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
  assert.equal(manifest.assets.length, 3);
  const recordedRuntimeFiles = [];
  for (const asset of manifest.assets) {
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
const {cleanAndPack, unpackedApplicationDirectory} = require('../scripts/pack.cjs');

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

test('pack cleans the output and packaged smoke selects the exact current architecture', async () => {
  assert.equal(pkg.scripts.pack, 'node scripts/pack.cjs');

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
