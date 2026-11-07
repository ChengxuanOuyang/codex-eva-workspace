'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('unit verification cannot discover or launch Electron end-to-end tests', () => {
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(pkg.scripts.verify, 'npm run lint && npm test');
  assert.equal(pkg.scripts['test:e2e'], 'node --test tests/e2e/*.test.cjs');
});

test('production scripts and packaging never enable the test bridge', () => {
  const productionConfiguration = {
    build: pkg.build,
    scripts: Object.fromEntries(Object.entries(pkg.scripts).filter(([name]) => name !== 'test:e2e'))
  };

  assert.doesNotMatch(JSON.stringify(productionConfiguration), /PROJECT_ZERO_FAKE_CODEX|NODE_ENV=test/);
});
