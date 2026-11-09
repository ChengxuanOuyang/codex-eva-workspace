'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {WindowDirector} = require('../app/window-director.cjs');

function timerFixture() {
  const pending = new Map();
  const delays = [];
  let nextId = 1;
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      pending.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    fire() {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
    get delays() { return [...delays]; },
    get size() { return pending.size; }
  };
}

function windowFixture(overrides = {}) {
  const calls = [];
  const window = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.setFullScreen = enabled => calls.push(`setFullScreen:${enabled}`);
  window.show = () => calls.push('show');
  window.setBounds = bounds => calls.push(`setBounds:${bounds.width}x${bounds.height}`);
  window.center = () => calls.push('center');
  Object.assign(window, overrides);
  return {window, calls};
}

function createDirector(window, timers = timerFixture(), options = {}) {
  return {
    director: new WindowDirector(window, {
      timeoutMs: 1500,
      setTimeout: timers.setTimeout.bind(timers),
      clearTimeout: timers.clearTimeout.bind(timers),
      ...options
    }),
    timers
  };
}

test('boot enters fullscreen before the hidden window is shown and shares repeated work', async () => {
  const {window, calls} = windowFixture();
  const {director} = createDirector(window);

  const first = director.showBoot();
  const concurrent = director.showBoot();

  assert.equal(first, concurrent);
  assert.deepEqual(await first, {mode: 'fullscreen'});
  assert.deepEqual(await director.showBoot(), {mode: 'fullscreen'});
  assert.deepEqual(calls, ['setFullScreen:true', 'show']);
});

