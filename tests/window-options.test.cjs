'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {EventEmitter} = require('node:events');
const {windowOptions} = require('../app/window-options.cjs');
const {
  CLEANUP_FAILED_MESSAGE,
  CLEANUP_FINAL_FAILED_MESSAGE,
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

    async request(method) {
      calls.push(`bridge:request:${method}`);
      if (method === 'account/read') {
        return {
          account: {type: 'chatgpt', email: 'private@example.com', planType: 'plus'},
          requiresOpenaiAuth: true
        };
      }
      if (method === 'model/list') {
        return {
          data: [{
            id: 'private-model-id',
            model: 'gpt-test',
            displayName: 'Test',
            description: 'Test model',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{reasoningEffort: 'medium', description: 'Balanced'}]
          }],
          nextCursor: null
        };
      }
      throw Error(`unexpected method: ${method}`);
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
      assert.deepEqual(options.snapshot(), {
        ready: true,
        checks: {account: true, models: true}
      });
      assert.doesNotMatch(JSON.stringify(options.snapshot()), /private|email|model-id|plus/);
      assert.equal(options.bootRoot, '/renderer/boot');
      assert.equal(options.sharedRoot, '/renderer/shared');
      return service;
    },
    bootRoot: '/renderer/boot',
    sharedRoot: '/renderer/shared',
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
    'bridge:request:account/read',
    'bridge:request:model/list',
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

