'use strict';

const fs = require('node:fs');
const {EventEmitter} = require('node:events');

const MODEL = Object.freeze({
  id: 'project-zero-test-model',
  model: 'project-zero-test-model',
  displayName: 'PROJECT ZERO Test Model',
  description: 'Deterministic in-memory model for Electron tests',
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: Object.freeze([
    Object.freeze({reasoningEffort: 'low', description: 'Low'}),
    Object.freeze({reasoningEffort: 'medium', description: 'Medium'}),
    Object.freeze({reasoningEffort: 'high', description: 'High'})
  ]),
  inputModalities: Object.freeze(['text', 'image'])
});

class InMemoryCodexBridge extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.connected = false;
    this.stopPromise = null;
    this.nextThread = 1;
    this.nextTurn = 1;
    this.nextApproval = 100;
    this.pendingApprovals = new Map();
  }

  async start() {
    if (this.connected) throw Error('Bridge already started');
    this.stopPromise = null;
    this.connected = true;
    const disconnectSignal = process.env.PROJECT_ZERO_TEST_DISCONNECT_SIGNAL;
    if (typeof disconnectSignal === 'string' && disconnectSignal.length > 0) {
      this.disconnectTimer = setInterval(() => {
        if (!this.connected || !fs.existsSync(disconnectSignal)) return;
        clearInterval(this.disconnectTimer);
        this.disconnectTimer = null;
        this.connected = false;
        this.record('disconnected');
        this.emit('disconnected', 'CODEX_DISCONNECTED');
      }, 25);
      this.disconnectTimer.unref?.();
    }
  }

  record(event) {
    if (process.env.PROJECT_ZERO_TEST_TRACE) {
      fs.appendFileSync(process.env.PROJECT_ZERO_TEST_TRACE, `${event}\n`, {encoding: 'utf8'});
    }
  }

  async request(method, params = {}) {
    if (!this.connected) throw Error('Codex is disconnected');
    this.calls.push(method);
    this.record(method);
    if (method === 'configRequirements/read') return {requirements: {}};
    if (method === 'account/read') {
      return {
        account: {type: 'chatgpt', email: null, planType: 'plus'},
        requiresOpenaiAuth: true
      };
    }
    if (method === 'model/list') {
      return {
        data: [{
          ...MODEL,
          supportedReasoningEfforts: MODEL.supportedReasoningEfforts.map(option => ({...option})),
          inputModalities: [...MODEL.inputModalities]
        }],
        nextCursor: null
      };
    }
    if (method === 'thread/start') {
      return {thread: {id: `thread-${this.nextThread++}`, name: '', turns: []}};
    }
    if (method === 'thread/resume') return {thread: {id: params.threadId, name: '', turns: []}};
    if (method === 'turn/start') {
      const turnId = `turn-${this.nextTurn++}`;
      const approvalId = this.nextApproval++;
      this.pendingApprovals.set(approvalId, {threadId: params.threadId, turnId});
      setImmediate(() => {
        if (!this.connected || !this.pendingApprovals.has(approvalId)) return;
        this.emit('approval', {
          id: approvalId,
          method: 'item/commandExecution/requestApproval',
          params: {
            threadId: params.threadId,
            turnId,
            itemId: `command-${turnId}`,
            command: 'printf "检查完成"',
            startedAtMs: Date.now()
          }
        });
      });
      return {turn: {id: turnId, status: 'inProgress', items: []}};
    }
    if (method === 'turn/interrupt') {
      setImmediate(() => this.emit('notification', {
        method: 'turn/completed', params: {threadId: params.threadId, turn: {id: params.turnId, status: 'interrupted'}}
      }));
      return {};
    }
    if (['thread/name/set', 'thread/archive', 'thread/unarchive'].includes(method)) return {};
    throw Error(`Unsupported in-memory Codex request: ${method}`);
  }

  respond(id, result) {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;
    this.pendingApprovals.delete(id);
    const {threadId, turnId} = pending;
    const commandId = `command-${turnId}`;
    const messageId = `message-${turnId}`;
    if (result?.decision !== 'accept') {
      this.emit('notification', {
        method: 'turn/completed', params: {threadId, turn: {id: turnId, status: 'interrupted'}}
      });
      return;
    }
    this.emit('notification', {
      method: 'item/started',
      params: {threadId, turnId, item: {id: commandId, type: 'commandExecution', command: 'printf "检查完成"', status: 'inProgress'}}
    });
    this.emit('notification', {
      method: 'item/completed',
      params: {threadId, turnId, item: {id: commandId, type: 'commandExecution', command: 'printf "检查完成"', aggregatedOutput: 'COMMAND OK\n', status: 'completed'}}
    });
    this.emit('notification', {
      method: 'item/agentMessage/delta', params: {threadId, turnId, itemId: messageId, delta: '检查完成'}
    });
    this.emit('notification', {
      method: 'item/completed',
      params: {threadId, turnId, item: {id: messageId, type: 'agentMessage', text: '检查完成', status: 'completed'}}
    });
    this.emit('notification', {
      method: 'turn/completed', params: {threadId, turn: {id: turnId, status: 'completed'}}
    });
  }

  respondError() {}

  stop() {
    clearInterval(this.disconnectTimer);
    this.disconnectTimer = null;
    this.connected = false;
    this.stopPromise ||= Promise.resolve();
    return this.stopPromise;
  }
}

function createBridgeOptions() {
  const options = {
    CodexBridgeClass: InMemoryCodexBridge,
    enableTestBridge: true,
    locateCodex: () => 'in-memory-test-codex',
    resolvePathCodex: () => null
  };
  if (process.env.PROJECT_ZERO_TEST_DATA_ROOT) options.dataRoot = process.env.PROJECT_ZERO_TEST_DATA_ROOT;
  return options;
}

module.exports = {createBridgeOptions, InMemoryCodexBridge};
