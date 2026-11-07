'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  InMemoryCodexBridge,
  bridgeOptionsForEnvironment
} = require('../app/main.cjs');

class RealCodexBridge {}

test('fake bridge requires both the test environment and explicit fake switch', () => {
  for (const environment of [
    {},
    {NODE_ENV: 'test'},
    {PROJECT_ZERO_FAKE_CODEX: '1'},
    {NODE_ENV: 'production', PROJECT_ZERO_FAKE_CODEX: '1'},
    {NODE_ENV: 'test', PROJECT_ZERO_FAKE_CODEX: '0'}
  ]) {
    assert.deepEqual(bridgeOptionsForEnvironment(environment, RealCodexBridge), {});
  }

  const options = bridgeOptionsForEnvironment({
    NODE_ENV: 'test',
    PROJECT_ZERO_FAKE_CODEX: '1'
  }, RealCodexBridge);
  assert.equal(options.CodexBridgeClass, InMemoryCodexBridge);
  assert.equal(options.locateCodex(), 'in-memory-test-codex');
});

test('in-memory bridge exposes signed-in account and a fixed usable model catalog', async () => {
  const bridge = new InMemoryCodexBridge();

  assert.equal(bridge.child, undefined);
  assert.equal(bridge.connected, false);
  await bridge.start();
  assert.equal(bridge.connected, true);
  assert.deepEqual(await bridge.request('account/read'), {
    account: {signedIn: true}
  });
  assert.deepEqual(await bridge.request('model/list'), {
    data: [{
      id: 'project-zero-test-model',
      model: 'project-zero-test-model',
      displayName: 'PROJECT ZERO Test Model',
      description: 'Deterministic in-memory model for Electron tests',
      hidden: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      inputModalities: ['text', 'image']
    }],
    nextCursor: null
  });
  assert.equal(bridge.child, undefined);

  const firstStop = bridge.stop();
  const secondStop = bridge.stop();
  assert.ok(firstStop instanceof Promise);
  assert.equal(secondStop, firstStop);
  await firstStop;
  assert.equal(bridge.connected, false);
});

test('in-memory bridge rejects unsupported requests instead of inventing responses', async () => {
  const bridge = new InMemoryCodexBridge();
  await bridge.start();

  await assert.rejects(bridge.request('thread/list'), /Unsupported in-memory Codex request/);
});