test('boot still shows a usable window when fullscreen entry throws', async () => {
  const {window, calls} = windowFixture({
    setFullScreen(enabled) {
      calls.push(`setFullScreen:${enabled}`);
      throw Error('native fullscreen failed');
    }
  });
  const {director} = createDirector(window);

  assert.deepEqual(await director.showBoot(), {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:true', 'show']);
});

test('completion shares one promise, waits for leave-full-screen, and restores safe bounds', async () => {
  const {window, calls} = windowFixture();
  const {director, timers} = createDirector(window);

  const operation = director.revealWorkbench();
  const concurrent = director.revealWorkbench();

  assert.equal(operation, concurrent);
  assert.deepEqual(calls, ['setFullScreen:false']);
  assert.equal(window.listenerCount('leave-full-screen'), 1);
  assert.deepEqual(timers.delays, [1500]);

  window.emit('leave-full-screen');

  assert.deepEqual(await operation, {mode: 'windowed'});
  assert.deepEqual(await director.revealWorkbench(), {mode: 'windowed'});
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
  assert.equal(timers.size, 0);
});

test('completion timeout restores bounds once and ignores a later fullscreen event', async () => {
  const {window, calls} = windowFixture();
  const {director, timers} = createDirector(window);

  const operation = director.revealWorkbench();
  timers.fire();

  assert.deepEqual(await operation, {mode: 'windowed'});
  window.emit('leave-full-screen');
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
});

test('reveal before show keeps the window normal and showBoot only makes it visible', async () => {
  const {window, calls} = windowFixture();
  const {director} = createDirector(window);

  const reveal = director.revealWorkbench();
  window.emit('leave-full-screen');
  assert.deepEqual(await reveal, {mode: 'windowed'});
  assert.deepEqual(await director.showBoot(), {mode: 'windowed'});

  assert.deepEqual(calls, [
    'setFullScreen:false',
    'setBounds:1500x950',
    'center',
    'show'
  ]);
});

test('destroy is idempotent, clears pending work, and settles completion without rejection', async () => {
  const {window, calls} = windowFixture();
  const {director, timers} = createDirector(window);

  const operation = director.revealWorkbench();
  assert.equal(timers.size, 1);
  assert.equal(window.listenerCount('leave-full-screen'), 1);

  director.destroy();
  director.destroy();

  assert.deepEqual(await operation, {mode: 'fallback'});
  assert.equal(timers.size, 0);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
  timers.fire();
  window.emit('leave-full-screen');
  assert.deepEqual(await director.showBoot(), {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:false']);
});

test('destroy tolerates cleanup methods throwing and still settles pending completion', async () => {
  const timers = timerFixture();
  const {window} = windowFixture({
    removeListener() {
      throw Error('listener cleanup failed');
    }
  });
  const director = new WindowDirector(window, {
    setTimeout: timers.setTimeout.bind(timers),
    clearTimeout() {
      throw Error('timer cleanup failed');
    }
  });

  const operation = director.revealWorkbench();
  assert.doesNotThrow(() => director.destroy());
  assert.doesNotThrow(() => director.destroy());
  assert.deepEqual(await operation, {mode: 'fallback'});
});

test('fullscreen exit failure restores every remaining operation and returns fallback', async () => {
  const {window, calls} = windowFixture({
    setFullScreen(enabled) {
      calls.push(`setFullScreen:${enabled}`);
      if (!enabled) throw Error('exit failed');
    },
    setBounds(bounds) {
      calls.push(`setBounds:${bounds.width}x${bounds.height}`);
      throw Error('bounds failed');
    }
  });
  const {director, timers} = createDirector(window);

  assert.deepEqual(await director.revealWorkbench(), {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
  assert.equal(timers.size, 0);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
});

test('a window destroyed during the wait skips restoration and resolves fallback', async () => {
  const {window, calls} = windowFixture();
  const {director, timers} = createDirector(window);

  const operation = director.revealWorkbench();
  window.destroyed = true;
  timers.fire();

  assert.deepEqual(await operation, {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:false']);
  assert.equal(window.listenerCount('leave-full-screen'), 0);
});

test('a synchronous leave event cannot hide a later fullscreen method failure', async () => {
  const {window, calls} = windowFixture();
  window.setFullScreen = enabled => {
    calls.push(`setFullScreen:${enabled}`);
    window.emit('leave-full-screen');
    throw Error('native exit failed after event');
  };
  const {director} = createDirector(window);

  assert.deepEqual(await director.revealWorkbench(), {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
});

test('show failure returns fallback without retrying fullscreen side effects', async () => {
  const {window, calls} = windowFixture({
    show() {
      calls.push('show');
      throw Error('show failed');
    }
  });
  const {director} = createDirector(window);

  assert.deepEqual(await director.showBoot(), {mode: 'fallback'});
  assert.deepEqual(await director.showBoot(), {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:true', 'show']);
});

test('center failure returns fallback after preserving the restored bounds', async () => {
  const {window, calls} = windowFixture({
    center() {
      calls.push('center');
      throw Error('center failed');
    }
  });
  const {director} = createDirector(window);

  const operation = director.revealWorkbench();
  window.emit('leave-full-screen');

  assert.deepEqual(await operation, {mode: 'fallback'});
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
});

test('event and timer API failures fall back immediately while preserving the window', async () => {
  for (const failure of ['event', 'timer']) {
    const timers = timerFixture();
    const {window, calls} = windowFixture();
    if (failure === 'event') {
      window.once = () => { throw Error('event API failed'); };
    }
    const director = new WindowDirector(window, {
      setTimeout: failure === 'timer'
        ? () => { throw Error('timer API failed'); }
        : timers.setTimeout.bind(timers),
      clearTimeout: timers.clearTimeout.bind(timers)
    });

    assert.deepEqual(await director.revealWorkbench(), {mode: 'fallback'}, failure);
    assert.deepEqual(
      calls,
      ['setFullScreen:false', 'setBounds:1500x950', 'center'],
      failure
    );
  }
});

test('destroyed and exceptional destruction checks return stable fallback results', async () => {
  const destroyed = windowFixture();
  destroyed.window.destroyed = true;
  const destroyedDirector = createDirector(destroyed.window).director;

  assert.deepEqual(await destroyedDirector.showBoot(), {mode: 'fallback'});
  assert.deepEqual(await destroyedDirector.revealWorkbench(), {mode: 'fallback'});
  assert.deepEqual(destroyed.calls, []);

  const exceptional = windowFixture({
    isDestroyed() { throw Error('native state unavailable'); }
  });
  const exceptionalDirector = createDirector(exceptional.window).director;
  assert.deepEqual(await exceptionalDirector.showBoot(), {mode: 'fallback'});
  assert.deepEqual(exceptional.calls, ['setFullScreen:true', 'show']);
});

test('custom safe bounds are copied and cannot be mutated during the wait', async () => {
  const bounds = {width: 1280, height: 800};
  const {window, calls} = windowFixture();
  const {director} = createDirector(window, timerFixture(), {normalBounds: bounds});

  const operation = director.revealWorkbench();
  bounds.width = 1;
  bounds.height = 1;
  window.emit('leave-full-screen');

  assert.deepEqual(await operation, {mode: 'windowed'});
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1280x800', 'center']);
});
