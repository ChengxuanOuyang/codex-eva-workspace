'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createAudioClock} = require('../renderer/boot/audio-clock.js');
const {loadSequenceAudio} = require('../renderer/boot/sequence-audio.js');

function fakeRaf() {
  let callback;
  let nextId = 0;
  const cancelled = [];
  return {
    requestAnimationFrame(next) {
      callback = next;
      nextId += 1;
      return nextId;
    },
    cancelAnimationFrame(id) {
      cancelled.push(id);
      callback = undefined;
    },
    fire() {
      const active = callback;
      callback = undefined;
      active?.();
    },
    pending: () => callback !== undefined,
    cancelled
  };
}

function fakeTimers() {
  const pending = new Map();
  let nextId = 0;
  return {
    setTimeout(callback, delay) {
      nextId += 1;
      pending.set(nextId, {callback, delay});
      return nextId;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    fireNext() {
      const entry = pending.entries().next().value;
      if (!entry) return false;
      const [id, {callback}] = entry;
      pending.delete(id);
      callback();
      return true;
    },
    size: () => pending.size,
    delays: () => [...pending.values()].map(({delay}) => delay)
  };
}

function fakeAudio({currentTime = 0, playError, volume = 1} = {}) {
  return {
    currentTime,
    volume,
    playCalls: 0,
    pauseCalls: 0,
    closeCalls: 0,
    async play() {
      this.playCalls += 1;
      if (playError) throw playError;
    },
    pause() {
      this.pauseCalls += 1;
    },
    async close() {
      this.closeCalls += 1;
    }
  };
}

test('sequence audio identifies the exact MIT code source and excludes upstream media', () => {
  const source = fs.readFileSync('renderer/boot/sequence-audio.js', 'utf8');

  assert.match(source, /https:\/\/github\.com\/Iris-change\/eva-codex-workbench/);
  assert.match(source, /b12753e063d6b8752b4e0994e851d5cc0950f85b/);
  assert.match(source, /source: sequence-audio\.js/);
  assert.match(source, /MIT code scope/);
  assert.match(source, /No upstream voice\/audio or other media was copied/);
});

test('audio modules expose browser UMD APIs without CommonJS globals', () => {
  for (const [fileName, globalName] of [
    ['renderer/boot/sequence-audio.js', 'ProjectZeroSequenceAudio'],
    ['renderer/boot/audio-clock.js', 'ProjectZeroAudioClock']
  ]) {
    const context = vm.createContext({globalThis: {}});
    vm.runInContext(fs.readFileSync(fileName, 'utf8'), context, {filename: fileName});
    assert.equal(typeof context.globalThis[globalName], 'object');
  }
});

test('audio currentTime is the authoritative presentation clock', async () => {
  const audio = fakeAudio({currentTime: 2});
  const raf = fakeRaf();
  const ticks = [];
  const clock = createAudioClock({
    audio,
    startSeconds: 2,
    endSeconds: 22.5,
    onTick: milliseconds => ticks.push(milliseconds),
    requestAnimationFrame: callback => raf.requestAnimationFrame(callback),
    cancelAnimationFrame: id => raf.cancelAnimationFrame(id)
  });

  await clock.start();
  audio.currentTime = 3.25;
  raf.fire();

  assert.equal(ticks.at(-1), 1250);
  assert.equal(clock.mode(), 'media');
});

test('the raf compatibility injection still uses media currentTime', async () => {
  const audio = fakeAudio({currentTime: 2});
  const raf = fakeRaf();
  const ticks = [];
  const clock = createAudioClock({audio, startSeconds: 2, onTick: value => ticks.push(value), raf});

  await clock.start();
  audio.currentTime = 2.4;
  raf.fire();

  assert.ok(Math.abs(ticks.at(-1) - 400) < 1e-9);
});

test('a callable raf compatibility injection uses its cancel method', async () => {
  let callback;
  const cancelled = [];
  const raf = next => {
    callback = next;
    return 17;
  };
  raf.cancel = id => {
    cancelled.push(id);
    callback = undefined;
  };
  const clock = createAudioClock({audio: fakeAudio(), onTick() {}, raf});

  await clock.start();
  await clock.destroy();

  assert.deepEqual(cancelled, [17]);
  assert.equal(callback, undefined);
});

test('a rejected play switches once to the monotonic clock', async () => {
  let currentNow = 4100;
  const modes = [];
  const audio = fakeAudio({playError: Error('blocked')});
  const raf = fakeRaf();
  const clock = createAudioClock({
    audio,
    now: () => currentNow,
    onTick() {},
    onMode: mode => modes.push(mode),
    raf
  });

  await clock.start();
  assert.equal(clock.mode(), 'silent');
  await clock.pause();
  currentNow = 9000;
  await clock.resume();

  assert.deepEqual(modes, ['silent']);
});

test('pause at 15500 ms and resume exclude the authorization wait', async () => {
  let currentNow = 0;
  const ticks = [];
  const raf = fakeRaf();
  const clock = createAudioClock({
    audio: fakeAudio({playError: Error('blocked')}),
    now: () => currentNow,
    onTick: value => ticks.push(value),
    raf
  });

  await clock.start();
  currentNow = 15500;
  raf.fire();
  await clock.pause();
  currentNow = 45500;
  await clock.resume();
  currentNow = 46500;
  raf.fire();

  assert.equal(ticks.at(-2), 15500);
  assert.equal(ticks.at(-1), 16500);
});

test('seek synchronizes media and monotonic positions', async () => {
  let currentNow = 1000;
  const media = fakeAudio();
  const mediaRaf = fakeRaf();
  const mediaTicks = [];
  const mediaClock = createAudioClock({
    audio: media,
    startSeconds: 2,
    onTick: value => mediaTicks.push(value),
    raf: mediaRaf
  });
  await mediaClock.start();
  mediaClock.seek(15500);
  mediaRaf.fire();

  const silentRaf = fakeRaf();
  const silentTicks = [];
  const silentClock = createAudioClock({
    audio: fakeAudio({playError: Error('blocked')}),
    now: () => currentNow,
    onTick: value => silentTicks.push(value),
    raf: silentRaf
  });
  await silentClock.start();
  silentClock.seek(15500);
  currentNow = 1250;
  silentRaf.fire();

  assert.equal(media.currentTime, 17.5);
  assert.equal(mediaTicks.at(-1), 15500);
  assert.equal(silentTicks.at(-1), 15750);
});

test('fadeOut lowers volume every 25 ms, pauses, and restores the initial gain', async () => {
  const audio = fakeAudio({volume: 0.6});
  const raf = fakeRaf();
  const timers = fakeTimers();
  const clock = createAudioClock({
    audio,
    onTick() {},
    raf,
    setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeout: id => timers.clearTimeout(id)
  });
  await clock.start();

  const fading = clock.fadeOut(150);
  const volumes = [];
  while (timers.fireNext()) volumes.push(audio.volume);
  await fading;

  assert.deepEqual(volumes.slice(0, -1).map(value => Number(value.toFixed(1))), [0.5, 0.4, 0.3, 0.2, 0.1]);
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.volume, 0.6);
});

