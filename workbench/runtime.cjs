'use strict';

const {EventEmitter} = require('node:events');
const {createAttachmentStore} = require('./attachments.cjs');
const {WorkbenchController} = require('./controller.cjs');
const {createProjectFiles} = require('./files.cjs');
const {createStore} = require('./store.cjs');

class WorkbenchRuntime extends EventEmitter {
  constructor({coordinator, readiness, dataRoot, storeFactory = createStore}) {
    super();
    this.coordinator = coordinator;
    this.readiness = readiness;
    this.dataRoot = dataRoot;
    this.storeFactory = storeFactory;
    this.activated = false;
    this.controller = null;
    this.controllerBridge = null;
    this.store = null;
    this.files = null;
    this.attachments = null;
    this.initializing = null;
    this.retrying = null;
    this.forwardSnapshot = snapshot => this.emit('snapshot', snapshot);
  }

  async initializeStorage() {
    if (this.store) return;
    this.store = await this.storeFactory(this.dataRoot);
    this.attachments = await createAttachmentStore(this.dataRoot);
    this.files = createProjectFiles(projectId => {
      const project = this.store.read().projects.find(entry => entry.id === projectId);
      return project?.path || null;
    });
  }

  async ensureController() {
    const bridge = this.coordinator.bridge;
    if (!this.readiness.get().ready || !bridge || bridge.connected === false) throw new Error('Codex is not ready');
    if (this.controller && this.controllerBridge === bridge) return this.controller;
    if (this.initializing) return this.initializing;
    const operation = (async () => {
      await this.initializeStorage();
      if (this.controller) {
        this.controller.off('snapshot', this.forwardSnapshot);
        this.controller.detach();
        await this.controller.drain();
      }
      const controller = new WorkbenchController({bridge, store: this.store});
      await controller.initialize();
      controller.on('snapshot', this.forwardSnapshot);
      this.controller = controller;
      this.controllerBridge = bridge;
      this.emit('snapshot', controller.snapshot());
      return controller;
    })().finally(() => {
      if (this.initializing === operation) this.initializing = null;
    });
    this.initializing = operation;
    return operation;
  }

  async ready() {
    this.activated = true;
    await this.ensureController();
  }

  snapshot() {
    if (this.controller) return this.controller.snapshot();
    return {version: 1, projects: [], threads: [], models: [], approvals: []};
  }

  retry() {
    if (this.retrying) return this.retrying;
    const operation = Promise.resolve(this.coordinator.retry()).then(async result => {
      if (this.activated && result.ready) await this.ensureController();
      return result;
    }).finally(() => {
      if (this.retrying === operation) this.retrying = null;
    });
    this.retrying = operation;
    return operation;
  }

  async invoke(method, ...args) {
    this.activated = true;
    const controller = await this.ensureController();
    return controller[method](...args);
  }

  addProject(value) { return this.invoke('addProject', value); }
  createThread(value) { return this.invoke('createThread', value); }
  async send(value) {
    await this.ready();
    const attachments = [];
    for (const attachment of value.attachments || []) {
      const saved = await this.attachments.get(attachment.id);
      attachments.push({path: saved.path});
    }
    return this.invoke('send', {...value, attachments});
  }
  cancel(value) { return this.invoke('cancel', value); }
  renameThread(...value) { return this.invoke('renameThread', ...value); }
  archiveThread(...value) { return this.invoke('archiveThread', ...value); }
  answerApproval(value) { return this.invoke('answerApproval', value); }

  async listFiles(projectId, relativePath) {
    await this.ready();
    return this.files.list(projectId, relativePath);
  }

  async readFile(projectId, relativePath) {
    await this.ready();
    return this.files.read(projectId, relativePath);
  }

  async saveAttachment(input) {
    await this.ready();
    const saved = await this.attachments.save(input);
    return {id: saved.id, mime: saved.mime, size: saved.size, width: saved.width, height: saved.height};
  }

  async close() {
    await this.initializing?.catch(() => {});
    if (this.controller) {
      this.controller.off('snapshot', this.forwardSnapshot);
      this.controller.detach();
      await this.controller.drain();
    }
    await this.store?.close();
  }
}

module.exports = {WorkbenchRuntime};
