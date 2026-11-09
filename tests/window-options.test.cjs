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
  createReadinessStore,
  installCleanupHandler,
  startWorkbench,
  stopBridgeAndConfirm
} = require('../app/lifecycle.cjs');

test('renderer is isolated from Node', () => {
  const options = windowOptions('/app/preload.cjs');
  assert.deepEqual(
    [options.width, options.height, options.minWidth, options.minHeight, options.backgroundColor, options.show],
    [1500, 950, 1100, 720, '#0b151a', false]
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
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
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

    isDestroyed() {
      return false;
    }

    setFullScreen(enabled) {
      calls.push(`window:fullscreen:${enabled}`);
    }

    show() {
      calls.push('window:show');
    }

    setBounds(bounds) {
      calls.push(`window:bounds:${bounds.width}x${bounds.height}`);
    }

    center() {
      calls.push('window:center');
    }
  }

  class FakeBridge extends EventEmitter {
    constructor(selectedExecutable) {
      super();
      calls.push(`bridge:create:${selectedExecutable}`);
      this.connected = false;
    }

    async start() {
      calls.push('bridge:start');
      this.connected = true;
    }

    async request(method) {
      calls.push(`bridge:request:${method}`);
      if (method === 'configRequirements/read') return {requirements: {}};
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
      this.connected = false;
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

  let serviceOptions;
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
      serviceOptions = options;
      calls.push('service:create');
      assert.deepEqual(options.snapshot(), {
        ready: false,
        code: 'INITIALIZING'
      });
      assert.equal(typeof options.retryInitialization, 'function');
      assert.equal(typeof options.onPresentationComplete, 'function');
      assert.equal(options.bootRoot, '/renderer/boot');
      assert.equal(options.sharedRoot, '/renderer/shared');
      return service;
    },
    bootRoot: '/renderer/boot',
    sharedRoot: '/renderer/shared',
    cleanups: []
  };

  return {
    app,
    calls,
    dependencies,
    getServiceOptions: () => serviceOptions,
    getWindow: () => window
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

test('readiness store exposes only stable redacted states', () => {
  const readiness = createReadinessStore();

  assert.deepEqual(readiness.get(), {ready: false, code: 'INITIALIZING'});
  assert.deepEqual(readiness.set('READY'), {ready: true, code: 'READY'});
  assert.deepEqual(readiness.set('DISCONNECTED'), {ready: false, code: 'DISCONNECTED'});
  assert.throws(() => readiness.set('/private/path: raw failure'), /readiness code/i);
  assert.doesNotMatch(JSON.stringify(readiness.get()), /private|raw failure/);
});

test('workbench starts dependencies in lifecycle order and locks navigation to its origin', async () => {
  const fixture = startFixture();

  const resources = await startWorkbench(fixture.dependencies);

  assert.deepEqual(fixture.calls, [
    'ready',
    'mkdir:/tmp/project-zero/state',
    'mkdir:/tmp/project-zero/logs',
    'mkdir:/tmp/project-zero/themes',
    'service:create',
    'service:listen',
    'window:create',
    'window:load:http://127.0.0.1:43210/',
    'window:fullscreen:true',
    'window:show',
    'codex:find',
    'bridge:create:/Applications/ChatGPT.app/Contents/Resources/codex',
    'bridge:start'
  ]);
  assert.equal(resources.origin, 'http://127.0.0.1:43210');
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'INITIALIZING'});

  await resources.initialization;
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /private|email|model-id|plus/);

  const window = fixture.getWindow();
  assert.equal(window.options.webPreferences.preload, undefined);
  assert.equal(window.options.show, false);
  assert.deepEqual(window.openHandler(), {action: 'deny'});

  let prevented = false;
  window.webContents.emit('will-navigate', {preventDefault: () => { prevented = true; }}, 'https://example.com/');
  assert.equal(prevented, true);

  prevented = false;
  window.webContents.emit('will-navigate', {preventDefault: () => { prevented = true; }}, 'http://127.0.0.1:43210/health');
  assert.equal(prevented, false);

  resources.bridge.emit('disconnected', 'private details must not escape');
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /private|details/);

  const completion = fixture.getServiceOptions().onPresentationComplete();
  assert.equal(fixture.calls.at(-1), 'window:fullscreen:false');
  window.emit('leave-full-screen');
  assert.deepEqual(await completion, {mode: 'windowed'});
  assert.deepEqual(fixture.calls.slice(-3), [
    'window:fullscreen:false',
    'window:bounds:1500x950',
    'window:center'
  ]);

  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  assert.deepEqual(fixture.calls.slice(-2), ['service:close', 'bridge:stop']);
});

