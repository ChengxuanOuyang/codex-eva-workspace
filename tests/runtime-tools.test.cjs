'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ProjectOperationLocks} = require('../workbench/runtime.cjs');

test('project operations exclude Git and turn startup across the same project', async () => {
  const locks = new ProjectOperationLocks();
  let release;
  const first = locks.run('project-a', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(locks.run('project-a', async () => 'git'), /already in progress/);
  assert.equal(await locks.run('project-b', async () => 'other'), 'other');
  release('turn');
  assert.equal(await first, 'turn');
  assert.equal(await locks.run('project-a', async () => 'git'), 'git');
});
