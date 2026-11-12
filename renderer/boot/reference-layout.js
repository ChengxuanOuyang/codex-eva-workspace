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

  // Numeric/color/text calibration only. Source media remains owner-local.
  // Node samples are row-major left/right medians, quantized to 0.01. They
  // describe travelling pulses, independently of synchronization progress.
  const REFERENCE_LAYOUT = deepFreeze({
  "logicalSize": {
    "width": 1920,
    "height": 1080
  },
  "palette": {
    "background": "#eaf2fd",
    "nodeFill": "#b9d7ec",
    "ink": "#244955",
    "blue": "#518fae",
    "orangeTop": "#eec99d",
    "orangeBottom": "#cf9973",
    "white": "#f8fcfc",
    "muted": "#72939e",
    "blueSoft": "#b9d7ec",
    "line": "rgba(36, 73, 85, 0.08)",
    "lineStrong": "rgba(36, 73, 85, 0.24)"
  },
  "typography": {
    "title": "\"Unit02 Mincho\", serif",
    "code": "Arial, sans-serif",
    "headingSize": 76,
    "headingSpacing": 0,
    "metricSize": 60,
    "metricSpacing": 0,
    "nodeSize": 24,
    "nodeSpacing": 0,
    "unitSize": 24,
    "unitSpacing": 0,
    "cueSize": 34,
    "cueSpacing": 2
  },
  "geometry": {
    "center": {
      "x": 960,
      "y": 486
    },
    "ringRadius": 196,
    "nodes": {
      "leftX": 250,
      "rightX": 1670,
      "firstY": 201,
      "stepY": 168,
      "width": 208,
      "height": 144
    },
    "border": {
      "inset": 16,
      "width": 1
    },
    "headingY": 700,
    "rings": [
      196
    ]
  },
  "header": {
    "unit": "EVANGELION-00",
    "pilot": "零号机",
    "code": "MULTI-00"
  },
  "footer": {
    "left": "SYSTEM 00",
    "right": "EVANGELION"
  },
  "scanHeightSamples": [
    [
      0,
      0
    ],
    [
      3000,
      0
    ],
    [
      3500,
      0.033
    ],
    [
      4000,
      0.1712
    ],
    [
      4500,
      0.4114
    ],
    [
      5000,
      0.6817
    ],
    [
      5500,
      0.8949
    ],
    [
      6400,
      1
    ],
    [
      6800,
      1
    ],
    [
      7400,
      1
    ],
    [
      8000,
      1
    ],
    [
      8800,
      1
    ],
    [
      9200,
      0
    ]
  ],
  "nodeOpacitySamples": [
    [0,0,0,0,0,0,0,0,0,0,0,0],
    [250,0,0,0,0,0,0,0,0,0,0,0],
    [500,0,0,0,0,0,0,0,0,0,0,0],
    [750,1,0.18,0.1,0.1,0.1,0.1,0.19,0.1,0.1,0.1,0.1],
    [1000,0,0.18,0.1,0.1,0.1,0.1,0.35,0.32,0.1,0.11,0.1],
    [1250,0,0.11,0.1,0.1,0.47,0.1,0.26,0.66,0.1,0.11,0.1],
    [1500,0,0.11,0.12,0.1,0.83,0.16,0.1,0.76,0.1,0.12,0.1],
    [1750,0,0.11,0.35,0.11,0.74,0.42,0.1,0.42,0.11,0.12,0.19],
    [2000,0,0.11,0.71,0.1,0.3,0.79,0.11,0.26,0.11,0.11,0.34],
    [2250,0,0.11,0.85,0.18,0.1,0.85,0.11,0.11,0.11,0.11,0.7],
    [2500,0,0.11,0.57,0.48,0.1,0.59,0.11,0.11,0.11,0.11,0.85],
    [2750,0,0.11,0.18,0.78,0.11,0.44,0.11,0.11,0.18,0.11,0.85],
    [3000,1,0.41,0.12,0.74,0.11,0.1,0.11,0.11,0.52,0.11,0.54],
    [3250,1,0.83,0.12,0.46,0.11,0.11,0.12,0.11,0.79,0.12,0.3],
    [3500,1,0.76,0.12,0.11,0.11,0.11,0.28,0.11,0.83,0.2,0.1],
    [3750,1,0.35,0.11,0.1,0.11,0.11,0.6,0.11,0.6,0.49,0.11],
    [4000,0,0.1,0.1,0.11,0.18,0.11,0.83,0.11,0.29,0.76,0.11],
    [4250,0,0.1,0.13,0.11,0.51,0.11,0.78,0.24,0.12,0.85,0.11],
    [4500,0,0.11,0.39,0.11,0.85,0.11,0.48,0.6,0.17,0.73,0.16],
    [4750,0,0.11,0.77,0.11,0.73,0.27,0.18,0.83,0.17,0.56,0.1],
    [5000,0,0.11,0.78,0.1,0.29,0.5,0.1,0.8,0.1,0.43,0.14],
    [5250,0,0.11,0.39,0.24,0.1,0.67,0.1,0.68,0.11,0.32,0.16],
    [5500,0,0.21,0.1,0.54,0.1,0.79,0.1,0.48,0.1,0.32,0.1],
    [5750,1,0.49,0.1,0.78,0.1,0.67,0.1,0.36,0.1,0.28,0.23],
    [6000,1,0.74,0.1,0.8,0.1,0.52,0.1,0.28,0.1,0.28,0.36],
    [6250,1,0.64,0.1,0.47,0.1,0.32,0.1,0.26,0.18,0.25,0.49],
    [6400,1,0.4,0.1,0.28,0.1,0.27,0.1,0.27,0.21,0.25,0.59],
    [6500,1,0.35,0.1,0.2,0.1,0.24,0.1,0.26,0.35,0.23,0.59],
    [6750,1,0.17,0.1,0.22,0.1,0.24,0.18,0.31,0.53,0.25,0.52],
    [6800,1,0.17,0.1,0.22,0.1,0.24,0.2,0.31,0.57,0.25,0.44],
    [7000,0,0.13,0.1,0.2,0.1,0.32,0.42,0.29,0.65,0.3,0.39],
    [7250,0,0.11,0.29,0.18,0.4,0.31,0.63,0.3,0.58,0.39,0.16],
    [7400,0,0.16,0.54,0.21,0.56,0.21,0.75,0.31,0.47,0.4,0.16],
    [7500,0,0.2,0.71,0.22,0.63,0.26,0.66,0.32,0.34,0.45,0.11],
    [7750,0,0.14,0.69,0.22,0.58,0.23,0.43,0.34,0.15,0.68,0.14],
    [8000,0,0.16,0.27,0.25,0.34,0.23,0.25,0.4,0.14,0.85,0.14],
    [8250,0,0.3,0.1,0.21,0.1,0.41,0.17,0.77,0.19,0.85,0.16],
    [8500,1,0.66,0.11,0.53,0.1,0.68,0.1,0.85,0.12,0.6,0.17],
    [8750,1,0.85,0.13,0.85,0.11,0.85,0.11,0.76,0.15,0.37,0.21],
    [8800,1,0.8,0.12,0.85,0.16,0.85,0.13,0.72,0.15,0.27,0.17],
    [9000,0,0.6,0.1,0.79,0.12,0.71,0.1,0.47,0.1,0.1,0.12],
    [9200,1,0.32,0.1,0.51,0.11,0.41,0.11,0.28,0.11,0.11,0.11],
    [9250,0,0.28,0.11,0.4,0.11,0.34,0.11,0.22,0.11,0.11,0.11],
    [9500,0,0.11,0.11,0.15,0.11,0.1,0.1,0.11,0.12,0.11,0.2],
    [9750,0,0.11,0.11,0.11,0.11,0.1,0.1,0.11,0.12,0.11,0.35],
    [10000,0,0.11,0.58,0.11,0.2,0.1,0.1,0.11,0.32,0.11,0.62],
    [10250,0,0.11,0.85,0.11,0.57,0.1,0.39,0.11,0.62,0.11,0.83],
    [10500,0,0.11,0.66,0.11,0.85,0.1,0.74,0.11,0.85,0.11,0.82],
    [10750,0,0.11,0.29,0.11,0.79,0.1,0.82,0.11,0.78,0.11,0.59],
    [11000,0,0.29,0.1,0.11,0.34,0.1,0.53,0.11,0.56,0.11,0.32],
    [11250,1,0.74,0.11,0.23,0.11,0.1,0.23,0.11,0.2,0.19,0.1],
    [11500,1,0.85,0.11,0.49,0.11,0.26,0.1,0.3,0.11,0.39,0.11],
    [11750,1,0.54,0.11,0.83,0.11,0.63,0.1,0.57,0.11,0.73,0.11],
    [12000,1,0.13,0.11,0.76,0.11,0.85,0.1,0.85,0.11,0.85,0.11],
    [12250,1,0.11,0.1,0.45,0.11,0.74,0.1,0.84,0.11,0.75,0.11],
    [12500,1,0.11,0.32,0.15,0.11,0.47,0.1,0.56,0.11,0.54,0.11],
    [12750,0,0.11,0.65,0.11,0.1,0.11,0.1,0.32,0.11,0.2,0.11],
    [13000,0,0.11,0.85,0.11,0.29,0.1,0.1,0.11,0.11,0.11,0.11],
    [13250,0,0.11,0.63,0.11,0.57,0.1,0.1,0.11,0.11,0.11,0.11],
    [13300,0,0.11,0.53,0.11,0.63,0.1,0.19,0.11,0.11,0.11,0.1],
    [14100,1,0.13,0.13,0.83,0.11,0.19,0.11,0.1,0.26,0.15,0.44],
    [15450,0,0.11,0.82,0.11,0.12,0.51,0.11,0.85,0.11,0.85,0.11],
    [18600,1,0.18,0.11,0.35,0.11,0.1,0.81,0.1,0.54,0.11,0.2],
    [19850,0,0.1,0.37,0.1,0.1,0.58,0.1,0.11,0.1,0.1,0.29],
    [20500,0,0.1,0.37,0.1,0.1,0.58,0.1,0.11,0.1,0.1,0.29]
  ]
});
  const frames = new WeakSet();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  function interpolate(samples, elapsedMs, column = 1) {
    let before = samples[0];
    for (const after of samples.slice(1)) {
      if (elapsedMs <= after[0]) {
        const fraction = clamp((elapsedMs - before[0]) / (after[0] - before[0]), 0, 1);
        return before[column] + (after[column] - before[column]) * fraction;
      }
      before = after;
    }
    return before[column];
  }

  function referenceFrame(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const stage = ['wake', 'scan', 'synchronize', 'authorize', 'connect'].includes(source.stage) ? source.stage : 'wake';
    const elapsedMs = clamp(finite(source.elapsedMs), 0, REFERENCE_TIMING.durationMs);
    const reducedMotion = source.reducedMotion === true;
    // The source synchronization is eased, not the Canvas fallback's linear
    // progress curve. Authorization still belongs to the controller's gate.
    const progress = stage === 'authorize' ? 99.2 : stage === 'connect'
      ? interpolate([[13300, 99.2], [14100, 100]], elapsedMs)
      : stage === 'synchronize' ? interpolate([[8800, 0], [9200, .8], [10500, 29], [12500, 95.5], [13300, 99.2]], elapsedMs) : 0;
    const isConnecting = stage === 'connect';
    const completionOpacity = isConnecting ? interpolate([[13300, 0], [14100, .5], [14800, 1]], elapsedMs) : 0;
    const ringOpacity = ['synchronize', 'authorize'].includes(stage) ? clamp((elapsedMs - 8800) / 400, 0, 1)
      : isConnecting ? interpolate([[13300, 1], [14100, 1], [14800, 0]], elapsedMs) : 0;
    const metricOpacity = isConnecting ? interpolate([[13300, 1], [14100, .75], [14800, 0]], elapsedMs) : ringOpacity;
    const mode = completionOpacity > 0 && ringOpacity > 0 ? 'overlap' : completionOpacity > 0 ? 'complete'
      : ['synchronize', 'authorize', 'connect'].includes(stage) ? 'sync' : 'mark';
    const introOpacity = mode === 'mark' ? clamp(elapsedMs / 1500, 0, 1) : 0;
    const title = completionOpacity > 0 ? elapsedMs >= 18600 ? '工作台已就绪' : '正在连接工作台'
      : mode === 'mark' && elapsedMs > 0 ? '系统唤醒' : '';
    const nodeSamples = REFERENCE_LAYOUT.nodeOpacitySamples;
    const labelSample = nodeSamples.reduce((previous, sample) => sample[0] <= elapsedMs ? sample : previous, nodeSamples[0]);
    const nodes = Array.from({length: 12}, (_, index) => {
      const row = Math.floor(index / 2);
      const visible = row < 5 && elapsedMs >= 600;
      const opacity = row < 5 ? Number(interpolate(nodeSamples, elapsedMs, index + 2).toFixed(2)) : 0;
      return {
        side: index % 2 ? 'right' : 'left', row,
        label: ((index % 2 === row % 2) === Boolean(labelSample[1])) ? 'WARNING' : 'EMERGENCY',
        active: visible && opacity >= .5, visible, opacity,
        x: index % 2 ? REFERENCE_LAYOUT.geometry.nodes.rightX : REFERENCE_LAYOUT.geometry.nodes.leftX,
        y: REFERENCE_LAYOUT.geometry.nodes.firstY + row * REFERENCE_LAYOUT.geometry.nodes.stepY
      };
    });
    const scanHeight = interpolate(REFERENCE_LAYOUT.scanHeightSamples, elapsedMs) * 1080;
    const scanOpacity = elapsedMs < 6800 ? 1
      : interpolate([[6800, 1], [7400, .85], [8000, .4], [8800, .035], [9200, 0]], elapsedMs);
    const scanVisible = elapsedMs >= 3000 && elapsedMs < 9200 && scanHeight > 0 && scanOpacity > 0;
    const waveOffsets = Array.from({length: 33}, (_, index) => reducedMotion || !scanVisible ? 0
      : Number((Math.sin(index * .64 + elapsedMs / 330) * 4.8 + Math.sin(index * 1.43 - elapsedMs / 210) * 2.2).toFixed(3)));
    const cue = isConnecting && elapsedMs >= 14000 && elapsedMs < 15000
      ? {ja: 'アクセス許可。', zh: '访问已授权'}
      : isConnecting && elapsedMs >= 19000 && elapsedMs < 20000 ? {ja: 'システム、オンライン。', zh: '系统在线'}
        : REFERENCE_CUES.find(item => item.start < 14 && elapsedMs / 1000 >= item.start && elapsedMs / 1000 < item.end);
    const layers = {
      mark: {text: '', opacity: introOpacity},
      ring: {text: '', opacity: ringOpacity},
      metric: {text: `${progress.toFixed(1)}%`, opacity: metricOpacity},
      unit: {text: 'EVANGELION-00', opacity: completionOpacity},
      title: {text: title, opacity: completionOpacity || introOpacity},
      subtitle: {text: mode === 'mark' && elapsedMs > 0 ? 'EVANGELION-00 / LOCAL WORKSTATION' : '', opacity: introOpacity},
      code: {text: 'CODEX / 本地链路已建立', opacity: completionOpacity},
      cueJa: {text: cue?.ja || '', opacity: cue?.ja ? 1 : 0},
      cueZh: {text: cue?.zh || '', opacity: cue?.zh ? 1 : 0}
    };
    const frame = deepFreeze({
      stage, elapsedMs, reducedMotion,
      logicalSize: REFERENCE_LAYOUT.logicalSize, palette: REFERENCE_LAYOUT.palette,
      header: REFERENCE_LAYOUT.header, footer: REFERENCE_LAYOUT.footer,
      center: {title, subtitle: layers.subtitle.text, mode, layers,
        opacity: mode === 'mark' ? clamp(elapsedMs / 1500, 0, 1) : mode === 'sync' ? clamp((elapsedMs - 8800) / 400, 0, 1) : 1,
        metric: `${progress.toFixed(1)}%`, ringDegrees: Number((progress * 3.6).toFixed(5))},
      cue: cue ? {ja: cue.ja, zh: cue.zh} : {ja: '', zh: ''},
      scan: {visible: scanVisible, height: scanVisible ? scanHeight : 0,
        opacity: scanVisible ? scanOpacity : 0, waveOffsets},
      flash: {visible: !reducedMotion && stage === 'connect' && elapsedMs >= REFERENCE_TIMING.transferStartMs && elapsedMs < REFERENCE_TIMING.transferEndMs},
      nodes
    });
    frames.add(frame);
    return frame;
  }

  return Object.freeze({REFERENCE_LAYOUT, referenceFrame, isReferenceFrame: frame => frames.has(frame)});
});
