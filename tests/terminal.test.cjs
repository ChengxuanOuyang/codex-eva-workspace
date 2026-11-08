'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {TerminalManager} = require('../workbench/terminal.cjs');

class FakePty extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
    this.writes = [];
    this.resizes = [];
  }
  onData(listener) { this.on('data', listener); return {dispose: () => this.off('data', listener)}; }
  onExit(listener) { this.on('exit', listener); return {dispose: () => this.off('exit', listener)}; }
  write(data) { this.writes.push(data); }
  resize(cols, rows) { this.resizes.push([cols, rows]); }
  kill() { this.killed = true; }
}

function fixture() {
  const children = [];
  const calls = [];
  const manager = new TerminalManager({
    resolveShell: () => ({file: '/bin/zsh', args: ['-f']}),
    spawnPty(file, args, options) {
      calls.push({file, args, options});
      const child = new FakePty();
      children.push(child);
      return child;
    }
  });
  return {manager, children, calls};
}

test('terminal validates dimensions and caps retained output', () => {
  const {manager, children, calls} = fixture();
  const session = manager.create({id: 'p', path: '/tmp'});
  assert.equal(calls[0].options.cwd, '/tmp');
  assert.throws(() => manager.resize(session.id, 0, 24), /columns/);
  assert.throws(() => manager.resize(session.id, 80, 1000), /rows/);
  children[0].emit('data', 'x'.repeat(700 * 1024));
  assert.equal(manager.snapshot(session.id).buffer.length, 512 * 1024);
});

test('terminal input is bounded and closed sessions cannot be reused', () => {
  const {manager, children} = fixture();
  const session = manager.create({id: 'p', path: '/tmp'});
  manager.input(session.id, 'pwd\n');
  assert.deepEqual(children[0].writes, ['pwd\n']);
  assert.throws(() => manager.input(session.id, 'x'.repeat(64 * 1024 + 1)), /input/);
  manager.close(session.id);
  assert.equal(children[0].killed, true);
  assert.throws(() => manager.snapshot(session.id), /session/);
});

test('stop kills every workbench-owned PTY and project listing is isolated', () => {
  const {manager, children} = fixture();
  manager.create({id: 'p1', path: '/tmp'});
  manager.create({id: 'p2', path: '/tmp'});
  assert.equal(manager.list('p1').length, 1);
  manager.stop();
  assert.equal(children.every(child => child.killed), true);
  assert.deepEqual(manager.list('p1'), []);
});
