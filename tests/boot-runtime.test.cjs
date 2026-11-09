'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {nextBootState, MAX_UNCONFIRMED_PROGRESS} = require('../renderer/boot/boot-state.cjs');

class FakeElement {
  constructor(text = '') {
    this._text = text;
    this.textWrites = 0;
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = true;
    this.hidden = true;
    this.listeners = new Map();
  }

  get textContent() { return this._text; }
  set textContent(value) { this._text = value; this.textWrites += 1; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  dispatch(type, event = {}) { return this.listeners.get(type)?.(event); }
}

class FakeClock {
  constructor() {
    this.nextId = 1;
    this.timeouts = new Map();
    this.intervals = new Map();
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timeouts.set(id, {callback, delay});
    return id;
  };
  clearTimeout = id => this.timeouts.delete(id);
  setInterval = (callback, delay) => {
    const id = this.nextId++;
    this.intervals.set(id, {callback, delay});
    return id;
  };
  clearInterval = id => this.intervals.delete(id);
  countTimeouts(delay) { return [...this.timeouts.values()].filter(timer => timer.delay === delay).length; }
  countIntervals(delay) { return [...this.intervals.values()].filter(timer => timer.delay === delay).length; }
  fireTimeout(delay) {
    const entry = [...this.timeouts.entries()].find(([, timer]) => timer.delay === delay);
    if (!entry) return undefined;
    this.timeouts.delete(entry[0]);
    return entry[1].callback();
  }
  fireInterval(delay) {
    const timer = [...this.intervals.values()].find(candidate => candidate.delay === delay);
    return timer?.callback();
  }
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

function fixture(api, {reducedMotion = false} = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'boot', 'boot.js'), 'utf8');
  const sandbox = {AbortController};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});
  assert.equal(typeof sandbox.ProjectZeroBoot?.createBootController, 'function');

  const selectors = [
    '#backend-state', '#phase-caption', '#clock-readout', '#confirm-button',
    '#diagnostic-text', '#retry-button', '#sync-heading', '#progress-value', '#ring-progress',
    '#ring-stroke', '#skip-button', '#boot-screen', '#workbench-shell',
    '#pilot-authorization',
    '#shell-readiness-text', '#shell-link-state', '#shell-diagnostic-text', '#shell-retry-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement()]));
  elements['#boot-screen'].hidden = false;
  const document = {
    body: new FakeElement(),
    querySelector: selector => elements[selector]
  };
  const rootListeners = new Map();
  const root = {
    addEventListener: (type, listener) => rootListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (rootListeners.get(type) === listener) rootListeners.delete(type);
    }
  };
  const clock = new FakeClock();
  const controller = sandbox.ProjectZeroBoot.createBootController({
    api: {...api, nextBootState, MAX_UNCONFIRMED_PROGRESS},
    clock,
    document,
    now: () => 0,
    reducedMotion,
    root
  });
  controller.start();
  return {clock, controller, document, elements, rootListeners};
}

test('early READY keeps authorization hidden before the waiting stage', async () => {
  const view = fixture({health: () => Promise.resolve({ready: true, code: 'READY'})});

  assert.equal(view.elements['#pilot-authorization'].hidden, true);
  await view.clock.fireTimeout(0);
  assert.equal(view.controller.getState().phase, 'syncing');
  assert.equal(view.document.body.dataset.readiness, 'ready');
  assert.equal(view.elements['#pilot-authorization'].hidden, true);

  view.document.body.dataset.stage = 'authorize';
  view.clock.fireInterval(80);
  assert.equal(view.elements['#pilot-authorization'].hidden, false);
  view.document.body.dataset.stage = 'wake';
  view.clock.fireInterval(80);
  assert.equal(view.elements['#pilot-authorization'].hidden, true);

  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.elements['#pilot-authorization'].hidden, false);
  view.controller.destroy();
});

