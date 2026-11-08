'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {GitService} = require('../workbench/git-service.cjs');

const run = promisify(execFile);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-git-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  await run('git', ['init', '-b', 'main'], {cwd: repo});
  await run('git', ['config', 'user.name', 'Test Pilot'], {cwd: repo});
  await run('git', ['config', 'user.email', 'pilot@example.test'], {cwd: repo});
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  await run('git', ['add', 'a.txt'], {cwd: repo});
  await run('git', ['commit', '-m', 'initial'], {cwd: repo});
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return {project: {id: 'p', path: repo}, repo};
}

test('Git operations preserve unstaged changes and reject unsafe paths', async t => {
  const {project, repo} = await fixture(t);
  const service = new GitService();
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\n');
  await service.mutate(project, {operation: 'stage', path: 'a.txt'});
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  const status = await service.status(project);
  assert.equal(status.files[0].index, 'M');
  assert.equal(status.files[0].worktree, 'M');
  await assert.rejects(service.diff(project, {path: '../secret'}), /path/);
  await assert.rejects(service.mutate(project, {operation: 'force-push'}), /unsupported/);
});

test('Git service supports safe branch, switch, commit and unstage operations', async t => {
  const {project, repo} = await fixture(t);
  const service = new GitService();
  await service.mutate(project, {operation: 'branch', name: 'feature/safe'});
  await service.mutate(project, {operation: 'switch', name: 'feature/safe'});
  assert.equal((await service.status(project)).branch, 'feature/safe');
  await fs.writeFile(path.join(repo, 'b.txt'), 'new\n');
  await service.mutate(project, {operation: 'stage', path: 'b.txt'});
  await service.mutate(project, {operation: 'unstage', path: 'b.txt'});
  assert.equal((await service.status(project)).files[0].index, '?');
  await service.mutate(project, {operation: 'stage', path: 'b.txt'});
  await service.mutate(project, {operation: 'commit', message: 'add b'});
  assert.equal((await service.status(project)).files.length, 0);
  await assert.rejects(service.mutate(project, {operation: 'branch', name: '../bad'}), /branch/);
});

test('Git errors redact credentials embedded in remote URLs', async t => {
  const {project, repo} = await fixture(t);
  const service = new GitService();
  await run('git', ['remote', 'add', 'origin', 'https://pilot:secret-token@example.invalid/repo.git'], {cwd: repo});
  await assert.rejects(service.mutate(project, {operation: 'fetch'}), error => {
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});
