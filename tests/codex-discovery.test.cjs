const test = require('node:test');
const assert = require('node:assert/strict');
const {candidatePaths, findCodex} = require('../app/codex-discovery.cjs');

test('bundled ChatGPT binary precedes PATH and user selection', () => {
  assert.deepEqual(candidatePaths('/custom/codex', '/path/codex').slice(0, 3), [
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/path/codex', '/custom/codex'
  ]);
});

test('findCodex returns the first executable candidate', () => {
  const result = findCodex({exists: p => p === '/path/codex', pathCodex: '/path/codex'});
  assert.equal(result, '/path/codex');
});
