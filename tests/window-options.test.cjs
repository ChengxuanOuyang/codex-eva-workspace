'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {windowOptions} = require('../app/window-options.cjs');
const {
  installCleanupHandler,
  shouldBootstrap,
  startWorkbench,
  stopBridgeAndWait
} = require('../app/main.cjs');

test('renderer is isolated from Node', () => {
  const options = windowOptions('/app/preload.cjs');
  assert.deepEqual(
    [options.width, options.height, options.minWidth, options.minHeight, options.backgroundColor],
    [1500, 950, 1100, 720, '#0b151a']
  );
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.preload, '/app/preload.cjs');
});

test('Electron bootstraps even when CommonJS does not mark the entry as require.main', () => {
  assert.equal(shouldBootstrap({electronVersion: '45.2.3', isMainModule: false}), true);
  assert.equal(shouldBootstrap({electronVersion: undefined, isMainModule: false}), false);
});

function startFixture({executable = '/Applications/ChatGPT.app/Contents/Resources/codex'} = {}) {
  const calls = [];
  const app = new EventEmitter();
  app.whenReady = async () => calls.push('ready');
  app.getPath = name => {
    assert.equal(name, 'userData');
    return '/tmp/project-zero';
  };

  let window;
  class FakeBrowserWindow {
    constructor(options) {
      calls.push('window:create');
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = handler => {
        this.openHandler = handler;
      };
      window = this;
    }

    async loadURL(url) {
      calls.push(`window:load:${url}`);
      this.url = url;
    }
  }

  class FakeBridge {
    constructor(selectedExecutable) {
      calls.push(`bridge:create:${selectedExecutable}`);
      this.connected = false;
    }

    async start() {
      calls.push('bridge:start');
      this.connected = true;
    }

    stop() {
      calls.push('bridge:stop');
    }
  }

  const service = {
    async listen() {
      calls.push('service:listen');
      return {address: '127.0.0.1', port: 43210};
    },
    async close() {
      calls.push('service:close');
    }
  };

  const dependencies = {
    app,
    BrowserWindow: FakeBrowserWindow,
    mkdir: async directory => calls.push(`mkdir:${directory}`),
    locateCodex: options => {
      calls.push('codex:find');
      assert.equal(options.pathCodex, '/path/codex');
      assert.equal(options.userPath, '/chosen/codex');
      return executable;
    },
    pathCodex: '/path/codex',
    userPath: '/chosen/codex',
    CodexBridgeClass: FakeBridge,
    serviceFactory: options => {
      calls.push('service:create');
      assert.equal(options.snapshot().ready, true);
      assert.equal(options.publicRoot, '/renderer/boot');
      return service;
    },
    publicRoot: '/renderer/boot',
    cleanups: []
  };

  return {app, calls, dependencies, getWindow: () => window};
}

test('workbench starts dependencies in lifecycle order and locks navigation to its origin', async () => {
  const fixture = startFixture();

  const resources = await startWorkbench(fixture.dependencies);

  assert.deepEqual(fixture.calls, [
    'ready',
    'mkdir:/tmp/project-zero/state',
    'mkdir:/tmp/project-zero/logs',
    'mkdir:/tmp/project-zero/themes',
    'codex:find',
    'bridge:create:/Applications/ChatGPT.app/Contents/Resources/codex',
    'bridge:start',
    'service:create',
    'service:listen',
    'window:create',
    'window:load:http://127.0.0.1:43210/'
  ]);
  assert.equal(resources.origin, 'http://127.0.0.1:43210');

  const window = fixture.getWindow();
  assert.equal(window.options.webPreferences.preload, undefined);
  assert.deepEqual(window.openHandler(), {action: 'deny'});

  let prevented = false;
  window.webContents.emit('will-navigate', {preventDefault: () => { prevented = true; }}, 'https://example.com/');
  assert.equal(prevented, true);

  prevented = false;
  window.webContents.emit('will-navigate', {preventDefault: () => { prevented = true; }}, 'http://127.0.0.1:43210/health');
  assert.equal(prevented, false);

  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  assert.deepEqual(fixture.calls.slice(-2), ['service:close', 'bridge:stop']);
});

test('missing Codex fails diagnostically without constructing a bridge or disclosing candidates', async () => {
  const fixture = startFixture({executable: null});

  await assert.rejects(startWorkbench(fixture.dependencies), error => {
    assert.equal(error.code, 'CODEX_NOT_FOUND');
    assert.doesNotMatch(error.message, /chosen|Applications|\/path/);
    return true;
  });
  assert.equal(fixture.calls.some(call => call.startsWith('bridge:create')), false);
});

test('PATH discovery happens only after ready and runtime directory creation', async () => {
  const fixture = startFixture();
  fixture.dependencies.pathCodex = undefined;
  fixture.dependencies.resolvePathCodex = () => {
    fixture.calls.push('codex:path');
    return '/resolved/codex';
  };
  fixture.dependencies.locateCodex = options => {
    fixture.calls.push(`codex:find:${options.pathCodex}`);
    return null;
  };

  await assert.rejects(startWorkbench(fixture.dependencies), {code: 'CODEX_NOT_FOUND'});

  assert.deepEqual(fixture.calls, [
    'ready',
    'mkdir:/tmp/project-zero/state',
    'mkdir:/tmp/project-zero/logs',
    'mkdir:/tmp/project-zero/themes',
    'codex:path',
    'codex:find:/resolved/codex'
  ]);
});

test('before-quit waits for cleanup and does not enter a repeated quit loop', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.quit = () => { quitCalls += 1; };
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let cleanupCalls = 0;
  installCleanupHandler(app, [async () => {
    cleanupCalls += 1;
    await waiting;
  }]);

  let prevented = 0;
  const event = {preventDefault: () => { prevented += 1; }};
  app.emit('before-quit', event);
  app.emit('before-quit', event);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(cleanupCalls, 1);
  assert.equal(quitCalls, 0);
  assert.equal(prevented, 2);

  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 1);

  app.emit('before-quit', event);
  assert.equal(prevented, 2);
});

test('before-quit waits for the Codex child to exit after bridge stop', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.quit = () => { quitCalls += 1; };

  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let stopCalls = 0;
  const bridge = {
    child,
    stop() {
      stopCalls += 1;
    }
  };
  installCleanupHandler(app, [() => stopBridgeAndWait(bridge)]);

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopCalls, 1);
  assert.equal(quitCalls, 0);

  child.emit('exit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 1);
});
