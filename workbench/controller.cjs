'use strict';

const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const fs = require('node:fs/promises');
const {normalizeModels, selectModel} = require('./model-options.cjs');
const {reduceEvent} = require('./state-reducer.cjs');

const MAX_MESSAGE_LENGTH = 60_000;
const MAX_ITEM_TEXT = 512 * 1024;
const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput'
]);

function clone(value) {
  return structuredClone(value);
}

function itemText(item) {
  if (typeof item.text === 'string') return item.text.slice(-MAX_ITEM_TEXT);
  return (item.content || [])
    .filter(part => ['input_text', 'output_text', 'text'].includes(part?.type) && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
    .slice(-MAX_ITEM_TEXT);
}

function hydrateThread(local, remote) {
  if (!Array.isArray(remote?.turns)) return false;
  const hadActiveTurn = Boolean(local.activeTurn);
  if (remote.turns.length === 0) {
    local.activeTurn = null;
    if (hadActiveTurn) local.status = 'interrupted';
    local.title = remote.name || local.title;
    return hadActiveTurn;
  }
  local.messages = [];
  local.tools = [];
  for (const turn of remote.turns) {
    for (const item of turn.items || []) {
      if (item.type === 'userMessage') {
        local.messages.push({id: item.id, role: 'user', text: itemText(item), status: item.status || 'completed'});
      } else {
        reduceEvent(local, 'item/completed', {item});
      }
    }
    local.status = turn.status || local.status;
  }
  local.title = remote.name || local.title;
  const lastTurn = remote.turns.at(-1);
  local.activeTurn = lastTurn.status === 'inProgress' ? lastTurn.id : null;
  return true;
}

class WorkbenchController extends EventEmitter {
  constructor({bridge, store}) {
    super();
    this.bridge = bridge;
    this.store = store;
    this.state = store.read();
    this.models = [];
    this.resumed = new Set();
    this.approvals = new Map();
    this.turnLocks = new Set();
    this.persistQueue = Promise.resolve();
    this.persistTimer = null;
    this.closed = false;
    this.attached = false;
    this.onNotification = message => this.handleNotification(message.method, message.params);
    this.onApproval = message => this.handleApproval(message);
    this.onDisconnected = () => {
      for (const thread of this.state.threads) {
        if (thread.activeTurn) {
          thread.activeTurn = null;
          thread.status = 'disconnected';
        }
      }
      this.resumed.clear();
      this.persist();
    };
  }

  async initialize() {
    const pages = [];
    const cursors = new Set();
    let cursor;
    do {
      const page = await this.bridge.request('model/list', cursor === undefined ? {} : {cursor});
      pages.push(page);
      cursor = page?.nextCursor || undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Repeated model catalog cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    this.models = normalizeModels(pages);
    if (this.models.length === 0) throw new Error('No supported Codex models');
    this.bridge.on?.('notification', this.onNotification);
    this.bridge.on?.('approval', this.onApproval);
    this.bridge.on?.('disconnected', this.onDisconnected);
    this.attached = true;
    for (const thread of this.state.threads.filter(entry => entry.activeTurn)) await this.resume(thread);
    return this.snapshot();
  }

  snapshot() {
    return {
      ...clone(this.state),
      connected: this.bridge.connected !== false,
      models: clone(this.models),
      approvals: [...this.approvals.values()].map(approval => clone({
        id: String(approval.id), method: approval.method, params: approval.params
      }))
    };
  }

  persist() {
    const snapshot = clone(this.state);
    const operation = this.persistQueue.then(() => this.store.update(state => {
      state.version = snapshot.version;
      state.projects = snapshot.projects;
      state.threads = snapshot.threads;
    }));
    this.persistQueue = operation.catch(() => {});
    this.emit('snapshot', this.snapshot());
    return operation;
  }

  schedulePersist() {
    this.emit('snapshot', this.snapshot());
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 100);
    this.persistTimer.unref?.();
  }

  async addProject(projectPath) {
    const canonical = await fs.realpath(projectPath);
    const stats = await fs.stat(canonical);
    if (!stats.isDirectory()) throw new Error('Project must be a directory');
    const existing = this.state.projects.find(project => project.path === canonical);
    if (existing) return clone(existing);
    const project = {id: crypto.randomUUID(), path: canonical, name: canonical.split('/').at(-1)};
    this.state.projects.push(project);
    await this.persist();
    return clone(project);
  }

  projectFor(id) {
    const project = this.state.projects.find(entry => entry.id === id);
    if (!project) throw new Error('Unknown project');
    return project;
  }

  threadFor(id) {
    const thread = this.state.threads.find(entry => entry.id === id);
    if (!thread) throw new Error('Unknown thread');
    return thread;
  }

  async createThread({projectId, model: modelId, effort}) {
    const project = this.projectFor(projectId);
    const model = selectModel(this.models, modelId, effort);
    const response = await this.bridge.request('thread/start', {
      cwd: project.path,
      model: model.model,
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user'
    });
    if (!response?.thread?.id) throw new Error('Codex returned an invalid thread');
    const thread = {
      id: response.thread.id,
      projectId,
      title: response.thread.name || '新任务',
      archived: false,
      model: model.id,
      effort,
      messages: [],
      tools: [],
      status: 'idle',
      activeTurn: null
    };
    this.state.threads.push(thread);
    this.resumed.add(thread.id);
    await this.persist();
    return clone(thread);
  }

  async resume(thread) {
    if (this.resumed.has(thread.id)) return;
    const project = this.projectFor(thread.projectId);
    const model = selectModel(this.models, thread.model, thread.effort);
    const response = await this.bridge.request('thread/resume', {
      threadId: thread.id,
      cwd: project.path,
      model: model.model,
      sandbox: 'read-only',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user'
    });
    if (hydrateThread(thread, response?.thread)) await this.persist();
    this.resumed.add(thread.id);
  }

  async send({threadId, text, model: modelId, effort, attachments = []}) {
    const thread = this.threadFor(threadId);
    if (this.turnLocks.has(threadId)) throw new Error('Thread already has an active turn');
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_MESSAGE_LENGTH) {
      throw new Error('Invalid user message');
    }
    this.turnLocks.add(threadId);
    try {
      const model = selectModel(this.models, modelId, effort);
      if (attachments.length && !model.inputModalities.includes('image')) throw new Error('Model does not support image input');
      await this.resume(thread);
      if (thread.activeTurn) throw new Error('Thread already has an active turn');
      const input = [{type: 'text', text}];
      for (const attachment of attachments) input.push({type: 'localImage', path: attachment.path});
      const response = await this.bridge.request('turn/start', {threadId, input, model: model.model, effort});
      if (!response?.turn?.id) throw new Error('Codex returned an invalid turn');
      thread.model = model.id;
      thread.effort = effort;
      thread.messages.push({id: crypto.randomUUID(), role: 'user', text, status: 'completed'});
      thread.activeTurn = response.turn.id;
      thread.status = response.turn.status || 'inProgress';
      await this.persist();
      return clone(thread);
    } finally {
      this.turnLocks.delete(threadId);
    }
  }

  async cancel(threadId) {
    const thread = this.threadFor(threadId);
    if (!thread.activeTurn) throw new Error('Thread has no active turn');
    await this.bridge.request('turn/interrupt', {threadId, turnId: thread.activeTurn});
  }

  async renameThread(id, title) {
    const thread = this.threadFor(id);
    if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('Invalid thread title');
    await this.bridge.request('thread/name/set', {threadId: id, name: title.trim()});
    thread.title = title.trim();
    await this.persist();
    return clone(thread);
  }

  async archiveThread(id, archived) {
    const thread = this.threadFor(id);
    await this.bridge.request(archived ? 'thread/archive' : 'thread/unarchive', {threadId: id});
    thread.archived = Boolean(archived);
    await this.persist();
    return clone(thread);
  }

  handleNotification(method, params = {}) {
    if (method === 'turn/completed' && params.turn?.id) this.clearTurnApprovals(params.threadId, params.turn.id);
    const threadId = params.threadId || params.thread?.id;
    const thread = this.state.threads.find(entry => entry.id === threadId);
    if (!thread) return false;
    reduceEvent(thread, method, params);
    if (method === 'turn/completed') void this.persist();
    else this.schedulePersist();
    return true;
  }

  handleApproval(message) {
    if (!APPROVAL_METHODS.has(message?.method)) {
      this.bridge.respondError(message?.id, {
        code: -32601,
        message: 'Unsupported request; no permission granted'
      });
      return false;
    }
    const params = message.params || {};
    const thread = this.state.threads.find(entry => entry.id === params.threadId);
    if (!thread || !params.itemId || !params.turnId || thread.activeTurn !== params.turnId) {
      const approval = {method: message.method, params};
      this.bridge.respond(message.id, this.approvalResult(approval, {accept: false}));
      return false;
    }
    const id = String(message.id);
    this.approvals.set(id, {
      id: message.id,
      method: message.method,
      params: clone(message.params || {})
    });
    this.emit('snapshot', this.snapshot());
    return true;
  }

  approvalResult(approval, {accept, answers}) {
    if (approval.method === 'item/commandExecution/requestApproval' ||
        approval.method === 'item/fileChange/requestApproval') {
      return {decision: accept ? 'accept' : 'decline'};
    }
    if (approval.method === 'item/permissions/requestApproval') {
      return {
        permissions: accept ? clone(approval.params.permissions || {}) : {},
        scope: 'turn'
      };
    }
    const values = accept && answers && typeof answers === 'object' ? answers : {};
    return {answers: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
      answers: Array.isArray(value) ? value.map(String) : [String(value)]
    }]))};
  }

  async answerApproval({id, accept, answers}) {
    const key = String(id);
    const approval = this.approvals.get(key);
    if (!approval) throw new Error('Unknown approval');
    this.approvals.delete(key);
    this.bridge.respond(approval.id, this.approvalResult(approval, {accept: accept === true, answers}));
    this.emit('snapshot', this.snapshot());
  }

  clearTurnApprovals(threadId, turnId) {
    for (const [key, approval] of this.approvals) {
      if (approval.params.threadId !== threadId || approval.params.turnId !== turnId) continue;
      this.approvals.delete(key);
      this.bridge.respond(approval.id, this.approvalResult(approval, {accept: false}));
    }
    this.emit('snapshot', this.snapshot());
  }

  detach() {
    if (!this.attached) return;
    this.bridge.off?.('notification', this.onNotification);
    this.bridge.off?.('approval', this.onApproval);
    this.bridge.off?.('disconnected', this.onDisconnected);
    for (const approval of this.approvals.values()) {
      try { this.bridge.respond(approval.id, this.approvalResult(approval, {accept: false})); } catch {}
    }
    this.approvals.clear();
    this.attached = false;
  }

  async drain() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      await this.persist();
    }
    await this.persistQueue;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    await this.drain();
    await this.store.close();
  }
}

module.exports = {WorkbenchController};
