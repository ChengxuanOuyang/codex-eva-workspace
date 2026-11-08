'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {BOOT_TIMELINE, sampleTimeline, validateTimeline} = require('../renderer/boot/timeline.js');
const {scanPosition} = require('../renderer/boot/motion.js');
const {stageLayout} = require('../renderer/boot/stage-layout.js');

test('reference timeline exposes the five approved stages', () => {
  assert.deepEqual(BOOT_TIMELINE.map(cue => cue.stage), [
    'wake', 'scan', 'synchronize', 'authorize', 'connect'
  ]);
  assert.equal(validateTimeline(BOOT_TIMELINE), true);
  assert.equal(Object.isFrozen(BOOT_TIMELINE), true);
  assert.equal(Object.isFrozen(BOOT_TIMELINE[0]), true);
});

test('timeline reaches but never crosses 99.2 before authorization', () => {
  assert.equal(sampleTimeline(15_499).progress < 99.2, true);
  assert.equal(sampleTimeline(15_500).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: false}).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: true}).progress, 100);
  assert.equal(sampleTimeline(-1).elapsedMs, 0);
  assert.equal(sampleTimeline(Number.NaN).elapsedMs, 0);
  assert.equal(sampleTimeline(4_000, {reducedMotion: true}).scan, 1);
});

test('motion and layout are deterministic at reference sizes', () => {
  assert.equal(scanPosition(5.5, 900, 5), scanPosition(5.5, 900, 5));
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
    ['../renderer/boot/timeline.js', 'ProjectZeroTimeline'],
    ['../renderer/boot/motion.js', 'ProjectZeroMotion'],
    ['../renderer/boot/stage-layout.js', 'ProjectZeroStageLayout']
  ]) {
    const source = require('node:fs').readFileSync(require.resolve(modulePath), 'utf8');
    const context = require('node:vm').createContext({globalThis: {}});
    require('node:vm').runInContext(source, context, {filename: modulePath});
    assert.equal(typeof context.globalThis[globalName], 'object');
  }
});
