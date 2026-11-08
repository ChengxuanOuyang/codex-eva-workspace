/*
 * PROJECT ZERO boot timeline. This is original timeline code, exposed as UMD
 * so the same immutable model is available to the browser and CommonJS tests.
 */
(function exposeTimeline(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroTimeline = api;
})(typeof globalThis === 'object' ? globalThis : this, function createTimeline() {
  'use strict';

  const MAX_UNAUTHORIZED_PROGRESS = 99.2;
  const BOOT_TIMELINE = Object.freeze([
    Object.freeze({stage: 'wake', startMs: 0, endMs: 3500, from: 0, to: 0}),
    Object.freeze({stage: 'scan', startMs: 3500, endMs: 8500, from: 0, to: 0}),
    Object.freeze({stage: 'synchronize', startMs: 8500, endMs: 15500, from: 0, to: MAX_UNAUTHORIZED_PROGRESS}),
    Object.freeze({stage: 'authorize', startMs: 15500, endMs: 15500, from: MAX_UNAUTHORIZED_PROGRESS, to: MAX_UNAUTHORIZED_PROGRESS}),
    Object.freeze({stage: 'connect', startMs: 15500, endMs: 20500, from: MAX_UNAUTHORIZED_PROGRESS, to: 100})
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

  function sampleTimeline(elapsedMs, {authorized = false, reducedMotion = false} = {}) {
    const safeMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
    const logicalMs = authorized ? Math.min(safeMs, 20500) : Math.min(safeMs, 15500);
    const stage = !authorized && logicalMs >= 15500 ? 'authorize'
      : logicalMs < 3500 ? 'wake'
        : logicalMs < 8500 ? 'scan'
          : logicalMs < 15500 ? 'synchronize' : 'connect';
    const sync = Math.max(0, Math.min(1, (logicalMs - 8500) / 7000));
    const connect = authorized ? Math.max(0, Math.min(1, (logicalMs - 15500) / 5000)) : 0;
    const progress = authorized && stage === 'connect'
      ? MAX_UNAUTHORIZED_PROGRESS + (100 - MAX_UNAUTHORIZED_PROGRESS) * connect
      : MAX_UNAUTHORIZED_PROGRESS * sync;
    const scanPhase = stage === 'scan' ? (logicalMs - 3500) / 5000 : 0;

    return Object.freeze({
      elapsedMs: logicalMs,
      stage,
      progress: Math.min(authorized ? 100 : MAX_UNAUTHORIZED_PROGRESS, progress),
      scan: reducedMotion ? (scanPhase > 0 ? 1 : 0) : Math.sin(Math.PI * scanPhase),
      activeNodes: Math.min(12, Math.floor((progress / MAX_UNAUTHORIZED_PROGRESS) * 12)),
      headingKey: `boot.${stage}.heading`,
      captionKey: `boot.${stage}.caption`,
      reducedMotion: Boolean(reducedMotion)
    });
  }

  return Object.freeze({BOOT_TIMELINE, sampleTimeline, validateTimeline});
});
