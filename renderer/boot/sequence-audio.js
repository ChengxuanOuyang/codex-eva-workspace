/*
 * Adapted from https://github.com/Iris-change/eva-codex-workbench
 * at commit b12753e063d6b8752b4e0994e851d5cc0950f85b, source: sequence-audio.js.
 * MIT code scope: complete-file fetch/decode and restartable Web Audio buffer
 * playback structure only. No upstream voice/audio or other media was copied.
 */
(function exposeSequenceAudio(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroSequenceAudio = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSequenceAudio() {
  'use strict';

  function clamp(value, maximum) {
    const finite = Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(maximum, finite));
  }

  async function loadSequenceAudio(url, {fetch, AudioContext}) {
    if (typeof fetch !== 'function') throw new TypeError('fetch must be provided');
    if (typeof AudioContext !== 'function') throw new TypeError('AudioContext must be provided');

    const response = await fetch(url);
    if (!response || response.ok !== true || typeof response.arrayBuffer !== 'function') {
      throw new Error(`Unable to load sequence audio: ${url}`);
    }
    const encodedAudio = await response.arrayBuffer();
    const context = new AudioContext();
    let buffer;
    try {
      buffer = await context.decodeAudioData(encodedAudio);
    } catch (error) {
      await context.close();
      throw error;
    }

    const gainNode = context.createGain();
    gainNode.connect(context.destination);
    let source;
    let startedAt = 0;
    let position = 0;
    let playing = false;
    let closed = false;
    let generation = 0;
    let playPromise;
    let closePromise;

    function stopSource() {
      if (!source) return;
      const active = source;
      source = undefined;
      active.onended = null;
      try { active.stop(); } catch {}
    }

    function beginSource() {
      const nextSource = context.createBufferSource();
      nextSource.buffer = buffer;
      nextSource.connect(gainNode);
      nextSource.onended = () => {
        if (source !== nextSource) return;
        source = undefined;
        playing = false;
        position = buffer.duration;
      };
      source = nextSource;
      startedAt = context.currentTime - position;
      nextSource.start(0, position);
      playing = true;
    }

    function currentTime() {
      if (!playing) return position;
      return clamp(context.currentTime - startedAt, buffer.duration);
    }

    function seek(seconds) {
      if (closed) return;
      const wasPlaying = playing;
      if (wasPlaying) {
        playing = false;
        stopSource();
      }
      position = clamp(seconds, buffer.duration);
      if (wasPlaying && position < buffer.duration) beginSource();
    }

    function play() {
      if (closed) return Promise.reject(new Error('Sequence audio is closed'));
      if (playing) return Promise.resolve();
      if (playPromise) return playPromise;

      const playGeneration = generation;
      const pending = (async () => {
        if (position >= buffer.duration) position = 0;
        if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
        if (closed || generation !== playGeneration || playing) return;
        beginSource();
      })();
      playPromise = pending;
      const clearPending = () => {
        if (playPromise === pending) playPromise = undefined;
      };
      void pending.then(clearPending, clearPending);
      return pending;
    }

    function pause() {
      if (closed) return;
      generation += 1;
      if (!playing) return;
      position = currentTime();
      playing = false;
      stopSource();
    }

    function close() {
      if (closePromise) return closePromise;
      generation += 1;
      if (playing) {
        position = currentTime();
        playing = false;
        stopSource();
      }
      closed = true;
      closePromise = Promise.resolve().then(() => context.close());
      return closePromise;
    }

    const track = {play, pause, seek, close};
    Object.defineProperties(track, {
      currentTime: {
        enumerable: true,
        get: currentTime,
        set: seek
      },
      duration: {
        enumerable: true,
        value: buffer.duration
      },
      volume: {
        enumerable: true,
        get: () => gainNode.gain.value,
        set: value => {
          gainNode.gain.value = clamp(value, 1);
        }
      }
    });
    return track;
  }

  return Object.freeze({loadSequenceAudio});
});