test('shutdown destroys the window director before existing service and bridge cleanup', async () => {
  const fixture = startFixture();
  class RecordingWindowDirector {
    showBoot() {
      fixture.calls.push('director:show');
      return Promise.resolve({mode: 'fullscreen'});
    }
    revealWorkbench() {
      fixture.calls.push('director:reveal');
      return Promise.resolve({mode: 'windowed'});
    }
    destroy() {
      fixture.calls.push('director:destroy');
    }
  }
  fixture.dependencies.WindowDirectorClass = RecordingWindowDirector;

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  let quitCalls = 0;
  fixture.app.quit = () => { quitCalls += 1; };
  installCleanupHandler(fixture.app, fixture.dependencies.cleanups);
  fixture.calls.length = 0;

  let prevented = 0;
  fixture.app.emit('before-quit', {preventDefault: () => { prevented += 1; }});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fixture.calls, [
    'director:destroy',
    'service:close',
    'bridge:stop'
  ]);
  assert.equal(prevented, 1);
  assert.equal(quitCalls, 1);
});

test('malformed readiness keeps the renderer open with a recoverable redacted state', async () => {
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

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;

  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});
  assert.equal(fixture.calls.includes('service:create'), true);
  assert.equal(fixture.calls.includes('window:create'), true);
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /invalid|missing|required/);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

function readinessBridge(account, models) {
  return class ReadinessBridge {
    async start() {}
    async request(method) {
      if (method === 'configRequirements/read') return {requirements: {}};
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
      if (method === 'configRequirements/read') return {requirements: {}};
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

    const resources = await startWorkbench(fixture.dependencies);
    await resources.initialization;
    assert.deepEqual(
      fixture.getServiceOptions().snapshot(),
      {ready: false, code: 'NO_LAUNCHABLE_MODEL'},
      modelResponse.name
    );
    assert.equal(fixture.calls.includes('service:create'), true, modelResponse.name);
    await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  }
});

