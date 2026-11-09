'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {nextBootState} = require('../renderer/boot/boot-state.cjs');

test('progress cannot pass 99.2 before backend readiness and confirmation', () => {
  let state = {phase: 'syncing', progress: 98, ready: false, confirmed: false};

  state = nextBootState(state, {type: 'tick', delta: 4});
  assert.equal(state.progress, 99.2);
  assert.equal(nextBootState(state, {type: 'confirm'}), state);

  state = nextBootState(state, {type: 'ready'});
  state = nextBootState(state, {type: 'confirm'});
  assert.deepEqual(state, {phase: 'completing', progress: 99.2, ready: true, confirmed: true});
});

test('READY and confirmation only change authorization state, never timeline progress', () => {
  const atGate = {phase: 'syncing', progress: 99.2, ready: false, confirmed: false};
  const ready = nextBootState(atGate, {type: 'ready'});
  const confirmed = nextBootState(ready, {type: 'confirm'});

  assert.deepEqual(ready, {phase: 'syncing', progress: 99.2, ready: true, confirmed: false});
  assert.deepEqual(confirmed, {phase: 'completing', progress: 99.2, ready: true, confirmed: true});
});

test('skip atomically finishes presentation without fabricating readiness or confirmation', () => {
  const initial = {phase: 'syncing', progress: 20, ready: false, confirmed: false};
  const skipped = nextBootState(initial, {type: 'skip'});

  assert.deepEqual(skipped, {phase: 'waiting', progress: 99.2, ready: false, confirmed: false});
  assert.equal(nextBootState(skipped, {type: 'confirm'}), skipped);

  const ready = {phase: 'syncing', progress: 47, ready: true, confirmed: false};
  assert.deepEqual(nextBootState(ready, {type: 'skip'}), {
    phase: 'waiting', progress: 99.2, ready: true, confirmed: false
  });

  const failed = nextBootState(initial, {type: 'failed'});
  const recovered = nextBootState(failed, {type: 'ready'});
  assert.deepEqual(recovered, {phase: 'waiting', progress: 20, ready: true, confirmed: false});
  assert.deepEqual(nextBootState(recovered, {type: 'skip'}), {
    phase: 'waiting', progress: 99.2, ready: true, confirmed: false
  });
});

test('unknown events preserve the original state by reference and value', () => {
  const state = Object.freeze({phase: 'syncing', progress: 42, ready: false, confirmed: false});
  const snapshot = {...state};

  const result = nextBootState(state, {type: 'launch-workbench'});

  assert.equal(result, state);
  assert.deepEqual(result, snapshot);
});

test('failed marks readiness unavailable without leaking an event error', () => {
  const state = {phase: 'syncing', progress: 73, ready: true, confirmed: false};
  const failed = nextBootState(state, {type: 'failed', error: '/Users/example/private-token'});

  assert.deepEqual(failed, {phase: 'failed', progress: 73, ready: false, confirmed: false});
  assert.equal(Object.hasOwn(failed, 'error'), false);

  const recovered = nextBootState(failed, {type: 'ready'});
  assert.deepEqual(recovered, {phase: 'waiting', progress: 73, ready: true, confirmed: false});
});

test('repeated ready and confirm events are idempotent', () => {
  const ready = nextBootState(
    {phase: 'syncing', progress: 99.2, ready: false, confirmed: false},
    {type: 'ready'}
  );
  assert.equal(nextBootState(ready, {type: 'ready'}), ready);

  const confirmed = nextBootState(ready, {type: 'confirm'});
  assert.equal(nextBootState(confirmed, {type: 'confirm'}), confirmed);
});

test('complete is accepted only after confirmation and is idempotent', () => {
  const syncing = {phase: 'syncing', progress: 99.2, ready: true, confirmed: false};
  assert.equal(nextBootState(syncing, {type: 'complete'}), syncing);

  const completing = nextBootState(syncing, {type: 'confirm'});
  const complete = nextBootState(completing, {type: 'complete'});

  assert.deepEqual(complete, {phase: 'complete', progress: 100, ready: true, confirmed: true});
  assert.equal(nextBootState(complete, {type: 'complete'}), complete);
  assert.equal(nextBootState(complete, {type: 'skip'}), complete);
});

test('browser and CommonJS reducers satisfy the same event matrix', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'api.js'), 'utf8');
  const sandbox = {fetch: async () => ({ok: true, json: async () => ({ready: true})})};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/shared/api.js'});
  const browserReducer = sandbox.ProjectZeroApi.nextBootState;
  const states = [
    {phase: 'syncing', progress: 20, ready: false, confirmed: false},
    {phase: 'syncing', progress: 99.2, ready: true, confirmed: false},
    {phase: 'waiting', progress: 20, ready: false, confirmed: false},
    {phase: 'failed', progress: 73, ready: false, confirmed: false},
    {phase: 'completing', progress: 99.2, ready: true, confirmed: true},
    {phase: 'complete', progress: 100, ready: true, confirmed: true}
  ];
  const events = [
    {type: 'tick', delta: 4},
    {type: 'ready'},
    {type: 'failed', error: '/private/path'},
    {type: 'confirm'},
    {type: 'skip'},
    {type: 'complete'},
    {type: 'unknown'}
  ];

  for (const state of states) {
    for (const event of events) {
      const commonResult = nextBootState(state, event);
      const browserResult = browserReducer(state, event);
      assert.deepEqual(JSON.parse(JSON.stringify(browserResult)), commonResult, `${state.phase} + ${event.type}`);
      if (commonResult === state) assert.equal(browserResult, state, `${state.phase} + ${event.type} identity`);
    }
  }
});
