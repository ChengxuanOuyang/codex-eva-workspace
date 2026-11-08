/*
 * PROJECT ZERO presentation clock. Audio playback is authoritative when it is
 * available; an injected monotonic clock is used after playback is rejected.
 */
(function exposeAudioClock(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroAudioClock = api;
})(typeof globalThis === 'object' ? globalThis : this, function createAudioClockModule() {
  'use strict';

  function injectedFunction(primary, compatibility, names) {
    if (typeof primary === 'function') return primary;
    if (!compatibility || !['function', 'object'].includes(typeof compatibility)) return undefined;
    for (const name of names) {
      if (typeof compatibility[name] === 'function') return compatibility[name].bind(compatibility);
    }
    return typeof compatibility === 'function' ? compatibility : undefined;
  }

  function createAudioClock(options = {}) {
    const {
      audio,
      startSeconds = 0,
      endSeconds = Number.POSITIVE_INFINITY,
      now = () => 0,
      onTick = () => {},
      onEnd = () => {},
      onMode = () => {},
      raf,
      setTimeout: scheduleTimeout,
      clearTimeout: cancelTimeout
    } = options;
    if (!audio || typeof audio.play !== 'function' || typeof audio.pause !== 'function') {
      throw new TypeError('audio must provide play() and pause()');
    }

    const requestFrame = injectedFunction(options.requestAnimationFrame, raf, ['requestAnimationFrame', 'request']);
    const cancelFrame = injectedFunction(options.cancelAnimationFrame, null, [])
      || injectedFunction(undefined, raf, ['cancelAnimationFrame', 'cancel']);
    const safeStart = Number.isFinite(startSeconds) ? startSeconds : 0;
    const maximumElapsed = Number.isFinite(endSeconds)
      ? Math.max(0, (endSeconds - safeStart) * 1000)
      : Number.POSITIVE_INFINITY;
    let activeMode = 'media';
    let frameId;
    let started = false;
    let paused = true;
    let destroyed = false;
    let ended = false;
    let silentNotified = false;
    let frozenElapsed = 0;
    let silentStartedAt = 0;
    let fadeTimer;
    let fadeResolve;
    let fadeInitialVolume;
    let destroyPromise;

    function bounded(milliseconds) {
      const finite = Number.isFinite(milliseconds) ? milliseconds : 0;
      return Math.max(0, Math.min(maximumElapsed, finite));
    }

    function elapsed() {
      if (paused) return frozenElapsed;
      if (activeMode === 'silent') return bounded(now() - silentStartedAt);
      return bounded((audio.currentTime - safeStart) * 1000);
    }

    function cancelScheduledFrame() {
      if (frameId === undefined) return;
      if (cancelFrame) cancelFrame(frameId);
      frameId = undefined;
    }

    function scheduleFrame() {
      if (destroyed || paused || ended || frameId !== undefined || !requestFrame) return;
      frameId = requestFrame(tick);
    }

    function tick() {
      frameId = undefined;
      if (destroyed || paused || ended) return;
      const current = elapsed();
      onTick(current);
      if (current >= maximumElapsed) {
        ended = true;
        pause();
        onEnd();
        return;
      }
      scheduleFrame();
    }

    function switchToSilent(atElapsed) {
      activeMode = 'silent';
      frozenElapsed = bounded(atElapsed);
      silentStartedAt = now() - frozenElapsed;
      if (!silentNotified) {
        silentNotified = true;
        onMode('silent');
      }
    }

    async function start() {
      if (destroyed) return;
      if (started) return resume();
      started = true;
      ended = false;
      frozenElapsed = 0;
      audio.currentTime = safeStart;
      try {
        await audio.play();
        if (destroyed) return;
        activeMode = 'media';
      } catch {
        if (destroyed) return;
        switchToSilent(0);
      }
      paused = false;
      scheduleFrame();
    }

    function pause() {
      if (destroyed || paused) return;
      frozenElapsed = elapsed();
      paused = true;
      cancelScheduledFrame();
      audio.pause();
    }

    async function resume() {
      if (destroyed || !started || !paused) return;
      ended = false;
      if (activeMode === 'media') {
        audio.currentTime = safeStart + frozenElapsed / 1000;
        try {
          await audio.play();
          if (destroyed) return;
        } catch {
          if (destroyed) return;
          switchToSilent(frozenElapsed);
        }
      } else {
        silentStartedAt = now() - frozenElapsed;
      }
      paused = false;
      scheduleFrame();
    }

    function seek(milliseconds) {
      if (destroyed) return;
      frozenElapsed = bounded(milliseconds);
      audio.currentTime = safeStart + frozenElapsed / 1000;
      if (activeMode === 'silent' && !paused) silentStartedAt = now() - frozenElapsed;
      if (frozenElapsed < maximumElapsed) ended = false;
    }

    function finishFade() {
      fadeTimer = undefined;
      pause();
      if (fadeInitialVolume !== undefined) audio.volume = fadeInitialVolume;
      fadeInitialVolume = undefined;
      const resolve = fadeResolve;
      fadeResolve = undefined;
      resolve?.();
    }

    function cancelFade() {
      if (fadeTimer !== undefined && typeof cancelTimeout === 'function') cancelTimeout(fadeTimer);
      fadeTimer = undefined;
      if (fadeInitialVolume !== undefined) audio.volume = fadeInitialVolume;
      fadeInitialVolume = undefined;
      const resolve = fadeResolve;
      fadeResolve = undefined;
      resolve?.();
    }

    function fadeOut(duration = 150) {
      if (destroyed) return Promise.resolve();
      cancelFade();
      const milliseconds = Math.max(0, Number.isFinite(duration) ? duration : 0);
      fadeInitialVolume = Number.isFinite(audio.volume) ? audio.volume : 1;
      if (milliseconds === 0 || typeof scheduleTimeout !== 'function') {
        audio.volume = 0;
        finishFade();
        return Promise.resolve();
      }

      const steps = Math.max(1, Math.ceil(milliseconds / 25));
      let step = 0;
      return new Promise(resolve => {
        fadeResolve = resolve;
        const lowerVolume = () => {
          if (destroyed) return;
          step += 1;
          audio.volume = fadeInitialVolume * Math.max(0, 1 - step / steps);
          if (step >= steps) {
            finishFade();
            return;
          }
          fadeTimer = scheduleTimeout(lowerVolume, 25);
        };
        fadeTimer = scheduleTimeout(lowerVolume, 25);
      });
    }

    function destroy() {
      if (destroyPromise) return destroyPromise;
      destroyed = true;
      cancelScheduledFrame();
      cancelFade();
      destroyPromise = Promise.resolve(typeof audio.close === 'function' ? audio.close() : undefined);
      return destroyPromise;
    }

    return Object.freeze({start, pause, resume, seek, fadeOut, destroy, mode: () => activeMode});
  }

  return Object.freeze({createAudioClock});
});