test('signed-out official account response starts with a stable non-ready status', async () => {
  const fixture = startFixture();
  fixture.dependencies.CodexBridgeClass = readinessBridge(
    {account: null, requiresOpenaiAuth: true},
    {data: [validModel()], nextCursor: null}
  );
  fixture.dependencies.serviceFactory = options => {
    fixture.serviceOptions = options;
    return {
      async listen() { return {address: '127.0.0.1', port: 43210}; },
      async close() {}
    };
  };

  const resources = await startWorkbench(fixture.dependencies);
  assert.deepEqual(fixture.serviceOptions.snapshot(), {ready: false, code: 'INITIALIZING'});
  await resources.initialization;

  assert.deepEqual(fixture.serviceOptions.snapshot(), {ready: false, code: 'SIGNED_OUT'});
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('official account response may omit account and still reports signed out', async () => {
  const fixture = startFixture();
  fixture.dependencies.CodexBridgeClass = readinessBridge(
    {requiresOpenaiAuth: true},
    {data: [validModel()], nextCursor: null}
  );
  fixture.dependencies.serviceFactory = options => {
    fixture.serviceOptions = options;
    return {
      async listen() { return {address: '127.0.0.1', port: 43210}; },
      async close() {}
    };
  };

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;

  assert.deepEqual(fixture.serviceOptions.snapshot(), {ready: false, code: 'SIGNED_OUT'});
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

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;

  assert.deepEqual(requests, [
    {method: 'configRequirements/read', params: {}},
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'second-page'}}
  ]);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('account update snapshots revoke READY and serialize a complete official revalidation', async () => {
  const fixture = startFixture();
  const requests = [];
  const secondPage = deferred();
  class AccountUpdateBridge extends EventEmitter {
    constructor() {
      super();
      this.connected = false;
      this.modelReads = 0;
    }
    async start() { this.connected = true; }
    async request(method, params) {
      requests.push({method, params});
      if (method === 'configRequirements/read') return {requirements: {}};
      if (method === 'account/read') {
        return {account: {type: 'apiKey'}, requiresOpenaiAuth: false};
      }
      this.modelReads += 1;
      if (this.modelReads === 1) return {data: [validModel()], nextCursor: null};
      if (this.modelReads === 2) {
        return {data: [validModel({hidden: true})], nextCursor: 'second-page'};
      }
      if (this.modelReads === 3) return secondPage.promise;
      return {data: [validModel()], nextCursor: null};
    }
    async stop() { this.connected = false; }
  }
  fixture.dependencies.CodexBridgeClass = AccountUpdateBridge;

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});
  requests.length = 0;

  resources.bridge.emit('notification', {
    method: 'account/updated',
    params: {privatePayload: '/Users/private/account'}
  });
  resources.bridge.emit('notification', {method: 'account/updated', params: {burst: 2}});

  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'INITIALIZING'});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'INITIALIZING'});
  secondPage.resolve({data: [validModel()], nextCursor: null});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [
    {method: 'configRequirements/read', params: {}},
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'second-page'}}
  ]);
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /private|Users|burst/);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('a disconnected bridge cannot let a stale account revalidation restore READY', async () => {
  const fixture = startFixture();
  const accountGate = deferred();
  let accountReads = 0;
  class StaleAccountBridge extends EventEmitter {
    constructor() {
      super();
      this.connected = false;
    }
    async start() { this.connected = true; }
    async request(method) {
      if (method === 'configRequirements/read') return {requirements: {}};
      if (method === 'account/read') {
        accountReads += 1;
        if (accountReads > 1) return accountGate.promise;
        return {account: {type: 'apiKey'}, requiresOpenaiAuth: false};
      }
      return {data: [validModel()], nextCursor: null};
    }
    async stop() { this.connected = false; }
  }
  fixture.dependencies.CodexBridgeClass = StaleAccountBridge;

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  resources.bridge.emit('notification', {method: 'account/updated'});
  await new Promise(resolve => setImmediate(resolve));
  resources.bridge.connected = false;
  resources.bridge.emit('disconnected', {private: '/Users/private'});
  accountGate.resolve({account: {type: 'apiKey'}, requiresOpenaiAuth: false});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /private|Users/);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('account notification listeners ignore malformed signals and detach on replacement and close', async () => {
  const fixture = startFixture();
  const bridges = [];
  class ListenerBridge extends EventEmitter {
    constructor() {
      super();
      this.connected = false;
      bridges.push(this);
    }
    async start() { this.connected = true; }
    async request(method) {
      if (method === 'configRequirements/read') return {requirements: {}};
      if (method === 'account/read') return {account: {type: 'apiKey'}, requiresOpenaiAuth: false};
      return {data: [validModel()], nextCursor: null};
    }
    async stop() { this.connected = false; }
  }
  fixture.dependencies.CodexBridgeClass = ListenerBridge;

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  assert.equal(bridges[0].listenerCount('notification'), 1);

  bridges[0].emit('notification', null);
  bridges[0].emit('notification', {method: 'account/update', params: {private: true}});
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});

  await fixture.getServiceOptions().retryInitialization();
  assert.equal(bridges[0].listenerCount('notification'), 0);
  assert.equal(bridges[1].listenerCount('notification'), 1);

  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  assert.equal(bridges[1].listenerCount('notification'), 0);
});

