'use strict';

// Lifecycle adapted from Iris-change/eva-codex-workbench/workbench/bridge.cjs
// at commit 297b522 (MIT License, Copyright (c) 2026 Iris-change).
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');

const STOP_TIMEOUT_MS = 2000;
const RPC_ERROR_MESSAGE = 'Codex request failed';
const DISCONNECTED_CODE = 'CODEX_DISCONNECTED';
const ALLOWED_RPC_DATA_FIELDS = new Map([
  ['kind', 'string'],
  ['retryable', 'boolean']
]);
const ALLOWED_RPC_KINDS = new Set([
  'authentication', 'conflict', 'internal', 'not_found', 'permission', 'rate_limit', 'validation'
]);

function redactRpcData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const redacted = {};
  for (const [field, expectedType] of ALLOWED_RPC_DATA_FIELDS) {
    if (typeof data[field] !== expectedType) continue;
    if (field === 'kind' && !ALLOWED_RPC_KINDS.has(data[field])) continue;
    redacted[field] = data[field];
  }
  return Object.keys(redacted).length ? redacted : undefined;
}

class CodexRpcError extends Error {
  constructor(error) {
    super(RPC_ERROR_MESSAGE);
    this.name = 'CodexRpcError';
    if (Number.isInteger(error?.code)) this.code = error.code;
    const data = redactRpcData(error?.data);
    if (data) this.data = data;
  }
}

class CodexBridge extends EventEmitter {
  constructor(executable = 'codex', spawnProcess = spawn, {stopTimeoutMs = STOP_TIMEOUT_MS} = {}) {
    super();
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
    this.stopTimeoutMs = stopTimeoutMs;
    this.stopPromise = null;
    this.stoppingChild = null;
  }

  async start() {
    if (this.stopPromise) {
      await this.stopPromise;
      this.stopPromise = null;
    }
    if (this.child) throw Error('Bridge already started');

    const child = this.spawnProcess(this.executable, [
      'app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'
    ], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    this.child = child;

    const failed = error => {
      if (this.child === child) this.fail(error, child);
    };
    child.on('error', failed);
    child.stdin.on('error', failed);
    child.stdout.on('error', failed);
    child.stderr.on('error', failed);
    child.on('exit', code => failed(Error(`Codex process exited (${code})`)));

    // Startup logs may contain private account details, so stderr is only drained.
    child.stderr.resume();

    const lines = readline.createInterface({input: child.stdout});
    this.lines = lines;
    lines.on('error', failed);
    lines.on('line', line => {
      if (this.child !== child) return;
      try {
        this.receive(JSON.parse(line));
      } catch (error) {
        this.emit('diagnostic', 'CODEX_PROTOCOL_INVALID_JSON');
      }
    });

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'project-zero-pilot-codex-workbench',
          title: 'PROJECT ZERO — PILOT CODEX WORKBENCH',
          version: '0.1.0-preview.0'
        },
        capabilities: {experimentalApi: false}
      });
      if (this.child !== child) throw Error('Codex initialization interrupted');

      this.send({method: 'initialized'});
      this.connected = true;
    } catch (error) {
      try {
        await this.stop(error);
      } catch {
        // The caller's lifecycle cleanup can retry or force the retained child.
      }
      throw error;
    }
  }

  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new CodexRpcError(message.error));
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) this.emit('approval', message);
    else if (message.method) this.emit('notification', message);
  }

  send(message) {
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw Error('Codex is disconnected');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error(`${method} timed out; operation may still be running`));
      }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      try {
        this.send({id, method, params});
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  respond(id, result) {
    this.send({id, result});
  }

  respondError(id, error) {
    this.send({id, error});
  }

  fail(error, child) {
    if (child && this.child !== child) return;
    const disconnected = Error('Codex connection stopped');
    disconnected.code = DISCONNECTED_CODE;
    void this.stop(disconnected).catch(() => {});
    this.emit('disconnected', DISCONNECTED_CODE);
  }

  stop(error = Error('Codex connection stopped')) {
    const child = this.child;
    this.child = null;
    this.connected = false;
    this.lines?.close();
    this.lines = null;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();

    if (!child) return this.stopPromise || Promise.resolve();

    this.stoppingChild = child;
    const stopPromise = new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        child.removeListener('exit', exited);
        child.removeListener('close', exited);
      };
      const exited = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.stoppingChild === child) this.stoppingChild = null;
        resolve();
      };
      const failed = stopError => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(stopError);
      };

      child.once('exit', exited);
      child.once('close', exited);
      timer = setTimeout(() => {
        failed(Error('Codex process did not exit after the termination signal'));
      }, this.stopTimeoutMs);

      try {
        if (child.exitCode !== null || child.signalCode !== null) return exited();
        child.stdin.end();
        if (!child.killed && child.kill() === false && child.pid !== null && child.pid !== undefined) {
          return failed(Error('Codex process did not accept the termination signal'));
        }
        if (child.pid === null || child.pid === undefined) return exited();
        if (child.exitCode !== null || child.signalCode !== null) exited();
      } catch (stopError) {
        failed(stopError);
      }
    });
    this.stopPromise = stopPromise;
    return stopPromise;
  }
}

module.exports = {CodexBridge, CodexRpcError, redactRpcData};
