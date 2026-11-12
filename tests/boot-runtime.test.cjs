'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {nextBootState, MAX_UNCONFIRMED_PROGRESS} = require('../renderer/boot/boot-state.cjs');
const {REFERENCE_TIMING} = require('../renderer/boot/reference-timing.js');
const {sampleTimeline} = require('../renderer/boot/timeline.js');

class FakeStyle {
  constructor(events) {
    this.events = events;
    this.properties = new Map();
  }

  setProperty(name, value) {
    this.properties.set(name, value);
    this.events.push(`style:${name}:${value}`);
  }

  removeProperty(name) {
    this.properties.delete(name);
    this.events.push(`style-remove:${name}`);
  }

  getPropertyValue(name) { return this.properties.get(name) || ''; }
}

class FakeElement {
  constructor(text = '', {events = [], name = 'element'} = {}) {
    this._text = text;
    this._hidden = true;
    this.textWrites = 0;
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = true;
    this.listeners = new Map();
    this.events = events;
    this.name = name;
    this.style = new FakeStyle(events);
  }

  get textContent() { return this._text; }
  set textContent(value) { this._text = value; this.textWrites += 1; }
  get hidden() { return this._hidden; }
  set hidden(value) {
    this._hidden = Boolean(value);
    this.events.push(`${this.name}.hidden:${this._hidden}`);
  }
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
}

class FakeAudioClock {
  constructor(options, events, {fade} = {}) {
    this.options = options;
    this.events = events;
    this.fade = fade;
    this.calls = {start: 0, pause: 0, resume: 0, seek: [], fadeOut: [], destroy: 0};
  }

  start = async () => {
    this.calls.start += 1;
    this.events.push('audio.start');
  };
  pause = () => {
    this.calls.pause += 1;
    this.events.push('audio.pause');
  };
  resume = async () => {
    this.calls.resume += 1;
    this.events.push('audio.resume');
  };
  seek = elapsedMs => {
    this.calls.seek.push(elapsedMs);
    this.events.push(`audio.seek:${elapsedMs}`);
  };
  fadeOut = duration => {
    this.calls.fadeOut.push(duration);
    this.events.push(`audio.fadeOut:${duration}`);
    return this.fade?.promise || Promise.resolve();
  };
  destroy = async () => {
    this.calls.destroy += 1;
    this.events.push('audio.destroy');
  };
  tick(elapsedMs) { return this.options.onTick(elapsedMs); }
  end() { return this.options.onEnd(); }
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

async function flushMicrotasks(turns = 3) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

function response({status = 200, json = {}} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json
  };
}

