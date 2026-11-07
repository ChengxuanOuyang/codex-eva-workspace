'use strict';

// Lifecycle adapted from Iris-change/eva-codex-workbench/workbench/bridge.cjs
// at commit 297b522 (MIT License, Copyright (c) 2026 Iris-change).
const {spawn} = require('node:child_process');
const {EventEmitter} = require('node:events');
const readline = require('node:readline');

class CodexBridge extends EventEmitter {
  constructor(executable = 'codex', spawnProcess = spawn) {
    super();
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.pending = new Map();
    this.nextId = 1;
    this.connected = false;
  }

  async start() {
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
        this.emit('diagnostic', `Invalid app-server message: ${error.message}`);
      }
    });

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'project-zero-rei-codex-workbench',
          title: 'PROJECT ZERO — REI CODEX WORKBENCH',
          version: '0.1.0-preview.0'
        },
        capabilities: {experimentalApi: false}
      });
      if (this.child !== child) throw Error('Codex initialization interrupted');

      this.send({method: 'initialized', params: {}});
      this.connected = true;
    } catch (error) {
      if (this.child === child) this.stop(error);
      throw error;
    }
  }

  receive(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Error(message.error.message));
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

  fail(error, child) {
    if (child && this.child !== child) return;
    this.stop(error);
    this.emit('disconnected', error.message);
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

    child?.stdin.end();
    if (child && !child.killed) child.kill();
  }
}

module.exports = {CodexBridge};