test('skip atomically reaches confirmation while stopping presentation timers and preserving health polling', async () => {
  const health = deferred();
  const view = fixture({health: () => health.promise});

  const healthRun = view.clock.fireTimeout(0);
  assert.equal(view.clock.countIntervals(80), 1);
  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');

  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.controller.getState().progress, 99.2);
  assert.equal(view.clock.countIntervals(80), 0);
  assert.equal(view.clock.countIntervals(100), 0);
  assert.equal(view.clock.countTimeouts(600), 0);
  assert.equal(view.elements['#confirm-button'].disabled, true);
  health.resolve({ready: false, code: 'INITIALIZING'});
  await healthRun;
  assert.equal(view.clock.countTimeouts(500), 1);

  view.controller.destroy();
});

test('a skipped presentation becomes confirmable immediately when real readiness arrives', async () => {
  let calls = 0;
  const view = fixture({
    health: () => Promise.resolve(++calls === 1
      ? {ready: false, code: 'INITIALIZING'}
      : {ready: true, code: 'READY'})
  });

  await view.clock.fireTimeout(0);
  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');
  assert.equal(view.elements['#confirm-button'].disabled, true);

  await view.clock.fireTimeout(500);
  assert.equal(view.controller.getState().progress, 99.2);
  assert.equal(view.controller.getState().ready, true);
  assert.equal(view.elements['#confirm-button'].disabled, false);
});

test('skip after failed readiness recovery still reaches confirmation and preserves health polling', async () => {
  let calls = 0;
  const view = fixture({
    health: () => ++calls === 1
      ? Promise.reject(Error('offline'))
      : Promise.resolve({ready: true, code: 'READY'})
  });

  await view.clock.fireTimeout(0);
  assert.equal(view.controller.getState().phase, 'failed');
  await view.clock.fireTimeout(500);
  assert.deepEqual(view.controller.getState(), {
    phase: 'waiting', progress: 0, ready: true, confirmed: false
  });

  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');

  assert.deepEqual(view.controller.getState(), {
    phase: 'waiting', progress: 99.2, ready: true, confirmed: false
  });
  assert.equal(view.clock.countIntervals(80), 0);
  assert.equal(view.clock.countIntervals(100), 0);
  assert.equal(view.clock.countTimeouts(600), 0);
  assert.equal(view.clock.countTimeouts(500), 1);
  assert.equal(view.elements['#confirm-button'].disabled, false);
});

test('failed recovery resumes logical progress while decorative presentation stays frozen', async () => {
  let calls = 0;
  const view = fixture({
    health: () => {
      calls += 1;
      return calls === 1 ? Promise.reject(Error('offline')) : Promise.resolve({ready: true});
    }
  });

  await view.clock.fireTimeout(0);
  assert.equal(view.controller.getState().phase, 'failed');
  await view.clock.fireTimeout(500);
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.clock.countIntervals(80), 1);
  assert.equal(view.clock.countIntervals(100), 0);
  assert.equal(view.clock.countTimeouts(500), 1);
  const clockText = view.elements['#clock-readout'].textContent;
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.clock.fireInterval(100);
  assert.equal(view.controller.getState().progress, 99.2);
  assert.equal(view.elements['#clock-readout'].textContent, clockText);
  assert.equal(view.elements['#confirm-button'].disabled, false);
});

test('stable readiness codes render accurate redacted recovery diagnostics', async () => {
  const cases = [
    ['INITIALIZING', '初始化中', '正在连接官方 Codex', true],
    ['CODEX_NOT_FOUND', '未找到 Codex', '未检测到可用的 Codex', false],
    ['SIGNED_OUT', '需要登录', '官方 ChatGPT 登录', false],
    ['NO_LAUNCHABLE_MODEL', '无可用模型', '没有可启动的 Codex 模型', false],
    ['DISCONNECTED', '连接已断开', 'Codex 连接已断开', false]
  ];

  for (const [code, backend, diagnostic, retryHidden] of cases) {
    const view = fixture({
      health: () => Promise.resolve({ready: false, code, message: '/private/raw failure'}),
      retryReadiness: () => Promise.resolve()
    });
    await view.clock.fireTimeout(0);

    assert.equal(view.elements['#backend-state'].textContent, backend, code);
    assert.match(view.elements['#diagnostic-text'].textContent, new RegExp(diagnostic), code);
    assert.equal(view.elements['#retry-button'].hidden, retryHidden, code);
    assert.doesNotMatch(view.elements['#diagnostic-text'].textContent, /private|raw failure/, code);
    view.controller.destroy();
  }
});

