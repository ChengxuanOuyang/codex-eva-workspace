'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('./fixtures/reference-video-manifest.json');
const {referenceFrame, REFERENCE_LAYOUT} = require('../renderer/boot/reference-layout.js');
const {sampleTimeline} = require('../renderer/boot/timeline.js');

test('reference presentation follows independently sampled video keyframes, including every node', () => {
  assert.deepEqual(manifest.frames.map(frame => frame.logicalMs),
    [0, 1500, 3000, 5500, 8800, 10500, 12500, 13300, 14100, 15450, 18600, 19850, 20500]);
  for (const expected of manifest.frames) {
    const actual = referenceFrame(sampleTimeline(expected.logicalMs, {authorized: expected.authorized}));
    const message = `logical ${expected.logicalMs}`;
    assert.equal(actual.center.title, expected.title, message);
    assert.equal(actual.center.metric, `${expected.progress.toFixed(1)}%`, message);
    assert.equal(actual.center.mode, expected.mode, message);
    assert.equal(actual.nodes.length, expected.totalNodeCount, message);
    assert.equal(actual.nodes.filter(node => node.visible).length, expected.visibleNodeCount, message);
    assert.deepEqual(actual.nodes.map(({side, row, visible, opacity, active, label}) =>
      ({side, row, visible, opacity, active, label})), expected.nodes, message);
    assert.ok(Math.abs(actual.scan.height / 1080 - expected.scan.ratio) < .002, message);
  }
  assert.deepEqual(REFERENCE_LAYOUT.geometry.center, manifest.calibration.geometry.center);
});

test('travelling pulses illuminate and extinguish individual rows on opposite sides independently of progress', () => {
  const samples = [1500, 3000, 5500].map(ms => referenceFrame(sampleTimeline(ms)));
  assert.ok(samples.every(frame => frame.center.metric === '0.0%'));
  assert.notDeepEqual(samples[0].nodes.map(node => node.opacity), samples[1].nodes.map(node => node.opacity));
  assert.equal(samples[0].nodes[3].active, true);
  assert.equal(samples[1].nodes[3].active, false);
  assert.equal(samples[1].nodes[2].active, true);
});

test('liquid uses a clock-driven disturbed bottom-up front and fades after reaching the top', () => {
  const first = referenceFrame(sampleTimeline(4000));
  const later = referenceFrame(sampleTimeline(5500));
  assert.ok(first.scan.height < later.scan.height);
  assert.ok(first.scan.waveOffsets.some(value => value !== first.scan.waveOffsets[0]));
  assert.notDeepEqual(first.scan.waveOffsets, referenceFrame(sampleTimeline(4100)).scan.waveOffsets);
  assert.equal(referenceFrame(sampleTimeline(8000)).scan.height, 1080);
  assert.ok(referenceFrame(sampleTimeline(8000)).scan.opacity < 1);
  assert.equal(referenceFrame(sampleTimeline(5500, {reducedMotion: true})).scan.waveOffsets.every(value => value === 0), true);
});
