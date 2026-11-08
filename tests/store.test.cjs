'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createStore} = require('../workbench/store.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-store-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return root;
}

test('store preserves corrupt input and starts with versioned empty state', async t => {
  const root = await fixture(t);
  const stateRoot = path.join(root, 'state');
  await fs.mkdir(stateRoot, {recursive: true});
  await fs.writeFile(path.join(stateRoot, 'state.json'), '{broken');

  const store = await createStore(root);

  assert.deepEqual(store.read(), {version: 1, projects: [], threads: []});
  const entries = await fs.readdir(stateRoot);
  assert.equal(entries.some(entry => /^state\.corrupt-.*\.json$/.test(entry)), true);
  await store.close();
});

test('store serializes updates, returns clones and persists atomically', async t => {
  const root = await fixture(t);
  const store = await createStore(root);
  const first = store.update(async state => {
    await new Promise(resolve => setTimeout(resolve, 5));
    state.projects.push({id: 'p1', path: '/tmp/one'});
  });
  const second = store.update(state => {
    state.projects.push({id: 'p2', path: '/tmp/two'});
  });
  await Promise.all([first, second]);

  const snapshot = store.read();
  snapshot.projects.length = 0;
  assert.deepEqual(store.read().projects.map(project => project.id), ['p1', 'p2']);
  await store.close();

  const restored = await createStore(root);
  assert.deepEqual(restored.read().projects.map(project => project.id), ['p1', 'p2']);
  assert.equal((await fs.readdir(path.join(root, 'state'))).includes('state.tmp'), false);
  await restored.close();
});

test('store rejects invalid mutations without replacing the last valid state', async t => {
  const root = await fixture(t);
  const store = await createStore(root);

  await assert.rejects(store.update(state => {
    state.version = 2;
  }), /Invalid workbench state/);

  assert.deepEqual(store.read(), {version: 1, projects: [], threads: []});
  await store.close();
});
