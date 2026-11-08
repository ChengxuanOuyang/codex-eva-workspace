const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {candidatePaths, findCodex} = require('../app/codex-discovery.cjs');

const bundledCodex = '/Applications/ChatGPT.app/Contents/Resources/codex';

function hideBundledCodex(t) {
  const accessSync = fs.accessSync;
  const statSync = fs.statSync;
  const unavailable = candidate => {
    if (candidate !== bundledCodex) return false;
    const error = Error('bundled Codex hidden for discovery test');
    error.code = 'ENOENT';
    throw error;
  };
  t.mock.method(fs, 'accessSync', (candidate, mode) => {
    unavailable(candidate);
    return accessSync(candidate, mode);
  });
  t.mock.method(fs, 'statSync', candidate => {
    unavailable(candidate);
    return statSync(candidate);
  });
}

function temporaryCandidates(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-zero-codex-'));
  t.after(() => fs.rmSync(root, {recursive: true}));
  const directory = path.join(root, 'codex-directory');
  const nonExecutable = path.join(root, 'codex-non-executable');
  const executable = path.join(root, 'codex-executable');
  fs.mkdirSync(directory);
  fs.writeFileSync(nonExecutable, '#!/bin/sh\n');
  fs.chmodSync(nonExecutable, 0o644);
  fs.writeFileSync(executable, '#!/bin/sh\n');
  fs.chmodSync(executable, 0o755);
  return {directory, nonExecutable, executable};
}

test('bundled ChatGPT binary precedes PATH and user selection', () => {
  assert.deepEqual(candidatePaths('/custom/codex', '/path/codex').slice(0, 3), [
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/path/codex', '/custom/codex'
  ]);
});

test('findCodex returns the first executable candidate', () => {
  const result = findCodex({exists: p => p === '/path/codex', pathCodex: '/path/codex'});
  assert.equal(result, '/path/codex');
});

test('findCodex skips a directory and falls back to an executable file', t => {
  hideBundledCodex(t);
  const {directory, executable} = temporaryCandidates(t);

  assert.equal(findCodex({pathCodex: directory, userPath: executable}), executable);
});

test('findCodex skips a non-executable file and accepts an executable file', t => {
  hideBundledCodex(t);
  const {nonExecutable, executable} = temporaryCandidates(t);

  assert.equal(findCodex({pathCodex: nonExecutable, userPath: executable}), executable);
});
