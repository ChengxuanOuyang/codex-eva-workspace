'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

test('skip changes presentation only and never fabricates readiness or confirmation', () => {
  const initial = {phase: 'syncing', progress: 20, ready: false, confirmed: false};
  const skipped = nextBootState(initial, {type: 'skip'});

  assert.deepEqual(skipped, {phase: 'waiting', progress: 20, ready: false, confirmed: false});
  assert.equal(nextBootState(skipped, {type: 'confirm'}), skipped);
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
