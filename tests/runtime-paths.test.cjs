const test = require('node:test');
const assert = require('node:assert/strict');
const {runtimePaths} = require('../app/runtime-paths.cjs');

test('all writable files stay below userData', () => {
  const paths = runtimePaths('/tmp/project-zero');

  assert.equal(paths.state, '/tmp/project-zero/state/state.json');
  assert.equal(paths.logs, '/tmp/project-zero/logs');
  assert.equal(paths.themes, '/tmp/project-zero/themes');
});