async function fixture(apiOverrides = {}, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'boot', 'boot.js'), 'utf8');
  const sandbox = {
    AbortController,
    ProjectZeroReferenceTiming: {REFERENCE_TIMING},
    ProjectZeroRendererDirector: options.director ? require('../renderer/boot/renderer-director.js') : undefined
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});
  assert.equal(typeof sandbox.ProjectZeroBoot?.createBootController, 'function');

  const events = [];
  const selectors = [
    '#backend-state', '#phase-caption', '#clock-readout', '#confirm-button',
    '#diagnostic-text', '#retry-button', '#sync-heading', '#progress-value', '#ring-progress',
    '#ring-stroke', '#skip-button', '#boot-screen', '#workbench-shell', '#boot-live-status',
    '#pilot-authorization', '#reference-sequence', '#boot-sequence',
    '#shell-readiness-text', '#shell-link-state', '#shell-diagnostic-text', '#shell-retry-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [
    selector,
    new FakeElement('', {events, name: selector})
  ]));
  elements['#boot-screen'].hidden = false;
  events.length = 0;
  const body = new FakeElement('', {events, name: 'body'});
  body.dataset = new Proxy({}, {
    set(target, property, value) {
      target[property] = String(value);
      events.push(`body.dataset.${String(property)}:${String(value)}`);
      return true;
    },
    deleteProperty(target, property) {
      delete target[property];
      events.push(`body.dataset.${String(property)}:delete`);
      return true;
    }
  });
  const documentElement = new FakeElement('', {events, name: 'html'});
  const document = {
    body,
    documentElement,
    querySelector: selector => elements[selector]
  };
  const rootListeners = new Map();
  const root = {
    innerWidth: 1440, innerHeight: 900,
    addEventListener: (type, listener) => rootListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (rootListeners.get(type) === listener) rootListeners.delete(type);
    }
  };
  const clock = new FakeClock();
  const canvas = {
    lastSnapshot: null,
    renders: 0,
    render(snapshot) {
      this.lastSnapshot = snapshot;
      this.renders += 1;
      events.push(`canvas.render:${snapshot.elapsedMs}`);
    }
  };
  const reference = {
    snapshots: [], failRender: false, failResize: false, destroys: 0,
    render(snapshot, assets) {
      this.snapshots.push(snapshot);
      this.assets = assets;
      if (this.failRender) throw Error('reference render failed');
    },
    resize(viewport) { this.viewport = viewport; if (this.failResize) throw Error('reference resize failed'); },
    lastRenderRecord: () => ({renderer: 'reference'}),
    destroy() { this.destroys += 1; }
  };
  const mark = {decoded: true};
  const configFetches = [];
  const fetchPrivate = options.fetch || (async url => {
    configFetches.push(url);
    return response({status: 404});
  });
  const audioLoads = [];
  const decodedTrack = options.decodedTrack || {
    currentTime: 0,
    duration: 30,
    volume: 1,
    play: async () => {},
    pause() {},
    close: async () => {}
  };
  const loadSequenceAudio = options.loadSequenceAudio || (async (url, dependencies) => {
    audioLoads.push({url, dependencies});
    return decodedTrack;
  });
  let audioClock;
  const createAudioClock = clockOptions => {
    events.push('audio.create');
    audioClock = new FakeAudioClock(clockOptions, events, {fade: options.fade});
    return audioClock;
  };
  const api = {
    health: () => Promise.resolve({ready: false, code: 'INITIALIZING'}),
    retryReadiness: () => Promise.resolve({accepted: true}),
    completePresentation: () => {
      events.push('api.completePresentation');
      return Promise.resolve();
    },
    ...apiOverrides,
    nextBootState(state, event) {
      events.push(`state.${event?.type}`);
      return nextBootState(state, event);
    },
    MAX_UNCONFIRMED_PROGRESS
  };
  const controller = sandbox.ProjectZeroBoot.createBootController({
    api,
    bootCanvas: canvas,
    clock,
    createAudioClock,
    createReferenceRenderer: options.director ? () => {
      if (options.failReferenceCreation) throw Error('reference unavailable');
      return reference;
    } : undefined,
    prepareBootAssets: options.director ? async () => {
      if (options.markDecode) await options.markDecode.promise;
      if (options.markDecodeFails) throw Error('decode failed');
      return {mark};
    } : undefined,
    createImage: () => ({}),
    document,
    fetch: fetchPrivate,
    loadSequenceAudio,
    now: () => 0,
    reducedMotion: options.reducedMotion === true,
    root,
    sampleTimeline
  });
  const startPromise = controller.start();
  if (options.awaitStart !== false) await startPromise;
  return {
    get audioClock() { return audioClock; },
    audioLoads,
    canvas,
    clock,
    configFetches,
    controller,
    document,
    elements,
    events,
    rootListeners,
    root, reference, mark,
    startPromise
  };
}

test('audio ticks drive the timeline, accessible state, canvas and one authorization pause', async () => {
  const view = await fixture();

  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  assert.equal(view.document.body.dataset.stage, 'authorize');
  assert.equal(view.elements['#progress-value'].textContent, '99.2');
  assert.equal(view.elements['#confirm-button'].disabled, true);
  assert.deepEqual(view.canvas.lastSnapshot, sampleTimeline(REFERENCE_TIMING.holdMs));
  assert.equal(view.audioClock.calls.pause, 1);
  assert.equal(view.clock.countIntervals(80), 0);
  assert.equal(view.clock.countIntervals(100), 0);

  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.clock.fireTimeout(0);
  await view.clock.fireTimeout(500);
  assert.equal(view.audioClock.calls.pause, 1);
});

test('READY only unlocks confirmation and a fresh exact READY resumes once', async () => {
  let healthCalls = 0;
  const view = await fixture({
    health: () => Promise.resolve(++healthCalls === 1
      ? {ready: true, code: 'READY'}
      : {ready: true, code: 'READY'})
  });

  await view.clock.fireTimeout(0);
  assert.equal(view.controller.getState().progress, 0);
  assert.equal(view.elements['#confirm-button'].disabled, true);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  assert.equal(view.elements['#confirm-button'].disabled, false);

  await Promise.all([
    view.elements['#confirm-button'].dispatch('click'),
    view.elements['#confirm-button'].dispatch('click')
  ]);
  assert.equal(healthCalls, 2);
  assert.equal(view.controller.getState().phase, 'completing');
  assert.equal(view.audioClock.calls.resume, 1);
  assert.equal(view.document.body.dataset.stage, 'authorize');
});

