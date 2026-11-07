'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {EventEmitter} = require('node:events');
const {windowOptions} = require('../app/window-options.cjs');
const {
  CLEANUP_FAILED_MESSAGE,
  closeServiceAndConfirm,
  installCleanupHandler,
  startWorkbench,
  stopBridgeAndConfirm
} = require('../app/lifecycle.cjs');

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

test('the Electron entry is harmless when executed by plain Node', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'app', 'main.cjs')], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
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

test('before-quit does not quit after cleanup rejection and permits a retry', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  app.quit = () => { quitCalls += 1; };
  const server = {
    listening: true,
    closeAllConnections() {}
  };
  let closeCalls = 0;
  const service = {
    server,
    async close() {
      closeCalls += 1;
      if (closeCalls === 1) throw Error('/private/path cleanup failed');
      server.listening = false;
    }
  };
  const diagnostics = [];
  installCleanupHandler(app, [
    () => closeServiceAndConfirm(service)
  ], {onCleanupError: message => diagnostics.push(message)});

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 0);
  assert.equal(closeCalls, 1);
  assert.deepEqual(diagnostics, [CLEANUP_FAILED_MESSAGE]);
  assert.doesNotMatch(diagnostics[0], /private|path/);

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quitCalls, 1);
  assert.equal(closeCalls, 2);
});

test('service cleanup forces connections closed and confirms the listener stopped', async () => {
  const calls = [];
  const server = {
    listening: true,
    closeAllConnections() {
      calls.push('force');
    }
  };
  const service = {
    server,
    async close() {
      calls.push('close');
      server.listening = false;
    }
  };

  await closeServiceAndConfirm(service);

  assert.deepEqual(calls, ['force', 'close']);
  assert.equal(server.listening, false);
});

test('service cleanup fails within its bound when close cannot be confirmed', async () => {
  const service = {
    server: {
      listening: true,
      closeAllConnections() {}
    },
    close: () => new Promise(() => {})
  };
  const closing = closeServiceAndConfirm(service, {closeTimeoutMs: 5}).then(
    () => 'resolved',
    () => 'rejected'
  );

  const outcome = await Promise.race([
    closing,
    new Promise(resolve => setTimeout(() => resolve('test-timeout'), 30))
  ]);

  assert.equal(outcome, 'rejected');
});

test('bridge cleanup uses its stop promise and confirms the child exited', async () => {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.signalCode = null;
  const bridge = {
    child,
    stop() {
      return new Promise(resolve => child.once('exit', resolve));
    }
  };
  let stopped = false;
  const stopping = stopBridgeAndConfirm(bridge).then(() => { stopped = true; });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  child.exitCode = 0;
  child.emit('exit', 0);
  await stopping;
  assert.equal(stopped, true);
});

test('bridge cleanup force-kills and waits when graceful stop rejects', async () => {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.signalCode = null;
  const signals = [];
  child.kill = signal => {
    signals.push(signal);
    setImmediate(() => {
      child.signalCode = signal;
      child.emit('exit', null, signal);
    });
    return true;
  };
  const bridge = {
    child: null,
    stoppingChild: child,
    async stop() {
      throw Error('graceful stop failed');
    }
  };

  await stopBridgeAndConfirm(bridge, {forceExitTimeoutMs: 50});

  assert.deepEqual(signals, ['SIGKILL']);
  assert.equal(child.signalCode, 'SIGKILL');
});
