/*
 * PROJECT ZERO boot timeline. This is original timeline code, exposed as UMD
 * so the same immutable model is available to the browser and CommonJS tests.
 */
(function exposeTimeline(root, factory) {
  const referenceTiming = typeof module === 'object' && module.exports
    ? require('./reference-timing.js').REFERENCE_TIMING
    : root?.ProjectZeroReferenceTiming?.REFERENCE_TIMING;
  const api = factory(referenceTiming);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroTimeline = api;
})(typeof globalThis === 'object' ? globalThis : this, function createTimeline(REFERENCE_TIMING) {
  'use strict';

  if (!REFERENCE_TIMING) throw new Error('REFERENCE_TIMING_UNAVAILABLE');

  const MAX_UNAUTHORIZED_PROGRESS = 99.2;
  const NODE_ICONS = Object.freeze([
    'core', 'core', 'link', 'link', 'data', 'data',
    'shield', 'shield', 'render', 'render', 'pilot', 'pilot'
  ]);
  const BOOT_TIMELINE = Object.freeze([
    Object.freeze({stage: 'wake', startMs: 0, endMs: REFERENCE_TIMING.lclStartMs, from: 0, to: 0}),
    Object.freeze({stage: 'scan', startMs: REFERENCE_TIMING.lclStartMs, endMs: REFERENCE_TIMING.syncStartMs, from: 0, to: 0}),
    Object.freeze({stage: 'synchronize', startMs: REFERENCE_TIMING.syncStartMs, endMs: REFERENCE_TIMING.holdMs, from: 0, to: MAX_UNAUTHORIZED_PROGRESS}),
    Object.freeze({stage: 'authorize', startMs: REFERENCE_TIMING.holdMs, endMs: REFERENCE_TIMING.holdMs, from: MAX_UNAUTHORIZED_PROGRESS, to: MAX_UNAUTHORIZED_PROGRESS}),
    Object.freeze({stage: 'connect', startMs: REFERENCE_TIMING.holdMs, endMs: REFERENCE_TIMING.durationMs, from: MAX_UNAUTHORIZED_PROGRESS, to: 100})
  ]);

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validateTimeline(timeline) {
    if (!Array.isArray(timeline) || timeline.length === 0) return false;

    const stages = new Set();
    let previousEnd = 0;
    let reachedConnect = false;

    for (const cue of timeline) {
      if (!cue || typeof cue.stage !== 'string' || cue.stage.length === 0 || stages.has(cue.stage)) return false;
      if (![cue.startMs, cue.endMs, cue.from, cue.to].every(isFiniteNumber)) return false;
      if (cue.startMs < 0 || cue.endMs < cue.startMs || cue.startMs < previousEnd) return false;
      if (!reachedConnect && cue.stage !== 'connect'
        && (cue.from > MAX_UNAUTHORIZED_PROGRESS || cue.to > MAX_UNAUTHORIZED_PROGRESS)) return false;

      stages.add(cue.stage);
      previousEnd = cue.endMs;
      if (cue.stage === 'connect') reachedConnect = true;
    }

    return true;
  }

  function normalizeOptions(options) {
    const source = options !== null && typeof options === 'object' ? options : {};
    return {
      authorized: source.authorized === true,
      reducedMotion: source.reducedMotion === true
    };
  }

  function sampleTimeline(elapsedMs, options) {
    const {authorized, reducedMotion} = normalizeOptions(options);
    const safeMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
    const logicalMs = authorized
      ? Math.min(safeMs, REFERENCE_TIMING.durationMs)
      : Math.min(safeMs, REFERENCE_TIMING.holdMs);
    const stage = !authorized && logicalMs >= REFERENCE_TIMING.holdMs ? 'authorize'
      : logicalMs < REFERENCE_TIMING.lclStartMs ? 'wake'
        : logicalMs < REFERENCE_TIMING.syncStartMs ? 'scan'
          : logicalMs < REFERENCE_TIMING.holdMs ? 'synchronize' : 'connect';
    const sync = Math.max(0, Math.min(1,
      (logicalMs - REFERENCE_TIMING.syncStartMs)
      / (REFERENCE_TIMING.holdMs - REFERENCE_TIMING.syncStartMs)
    ));
    const connect = authorized ? Math.max(0, Math.min(1,
      (logicalMs - REFERENCE_TIMING.holdMs)
      / (REFERENCE_TIMING.syncFullMs - REFERENCE_TIMING.holdMs)
    )) : 0;
    const animatedProgress = authorized && stage === 'connect'
      ? MAX_UNAUTHORIZED_PROGRESS + (100 - MAX_UNAUTHORIZED_PROGRESS) * connect
      : MAX_UNAUTHORIZED_PROGRESS * sync;
    const progress = reducedMotion && (stage === 'synchronize' || stage === 'authorize')
      ? MAX_UNAUTHORIZED_PROGRESS
      : reducedMotion && stage === 'connect' && logicalMs < REFERENCE_TIMING.durationMs
        ? MAX_UNAUTHORIZED_PROGRESS
        : animatedProgress;
    const scanPhase = stage === 'scan'
      ? (logicalMs - REFERENCE_TIMING.lclStartMs)
        / (REFERENCE_TIMING.syncStartMs - REFERENCE_TIMING.lclStartMs)
      : 0;
    const activeNodes = Math.min(12, Math.floor((progress / MAX_UNAUTHORIZED_PROGRESS) * 12));
    const iconStates = Object.freeze(NODE_ICONS.map((icon, index) =>
      `${icon}:${index < activeNodes ? 'active' : 'idle'}`
    ));

    return Object.freeze({
      elapsedMs: logicalMs,
      stage,
      progress: Math.min(authorized ? 100 : MAX_UNAUTHORIZED_PROGRESS, progress),
      scan: reducedMotion ? (scanPhase > 0 ? 1 : 0) : Math.sin(Math.PI * scanPhase),
      activeNodes,
      iconStates,
      headingKey: `boot.${stage}.heading`,
      captionKey: `boot.${stage}.caption`,
      reducedMotion: Boolean(reducedMotion)
    });
  }

  return Object.freeze({BOOT_TIMELINE, REFERENCE_TIMING, sampleTimeline, validateTimeline});
});
