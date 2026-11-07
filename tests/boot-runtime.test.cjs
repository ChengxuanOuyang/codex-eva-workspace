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
  dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
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

function fixture(api) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'boot', 'boot.js'), 'utf8');
  const sandbox = {AbortController};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});
  assert.equal(typeof sandbox.ProjectZeroBoot?.createBootController, 'function');

  const selectors = [
    '#backend-state', '#phase-caption', '#clock-readout', '#confirm-button',
    '#diagnostic-text', '#sync-heading', '#progress-value', '#ring-progress', '#ring-stroke', '#skip-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement()]));
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
    reducedMotion: false,
    root
  });
  controller.start();
  return {clock, controller, document, elements, rootListeners};
}

test('skip freezes progress and display clock while health polling remains scheduled', async () => {
  const health = deferred();
  const view = fixture({health: () => health.promise});

  const healthRun = view.clock.fireTimeout(0);
  assert.equal(view.clock.countIntervals(80), 1);
  view.clock.fireTimeout(3000);
  view.elements['#skip-button'].dispatch('click');

  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.clock.countIntervals(80), 0);
  assert.equal(view.clock.countIntervals(100), 0);
  const progress = view.controller.getState().progress;
  const clockText = view.elements['#clock-readout'].textContent;
  view.clock.fireInterval(80);
  view.clock.fireInterval(100);
  assert.equal(view.controller.getState().progress, progress);
  assert.equal(view.elements['#clock-readout'].textContent, clockText);
  health.resolve({ready: false});
  await healthRun;
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('failed recovery entering waiting freezes presentation without stopping health polling', async () => {
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
  assert.equal(view.clock.countIntervals(80), 0);
  assert.equal(view.clock.countIntervals(100), 0);
  assert.equal(view.clock.countTimeouts(500), 1);
  const progress = view.controller.getState().progress;
  const clockText = view.elements['#clock-readout'].textContent;
  view.clock.fireInterval(80);
  view.clock.fireInterval(100);
  assert.equal(view.controller.getState().progress, progress);
  assert.equal(view.elements['#clock-readout'].textContent, clockText);
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

test('completion aborts health and a late response cannot overwrite SYSTEM ONLINE', async () => {
  const late = deferred();
  let calls = 0;
  let lateSignal;
  const view = fixture({
    health: ({signal}) => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ready: true});
      lateSignal = signal;
      return late.promise;
    }
  });

  await view.clock.fireTimeout(0);
  while (view.clock.countIntervals(80)) view.clock.fireInterval(80);
  assert.equal(view.controller.getState().progress, 99.2);
  const lateRun = view.clock.fireTimeout(500);
  view.elements['#confirm-button'].dispatch('click');
  view.clock.fireTimeout(720);

  assert.equal(view.document.body.dataset.phase, 'complete');
  assert.equal(view.elements['#sync-heading'].textContent, 'SYSTEM ONLINE');
  assert.equal(lateSignal.aborted, true);
  assert.equal(view.elements['#confirm-button'].listeners.has('click'), false);
  assert.equal(view.elements['#skip-button'].listeners.has('click'), false);
  assert.equal(view.rootListeners.has('keydown'), false);
  assert.equal(view.rootListeners.has('pagehide'), true);
  const writes = view.elements['#diagnostic-text'].textWrites;
  late.resolve({ready: false});
  await lateRun;
  assert.equal(view.elements['#sync-heading'].textContent, 'SYSTEM ONLINE');
  assert.equal(view.elements['#diagnostic-text'].textWrites, writes);
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
    '#diagnostic-text', '#sync-heading', '#progress-value', '#ring-progress', '#ring-stroke', '#skip-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement()]));
  const document = {body: new FakeElement(), querySelector: selector => elements[selector]};
  const clock = new FakeClock();
  const listeners = new Map();
  let listenerAdds = 0;
  const sandbox = {
    AbortController,
    ProjectZeroApi: {
      MAX_UNCONFIRMED_PROGRESS,
      health: () => new Promise(() => {}),
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
