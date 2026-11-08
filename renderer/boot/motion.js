/*
 * Adapted from https://github.com/Iris-change/eva-codex-workbench
 * at commit b12753e063d6b8752b4e0994e851d5cc0950f85b, source: motion-v12.js.
 * MIT code scope: deterministic easing, loop, ping-pong, and scan-position
 * algorithm structure only. No upstream media, marks, voice, images, or fonts
 * were copied.
 */
(function exposeMotion(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroMotion = api;
})(typeof globalThis === 'object' ? globalThis : this, function createMotion() {
  'use strict';

  function clamp(value) {
    return Math.max(0, Math.min(1, value));
  }

  function sCurve(value) {
    const progress = clamp(value);
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  }

  function stage(time, start, end) {
    return sCurve((time - start) / (end - start));
  }

  function loopTime(time, period = 1, offset = 0) {
    const phase = time / period + offset;
    const lap = Math.floor(phase);
    return lap + sCurve(phase - lap);
  }

  function pingPong(time, legSeconds = 1, offset = 0) {
    const phase = ((time / legSeconds + offset) % 2 + 2) % 2;
    return sCurve(phase <= 1 ? phase : 2 - phase);
  }

  function breathe(time, period = 4, offset = 0) {
    return (1 - Math.cos(loopTime(time, period, offset) * Math.PI * 2)) / 2;
  }

  function curvePoint(progress, start, controlA, controlB, end) {
    const inverse = 1 - progress;
    return {
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * progress * controlA.x + 3 * inverse * progress ** 2 * controlB.x + progress ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * progress * controlA.y + 3 * inverse * progress ** 2 * controlB.y + progress ** 3 * end.y
    };
  }

  function scanPosition(time, height, legSeconds) {
    return -72 + pingPong(time, legSeconds) * (height + 144);
  }

  return Object.freeze({
    clamp,
    sCurve,
    stage,
    loopTime,
    pingPong,
    breathe,
    curvePoint,
    scanPosition,
    easeInOut: sCurve,
    loop: loopTime
  });
});
