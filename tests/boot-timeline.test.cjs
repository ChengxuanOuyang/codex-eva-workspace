'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {REFERENCE_CUES, REFERENCE_TIMING} = require('../renderer/boot/reference-timing.js');
const {BOOT_TIMELINE, sampleTimeline, validateTimeline} = require('../renderer/boot/timeline.js');
const {scanPosition} = require('../renderer/boot/motion.js');
const {stageLayout} = require('../renderer/boot/stage-layout.js');

test('reference timing matches the author sequence and recorded absolute clock', () => {
  assert.deepEqual(REFERENCE_TIMING, {
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
  assert.equal(REFERENCE_TIMING.videoHoldMs, 15_300);
  assert.equal(Object.isFrozen(REFERENCE_TIMING), true);
  assert.equal(sampleTimeline(REFERENCE_TIMING.holdMs - 1).progress < 99.2, true);
  assert.equal(sampleTimeline(REFERENCE_TIMING.holdMs).stage, 'authorize');
  assert.equal(sampleTimeline(REFERENCE_TIMING.holdMs).progress, 99.2);
});

test('reference cues preserve the six fixed upstream announcements', () => {
  assert.deepEqual(REFERENCE_CUES, [
    {start: 0.35, end: 2.2575, ja: 'ネルフ、システム起動。', zh: 'NERV 系统启动'},
    {start: 3.35, end: 5.6001, ja: 'LCL、注入開始。', zh: 'LCL 循环注入'},
    {start: 8.1, end: 9.5888, ja: 'シンクロ、開始。', zh: '开始驾驶员同步'},
    {start: 11.5, end: 12.7707, ja: '同期、確認。', zh: '驾驶员同步确认'},
    {start: 14.6, end: 15.6374, ja: 'アクセス許可。', zh: '访问已授权'},
    {start: 18, end: 19.5925, ja: 'システム、オンライン。', zh: '系统在线'}
  ]);
  assert.equal(Object.isFrozen(REFERENCE_CUES), true);
  assert.equal(REFERENCE_CUES.every(Object.isFrozen), true);
  assert.doesNotMatch(JSON.stringify(REFERENCE_CUES), /明日香|二号机|ASUKA|EVANGELION-02/i);
});

test('reference timeline exposes the five approved stages', () => {
  assert.deepEqual(BOOT_TIMELINE, [
    {stage: 'wake', startMs: 0, endMs: 3000, from: 0, to: 0},
    {stage: 'scan', startMs: 3000, endMs: 8800, from: 0, to: 0},
    {stage: 'synchronize', startMs: 8800, endMs: 13300, from: 0, to: 99.2},
    {stage: 'authorize', startMs: 13300, endMs: 13300, from: 99.2, to: 99.2},
    {stage: 'connect', startMs: 13300, endMs: 20500, from: 99.2, to: 100}
  ]);
  assert.equal(validateTimeline(BOOT_TIMELINE), true);
  assert.equal(Object.isFrozen(BOOT_TIMELINE), true);
  assert.equal(Object.isFrozen(BOOT_TIMELINE[0]), true);
});

test('timeline reaches but never crosses 99.2 before authorization', () => {
  assert.equal(sampleTimeline(13_299).progress < 99.2, true);
  assert.equal(sampleTimeline(13_300).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: false}).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: true}).progress, 100);
  assert.equal(sampleTimeline(20_500, {authorized: 'true'}).progress, 99.2);
  assert.equal(sampleTimeline(20_500, null).progress, 99.2);
  assert.equal(sampleTimeline(20_500, 'authorized').progress, 99.2);
  assert.equal(sampleTimeline(-1).elapsedMs, 0);
  assert.equal(sampleTimeline(Number.NaN).elapsedMs, 0);
  assert.equal(sampleTimeline(4_000, {reducedMotion: true}).scan, 1);
});

test('reduced motion jumps to static stage keyframes instead of producing per-frame progress', () => {
  assert.deepEqual(
    [9_000, 12_000, 13_299].map(time => sampleTimeline(time, {reducedMotion: true}).progress),
    [99.2, 99.2, 99.2]
  );
  assert.deepEqual(
    [9_000, 12_000, 13_299].map(time => sampleTimeline(time, {reducedMotion: true}).activeNodes),
    [12, 12, 12]
  );
  assert.equal(sampleTimeline(17_000, {authorized: true, reducedMotion: true}).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: true, reducedMotion: true}).progress, 100);
});

test('motion uses the upstream quintic scan path at fixed reference times', () => {
  assert.equal(scanPosition(0, 900, 5), -72);
  assert.equal(scanPosition(5, 900, 5), 972);
  assert.ok(Math.abs(scanPosition(5.5, 900, 5) - 963.06336) < 1e-8);
  assert.equal(scanPosition(10, 900, 5), -72);
});

test('stage layout is deterministic at reference size', () => {
  assert.deepEqual(stageLayout(1440, 900), {
    cx: 720, cy: 405, ringRadius: 171, nodeSize: 58, markSize: 270
  });
});

test('timeline validator rejects malformed and unsafe cue sequences', () => {
  const valid = BOOT_TIMELINE.map(cue => ({...cue}));
  const cases = [
    valid.map((cue, index) => index === 1 ? {...cue, startMs: Number.POSITIVE_INFINITY} : cue),
    valid.map((cue, index) => index === 2 ? {...cue, startMs: 8_000} : cue),
    valid.map((cue, index) => index === 2 ? {...cue, endMs: 8_000} : cue),
    valid.map((cue, index) => index === 1 ? {...cue, stage: 'wake'} : cue),
    valid.map((cue, index) => index === 2 ? {...cue, to: 99.3} : cue),
    valid.map((cue, index) => index === 3 ? {...cue, from: 99.3} : cue)
  ];

  for (const invalid of cases) assert.equal(validateTimeline(invalid), false);
});

test('UMD modules expose their browser APIs without CommonJS globals', () => {
  for (const [modulePath, globalName] of [
    ['../renderer/boot/reference-timing.js', 'ProjectZeroReferenceTiming'],
    ['../renderer/boot/timeline.js', 'ProjectZeroTimeline'],
    ['../renderer/boot/motion.js', 'ProjectZeroMotion'],
    ['../renderer/boot/stage-layout.js', 'ProjectZeroStageLayout']
  ]) {
    const source = require('node:fs').readFileSync(require.resolve(modulePath), 'utf8');
    const context = require('node:vm').createContext({
      globalThis: {ProjectZeroReferenceTiming: {REFERENCE_TIMING}}
    });
    require('node:vm').runInContext(source, context, {filename: modulePath});
    assert.equal(typeof context.globalThis[globalName], 'object');
  }
});
