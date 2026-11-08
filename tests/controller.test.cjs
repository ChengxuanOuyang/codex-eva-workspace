'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {WorkbenchController} = require('../workbench/controller.cjs');
const {createStore} = require('../workbench/store.cjs');

class FakeBridge extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.nextThread = 1;
    this.nextTurn = 1;
  }

  async request(method, params) {
    this.calls.push({method, params});
    if (method === 'model/list') {
      return {
        data: [
          {
            id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test', description: '', hidden: false,
            isDefault: true, defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'],
            supportedReasoningEfforts: [{reasoningEffort: 'low'}, {reasoningEffort: 'medium'}]
          },
          {
            id: 'hidden', model: 'hidden', displayName: 'Hidden', description: '', hidden: true,
            isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: []
          }
        ],
        nextCursor: null
      };
    }
    if (method === 'thread/start') {
      const id = `thread-${this.nextThread++}`;
      return {thread: {id, name: '', turns: []}};
    }
    if (method === 'thread/resume') return {thread: {id: params.threadId, name: '', turns: []}};
    if (method === 'turn/start') {
      return {turn: {id: `turn-${this.nextTurn++}`, status: 'inProgress', items: []}};
    }
    return {};
  }

  respond() {}
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-controller-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const store = await createStore(root);
  const bridge = new FakeBridge();
  const controller = new WorkbenchController({bridge, store});
  t.after(async () => {
    await controller.close();
    await fs.rm(root, {recursive: true, force: true});
  });
  await controller.initialize();
  return {root, project, store, bridge, controller};
}

test('creates a read-only thread with a catalog model and user-reviewed approvals', async t => {
  const {project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);

  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});

  assert.equal(thread.id, 'thread-1');
  assert.deepEqual(bridge.calls.find(call => call.method === 'thread/start'), {
    method: 'thread/start',
    params: {
      cwd: added.path,
      model: 'gpt-test',
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user'
    }
  });
});

test('starts a turn, rejects overlapping sends and interrupts the real active turn', async t => {
  const {project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'low'});

  await controller.send({threadId: thread.id, text: '检查项目', model: 'gpt-test', effort: 'low'});
  await assert.rejects(
    controller.send({threadId: thread.id, text: '第二条', model: 'gpt-test', effort: 'low'}),
    /active turn/
  );
  await controller.cancel(thread.id);

  assert.deepEqual(bridge.calls.find(call => call.method === 'turn/interrupt'), {
    method: 'turn/interrupt', params: {threadId: 'thread-1', turnId: 'turn-1'}
  });
});

test('locks a thread before asynchronous resume so concurrent sends cannot overlap', async t => {
  const {project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'low'});
  controller.resumed.delete(thread.id);
  let release;
  const original = bridge.request.bind(bridge);
  bridge.request = async (method, params) => {
    if (method === 'thread/resume') await new Promise(resolve => { release = resolve; });
    return original(method, params);
  };

  const first = controller.send({threadId: thread.id, text: '第一条', model: 'gpt-test', effort: 'low'});
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    controller.send({threadId: thread.id, text: '第二条', model: 'gpt-test', effort: 'low'}),
    /active turn/
  );
  release();
  await first;
  assert.equal(bridge.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('clears stale persisted active turns after remote resume confirms no active turn', async t => {
  const {root, project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});
  await controller.send({threadId: thread.id, text: '未完成', model: 'gpt-test', effort: 'medium'});
  await controller.close();

  const restoredStore = await createStore(root);
  const restored = new WorkbenchController({bridge, store: restoredStore});
  await restored.initialize();
  const recovered = restored.threadFor(thread.id);
  assert.equal(recovered.activeTurn, null);
  assert.equal(recovered.status, 'interrupted');
  assert.ok(bridge.calls.some(call => call.method === 'thread/resume' && call.params.threadId === thread.id));
  await restored.close();
});

test('resume preserves a remotely active turn and allows it to be interrupted', async t => {
  const {root, project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});
  await controller.close();
  bridge.request = async (method, params) => {
    bridge.calls.push({method, params});
    if (method === 'model/list') return {data: [{
      id: 'gpt-test', model: 'gpt-test', displayName: 'GPT Test', hidden: false, isDefault: true,
      defaultReasoningEffort: 'medium', inputModalities: ['text', 'image'],
      supportedReasoningEfforts: [{reasoningEffort: 'medium'}]
    }], nextCursor: null};
    if (method === 'thread/resume') return {thread: {
      id: params.threadId, name: '运行中', turns: [{id: 'remote-turn', status: 'inProgress', items: []}]
    }};
    return {};
  };
  const restored = new WorkbenchController({bridge, store: await createStore(root)});
  await restored.initialize();
  await assert.rejects(
    restored.send({threadId: thread.id, text: '不能重叠', model: 'gpt-test', effort: 'medium'}),
    /active turn/
  );
  assert.equal(restored.snapshot().threads[0].activeTurn, 'remote-turn');
  await restored.cancel(thread.id);
  assert.ok(bridge.calls.some(call => call.method === 'turn/interrupt' && call.params.turnId === 'remote-turn'));
  await restored.close();
});

test('one stale thread resume failure does not block workbench startup', async t => {
  const {root, project, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});
  await controller.send({threadId: thread.id, text: '旧任务', model: 'gpt-test', effort: 'medium'});
  await controller.close();
  const original = bridge.request.bind(bridge);
  bridge.request = async (method, params) => {
    if (method === 'thread/resume') throw new Error('gone');
    return original(method, params);
  };
  const restored = new WorkbenchController({bridge, store: await createStore(root)});
  await restored.initialize();
  const recovered = restored.threadFor(thread.id);
  assert.equal(recovered.activeTurn, null);
  assert.equal(recovered.status, 'disconnected');
  assert.equal(restored.snapshot().models.length, 1);
  await restored.close();
});

test('restored threads resume before the next turn and invalid options fail locally', async t => {
  const {root, project, store, bridge, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});
  await controller.close();

  const restoredStore = await createStore(root);
  const restored = new WorkbenchController({bridge, store: restoredStore});
  await restored.initialize();
  await assert.rejects(restored.createThread({projectId: added.id, model: 'hidden', effort: 'low'}), /model/);
  await assert.rejects(restored.send({threadId: thread.id, text: 'x', model: 'gpt-test', effort: 'ultra'}), /effort/);
  await restored.send({threadId: thread.id, text: '继续', model: 'gpt-test', effort: 'medium'});

  const resumeIndex = bridge.calls.findIndex(call => call.method === 'thread/resume');
  const turnIndex = bridge.calls.findIndex((call, index) => index > resumeIndex && call.method === 'turn/start');
  assert.ok(resumeIndex >= 0 && turnIndex > resumeIndex);
  await restored.close();
});

test('notifications update streamed state and preserve terminal failure status', async t => {
  const {project, controller} = await fixture(t);
  const added = await controller.addProject(project);
  const thread = await controller.createThread({projectId: added.id, model: 'gpt-test', effort: 'medium'});
  await controller.send({threadId: thread.id, text: '检查', model: 'gpt-test', effort: 'medium'});

  controller.handleNotification('item/agentMessage/delta', {threadId: thread.id, itemId: 'a', delta: '处理中'});
  controller.handleNotification('turn/completed', {threadId: thread.id, turn: {id: 'turn-1', status: 'failed'}});

  const current = controller.snapshot().threads.find(item => item.id === thread.id);
  assert.equal(current.messages.at(-1).text, '处理中');
  assert.equal(current.status, 'failed');
  assert.equal(current.activeTurn, null);
});
