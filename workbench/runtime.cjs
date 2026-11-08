'use strict';

const {EventEmitter} = require('node:events');
const {createAttachmentStore} = require('./attachments.cjs');
const {WorkbenchController} = require('./controller.cjs');
const {createProjectFiles} = require('./files.cjs');
const {createStore} = require('./store.cjs');
const {collectDiagnostics} = require('./diagnostics.cjs');
const {GitService} = require('./git-service.cjs');
const {PluginManager} = require('./plugins.cjs');
const {TerminalManager} = require('./terminal.cjs');
const {ThemeManager} = require('./themes.cjs');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const pkg = require('../package.json');

class ProjectOperationLocks {
  constructor() { this.active = new Set(); }
  async run(projectId, operation) {
    if (this.active.has(projectId)) throw new Error('Project operation already in progress');
    this.active.add(projectId);
    try { return await operation(); }
    finally { this.active.delete(projectId); }
  }
}

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
    this.terminals = new TerminalManager();
    this.git = new GitService();
    this.themes = new ThemeManager({dataRoot});
    this.plugins = null;
    this.pluginExecutable = null;
    this.projectOperations = new ProjectOperationLocks();
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
    this.activated = true;
    const controller = await this.ensureController();
    const thread = controller.snapshot().threads.find(entry => entry.id === value.threadId);
    if (!thread) throw new Error('Unknown thread');
    const attachments = [];
    for (const attachment of value.attachments || []) {
      const saved = await this.attachments.get(attachment.id);
      attachments.push({path: saved.path});
    }
    return this.projectOperations.run(thread.projectId, () => controller.send({...value, attachments}));
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

  project(projectId) {
    const project = this.store?.read().projects.find(entry => entry.id === projectId);
    if (!project) throw new Error('Unknown project');
    return project;
  }

  async terminalList(projectId) {
    await this.ready();
    this.project(projectId);
    return this.terminals.list(projectId);
  }

  async terminalCreate(projectId, options) {
    await this.ready();
    return this.terminals.create(this.project(projectId), options);
  }

  terminalInput(id, data) { this.terminals.input(id, data); return {accepted: true}; }
  terminalResize(id, cols, rows) { this.terminals.resize(id, cols, rows); return {accepted: true}; }
  async terminalClose(id) { await this.terminals.close(id); return {closed: true}; }
  terminalSnapshot(id) { return this.terminals.snapshot(id); }
  terminalSubscribe(id, response, lastEventId) { return this.terminals.subscribe(id, response, lastEventId); }

  async gitStatus(projectId) {
    await this.ready();
    return this.git.status(this.project(projectId));
  }

  async gitDiff(projectId, options) {
    await this.ready();
    return {text: await this.git.diff(this.project(projectId), options)};
  }

  async gitMutate(projectId, input) {
    await this.ready();
    return this.projectOperations.run(projectId, async () => {
      if (this.snapshot().threads.some(thread => thread.projectId === projectId && thread.activeTurn)) {
        throw new Error('Git changes are disabled while a Codex task is running');
      }
      return this.git.mutate(this.project(projectId), input);
    });
  }

  pluginManager() {
    const executable = this.coordinator.bridge?.executable;
    if (typeof executable !== 'string') throw new Error('Codex plugin manager is unavailable');
    if (!this.plugins || this.pluginExecutable !== executable) {
      this.plugins = new PluginManager({codexPath: executable});
      this.pluginExecutable = executable;
    }
    return this.plugins;
  }

  async pluginList(projectId) {
    await this.ready();
    return this.pluginManager().list(this.project(projectId).path);
  }

  async pluginChange(projectId, id, operation) {
    await this.ready();
    return this.pluginManager().change(id, operation, this.project(projectId).path);
  }

  async themeList() { return this.themes.list(); }
  async themeImport(packPath) { return this.themes.importPack(packPath); }
  async themeExport(themeId) { return this.themes.exportSettings(themeId); }
  async themeAsset(themeId, kind) { return this.themes.readAsset(themeId, kind); }

  async diagnostics() {
    const bridge = this.coordinator.bridge;
    return collectDiagnostics({
      dataRoot: this.dataRoot,
      metadata: {
        appVersion: pkg.version,
        codexVersion: bridge?.executable ? 'installed' : 'unavailable',
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        osVersion: os.release()
      },
      connection: this.readiness.get()
    });
  }

  async saveSettings({codexPath = ''} = {}) {
    if (typeof codexPath !== 'string' || codexPath.length > 4096 || (codexPath && !path.isAbsolute(codexPath))) {
      throw new Error('Invalid Codex path');
    }
    const destination = path.join(this.dataRoot, 'settings.json');
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.mkdir(this.dataRoot, {recursive: true, mode: 0o700});
    await fs.writeFile(temporary, `${JSON.stringify({schemaVersion: 1, codexPath})}\n`, {mode: 0o600});
    await fs.rename(temporary, destination);
    return {saved: true, restartRequired: true};
  }

  async close() {
    await this.terminals.stop();
    await this.initializing?.catch(() => {});
    if (this.controller) {
      this.controller.off('snapshot', this.forwardSnapshot);
      this.controller.detach();
      await this.controller.drain();
    }
    await this.store?.close();
  }
}

module.exports = {ProjectOperationLocks, WorkbenchRuntime};
