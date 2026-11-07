'use strict';

const {EventEmitter} = require('node:events');

const TEST_MODEL = Object.freeze({
  id: 'project-zero-test-model',
  model: 'project-zero-test-model',
  displayName: 'PROJECT ZERO Test Model',
  description: 'Deterministic in-memory model for Electron tests',
  hidden: false,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: Object.freeze(['low', 'medium', 'high']),
  inputModalities: Object.freeze(['text', 'image'])
});

class InMemoryCodexBridge extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.stopPromise = null;
  }

  async start() {
    if (this.connected) throw Error('Bridge already started');
    this.stopPromise = null;
    this.connected = true;
  }

  async request(method) {
    if (!this.connected) throw Error('Codex is disconnected');
    if (method === 'account/read') return {account: {signedIn: true}};
    if (method === 'model/list') {
      return {
        data: [{
          ...TEST_MODEL,
          supportedReasoningEfforts: [...TEST_MODEL.supportedReasoningEfforts],
          inputModalities: [...TEST_MODEL.inputModalities]
        }],
        nextCursor: null
      };
    }
    throw Error(`Unsupported in-memory Codex request: ${method}`);
  }

  stop() {
    this.connected = false;
    this.stopPromise ||= Promise.resolve();
    return this.stopPromise;
  }
}

function bridgeOptionsForEnvironment(environment) {
  if (environment.NODE_ENV !== 'test' || environment.PROJECT_ZERO_FAKE_CODEX !== '1') return {};
  return {
    CodexBridgeClass: InMemoryCodexBridge,
    locateCodex: () => 'in-memory-test-codex',
    resolvePathCodex: () => null
  };
}

if (process.versions.electron && process.type === 'browser') {
  const {bootstrap} = require('./lifecycle.cjs');
  bootstrap(require('electron'), bridgeOptionsForEnvironment(process.env));
}

module.exports = {InMemoryCodexBridge, bridgeOptionsForEnvironment};
