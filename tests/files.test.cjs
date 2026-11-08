'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createProjectFiles} = require('../workbench/files.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-files-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'readme.txt'), 'hello');
  await fs.writeFile(path.join(root, '.env.production'), 'SECRET=value');
  await fs.mkdir(path.join(root, '.ssh'));
  await fs.writeFile(path.join(root, '.ssh', 'config'), 'Host secret');
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside');
  await fs.symlink(outside, path.join(root, 'escape'));
  t.after(() => fs.rm(base, {recursive: true, force: true}));
  const files = createProjectFiles(projectId => projectId === 'p1' ? root : null);
  return {files, root};
}

test('file preview reads bounded project text and returns metadata', async t => {
  const {files} = await fixture(t);

  const preview = await files.read('p1', 'readme.txt');

  assert.deepEqual(preview, {path: 'readme.txt', text: 'hello', size: 5});
});

test('file preview rejects traversal, symlink escape and credentials', async t => {
  const {files} = await fixture(t);

  await assert.rejects(files.read('p1', '../outside/secret.txt'), /outside/);
  await assert.rejects(files.read('p1', 'escape/secret.txt'), /outside/);
  await assert.rejects(files.read('p1', '.env.production'), /credential/i);
  await assert.rejects(files.read('p1', '.ssh/config'), /credential/i);
});

test('directory listing filters private and generated entries and rejects symlink directories', async t => {
  const {files, root} = await fixture(t);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.mkdir(path.join(root, '.git'));
  await fs.writeFile(path.join(root, 'auth.json'), '{}');

  const entries = await files.list('p1', '');

  assert.deepEqual(entries.map(entry => entry.name), ['readme.txt']);
  await assert.rejects(files.list('p1', 'escape'), /symlink|outside/i);
});

test('file preview rejects binary and oversized files', async t => {
  const {files, root} = await fixture(t);
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 0, 2]));
  await fs.writeFile(path.join(root, 'large.txt'), Buffer.alloc(512 * 1024 + 1, 65));

  await assert.rejects(files.read('p1', 'binary.bin'), /binary/i);
  await assert.rejects(files.read('p1', 'large.txt'), /large/i);
});