test('destroy is idempotent and leaves no RAF, timer, tick, or open track', async () => {
  const audio = fakeAudio({volume: 0.8});
  const raf = fakeRaf();
  const timers = fakeTimers();
  const ticks = [];
  const clock = createAudioClock({
    audio,
    onTick: value => ticks.push(value),
    raf,
    setTimeout: (callback, delay) => timers.setTimeout(callback, delay),
    clearTimeout: id => timers.clearTimeout(id)
  });
  await clock.start();
  void clock.fadeOut(150);

  await clock.destroy();
  await clock.destroy();
  raf.fire();
  while (timers.fireNext()) {}

  assert.equal(audio.closeCalls, 1);
  assert.equal(raf.pending(), false);
  assert.equal(timers.size(), 0);
  assert.deepEqual(ticks, []);
});

test('the sequence decoder fetches and decodes one complete local track', async () => {
  let fetchCalls = 0;
  let decodeCalls = 0;
  let contextClosed = false;
  let context;
  const starts = [];
  const stops = [];
  const responseBytes = new ArrayBuffer(8);
  const fetch = async url => {
    fetchCalls += 1;
    assert.equal(url, '/private/startup-reference.m4a');
    return {ok: true, arrayBuffer: async () => responseBytes};
  };

  class AudioContext {
    constructor() {
      context = this;
      this.currentTime = 10;
      this.state = 'running';
      this.destination = {};
    }

    async decodeAudioData(bytes) {
      decodeCalls += 1;
      assert.equal(bytes, responseBytes);
      return {duration: 30};
    }

    createGain() {
      return {gain: {value: 1}, connect() {}};
    }

    createBufferSource() {
      return {
        connect() {},
        start(when, offset) { starts.push([when, offset]); },
        stop() { stops.push(true); },
        onended: null
      };
    }

    async close() {
      contextClosed = true;
    }
  }

  const track = await loadSequenceAudio('/private/startup-reference.m4a', {fetch, AudioContext});
  track.currentTime = 2;
  await track.play();
  context.currentTime = 11.25;
  assert.equal(track.currentTime, 3.25);
  track.pause();
  track.currentTime = 7;
  await track.play();
  await track.close();

  assert.equal(fetchCalls, 1);
  assert.equal(decodeCalls, 1);
  assert.deepEqual(starts, [[0, 2], [0, 7]]);
  assert.equal(stops.length, 2);
  assert.equal(contextClosed, true);
});

test('a decode failure closes its AudioContext', async () => {
  let contextClosed = false;

  class AudioContext {
    async decodeAudioData() {
      throw new Error('unsupported');
    }

    async close() {
      contextClosed = true;
    }
  }

  await assert.rejects(
    loadSequenceAudio('/private/startup-reference.m4a', {
      fetch: async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(1)}),
      AudioContext
    }),
    /unsupported/
  );
  assert.equal(contextClosed, true);
});
