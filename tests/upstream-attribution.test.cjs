'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('the Windows reference is pinned and media is excluded from its MIT-code notice', () => {
  const notice = fs.readFileSync('docs/code-origins.md', 'utf8');
  assert.match(notice, /Iris-change\/eva-codex-workbench/);
  assert.match(notice, /b12753e063d6b8752b4e0994e851d5cc0950f85b/);
  for (const file of ['motion-v12.js', 'stage-layout.js', 'sequence-audio.js', 'unified-sequence.js', 'boot-atmosphere.js']) {
    assert.match(notice, new RegExp(file.replace('.', '\\.')));
  }
  assert.match(notice, /NERV.*not.*MIT|NERV.*不.*MIT/i);
  assert.match(notice, /voice.*not copied|语音.*不复制/i);
  assert.match(notice, /private.*local.*only/i);
  assert.match(notice, /does not authorize[\s\S]*redistribution/i);
  assert.match(notice, /does not authorize[\s\S]*public use/i);
  assert.match(notice, /MIT code notice[\s\S]*does not[\s\S]*cover[\s\S]*MIT/i);
});
