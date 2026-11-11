'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('upstream engineering baseline is pinned to the inspected public source', () => {
  const origins = fs.readFileSync('docs/code-origins.md', 'utf8');
  assert.match(origins, /Iris-change\/eva-codex-workbench/);
  assert.match(origins, /9733eb192e8ef97d3e7469ede544cad2a6186519/);
  assert.match(origins, /unified-sequence\.js/);
  assert.match(origins, /sequence-timing\.js/);
  assert.match(origins, /public history.*red.*Asuka/i);
  assert.match(origins, /private.*EVANGELION-00.*not published/i);
  assert.match(origins, /NERV.*not.*MIT/i);
  assert.match(origins, /reference soundtrack.*not.*MIT/i);
  assert.match(origins, /private.*local.*only/i);
  assert.match(origins, /does not authorize[\s\S]*redistribution/i);
  assert.match(origins, /does not authorize[\s\S]*public use/i);
  assert.match(origins, /MIT code notice[\s\S]*does not[\s\S]*cover[\s\S]*MIT/i);
});
