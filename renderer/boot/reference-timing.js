/*
 * Fixed timing and announcement cues from the inspected upstream author
 * sequence. Exposed as UMD for the renderer and CommonJS tests.
 */
(function exposeReferenceTiming(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroReferenceTiming = api;
})(typeof globalThis === 'object' ? globalThis : this, function createReferenceTiming() {
  'use strict';

  const REFERENCE_TIMING = Object.freeze({
    durationMs: 20_500,
    lclStartMs: 3_000,
    lclEndMs: 6_400,
    lclClearStartMs: 6_800,
    lclClearEndMs: 9_200,
    syncStartMs: 8_800,
    holdMs: 13_300,
    syncFullMs: 14_100,
    transferStartMs: 14_350,
    transferEndMs: 15_450,
    handoffStartMs: 18_600,
    handoffEndMs: 19_850,
    videoStartMs: 2_000,
    videoEndMs: 22_500,
    videoHoldMs: 15_300
  });
  const REFERENCE_CUES = Object.freeze([
    Object.freeze({start: 0.35, end: 2.2575, ja: 'ネルフ、システム起動。', zh: 'NERV 系统启动'}),
    Object.freeze({start: 3.35, end: 5.6001, ja: 'LCL、注入開始。', zh: 'LCL 循环注入'}),
    Object.freeze({start: 8.1, end: 9.5888, ja: 'シンクロ、開始。', zh: '开始驾驶员同步'}),
    Object.freeze({start: 11.5, end: 12.7707, ja: '同期、確認。', zh: '驾驶员同步确认'}),
    Object.freeze({start: 14.6, end: 15.6374, ja: 'アクセス許可。', zh: '访问已授权'}),
    Object.freeze({start: 18, end: 19.5925, ja: 'システム、オンライン。', zh: '系统在线'})
  ]);

  return Object.freeze({REFERENCE_CUES, REFERENCE_TIMING});
});
