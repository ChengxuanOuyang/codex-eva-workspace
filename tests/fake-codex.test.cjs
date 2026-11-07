'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {bridgeOptionsForEnvironment} = require('../app/main.cjs');
const {InMemoryCodexBridge, createBridgeOptions} = require('./support/fake-codex.cjs');

const fakeModule = path.join(__dirname, 'support', 'fake-codex.cjs');

test('test bridge requires explicit development-only module injection', () => {
  for (const environment of [
    {},
    {NODE_ENV: 'test'},
    {PROJECT_ZERO_TEST_BRIDGE_MODULE: fakeModule},
    {NODE_ENV: 'production', PROJECT_ZERO_TEST_BRIDGE_MODULE: fakeModule}
  ]) {
    assert.deepEqual(bridgeOptionsForEnvironment(environment, {isPackaged: false}), {});
  }

  const environment = {NODE_ENV: 'test', PROJECT_ZERO_TEST_BRIDGE_MODULE: fakeModule};
  const options = bridgeOptionsForEnvironment(environment, {isPackaged: false});
  assert.equal(options.CodexBridgeClass, InMemoryCodexBridge);
  assert.equal(options.locateCodex(), 'in-memory-test-codex');
});

test('packaged production refuses test bridge injection even with hostile environment flags', () => {
  let loads = 0;
  const options = bridgeOptionsForEnvironment({
    NODE_ENV: 'test',
    PROJECT_ZERO_TEST_BRIDGE_MODULE: fakeModule
  }, {
    isPackaged: true,
    loadTestBridge() {
      loads += 1;
      return {createBridgeOptions};
    }
  });

  assert.deepEqual(options, {});
  assert.equal(loads, 0);
});

test('external in-memory bridge matches official account and model response shapes', async () => {
  const bridge = new InMemoryCodexBridge();
  await bridge.start();

  assert.deepEqual(await bridge.request('account/read'), {
    account: {type: 'chatgpt', email: null, planType: 'plus'},
    requiresOpenaiAuth: true
  });
  assert.deepEqual(await bridge.request('model/list'), {
    data: [{
      id: 'project-zero-test-model',
      model: 'project-zero-test-model',
      displayName: 'PROJECT ZERO Test Model',
      description: 'Deterministic in-memory model for Electron tests',
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        {reasoningEffort: 'low', description: 'Low'},
        {reasoningEffort: 'medium', description: 'Medium'},
        {reasoningEffort: 'high', description: 'High'}
      ],
      inputModalities: ['text', 'image']
    }],
    nextCursor: null
  });
  assert.deepEqual(bridge.calls, ['account/read', 'model/list']);
  await bridge.stop();
});

test('external bridge rejects unsupported requests instead of inventing responses', async () => {
  const bridge = new InMemoryCodexBridge();
  await bridge.start();
  await assert.rejects(bridge.request('thread/list'), /Unsupported in-memory Codex request/);
});