test('post-ready disconnect revokes an in-progress confirmation and cannot enter online', async () => {
  let calls = 0;
  const view = fixture({
    health: () => Promise.resolve(++calls === 1
      ? {ready: true, code: 'READY'}
      : {ready: false, code: 'DISCONNECTED'}),
    retryReadiness: () => Promise.resolve()
  });

  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.elements['#confirm-button'].dispatch('click');
  assert.equal(view.controller.getState().phase, 'completing');

  await view.clock.fireTimeout(500);
  assert.equal(view.controller.getState().phase, 'failed');
  assert.equal(view.controller.getState().ready, false);
  assert.equal(view.elements['#confirm-button'].disabled, true);
  view.clock.fireTimeout(720);
  assert.equal(view.controller.getState().phase, 'failed');
  assert.notEqual(view.document.body.dataset.scene, 'online');
});

test('reduced-motion completion requires a fresh exact READY snapshot', async () => {
  let calls = 0;
  const view = fixture({
    health: () => Promise.resolve(++calls === 1
      ? {ready: true, code: 'READY'}
      : {ready: true}),
    retryReadiness: () => Promise.resolve()
  }, {reducedMotion: true});

  view.clock.fireTimeout(600);
  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.elements['#confirm-button'].dispatch('click');
  assert.equal(view.controller.getState().phase, 'completing');

  await view.clock.fireTimeout(120);

  assert.equal(calls, 2);
  assert.equal(view.controller.getState().phase, 'failed');
  assert.equal(view.controller.getState().ready, false);
  assert.equal(view.document.body.dataset.scene, 'sync');
  assert.equal(view.elements['#confirm-button'].disabled, true);
  assert.equal(view.elements['#retry-button'].hidden, false);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('completion health error revokes readiness and resumes recovery polling', async () => {
  let calls = 0;
  const view = fixture({
    health: () => ++calls === 1
      ? Promise.resolve({ready: true, code: 'READY'})
      : Promise.reject(Error('/private/final health failure')),
    retryReadiness: () => Promise.resolve()
  }, {reducedMotion: true});

  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.elements['#confirm-button'].dispatch('click');
  await view.clock.fireTimeout(120);

  assert.equal(view.controller.getState().phase, 'failed');
  assert.equal(view.controller.getState().ready, false);
  assert.equal(view.elements['#backend-state'].textContent, '连接已断开');
  assert.doesNotMatch(view.elements['#diagnostic-text'].textContent, /private|final health failure/);
  assert.equal(view.elements['#retry-button'].hidden, false);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('retry aborts and invalidates stale health so it cannot restore ready', async () => {
  const stale = deferred();
  const retry = deferred();
  let healthCalls = 0;
  let staleSignal;
  let retryCalls = 0;
  const view = fixture({
    health: ({signal}) => {
      healthCalls += 1;
      if (healthCalls === 1) return Promise.resolve({ready: false, code: 'DISCONNECTED'});
      staleSignal = signal;
      return stale.promise;
    },
    retryReadiness: () => {
      retryCalls += 1;
      return retry.promise;
    }
  });

  await view.clock.fireTimeout(0);
  const staleRun = view.clock.fireTimeout(500);
  const retryRun = view.elements['#retry-button'].dispatch('click');

  assert.equal(retryCalls, 1);
  assert.equal(staleSignal.aborted, true);
  assert.equal(view.elements['#retry-button'].disabled, true);
  stale.resolve({ready: true, code: 'READY'});
  await staleRun;
  assert.equal(view.controller.getState().ready, false);
  assert.equal(view.elements['#confirm-button'].disabled, true);

  retry.resolve({accepted: true});
  await retryRun;
  assert.equal(view.controller.getState().ready, false);
  assert.equal(view.clock.countTimeouts(0), 1);
});

test('health polling is serial and never has more than one request in flight', async () => {
  const requests = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const view = fixture({
    health: ({signal}) => {
      const request = deferred();
      requests.push({request, signal});
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return request.promise.finally(() => { inFlight -= 1; });
    }
  });

  const firstRun = view.clock.fireTimeout(0);
  assert.equal(view.clock.countTimeouts(500), 0);
  assert.equal(requests.length, 1);
  requests[0].request.resolve({ready: false});
  await firstRun;
  assert.equal(view.clock.countTimeouts(500), 1);

  const secondRun = view.clock.fireTimeout(500);
  assert.equal(view.clock.countTimeouts(500), 0);
  assert.equal(requests.length, 2);
  assert.equal(maxInFlight, 1);
  requests[1].request.resolve({ready: true});
  await secondRun;
  assert.equal(maxInFlight, 1);
});

test('completion invalidates an overlapping stale poll and trusts only its final health response', async () => {
  const late = deferred();
  const finalHealth = deferred();
  let calls = 0;
  let lateSignal;
  const view = fixture({
    health: ({signal}) => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ready: true, code: 'READY'});
      if (calls === 2) {
        lateSignal = signal;
        return late.promise;
      }
      return finalHealth.promise;
    }
  });

  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  assert.equal(view.controller.getState().progress, 99.2);
  const lateRun = view.clock.fireTimeout(500);
  view.elements['#confirm-button'].dispatch('click');
  const completionRun = view.clock.fireTimeout(720);

  assert.equal(calls, 3);
  assert.equal(lateSignal.aborted, true);
  assert.equal(view.controller.getState().phase, 'completing');
  late.resolve({ready: false, code: 'DISCONNECTED'});
  await lateRun;
  assert.equal(view.controller.getState().phase, 'completing');

  finalHealth.resolve({ready: true, code: 'READY'});
  await completionRun;

  assert.equal(view.document.body.dataset.phase, 'complete');
  assert.equal(view.elements['#sync-heading'].textContent, 'SYSTEM ONLINE');
  assert.equal(view.elements['#boot-screen'].hidden, true);
  assert.equal(view.elements['#workbench-shell'].hidden, false);
  assert.equal(view.elements['#confirm-button'].listeners.has('click'), false);
  assert.equal(view.elements['#skip-button'].listeners.has('click'), false);
  assert.equal(view.rootListeners.has('keydown'), false);
  assert.equal(view.rootListeners.has('pagehide'), true);
  assert.equal(view.clock.intervals.size, 0);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('the mounted shell owns live health and recovers without replaying boot or duplicating retry', async () => {
  const retry = deferred();
  let healthCalls = 0;
  let retryCalls = 0;
  const view = fixture({
    health: () => {
      healthCalls += 1;
      if (healthCalls <= 2) return Promise.resolve({ready: true, code: 'READY'});
      if (healthCalls === 3) return Promise.resolve({ready: false, code: 'DISCONNECTED'});
      return Promise.resolve({ready: true, code: 'READY'});
    },
    retryReadiness: () => {
      retryCalls += 1;
      return retry.promise;
    }
  });

  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.elements['#confirm-button'].dispatch('click');
  await view.clock.fireTimeout(720);
  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.elements['#workbench-shell'].hidden, false);

  await view.clock.fireTimeout(500);
  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.document.body.dataset.scene, 'online');
  assert.equal(view.document.body.dataset.readiness, 'disconnected');
  assert.equal(view.elements['#shell-link-state'].textContent, 'DISCONNECTED');
  assert.match(view.elements['#shell-diagnostic-text'].textContent, /连接已断开/);
  assert.equal(view.elements['#shell-retry-button'].hidden, false);

  const firstRetry = view.elements['#shell-retry-button'].dispatch('click');
  const overlappingRetry = view.elements['#shell-retry-button'].dispatch('click');
  assert.equal(retryCalls, 1);
  assert.equal(view.elements['#shell-retry-button'].disabled, true);
  retry.resolve({accepted: true});
  await Promise.all([firstRetry, overlappingRetry]);
  await view.clock.fireTimeout(0);

  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.elements['#boot-screen'].hidden, true);
  assert.equal(view.elements['#workbench-shell'].hidden, false);
  assert.equal(view.document.body.dataset.readiness, 'ready');
  assert.equal(view.elements['#shell-link-state'].textContent, 'READY');
  assert.equal(view.elements['#shell-retry-button'].hidden, true);
});

