const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const gitignorePath = path.join(__dirname, '..', '.gitignore');

test('application metadata and exact runtime versions are pinned', () => {
  assert.equal(pkg.name, 'project-zero-pilot-codex-workbench');
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

test('public product identity is PILOT and contains no REI product branding', async () => {
  assert.equal(pkg.name, 'project-zero-pilot-codex-workbench');
  assert.equal(pkg.build.appId, 'io.github.chengxuanouyang.project-zero-pilot-workbench');
  assert.doesNotMatch(pkg.build.appId, /eva|rei|nerv/i);
  assert.equal(pkg.build.productName, 'PROJECT ZERO — PILOT CODEX WORKBENCH');
  const publicRuntime = await Promise.all([
    'package.json', 'NOTICE.md', 'workbench/bridge.cjs', 'renderer/boot/index.html'
  ].map(file => fs.promises.readFile(path.join(__dirname, '..', file), 'utf8')));
  assert.doesNotMatch(publicRuntime.join('\n'), /\bREI\b|绫波丽|EVANGELION|\bNERV\b/iu);
});

test('public tracked tree contains no internal superpowers workspace', () => {
  const projectRoot = path.join(__dirname, '..');
  const tracked = childProcess.execFileSync(
    'git',
    ['ls-files', '--', '.superpowers'],
    {cwd: projectRoot, encoding: 'utf8'}
  );
  assert.equal(tracked.trim(), '');
});
