'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {WorkbenchController} = require('../workbench/controller.cjs');

function fixture() {
  const responses = [];
  const bridge = {
    on() {},
    off() {},
    respond(id, result) { responses.push({id, result}); },
    respondError(id, error) { responses.push({id, error}); }
  };
  const store = {
    read: () => ({version: 1, projects: [], threads: [{id: 'thread-1', activeTurn: 'turn-1', messages: [], tools: []}]}),
    update: async () => {},
    close: async () => {}
  };
  return {controller: new WorkbenchController({bridge, store}), responses};
}

test('unknown server requests are declined and never stored', () => {
  const {controller, responses} = fixture();
  controller.handleApproval({id: 9, method: 'unknown/request', params: {threadId: 'thread-1'}});

  assert.deepEqual(responses[0], {
    id: 9,
    error: {code: -32601, message: 'Unsupported request; no permission granted'}
  });
  assert.deepEqual(controller.snapshot().approvals, []);
});

test('known approvals for unknown or stale turns are declined immediately', () => {
  const {controller, responses} = fixture();
  controller.handleApproval({
    id: 8,
    method: 'item/commandExecution/requestApproval',
    params: {threadId: 'thread-1', turnId: 'turn-old', itemId: 'cmd-old'}
  });
  assert.deepEqual(controller.snapshot().approvals, []);
  assert.deepEqual(responses[0], {id: 8, result: {decision: 'decline'}});
});
test('command and file approvals are single-use and never persist beyond one response', async () => {
  const {controller, responses} = fixture();
  controller.handleApproval({
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: {threadId: 'thread-1', turnId: 'turn-1', itemId: 'cmd-1', command: 'npm test'}
  });
  assert.equal(controller.snapshot().approvals.length, 1);

  await controller.answerApproval({id: '7', accept: true});

  assert.deepEqual(responses[0], {id: 7, result: {decision: 'accept'}});
  assert.deepEqual(controller.snapshot().approvals, []);
  await assert.rejects(controller.answerApproval({id: '7', accept: false}), /Unknown approval/);
});

test('permission acceptance grants only the requested permissions for the current turn', async () => {
  const {controller, responses} = fixture();
  controller.handleApproval({
    id: 11,
    method: 'item/permissions/requestApproval',
    params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'permission-1',
      permissions: {network: true}
    }
  });

  await controller.answerApproval({id: '11', accept: true});

  assert.deepEqual(responses[0], {
    id: 11,
    result: {permissions: {network: true}, scope: 'turn'}
  });
});

test('user input answers use the official nested answer arrays', async () => {
  const {controller, responses} = fixture();
  controller.handleApproval({
    id: 12, method: 'item/tool/requestUserInput',
    params: {threadId: 'thread-1', turnId: 'turn-1', itemId: 'input-1', questions: [{id: 'mode'}]}
  });
  await controller.answerApproval({id: '12', accept: true, answers: {mode: '安全模式'}});
  assert.deepEqual(responses[0], {id: 12, result: {answers: {mode: {answers: ['安全模式']}}}});
});

test('turn completion clears unanswered approvals and declines them', () => {
  const {controller, responses} = fixture();
  controller.handleApproval({
    id: 13,
    method: 'item/fileChange/requestApproval',
    params: {threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-1'}
  });

  controller.handleNotification('turn/completed', {
    threadId: 'thread-1', turn: {id: 'turn-1', status: 'completed'}
  });

  assert.deepEqual(controller.snapshot().approvals, []);
  assert.deepEqual(responses[0], {id: 13, result: {decision: 'decline'}});
});
