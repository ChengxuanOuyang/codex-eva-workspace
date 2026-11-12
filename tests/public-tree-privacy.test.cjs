'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

test('tracked public documentation and renderer omit private owner identifiers', () => {
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['ls-files', '-z', 'README.md', 'docs', 'renderer', 'app', 'scripts', 'tests', 'package.json'], {cwd: root})
    .toString().split('\0').filter(file => /\.(?:md|cjs|mjs|js|css|html|json)$/.test(file));
  const forbidden = [
    /REI[ ]PRIVATE/,
    /BF[.]JUV/,
    new RegExp(['609_', '1794013039'].join('')),
    new RegExp(['/Users/', 'harrison', 'rio'].join(''))
  ];
  const leaks = files.filter(file => forbidden.some(pattern => pattern.test(fs.readFileSync(path.join(root, file), 'utf8'))));
  assert.deepEqual(leaks, []);
});
