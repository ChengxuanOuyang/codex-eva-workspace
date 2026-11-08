'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
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