test('destroy aborts an in-flight request and blocks later DOM writes', async () => {
  const late = deferred();
  let signal;
  const view = fixture({health: options => { signal = options.signal; return late.promise; }});
  const run = view.clock.fireTimeout(0);
  const writes = view.elements['#diagnostic-text'].textWrites;

  view.controller.destroy();
  assert.equal(signal.aborted, true);
  assert.equal(view.rootListeners.size, 0);
  assert.equal(view.elements['#confirm-button'].listeners.size, 0);
  assert.equal(view.elements['#skip-button'].listeners.size, 0);
  late.resolve({ready: true});
  await run;
  assert.equal(view.elements['#diagnostic-text'].textWrites, writes);
});

test('render updates aria-valuenow and identical health states do not rewrite the live region', async () => {
  const view = fixture({health: () => Promise.resolve({ready: true})});
  await view.clock.fireTimeout(0);
  const writes = view.elements['#diagnostic-text'].textWrites;
  await view.clock.fireTimeout(500);

  view.clock.fireInterval(80);
  assert.equal(view.elements['#ring-progress'].getAttribute('aria-valuenow'), '0.4');
  assert.equal(view.elements['#diagnostic-text'].textWrites, writes);
});

test('scene mapping keeps awakening to the opening beat, sync through confirmation, and online after completion', async () => {
  const view = fixture({health: () => Promise.resolve({ready: true, code: 'READY'})});

  assert.equal(view.document.body.dataset.scene, 'awakening');
  view.clock.fireTimeout(600);
  assert.equal(view.document.body.dataset.scene, 'sync');
  await view.clock.fireTimeout(0);
  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.document.body.dataset.scene, 'sync');
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  view.elements['#confirm-button'].dispatch('click');
  assert.equal(view.document.body.dataset.scene, 'sync');
  await view.clock.fireTimeout(720);
  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.document.body.dataset.scene, 'online');
});

