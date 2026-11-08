const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const gitignorePath = path.join(__dirname, '..', '.gitignore');

test('application metadata and exact runtime versions are pinned', () => {
  assert.equal(pkg.name, 'project-zero-rei-codex-workbench');
  assert.equal(pkg.main, 'app/main.cjs');
  for (const version of Object.values({...pkg.dependencies, ...pkg.devDependencies})) {
    assert.doesNotMatch(version, /^[~^*]|latest$/);
  }
});

test('private and credential-bearing paths are ignored', () => {
  const ignore = fs.readFileSync(gitignorePath, 'utf8');
  for (const entry of ['private-themes/', '.env', 'auth.json', 'dist/', 'node_modules/']) {
    assert.match(ignore, new RegExp(entry.replace(/[./]/g, '\\$&')));
  }
});

test('private themes and private build outputs are excluded from Git', async () => {
  const ignore = await fs.promises.readFile(gitignorePath, 'utf8');
  assert.match(ignore, /^\/private-themes\/$/m);
  assert.match(ignore, /^\/\.private-build\/$/m);
  assert.match(ignore, /^\/dist-private\/$/m);
});