test('workbench rejects malformed readiness responses before opening the renderer', async () => {
  const fixture = startFixture();
  class InvalidReadinessBridge {
    async start() {}
    async request(method) {
      if (method === 'account/read') return {account: {signedIn: true}};
      return {data: [{id: 'missing-required-model-fields'}]};
    }
    async stop() {}
  }
  fixture.dependencies.CodexBridgeClass = InvalidReadinessBridge;

  await assert.rejects(startWorkbench(fixture.dependencies), error => {
    assert.equal(error.code, 'CODEX_READINESS_INVALID');
    assert.equal(error.message, 'Codex readiness could not be verified.');
    return true;
  });
  assert.equal(fixture.calls.includes('service:create'), false);
  assert.equal(fixture.calls.includes('window:create'), false);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

function readinessBridge(account, models) {
  return class ReadinessBridge {
    async start() {}
    async request(method) {
      return method === 'account/read' ? account : models;
    }
    async stop() {}
  };
}

function validModel(overrides = {}) {
  return {
    id: 'test-model',
    model: 'test-model',
    displayName: 'Test model',
    description: 'A valid test model',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [{reasoningEffort: 'medium', description: 'Balanced'}],
    ...overrides
  };
}

function pagedReadinessBridge(account, pages, requests) {
  return class ReadinessBridge {
    async start() {}
    async request(method, params) {
      requests.push({method, params});
      if (method === 'account/read') return account;
      return pages.get(params.cursor) || pages.get(null);
    }
    async stop() {}
  };
}

test('workbench rejects empty, hidden, blank, and incoherent model catalogs', async () => {
  const account = {account: {type: 'apiKey'}, requiresOpenaiAuth: false};
  const cases = [
    {name: 'empty', data: []},
    {name: 'hidden', data: [validModel({hidden: true})]},
    {name: 'blank id', data: [validModel({id: ''})]},
    {name: 'blank model', data: [validModel({model: '   '})]},
    {name: 'blank display name', data: [validModel({displayName: ''})]},
    {name: 'no reasoning efforts', data: [validModel({supportedReasoningEfforts: []})]},
    {
      name: 'default effort not supported',
      data: [validModel({
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [{reasoningEffort: 'medium', description: 'Balanced'}]
      })]
    }
  ];

  for (const modelResponse of cases) {
    const fixture = startFixture();
    fixture.dependencies.CodexBridgeClass = readinessBridge(account, {
      data: modelResponse.data,
      nextCursor: null
    });

    await assert.rejects(startWorkbench(fixture.dependencies), {code: 'CODEX_READINESS_INVALID'}, modelResponse.name);
    assert.equal(fixture.calls.includes('service:create'), false, modelResponse.name);
    await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  }
});

test('signed-out official account response starts with a stable non-ready status', async () => {
  const fixture = startFixture();
  fixture.dependencies.CodexBridgeClass = readinessBridge(
    {account: null, requiresOpenaiAuth: true},
    {data: [validModel()], nextCursor: null}
  );
  let snapshot;
  fixture.dependencies.serviceFactory = options => {
    snapshot = options.snapshot();
    return {
      async listen() { return {address: '127.0.0.1', port: 43210}; },
      async close() {}
    };
  };

  await startWorkbench(fixture.dependencies);

  assert.deepEqual(snapshot, {
    ready: false,
    status: 'SIGNED_OUT',
    checks: {account: true, models: true}
  });
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('official account response may omit account and still reports signed out', async () => {
  const fixture = startFixture();
  fixture.dependencies.CodexBridgeClass = readinessBridge(
    {requiresOpenaiAuth: true},
    {data: [validModel()], nextCursor: null}
  );
  let snapshot;
  fixture.dependencies.serviceFactory = options => {
    snapshot = options.snapshot();
    return {
      async listen() { return {address: '127.0.0.1', port: 43210}; },
      async close() {}
    };
  };

  await startWorkbench(fixture.dependencies);

  assert.deepEqual(snapshot, {
    ready: false,
    status: 'SIGNED_OUT',
    checks: {account: true, models: true}
  });
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('workbench aggregates launchable models across every official catalog page', async () => {
  const fixture = startFixture();
  const requests = [];
  fixture.dependencies.CodexBridgeClass = pagedReadinessBridge(
    {account: {type: 'apiKey'}, requiresOpenaiAuth: false},
    new Map([
      [null, {data: [validModel({hidden: true})], nextCursor: 'second-page'}],
      ['second-page', {data: [validModel()], nextCursor: null}]
    ]),
    requests
  );

  await startWorkbench(fixture.dependencies);

  assert.deepEqual(requests, [
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'second-page'}}
  ]);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('workbench rejects a malformed later model catalog page', async () => {
  const fixture = startFixture();
  const requests = [];
  fixture.dependencies.CodexBridgeClass = pagedReadinessBridge(
    {account: {type: 'apiKey'}, requiresOpenaiAuth: false},
    new Map([
      [null, {data: [validModel()], nextCursor: 'second-page'}],
      ['second-page', {data: [{id: 'missing required fields'}], nextCursor: null}]
    ]),
    requests
  );

  await assert.rejects(startWorkbench(fixture.dependencies), {code: 'CODEX_READINESS_INVALID'});
  assert.deepEqual(requests, [
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'second-page'}}
  ]);
  assert.equal(fixture.calls.includes('service:create'), false);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('workbench rejects repeated model catalog cursors without cycling', async () => {
  const fixture = startFixture();
  const requests = [];
  fixture.dependencies.CodexBridgeClass = pagedReadinessBridge(
    {account: {type: 'apiKey'}, requiresOpenaiAuth: false},
    new Map([
      [null, {data: [validModel()], nextCursor: 'repeated-page'}],
      ['repeated-page', {data: [validModel()], nextCursor: 'repeated-page'}]
    ]),
    requests
  );

  await assert.rejects(startWorkbench(fixture.dependencies), {code: 'CODEX_READINESS_INVALID'});
  assert.deepEqual(requests, [
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'repeated-page'}}
  ]);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
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

test('before-quit automatically retries a transient cleanup failure', async () => {
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
  ], {
    onCleanupError: message => diagnostics.push(message),
    retryDelayMs: 0
  });

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(quitCalls, 1);
  assert.equal(closeCalls, 2);
  assert.deepEqual(diagnostics, [CLEANUP_FAILED_MESSAGE]);
  assert.doesNotMatch(diagnostics[0], /private|path/);
});

test('persistent cleanup failure exits instead of leaving a headless resident process', async () => {
  const app = new EventEmitter();
  let quitCalls = 0;
  const exits = [];
  app.quit = () => { quitCalls += 1; };
  app.exit = code => exits.push(code);
  let cleanupCalls = 0;
  const diagnostics = [];
  installCleanupHandler(app, [async () => {
    cleanupCalls += 1;
    throw Error('/private/path cleanup failed');
  }], {
    onCleanupError: message => diagnostics.push(message),
    retryDelayMs: 0
  });

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(cleanupCalls, 2);
  assert.equal(quitCalls, 0);
  assert.deepEqual(exits, [1]);
  assert.deepEqual(diagnostics, [CLEANUP_FAILED_MESSAGE, CLEANUP_FINAL_FAILED_MESSAGE]);
  assert.doesNotMatch(diagnostics.join(' '), /private|path/);
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
