'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const MAX_BUFFER = 512 * 1024;
const MAX_INPUT = 64 * 1024;
const MAX_SESSIONS = 8;

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
  constructor({spawnPty = defaultSpawn, resolveShell = defaultResolveShell} = {}) {
    this.spawnPty = spawnPty;
    this.resolveShell = resolveShell;
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
      buffer: '', status: 'running', sequence: 0, subscribers: new Set(), disposables: []
    };
    session.disposables.push(child.onData(data => {
      session.buffer = `${session.buffer}${String(data)}`.slice(-MAX_BUFFER);
      session.sequence += 1;
      const payload = `id: ${session.sequence}\nevent: output\ndata: ${JSON.stringify(String(data))}\n\n`;
      for (const response of session.subscribers) response.write(payload);
    }));
    session.disposables.push(child.onExit(() => {
      session.status = 'exited';
      session.sequence += 1;
      for (const response of session.subscribers) response.write(`id: ${session.sequence}\nevent: exit\ndata: {}\n\n`);
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
    session.subscribers.add(response);
    if (Number(lastEventId) !== session.sequence) {
      response.write(`id: ${session.sequence}\nevent: snapshot\ndata: ${JSON.stringify(publicSession(session))}\n\n`);
    }
    return () => session.subscribers.delete(response);
  }

  close(id) {
    const session = this.session(id);
    this.sessions.delete(id);
    for (const disposable of session.disposables) disposable?.dispose?.();
    session.subscribers.clear();
    if (session.status === 'running') session.child.kill();
    session.status = 'closed';
  }

  stop() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}

module.exports = {TerminalManager};
