/*
 * Original light-blue reference presentation. Persistent anchor and symmetric
 * node-bank structure adapted from https://github.com/Iris-change/eva-codex-workbench
 * at 9733eb192e8ef97d3e7469ede544cad2a6186519: stage-layout.js,
 * boot-atmosphere.js and unified-sequence.js (MIT code scope only).
 * NERV marks, character artwork and voice/audio are not covered or copied.
 */
(function exposeReferenceLayout(root, factory) {
  const timing = typeof module === 'object' && module.exports
    ? require('./reference-timing.js') : root?.ProjectZeroReferenceTiming;
  const api = factory(timing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroReferenceLayout = api;
})(typeof globalThis === 'object' ? globalThis : this, function createReferenceLayout(timing) {
  'use strict';
  if (!timing?.REFERENCE_TIMING) throw new Error('REFERENCE_TIMING_UNAVAILABLE');
  const {REFERENCE_TIMING, REFERENCE_CUES} = timing;

  function deepFreeze(value) {
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') deepFreeze(child);
    });
    return Object.freeze(value);
  }

  // Public, text-only baseline. Video-manifest calibration belongs to the
  // reference-frame verification step; it must never embed captured media.
  const REFERENCE_LAYOUT = deepFreeze({
    logicalSize: {width: 1920, height: 1080},
    palette: {
      background: '#edf6fa', white: '#f8fcfc', ink: '#102934', muted: '#4d6873',
      blue: '#5c9fb2', blueSoft: '#a7d0d8', orange: '#e86426', green: '#397e72',
      line: 'rgba(25, 76, 91, 0.15)', lineStrong: 'rgba(25, 76, 91, 0.34)'
    },
    typography: {title: '"Unit02 Mincho", serif', code: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'},
    geometry: {
      center: {x: 960, y: 522}, rings: [174, 220, 268], titleY: 150,
      nodes: {leftX: 205, rightX: 1715, firstY: 205, stepY: 135, radius: 48},
      border: {inset: 42, width: 1, corner: 28}, grid: {step: 60}
    },
    header: {unit: 'EVANGELION-00', pilot: '零号机', code: 'NERV / SYSTEM 00'},
    footer: {left: 'NERV // CENTRAL CONTROL', right: 'REI AYANAMI / PILOT 00'},
    stages: {
      wake: {title: 'NERV', subtitle: 'システム起動', mode: 'mark'},
      scan: {title: 'LCL INJECTION', subtitle: 'LCL 循环注入', mode: 'mark'},
      synchronize: {title: 'SYNCHRONIZATION', subtitle: '驾驶员同步', mode: 'sync'},
      authorize: {title: 'PILOT AUTHORIZATION', subtitle: '同期、確認。', mode: 'sync'},
      connect: {title: 'ACCESS GRANTED', subtitle: '访问已授权', mode: 'sync'},
      complete: {title: 'SYSTEM ONLINE', subtitle: '系统在线', mode: 'complete'}
    },
    nodeIcons: ['core', 'link', 'data', 'shield', 'render', 'pilot']
  });
  const frames = new WeakSet();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  function referenceFrame(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const stage = ['wake', 'scan', 'synchronize', 'authorize', 'connect'].includes(source.stage) ? source.stage : 'wake';
    const elapsedMs = clamp(finite(source.elapsedMs), 0, REFERENCE_TIMING.durationMs);
    const reducedMotion = source.reducedMotion === true;
    const completed = stage === 'connect' && elapsedMs >= REFERENCE_TIMING.handoffEndMs;
    const display = REFERENCE_LAYOUT.stages[completed ? 'complete' : stage];
    const progress = stage === 'authorize' ? 99.2
      : stage === 'synchronize' ? clamp(finite(source.progress), 0, 99.2)
        : stage === 'connect' ? clamp(finite(source.progress, 99.2), 99.2, 100) : 0;
    const activeNodes = Math.min(12, Math.floor(progress / 99.2 * 12));
    const filling = clamp((elapsedMs - REFERENCE_TIMING.lclStartMs)
      / (REFERENCE_TIMING.lclEndMs - REFERENCE_TIMING.lclStartMs), 0, 1);
    const clearing = clamp((elapsedMs - REFERENCE_TIMING.lclClearStartMs)
      / (REFERENCE_TIMING.lclClearEndMs - REFERENCE_TIMING.lclClearStartMs), 0, 1);
    const scanVisible = ['scan', 'synchronize'].includes(stage)
      && elapsedMs >= REFERENCE_TIMING.lclStartMs && elapsedMs < REFERENCE_TIMING.lclClearEndMs;
    const scanHeight = scanVisible ? (reducedMotion ? 1 : filling * (1 - clearing)) * 1080 : 0;
    const cue = REFERENCE_CUES.find(item => elapsedMs / 1000 >= item.start && elapsedMs / 1000 < item.end);
    const nodes = Array.from({length: 12}, (_, index) => {
      const row = Math.floor(index / 2);
      return {
        side: index % 2 ? 'right' : 'left', row, icon: REFERENCE_LAYOUT.nodeIcons[row],
        label: index % 2 ? 'EMERGENCY' : 'WARNING', active: index < activeNodes,
        visible: stage !== 'wake' || reducedMotion || elapsedMs >= row * 160,
        x: index % 2 ? REFERENCE_LAYOUT.geometry.nodes.rightX : REFERENCE_LAYOUT.geometry.nodes.leftX,
        y: REFERENCE_LAYOUT.geometry.nodes.firstY + row * REFERENCE_LAYOUT.geometry.nodes.stepY
      };
    });
    const frame = deepFreeze({
      stage, elapsedMs, reducedMotion,
      logicalSize: REFERENCE_LAYOUT.logicalSize, palette: REFERENCE_LAYOUT.palette,
      header: REFERENCE_LAYOUT.header, footer: REFERENCE_LAYOUT.footer,
      center: {
        title: display.title, subtitle: display.subtitle, mode: display.mode,
        metric: `${progress.toFixed(1)}%`, ringDegrees: Number((progress * 3.6).toFixed(5))
      },
      cue: cue ? {ja: cue.ja, zh: cue.zh} : {ja: '', zh: ''},
      scan: {visible: scanVisible && scanHeight > 0, height: scanHeight},
      flash: {
        visible: !reducedMotion && stage === 'connect'
          && elapsedMs >= REFERENCE_TIMING.transferStartMs && elapsedMs < REFERENCE_TIMING.transferEndMs
      },
      nodes
    });
    frames.add(frame);
    return frame;
  }

  return Object.freeze({REFERENCE_LAYOUT, referenceFrame, isReferenceFrame: frame => frames.has(frame)});
});
