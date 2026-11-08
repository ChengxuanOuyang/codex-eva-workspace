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

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function easeInOut(value) {
    const progress = clamp(Number.isFinite(value) ? value : 0, 0, 1);
    return progress * progress * (3 - 2 * progress);
  }

  function loop(value, period) {
    if (!Number.isFinite(value) || !Number.isFinite(period) || period <= 0) return 0;
    return ((value % period) + period) % period;
  }

  function pingPong(value, distance) {
    if (!Number.isFinite(distance) || distance <= 0) return 0;
    const phase = loop(value, distance * 2);
    return distance - Math.abs(phase - distance);
  }

  function scanPosition(seconds, span, speed) {
    if (!Number.isFinite(seconds) || !Number.isFinite(span) || !Number.isFinite(speed)) return 0;
    return pingPong(seconds * speed, Math.max(0, span));
  }

  return Object.freeze({clamp, easeInOut, loop, pingPong, scanPosition});
});
