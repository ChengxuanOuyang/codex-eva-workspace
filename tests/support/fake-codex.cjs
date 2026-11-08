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

  async request(method) {
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
    throw Error(`Unsupported in-memory Codex request: ${method}`);
  }

  stop() {
    clearInterval(this.disconnectTimer);
    this.disconnectTimer = null;
    this.connected = false;
    this.stopPromise ||= Promise.resolve();
    return this.stopPromise;
  }
}

function createBridgeOptions() {
  return {
    CodexBridgeClass: InMemoryCodexBridge,
    locateCodex: () => 'in-memory-test-codex',
    resolvePathCodex: () => null
  };
}

module.exports = {createBridgeOptions, InMemoryCodexBridge};