test('Escape skips without preventing the browser default', () => {
  const view = fixture({health: () => new Promise(() => {})});
  view.clock.fireTimeout(3000);
  let prevented = false;
  view.rootListeners.get('keydown')({key: 'Escape', preventDefault: () => { prevented = true; }});

  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(prevented, false);
});

test('automatic startup is a window singleton across repeated script execution', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'boot', 'boot.js'), 'utf8');
  const selectors = [
    '#backend-state', '#phase-caption', '#clock-readout', '#confirm-button',
    '#diagnostic-text', '#retry-button', '#sync-heading', '#progress-value', '#ring-progress',
    '#ring-stroke', '#skip-button', '#boot-screen', '#workbench-shell',
    '#pilot-authorization',
    '#shell-readiness-text', '#shell-link-state', '#shell-diagnostic-text', '#shell-retry-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement()]));
  elements['#boot-screen'].hidden = false;
  const document = {body: new FakeElement(), querySelector: selector => elements[selector]};
  const clock = new FakeClock();
  const listeners = new Map();
  let listenerAdds = 0;
  const sandbox = {
    AbortController,
    ProjectZeroApi: {
      MAX_UNCONFIRMED_PROGRESS,
      health: () => new Promise(() => {}),
      retryReadiness: () => Promise.resolve(),
      nextBootState
    },
    addEventListener(type, listener) { listenerAdds += 1; listeners.set(type, listener); },
    clearInterval: clock.clearInterval,
    clearTimeout: clock.clearTimeout,
    document,
    matchMedia: () => ({matches: false}),
    performance: {now: () => 0},
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    setInterval: clock.setInterval,
    setTimeout: clock.setTimeout
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});
  const controller = sandbox.ProjectZeroBootController;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});

  assert.ok(controller);
  assert.equal(sandbox.ProjectZeroBootController, controller);
  assert.equal(clock.countIntervals(80), 1);
  assert.equal(clock.countIntervals(100), 1);
  assert.equal(listenerAdds, 2);
});

test('shared API uses the exact same-origin POST retry route', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'api.js'), 'utf8');
  const calls = [];
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({url, options});
      return {ok: true, status: 202, json: async () => ({accepted: true})};
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/shared/api.js'});

  await sandbox.ProjectZeroApi.retryReadiness();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/readiness/retry');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'same-origin');
});
