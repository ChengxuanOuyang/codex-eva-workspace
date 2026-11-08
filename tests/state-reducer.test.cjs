'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {reduceEvent} = require('../workbench/state-reducer.cjs');

test('interleaved message deltas join by item id and completion replaces text', () => {
  const thread = {messages: [], tools: [], status: 'inProgress'};
  reduceEvent(thread, 'item/agentMessage/delta', {itemId: 'a', delta: 'A'});
  reduceEvent(thread, 'item/agentMessage/delta', {itemId: 'b', delta: 'B'});
  reduceEvent(thread, 'item/completed', {item: {id: 'a', type: 'agentMessage', text: 'Answer'}});

  assert.deepEqual(thread.messages.map(message => message.text), ['Answer', 'B']);
});

test('turn lifecycle keeps failed and interrupted terminal states', () => {
  for (const status of ['failed', 'interrupted']) {
    const thread = {messages: [], tools: [], status: 'inProgress', activeTurn: 'turn-1'};
    reduceEvent(thread, 'turn/completed', {turn: {id: 'turn-1', status}});
    assert.equal(thread.status, status);
    assert.equal(thread.activeTurn, null);
  }
});

test('tool output is grouped by item and completed item replaces streamed output', () => {
  const thread = {messages: [], tools: [], status: 'inProgress'};
  reduceEvent(thread, 'item/started', {
    item: {id: 'cmd-1', type: 'commandExecution', command: 'pwd', status: 'inProgress'}
  });
  reduceEvent(thread, 'item/commandExecution/outputDelta', {itemId: 'cmd-1', delta: '/tmp'});
  reduceEvent(thread, 'item/completed', {
    item: {id: 'cmd-1', type: 'commandExecution', command: 'pwd', aggregatedOutput: '/workspace\n', status: 'completed'}
  });

  assert.deepEqual(thread.tools, [{
    id: 'cmd-1', type: 'commandExecution', title: 'pwd', output: '/workspace\n', status: 'completed'
  }]);
});

test('completed file changes retain bounded path and diff text for review', () => {
  const thread = {messages: [], tools: [], status: 'inProgress'};
  reduceEvent(thread, 'item/completed', {
    item: {
      id: 'change-1', type: 'fileChange', status: 'completed',
      changes: [{path: 'src/app.js', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new'}]
    }
  });

  assert.equal(thread.tools[0].title, 'src/app.js');
  assert.equal(thread.tools[0].output, '@@ -1 +1 @@\n-old\n+new');
});

test('user messages and reasoning items never appear as command tools', () => {
  const thread = {messages: [], tools: [], status: 'inProgress', activeTurn: 'turn-1'};
  reduceEvent(thread, 'item/started', {item: {id: 'u1', type: 'userMessage', text: 'hello'}});
  reduceEvent(thread, 'item/completed', {item: {id: 'r1', type: 'reasoning', text: 'private'}});
  assert.deepEqual(thread.tools, []);
});

test('completed assistant messages are bounded like streamed deltas', () => {
  const thread = {messages: [], tools: []};
  reduceEvent(thread, 'item/completed', {item: {id: 'large', type: 'agentMessage', text: 'x'.repeat(600 * 1024)}});
  assert.equal(thread.messages[0].text.length, 512 * 1024);
});
