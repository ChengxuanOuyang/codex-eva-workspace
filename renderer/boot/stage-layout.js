/*
 * Adapted from https://github.com/Iris-change/eva-codex-workbench
 * at commit b12753e063d6b8752b4e0994e851d5cc0950f85b, source: stage-layout.js.
 * MIT code scope: responsive central-anchor and ring-geometry algorithm
 * structure only. No upstream media, marks, voice, images, or fonts were
 * copied.
 */
(function exposeStageLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroStageLayout = api;
})(typeof globalThis === 'object' ? globalThis : this, function createStageLayout() {
  'use strict';

  function positiveFinite(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function stageLayout(width, height) {
    const safeWidth = positiveFinite(width);
    const safeHeight = positiveFinite(height);
    const scale = Math.min(safeWidth / 1440, safeHeight / 900);
    const size = Number.isFinite(scale) ? scale : 0;

    return Object.freeze({
      cx: Math.round(safeWidth / 2),
      cy: Math.round(safeHeight * 0.45),
      ringRadius: Math.round(171 * size),
      nodeSize: Math.round(58 * size),
      markSize: Math.round(270 * size)
    });
  }

  return Object.freeze({stageLayout});
});
