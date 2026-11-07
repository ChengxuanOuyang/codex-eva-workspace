const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pkg = require('../package.json');

test('application metadata and exact runtime versions are pinned', () => {
  assert.equal(pkg.name, 'project-zero-rei-codex-workbench');
  assert.equal(pkg.main, 'app/main.cjs');
  for (const version of Object.values({...pkg.dependencies, ...pkg.devDependencies})) {
    assert.doesNotMatch(version, /^[~^*]|latest$/);
  }
});

test('private and credential-bearing paths are ignored', () => {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  for (const entry of ['private-themes/', '.env', 'auth.json', 'dist/', 'node_modules/']) {
    assert.match(ignore, new RegExp(entry.replace(/[./]/g, '\\$&')));
  }
});