test('reduced motion cannot confirm before the semantic authorization gate', async () => {
  let healthCalls = 0;
  const view = await fixture({
    health: () => {
      healthCalls += 1;
      return Promise.resolve({ready: true, code: 'READY'});
    }
  }, {reducedMotion: true});

  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.syncStartMs);
  assert.equal(view.controller.getState().progress, 99.2);
  assert.equal(view.document.body.dataset.stage, 'synchronize');
  assert.equal(view.elements['#confirm-button'].disabled, true);
  await view.elements['#confirm-button'].dispatch('click');
  assert.equal(healthCalls, 1);
  assert.equal(view.audioClock.calls.resume, 0);

  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  assert.equal(view.elements['#confirm-button'].disabled, false);
});

test('confirmation fails closed when the revalidation is not exact READY', async () => {
  let healthCalls = 0;
  const view = await fixture({
    health: () => Promise.resolve(++healthCalls === 1
      ? {ready: true, code: 'READY'}
      : {ready: true})
  });

  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');

  assert.equal(healthCalls, 2);
  assert.equal(view.controller.getState().phase, 'failed');
  assert.equal(view.controller.getState().confirmed, false);
  assert.equal(view.audioClock.calls.resume, 0);
  assert.equal(view.elements['#workbench-shell'].hidden, true);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('private config accepts only fixed same-origin asset URLs and applies the fixed portrait', async () => {
  const fetches = [];
  const view = await fixture({}, {
    fetch: async (url, requestOptions) => {
      fetches.push({url, requestOptions});
      return response({json: {
        displayName: 'PROJECT ZERO // PRIVATE',
        mark: '/private/boot-mark.webp',
        portrait: '/private/rei-portrait.webp',
        soundtrack: '/private/startup-reference.wav',
        audioStartMs: 250,
        audioEndMs: 20_750
      }});
    }
  });

  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, '/private/theme.json');
  assert.equal(fetches[0].requestOptions.credentials, 'same-origin');
  assert.deepEqual(view.audioLoads.map(load => load.url), ['/private/startup-reference.wav']);
  assert.equal(view.audioClock.options.startSeconds, 0.25);
  assert.equal(view.audioClock.options.endSeconds, 20.75);
  assert.equal(view.audioClock.options.endToleranceMs, 1);
  assert.equal(
    view.document.documentElement.style.getPropertyValue('--theme-workbench-portrait'),
    'url("/private/rei-portrait.webp")'
  );
});

test('a decoded private track shorter than audioEndMs closes and falls back to the public silent clock', async () => {
  let closeCalls = 0;
  const decodedTrack = {
    currentTime: 0,
    duration: 20.7,
    volume: 1,
    play: async () => {},
    pause() {},
    close: async () => { closeCalls += 1; }
  };
  const view = await fixture({}, {
    decodedTrack,
    fetch: async () => response({json: {
      displayName: 'PROJECT ZERO // PRIVATE',
      mark: '/private/boot-mark.webp',
      portrait: '/private/rei-portrait.webp',
      soundtrack: '/private/startup-reference.wav',
      audioStartMs: 250,
      audioEndMs: 20_750
    }})
  });

  assert.equal(closeCalls, 1);
  assert.notEqual(view.audioClock.options.audio, decodedTrack);
  assert.equal(view.audioClock.options.startSeconds, 0);
  assert.equal(view.audioClock.options.endSeconds, 20.5);
  assert.equal(view.audioClock.calls.start, 1);
});

test('a missing or non-finite decoded duration fails closed without stalling presentation', async () => {
  for (const duration of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    let closeCalls = 0;
    const decodedTrack = {
      currentTime: 0,
      duration,
      volume: 1,
      play: async () => {},
      pause() {},
      close: async () => { closeCalls += 1; }
    };
    const view = await fixture({}, {
      decodedTrack,
      fetch: async () => response({json: {
        displayName: 'PROJECT ZERO // PRIVATE',
        mark: '/private/boot-mark.webp',
        portrait: '/private/rei-portrait.webp',
        soundtrack: '/private/startup-reference.wav',
        audioStartMs: 250,
        audioEndMs: 20_750
      }})
    });

    assert.equal(closeCalls, 1);
    assert.notEqual(view.audioClock.options.audio, decodedTrack);
    assert.equal(view.audioClock.options.startSeconds, 0);
    assert.equal(view.audioClock.options.endSeconds, 20.5);
    assert.equal(view.audioClock.calls.start, 1);
  }
});

test('decoded duration accepts a sub-millisecond floating-point shortfall', async () => {
  const decodedTrack = {
    currentTime: 0,
    duration: 20.7499995,
    volume: 1,
    play: async () => {},
    pause() {},
    close: async () => { throw new Error('valid track must remain open'); }
  };
  const view = await fixture({}, {
    decodedTrack,
    fetch: async () => response({json: {
      displayName: 'PROJECT ZERO // PRIVATE',
      mark: '/private/boot-mark.webp',
      portrait: '/private/rei-portrait.webp',
      soundtrack: '/private/startup-reference.wav',
      audioStartMs: 250,
      audioEndMs: 20_750
    }})
  });

  assert.equal(view.audioClock.options.audio, decodedTrack);
  assert.equal(view.audioClock.options.startSeconds, 0.25);
  assert.equal(view.audioClock.options.endSeconds, 20.75);
});

test('arbitrary private URLs are rejected without fetching them', async () => {
  const view = await fixture({}, {
    fetch: async () => response({json: {
      displayName: 'PROJECT ZERO // MALICIOUS',
      mark: 'https://example.test/mark.webp',
      portrait: 'javascript:alert(1)',
      soundtrack: 'https://example.test/audio.wav',
      audioStartMs: 0,
      audioEndMs: 20_500
    }})
  });

  assert.deepEqual(view.audioLoads, []);
  assert.equal(view.audioClock.options.startSeconds, 0);
  assert.equal(view.audioClock.options.endSeconds, 20.5);
  assert.equal(view.document.documentElement.style.getPropertyValue('--theme-workbench-portrait'), '');
});

test('a missing private config creates a silent public 20.5 second clock', async () => {
  const view = await fixture();

  assert.deepEqual(view.configFetches, ['/private/theme.json']);
  assert.deepEqual(view.audioLoads, []);
  assert.equal(view.audioClock.options.startSeconds, 0);
  assert.equal(view.audioClock.options.endSeconds, 20.5);
  assert.equal(typeof view.audioClock.options.audio.play, 'function');
  assert.equal(view.audioClock.calls.start, 1);
});

test('skip strictly fades, seeks and dispatches without stopping health polling', async () => {
  const fade = deferred();
  const health = deferred();
  const view = await fixture({health: () => health.promise}, {fade});
  const healthRun = view.clock.fireTimeout(0);

  const skipRun = view.elements['#skip-button'].dispatch('click');
  assert.deepEqual(view.audioClock.calls.fadeOut, [150]);
  assert.deepEqual(view.audioClock.calls.seek, []);
  assert.equal(view.controller.getState().progress, 0);

  fade.resolve();
  await skipRun;
  assert.deepEqual(view.audioClock.calls.seek, [REFERENCE_TIMING.holdMs]);
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.controller.getState().progress, 99.2);
  assert.deepEqual(
    view.events.filter(event => event.startsWith('audio.fadeOut') || event.startsWith('audio.seek') || event === 'state.skip'),
    ['audio.fadeOut:150', `audio.seek:${REFERENCE_TIMING.holdMs}`, 'state.skip']
  );

  health.resolve({ready: false, code: 'INITIALIZING'});
  await healthRun;
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('skip waits for pending clock initialization and still runs exactly once', async () => {
  const config = deferred();
  const view = await fixture({}, {
    awaitStart: false,
    fetch: () => config.promise
  });

  const skipRun = view.elements['#skip-button'].dispatch('click');
  assert.equal(view.controller.getState().phase, 'syncing');
  config.resolve(response({status: 404}));
  await view.startPromise;
  await skipRun;

  assert.deepEqual(view.audioClock.calls.fadeOut, [150]);
  assert.deepEqual(view.audioClock.calls.seek, [REFERENCE_TIMING.holdMs]);
  assert.equal(view.controller.getState().phase, 'waiting');
});

test('Escape uses skip without preventing the browser default', async () => {
  const view = await fixture();
  let prevented = false;

  await view.rootListeners.get('keydown')({
    key: 'Escape',
    preventDefault: () => { prevented = true; }
  });

  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(prevented, false);
  assert.deepEqual(view.audioClock.calls.fadeOut, [150]);
});

test('completion closes for 180 ms, completes the window once, reveals the shell and resumes polling', async () => {
  let healthCalls = 0;
  let completeCalls = 0;
  const view = await fixture({
    health: () => {
      healthCalls += 1;
      return Promise.resolve({ready: true, code: 'READY'});
    },
    completePresentation: () => {
      completeCalls += 1;
      view.events.push('api.completePresentation');
      return Promise.resolve();
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  view.audioClock.tick(20_500);

  const completionRun = view.audioClock.end();
  await flushMicrotasks();
  assert.equal(healthCalls, 3);
  assert.equal(view.document.body.dataset.transition, 'closing');
  assert.equal(completeCalls, 0);
  assert.equal(view.elements['#boot-screen'].hidden, false);
  assert.equal(view.clock.countTimeouts(180), 1);

  await view.clock.fireTimeout(180);
  await completionRun;
  assert.equal(completeCalls, 1);
  assert.equal(view.elements['#boot-screen'].hidden, true);
  assert.equal(view.elements['#workbench-shell'].hidden, false);
  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.document.body.dataset.transition, undefined);
  assert.equal(view.clock.countTimeouts(500), 1);
  assert.deepEqual(view.events.filter(event =>
    event === 'body.dataset.transition:closing'
    || event === 'api.completePresentation'
    || event === '#boot-screen.hidden:true'
    || event === '#workbench-shell.hidden:false'
    || event === 'state.complete'
    || event === 'body.dataset.transition:delete'
  ), [
    'body.dataset.transition:closing',
    'api.completePresentation',
    '#boot-screen.hidden:true',
    '#workbench-shell.hidden:false',
    'state.complete',
    'body.dataset.transition:delete'
  ]);

  await view.audioClock.end();
  assert.equal(completeCalls, 1);
});

test('completion revalidates exact READY before closing and returns to the authorization gate on failure', async () => {
  let healthCalls = 0;
  let completeCalls = 0;
  const view = await fixture({
    health: () => Promise.resolve(++healthCalls <= 2
      ? {ready: true, code: 'READY'}
      : {ready: false, code: 'DISCONNECTED'}),
    completePresentation: () => {
      completeCalls += 1;
      return Promise.resolve();
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  view.audioClock.tick(20_500);

  const completionRun = view.audioClock.end();
  await flushMicrotasks();
  if (view.clock.countTimeouts(180) > 0) await view.clock.fireTimeout(180);
  await completionRun;

  assert.equal(healthCalls, 3);
  assert.equal(completeCalls, 0);
  assert.equal(view.document.body.dataset.transition, undefined);
  assert.equal(view.elements['#boot-screen'].hidden, false);
  assert.equal(view.elements['#workbench-shell'].hidden, true);
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.controller.getState().confirmed, false);
  assert.equal(view.document.body.dataset.stage, 'authorize');
  assert.equal(view.canvas.lastSnapshot.stage, 'authorize');
  assert.deepEqual(view.audioClock.calls.seek, [REFERENCE_TIMING.holdMs]);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('completion aborts a stale disconnect poll before its fresh READY revalidation', async () => {
  const stalePoll = deferred();
  const freshReady = deferred();
  let healthCalls = 0;
  let staleSignal;
  let completeCalls = 0;
  const view = await fixture({
    health: ({signal}) => {
      healthCalls += 1;
      if (healthCalls <= 2) return Promise.resolve({ready: true, code: 'READY'});
      if (healthCalls === 3) {
        staleSignal = signal;
        return stalePoll.promise;
      }
      return freshReady.promise;
    },
    completePresentation: () => {
      completeCalls += 1;
      return Promise.resolve();
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  const staleRun = view.clock.fireTimeout(500);
  view.audioClock.tick(20_500);

  const completionRun = view.audioClock.end();
  stalePoll.resolve({ready: false, code: 'DISCONNECTED'});
  await staleRun;
  freshReady.resolve({ready: true, code: 'READY'});
  await flushMicrotasks();
  if (view.clock.countTimeouts(180) > 0) await view.clock.fireTimeout(180);
  await completionRun;

  assert.equal(staleSignal.aborted, true);
  assert.equal(healthCalls, 4);
  assert.equal(completeCalls, 1);
  assert.equal(view.controller.getState().phase, 'complete');
  assert.equal(view.elements['#workbench-shell'].hidden, false);
});

test('a rejected completion API fails closed with no unhandled reveal', async () => {
  const view = await fixture({
    health: () => Promise.resolve({ready: true, code: 'READY'}),
    completePresentation: () => Promise.reject(Error('/private/window failure'))
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  const completionRun = view.audioClock.end();
  await flushMicrotasks();
  await view.clock.fireTimeout(180);
  await completionRun;

  assert.equal(view.elements['#boot-screen'].hidden, false);
  assert.equal(view.elements['#workbench-shell'].hidden, true);
  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.controller.getState().confirmed, false);
  assert.equal(view.document.body.dataset.stage, 'authorize');
  assert.equal(view.canvas.lastSnapshot.stage, 'authorize');
  assert.equal(view.document.body.dataset.transition, undefined);
  assert.doesNotMatch(view.elements['#diagnostic-text'].textContent, /private|window failure/);
  assert.equal(view.clock.countTimeouts(500), 1);
});

test('destroy during a pending completion aborts and blocks every later DOM transition', async () => {
  const pending = deferred();
  let completeSignal;
  const view = await fixture({
    health: () => Promise.resolve({ready: true, code: 'READY'}),
    completePresentation: ({signal}) => {
      completeSignal = signal;
      return pending.promise;
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  const completionRun = view.audioClock.end();
  await flushMicrotasks();
  await view.clock.fireTimeout(180);

  view.controller.destroy();
  assert.equal(completeSignal.aborted, true);
  assert.equal(view.audioClock.calls.destroy, 1);
  pending.resolve();
  await completionRun;
  assert.equal(view.elements['#boot-screen'].hidden, false);
  assert.equal(view.elements['#workbench-shell'].hidden, true);
  assert.notEqual(view.controller.getState().phase, 'complete');
});

test('a concurrent confirm wins over skip and does not duplicate revalidation', async () => {
  const revalidation = deferred();
  let healthCalls = 0;
  const view = await fixture({
    health: () => {
      healthCalls += 1;
      return healthCalls === 1
        ? Promise.resolve({ready: true, code: 'READY'})
        : revalidation.promise;
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);

  const confirmRun = view.elements['#confirm-button'].dispatch('click');
  await view.elements['#skip-button'].dispatch('click');
  assert.deepEqual(view.audioClock.calls.fadeOut, []);
  assert.equal(healthCalls, 2);
  revalidation.resolve({ready: true, code: 'READY'});
  await confirmRun;
  assert.equal(view.audioClock.calls.resume, 1);
  assert.equal(view.controller.getState().phase, 'completing');
});

test('stable readiness diagnostics stay redacted and retry invalidates stale polling', async () => {
  const stale = deferred();
  const retry = deferred();
  let calls = 0;
  let staleSignal;
  let retryCalls = 0;
  const view = await fixture({
    health: ({signal}) => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ready: false, code: 'DISCONNECTED', message: '/private/raw'});
      staleSignal = signal;
      return stale.promise;
    },
    retryReadiness: () => {
      retryCalls += 1;
      return retry.promise;
    }
  });

  await view.clock.fireTimeout(0);
  assert.equal(view.elements['#backend-state'].textContent, '连接已断开');
  assert.doesNotMatch(view.elements['#diagnostic-text'].textContent, /private|raw/);
  const staleRun = view.clock.fireTimeout(500);
  const retryRun = view.elements['#retry-button'].dispatch('click');
  assert.equal(staleSignal.aborted, true);
  assert.equal(retryCalls, 1);
  stale.resolve({ready: true, code: 'READY'});
  await staleRun;
  assert.equal(view.controller.getState().ready, false);
  retry.resolve({accepted: true});
  await retryRun;
  assert.equal(view.clock.countTimeouts(0), 1);
});

test('health polling remains serial', async () => {
  const requests = [];
  let inFlight = 0;
  let maximum = 0;
  const view = await fixture({
    health: () => {
      const request = deferred();
      requests.push(request);
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      return request.promise.finally(() => { inFlight -= 1; });
    }
  });

  const firstRun = view.clock.fireTimeout(0);
  assert.equal(requests.length, 1);
  assert.equal(view.clock.countTimeouts(500), 0);
  requests[0].resolve({ready: false, code: 'INITIALIZING'});
  await firstRun;
  const secondRun = view.clock.fireTimeout(500);
  assert.equal(requests.length, 2);
  requests[1].resolve({ready: true, code: 'READY'});
  await secondRun;
  assert.equal(maximum, 1);
});

test('disconnect after confirmation restores authorize and requires a fresh second confirmation', async () => {
  let calls = 0;
  const view = await fixture({
    health: () => {
      calls += 1;
      if (calls <= 2 || calls >= 4) return Promise.resolve({ready: true, code: 'READY'});
      return Promise.resolve({ready: false, code: 'DISCONNECTED'});
    }
  });
  await view.clock.fireTimeout(0);
  view.audioClock.tick(REFERENCE_TIMING.holdMs);
  await view.elements['#confirm-button'].dispatch('click');
  assert.equal(view.audioClock.calls.pause, 1);
  await view.clock.fireTimeout(500);

  assert.equal(view.controller.getState().phase, 'waiting');
  assert.equal(view.controller.getState().confirmed, false);
  assert.equal(view.audioClock.calls.pause, 2);
  assert.deepEqual(view.audioClock.calls.seek, [REFERENCE_TIMING.holdMs]);
  assert.deepEqual(
    view.events.filter(event => event === 'audio.pause'
      || event === `audio.seek:${REFERENCE_TIMING.holdMs}`).slice(-2),
    ['audio.pause', `audio.seek:${REFERENCE_TIMING.holdMs}`]
  );
  assert.equal(view.document.body.dataset.stage, 'authorize');
  assert.equal(view.canvas.lastSnapshot.stage, 'authorize');
  assert.equal(view.elements['#confirm-button'].disabled, true);
  assert.equal(view.elements['#workbench-shell'].hidden, true);

  await view.clock.fireTimeout(500);
  assert.equal(view.elements['#confirm-button'].disabled, false);
  await view.elements['#confirm-button'].dispatch('click');
  assert.equal(calls, 5);
  assert.equal(view.controller.getState().phase, 'completing');
  assert.equal(view.audioClock.calls.resume, 2);
});

test('destroy aborts health, destroys audio once and blocks late writes', async () => {
  const health = deferred();
  let signal;
  const view = await fixture({health: options => {
    signal = options.signal;
    return health.promise;
  }});
  const run = view.clock.fireTimeout(0);
  const writes = view.elements['#diagnostic-text'].textWrites;

  view.controller.destroy();
  view.controller.destroy();
  assert.equal(signal.aborted, true);
  assert.equal(view.audioClock.calls.destroy, 1);
  assert.equal(view.rootListeners.size, 0);
  health.resolve({ready: true, code: 'READY'});
  await run;
  assert.equal(view.elements['#diagnostic-text'].textWrites, writes);
});

test('identical readiness and timeline snapshots do not rewrite live regions', async () => {
  const view = await fixture({health: () => Promise.resolve({ready: true, code: 'READY'})});
  await view.clock.fireTimeout(0);
  view.audioClock.tick(10_500);
  const diagnosticWrites = view.elements['#diagnostic-text'].textWrites;
  const liveWrites = view.elements['#boot-live-status'].textWrites;

  await view.clock.fireTimeout(500);
  view.audioClock.tick(10_500);
  assert.equal(view.elements['#diagnostic-text'].textWrites, diagnosticWrites);
  assert.equal(view.elements['#boot-live-status'].textWrites, liveWrites);
  assert.equal(
    view.elements['#ring-progress'].getAttribute('aria-valuenow'),
    sampleTimeline(10_500).progress.toFixed(1)
  );
});

test('automatic startup remains a singleton and uses no legacy interval ticker', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'boot', 'boot.js'), 'utf8');
  const selectors = [
    '#backend-state', '#phase-caption', '#clock-readout', '#confirm-button',
    '#diagnostic-text', '#retry-button', '#sync-heading', '#progress-value', '#ring-progress',
    '#ring-stroke', '#skip-button', '#boot-screen', '#workbench-shell', '#boot-live-status',
    '#pilot-authorization',
    '#shell-readiness-text', '#shell-link-state', '#shell-diagnostic-text', '#shell-retry-button'
  ];
  const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement()]));
  elements['#boot-screen'].hidden = false;
  const body = new FakeElement();
  const document = {body, documentElement: body, querySelector: selector => elements[selector]};
  const clock = new FakeClock();
  const listeners = new Map();
  let audioStarts = 0;
  const presentationClock = {
    start: async () => { audioStarts += 1; },
    pause() {}, resume: async () => {}, seek() {}, fadeOut: async () => {}, destroy: async () => {}
  };
  const sandbox = {
    AbortController,
    ProjectZeroApi: {
      MAX_UNCONFIRMED_PROGRESS,
      health: () => new Promise(() => {}),
      retryReadiness: () => Promise.resolve(),
      completePresentation: () => Promise.resolve(),
      nextBootState
    },
    ProjectZeroAudioClock: {createAudioClock: () => presentationClock},
    ProjectZeroBootCanvasInstance: {render() {}},
    ProjectZeroReferenceTiming: {REFERENCE_TIMING},
    ProjectZeroSequenceAudio: {loadSequenceAudio: async () => { throw Error('not used'); }},
    ProjectZeroTimeline: {sampleTimeline},
    addEventListener(type, listener) { listeners.set(type, listener); },
    clearInterval: clock.clearInterval,
    clearTimeout: clock.clearTimeout,
    document,
    fetch: async () => response({status: 404}),
    matchMedia: () => ({matches: false}),
    performance: {now: () => 0},
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setInterval: clock.setInterval,
    setTimeout: clock.setTimeout
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});
  const controller = sandbox.ProjectZeroBootController;
  await controller.start();
  vm.runInNewContext(source, sandbox, {filename: 'renderer/boot/boot.js'});

  assert.ok(controller);
  assert.equal(sandbox.ProjectZeroBootController, controller);
  assert.equal(audioStarts, 1);
  assert.equal(clock.intervals.size, 0);
});

function completePrivateTheme() {
  return response({json: {
    displayName: 'PRIVATE', mark: '/private/boot-mark.webp', portrait: '/private/rei-portrait.webp',
    soundtrack: '/private/startup-reference.wav', audioStartMs: 250, audioEndMs: 20_750
  }});
}

test('complete decoded private theme selects reference without recreating audio on fallback', async () => {
  const view = await fixture({health: async () => ({ready: true, code: 'READY'})}, {
    director: true, fetch: async () => completePrivateTheme()
  });
  const director = view.root.ProjectZeroRendererDirectorInstance;
  assert.equal(director.mode(), 'reference');
  assert.equal(view.reference.assets.mark, view.mark);
  assert.equal(view.elements['#reference-sequence'].hidden, false);
  assert.equal(view.elements['#boot-sequence'].hidden, true);
  await view.clock.fireTimeout(0);
  view.audioClock.tick(10500);
  const audioCalls = JSON.stringify(view.audioClock.calls);
  const liveWrites = view.elements['#boot-live-status'].textWrites;
  const state = view.controller.getState();
  view.reference.failRender = true;
  view.audioClock.tick(10500);
  assert.equal(director.mode(), 'canvas');
  assert.equal(view.canvas.lastSnapshot, view.reference.snapshots.at(-1));
  assert.equal(JSON.stringify(view.audioClock.calls), audioCalls);
  assert.equal(view.controller.getState(), state);
  assert.equal(view.controller.getState().ready, true);
  assert.equal(view.elements['#boot-live-status'].textWrites, liveWrites);
  assert.equal(view.elements['#reference-sequence'].hidden, true);
  assert.equal(view.elements['#boot-sequence'].hidden, false);
  assert.ok(view.events.indexOf('canvas.render:10500') < view.events.lastIndexOf('#reference-sequence.hidden:true'));
});

test('public, private 404, mark decode failure and reference creation failure select Canvas', async () => {
  for (const options of [
    {}, {fetch: async () => response({status: 404})},
    {fetch: async () => completePrivateTheme(), markDecodeFails: true},
    {fetch: async () => completePrivateTheme(), failReferenceCreation: true}
  ]) {
    const view = await fixture({}, {director: true, ...options});
    assert.equal(view.root.ProjectZeroRendererDirectorInstance.mode(), 'canvas');
    assert.equal(view.reference.snapshots.length, 0);
    assert.equal(view.audioClock.calls.start, 1);
    view.audioClock.tick(10500);
    assert.equal(view.canvas.lastSnapshot.elapsedMs, 10500);
    view.controller.destroy();
  }
});

test('reference resize failure keeps the reduced snapshot, audio and accessible state unchanged', async () => {
  const view = await fixture({}, {director: true, reducedMotion: true, fetch: async () => completePrivateTheme()});
  view.audioClock.tick(10500);
  const snapshot = view.reference.snapshots.at(-1);
  const calls = JSON.stringify(view.audioClock.calls);
  const liveWrites = view.elements['#boot-live-status'].textWrites;
  view.reference.failResize = true;
  view.root.innerWidth = 390;
  view.root.innerHeight = 844;
  view.rootListeners.get('resize')();
  assert.equal(view.root.ProjectZeroRendererDirectorInstance.mode(), 'canvas');
  assert.equal(view.canvas.lastSnapshot, snapshot);
  assert.equal(view.canvas.lastSnapshot.reducedMotion, true);
  assert.equal(JSON.stringify(view.audioClock.calls), calls);
  assert.equal(view.elements['#boot-live-status'].textWrites, liveWrites);
  view.controller.destroy();
  view.controller.destroy();
  assert.equal(view.reference.destroys, 1);
  assert.equal(view.rootListeners.has('resize'), false);
});


test('destroy during pending mark decode closes the private track and never creates a renderer or clock', async () => {
  const markDecode = deferred();
  let closeCalls = 0;
  const view = await fixture({}, {
    director: true, markDecode, awaitStart: false, fetch: async () => completePrivateTheme(),
    decodedTrack: {duration: 30, close: async () => { closeCalls += 1; }}
  });
  await flushMicrotasks(10);
  view.controller.destroy();
  const eventCount = view.events.length;
  markDecode.resolve();
  await view.startPromise;
  assert.equal(closeCalls, 1);
  assert.equal(view.audioClock, undefined);
  assert.equal(view.root.ProjectZeroRendererDirectorInstance, undefined);
  assert.equal(view.reference.snapshots.length, 0);
  assert.equal(view.events.length, eventCount);
});
