'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const MAX_BUFFER = 512 * 1024;
const MAX_INPUT = 64 * 1024;
const MAX_SESSIONS = 8;
const MAX_SUBSCRIBER_QUEUE = 256 * 1024;
const EXIT_TIMEOUT_MS = 2000;

function subscriberWrite(session, subscriber, payload) {
  if (subscriber.closed) return;
  if (subscriber.blocked) {
    subscriber.queue += payload;
    if (Buffer.byteLength(subscriber.queue) > MAX_SUBSCRIBER_QUEUE) {
      subscriber.closed = true;
      session.subscribers.delete(subscriber);
      subscriber.response.destroy?.();
    }
    return;
  }
  if (subscriber.response.write(payload) === false) subscriber.blocked = true;
}

function flushSubscriber(session, subscriber) {
  if (subscriber.closed) return;
  subscriber.blocked = false;
  const queued = subscriber.queue;
  subscriber.queue = '';
  if (queued) subscriberWrite(session, subscriber, queued);
}

function defaultResolveShell() {
  const candidate = process.env.SHELL;
  if (typeof candidate === 'string' && candidate.startsWith('/')) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return {file: candidate, args: []};
    } catch {}
  }
  return {file: '/bin/zsh', args: ['-f']};
}

function defaultSpawn(file, args, options) {
  return require('node-pty').spawn(file, args, options);
}

function publicSession(session) {
  return {
    id: session.id, projectId: session.projectId, cols: session.cols, rows: session.rows,
    status: session.status, buffer: session.buffer
  };
}

class TerminalManager {
  constructor({spawnPty = defaultSpawn, resolveShell = defaultResolveShell, exitTimeoutMs = EXIT_TIMEOUT_MS} = {}) {
    this.spawnPty = spawnPty;
    this.resolveShell = resolveShell;
    this.exitTimeoutMs = exitTimeoutMs;
    this.sessions = new Map();
  }

  session(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Unknown terminal session');
    return session;
  }

  create(project, {cols = 80, rows = 24} = {}) {
    if (!project || typeof project.id !== 'string' || typeof project.path !== 'string' || !project.path.startsWith('/')) {
      throw new Error('Invalid terminal project');
    }
    if (this.sessions.size >= MAX_SESSIONS) throw new Error('Too many terminal sessions');
    this.validateSize(cols, rows);
    const shell = this.resolveShell();
    const child = this.spawnPty(shell.file, shell.args, {
      name: 'xterm-256color', cwd: project.path, cols, rows,
      env: {...process.env, TERM: 'xterm-256color'}
    });
    const session = {
      id: crypto.randomUUID(), projectId: project.id, cols, rows, child,
      buffer: '', status: 'running', sequence: 0, subscribers: new Set(), disposables: [],
      exitPromise: null, resolveExit: null, closePromise: null
    };
    session.exitPromise = new Promise(resolve => { session.resolveExit = resolve; });
    session.disposables.push(child.onData(data => {
      session.buffer = `${session.buffer}${String(data)}`.slice(-MAX_BUFFER);
      session.sequence += 1;
      const payload = `id: ${session.sequence}\nevent: output\ndata: ${JSON.stringify(String(data))}\n\n`;
      for (const subscriber of session.subscribers) subscriberWrite(session, subscriber, payload);
    }));
    session.disposables.push(child.onExit(() => {
      session.status = 'exited';
      session.sequence += 1;
      for (const subscriber of session.subscribers) subscriberWrite(session, subscriber, `id: ${session.sequence}\nevent: exit\ndata: {}\n\n`);
      session.resolveExit();
    }));
    this.sessions.set(session.id, session);
    return publicSession(session);
  }

  list(projectId) {
    return [...this.sessions.values()].filter(session => session.projectId === projectId).map(publicSession);
  }

  snapshot(id) {
    return publicSession(this.session(id));
  }

  input(id, data) {
    if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data) > MAX_INPUT) {
      throw new Error('Invalid terminal input');
    }
    const session = this.session(id);
    if (session.status !== 'running') throw new Error('Terminal session is not running');
    session.child.write(data);
  }

  validateSize(cols, rows) {
    if (!Number.isInteger(cols) || cols < 1 || cols > 500) throw new Error('Invalid terminal columns');
    if (!Number.isInteger(rows) || rows < 1 || rows > 300) throw new Error('Invalid terminal rows');
  }

  resize(id, cols, rows) {
    this.validateSize(cols, rows);
    const session = this.session(id);
    session.child.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
  }

  subscribe(id, response, lastEventId) {
    const session = this.session(id);
    if (!response || typeof response.write !== 'function') throw new Error('Invalid terminal subscriber');
    const subscriber = {response, blocked: false, queue: '', closed: false, drain: null};
    subscriber.drain = () => flushSubscriber(session, subscriber);
    response.on?.('drain', subscriber.drain);
    session.subscribers.add(subscriber);
    if (Number(lastEventId) !== session.sequence) {
      subscriberWrite(session, subscriber, `id: ${session.sequence}\nevent: snapshot\ndata: ${JSON.stringify(publicSession(session))}\n\n`);
    }
    return () => {
      subscriber.closed = true;
      response.off?.('drain', subscriber.drain);
      session.subscribers.delete(subscriber);
    };
  }

  async close(id) {
    const session = this.session(id);
    if (session.closePromise) return session.closePromise;
    const operation = this.closeSession(session).finally(() => {
      if (session.closePromise === operation) session.closePromise = null;
    });
    session.closePromise = operation;
    return operation;
  }

  async closeSession(session) {
    if (session.status === 'running') session.child.kill();
    const exited = await Promise.race([
      session.exitPromise.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), this.exitTimeoutMs))
    ]);
    if (!exited) {
      session.child.kill('SIGKILL');
      const forced = await Promise.race([
        session.exitPromise.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), Math.min(500, this.exitTimeoutMs)))
      ]);
      if (!forced) throw new Error('Terminal process did not exit');
    }
    this.sessions.delete(session.id);
    for (const disposable of session.disposables) disposable?.dispose?.();
    for (const subscriber of session.subscribers) subscriber.response.off?.('drain', subscriber.drain);
    session.subscribers.clear();
    session.status = 'closed';
  }

  async stop() {
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Terminal cleanup failed');
  }
}

module.exports = {TerminalManager};
