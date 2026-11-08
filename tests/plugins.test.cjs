'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {PluginManager} = require('../workbench/plugins.cjs');

function fixture() {
  const calls = [];
  const catalog = {
    installed: [],
    available: [{
      pluginId: 'openai-developers@openai-curated', name: 'openai-developers',
      marketplaceName: 'openai-curated', version: '1.0.0', installed: false, enabled: false
    }]
  };
  const manager = new PluginManager({
    codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex',
    async runner(file, args, options) {
      calls.push({file, args, options});
      if (args[1] === 'list') return {stdout: JSON.stringify(catalog), stderr: ''};
      return {stdout: JSON.stringify({ok: true}), stderr: ''};
    }
  });
  return {manager, calls};
}

test('plugin changes accept only catalog identifiers and explicit operations', async () => {
  const {manager, calls} = fixture();
  await manager.list('/tmp/project');
  await manager.change('openai-developers@openai-curated', 'install', '/tmp/project');
  assert.deepEqual(calls[1].args, ['plugin', 'add', 'openai-developers@openai-curated', '--json']);
  await assert.rejects(manager.change('../bad', 'install', '/tmp/project'), /catalog/);
  await assert.rejects(manager.change('openai-developers@openai-curated', 'enable', '/tmp/project'), /operation/);
});

test('plugin list caches only sanitized official catalog fields', async () => {
  const {manager, calls} = fixture();
  const first = await manager.list('/tmp/project');
  const second = await manager.list('/tmp/project');
  assert.equal(calls.length, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first.available[0], {
    id: 'openai-developers@openai-curated', name: 'openai-developers', marketplace: 'openai-curated',
    version: '1.0.0', installed: false, enabled: false
  });
});

test('plugin list rejects malformed or oversized CLI output', async () => {
  const malformed = new PluginManager({codexPath: '/codex', runner: async () => ({stdout: '{bad'})});
  await assert.rejects(malformed.list('/tmp'), /catalog/);
  const huge = new PluginManager({codexPath: '/codex', runner: async () => ({stdout: 'x'.repeat(20 * 1024 * 1024 + 1)})});
  await assert.rejects(huge.list('/tmp'), /catalog/);
});
