'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

// Scan raw bytes, including binary files, without loading a large file into memory.
function containsSensitiveBytes(file, forbidden) {
  const handle = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    assert.ok(fs.fstatSync(handle).isFile(), 'tracked regular file changed during audit');
    const buffer = Buffer.alloc(64 * 1024);
    const overlap = Math.max(...forbidden.map(bytes => bytes.length)) - 1;
    let carry = Buffer.alloc(0);
    let length;
    while ((length = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
      const window = Buffer.concat([carry, buffer.subarray(0, length)]);
      if (forbidden.some(bytes => window.includes(bytes))) return true;
      carry = window.subarray(Math.max(0, window.length - overlap));
    }
    return false;
  } finally {
    fs.closeSync(handle);
  }
}

test('all tracked paths exclude private directories and regular files omit sensitive bytes', () => {
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['ls-files', '-z'], {cwd: root, maxBuffer: 16 * 1024 * 1024})
    .toString().split('\0').filter(Boolean);
  assert.deepEqual(files.filter(file => /^(?:private-themes|dist-private|\.private-build|\.superpowers)(?:\/|$)/.test(file)), []);
  const forbidden = [
    Buffer.from(['REI', 'PRIVATE'].join(' ')),
    Buffer.from(['BF', '.JUV'].join('')),
    Buffer.from(['609_', '1794013039'].join('')),
    Buffer.from(['/Users/', 'harrison', 'rio'].join(''))
  ];
  const leaks = files.filter(file => {
    const absolute = path.join(root, file);
    return fs.lstatSync(absolute).isFile() && containsSensitiveBytes(absolute, forbidden);
  });
  assert.deepEqual(leaks, []);
});