test('workbench redacts a malformed later model catalog page as disconnected', async () => {
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

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  assert.deepEqual(requests, [
    {method: 'configRequirements/read', params: {}},
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'second-page'}}
  ]);
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('workbench redacts repeated model catalog cursors without cycling', async () => {
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

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;
  assert.deepEqual(requests, [
    {method: 'configRequirements/read', params: {}},
    {method: 'account/read', params: {}},
    {method: 'model/list', params: {}},
    {method: 'model/list', params: {cursor: 'repeated-page'}}
  ]);
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('missing Codex keeps the window open with a retryable redacted diagnostic', async () => {
  const fixture = startFixture({executable: null});

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;

  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'CODEX_NOT_FOUND'});
  assert.equal(fixture.calls.includes('window:create'), true);
  assert.equal(fixture.calls.some(call => call.startsWith('bridge:create')), false);
  assert.doesNotMatch(JSON.stringify(fixture.getServiceOptions().snapshot()), /chosen|Applications|\/path/);
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
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

  const resources = await startWorkbench(fixture.dependencies);
  await resources.initialization;

  assert.deepEqual(fixture.calls, [
    'ready',
    'mkdir:/tmp/project-zero/state',
    'mkdir:/tmp/project-zero/logs',
    'mkdir:/tmp/project-zero/themes',
    'service:create',
    'service:listen',
    'window:create',
    'window:load:http://127.0.0.1:43210/',
    'window:fullscreen:true',
    'window:show',
    'codex:path',
    'codex:find:/resolved/codex'
  ]);
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'CODEX_NOT_FOUND'});
  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
});

test('retry shares one initialization attempt and cleanup owns every retry bridge', async () => {
  const fixture = startFixture();
  const firstStart = deferred();
  const bridges = [];
  class RetryBridge extends EventEmitter {
    constructor() {
      super();
      this.connected = false;
      this.stopCalls = 0;
      bridges.push(this);
    }
    async start() {
      this.connected = true;
      if (bridges.length === 1) await firstStart.promise;
    }
    async request(method) {
      if (method === 'configRequirements/read') return {requirements: {}};
      if (method === 'account/read') {
        return {account: {type: 'apiKey'}, requiresOpenaiAuth: false};
      }
      return {data: [validModel()], nextCursor: null};
    }
    async stop() {
      this.stopCalls += 1;
      this.connected = false;
    }
  }
  fixture.dependencies.CodexBridgeClass = RetryBridge;

  const resources = await startWorkbench(fixture.dependencies);
  const retryDuringStart = fixture.getServiceOptions().retryInitialization();
  assert.equal(retryDuringStart, resources.initialization);
  assert.equal(fixture.getServiceOptions().retryInitialization(), resources.initialization);
  assert.equal(bridges.length, 1);

  firstStart.resolve();
  await resources.initialization;
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});

  bridges[0].emit('disconnected', '/private/raw disconnect');
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'DISCONNECTED'});

  const retry = fixture.getServiceOptions().retryInitialization();
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: false, code: 'INITIALIZING'});
  assert.equal(fixture.getServiceOptions().retryInitialization(), retry);
  await retry;
  assert.equal(bridges.length, 2);
  assert.equal(bridges[0].stopCalls, 1);
  assert.deepEqual(fixture.getServiceOptions().snapshot(), {ready: true, code: 'READY'});

  await Promise.all(fixture.dependencies.cleanups.map(cleanup => cleanup()));
  assert.equal(bridges[1].stopCalls, 1);
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

test('a cleanup that never settles is bounded and forces process exit', async () => {
  const app = new EventEmitter();
  const exits = [];
  app.quit = () => {};
  app.exit = code => exits.push(code);
  installCleanupHandler(app, [() => new Promise(() => {})], {
    cleanupTimeoutMs: 2,
    retryDelayMs: 0
  });

  app.emit('before-quit', {preventDefault() {}});
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exits, [1]);
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
