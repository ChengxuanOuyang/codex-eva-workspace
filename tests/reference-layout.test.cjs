'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {referenceFrame} = require('../renderer/boot/reference-layout.js');
const {sampleTimeline} = require('../renderer/boot/timeline.js');
const timing = require('../renderer/boot/reference-timing.js');

test('hold frame reproduces the EVANGELION-00 reference inventory', () => {
  const frame = referenceFrame(Object.freeze({elapsedMs: 13_300, stage: 'authorize', progress: 99.2, activeNodes: 12}));
  assert.equal(frame.header.unit, 'EVANGELION-00');
  assert.equal(frame.header.pilot, '零号机');
  assert.equal(frame.center.metric, '99.2%');
  assert.deepEqual(frame.nodes.map(node => node.label), [
    'WARNING', 'EMERGENCY', 'WARNING', 'EMERGENCY', 'WARNING', 'EMERGENCY',
    'WARNING', 'EMERGENCY', 'WARNING', 'EMERGENCY', 'WARNING', 'EMERGENCY'
  ]);
  assert.equal(frame.palette.background, '#edf6fa');
  assert.deepEqual(frame.logicalSize, {width: 1920, height: 1080});
  assert.equal(frame.scan.visible, false);
  assert.equal(frame.center.ringDegrees, 357.12);
  assert.equal(frame.nodes.filter(node => node.active).length, 12);
});

test('frame is deeply frozen and rejects arbitrary snapshot presentation fields', () => {
  const snapshot = sampleTimeline(13_300);
  const clean = referenceFrame(snapshot);
  const spoofed = referenceFrame(Object.freeze({...snapshot,
    headingKey: '<img src=x onerror=alert(1)>', iconStates: ['evil:active'],
    header: {unit: 'ASUKA'}, palette: {background: 'red'}, markUrl: 'https://example.invalid'
  }));
  assert.deepEqual(spoofed, clean);
  function assertFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(assertFrozen);
  }
  assertFrozen(clean);
});

test('stage branches derive scan, cues, ring, and bounded authorization flash from the fixed clock', () => {
  const wake = referenceFrame(sampleTimeline(1500));
  assert.equal(wake.center.mode, 'mark');
  assert.equal(wake.cue.zh, 'NERV 系统启动');
  const scan = referenceFrame(sampleTimeline(5500));
  assert.equal(scan.scan.visible, true);
  assert.ok(scan.scan.height > 0 && scan.scan.height <= 1080);
  const sync = referenceFrame(sampleTimeline(10500));
  assert.equal(sync.center.mode, 'sync');
  assert.equal(sync.nodes.filter(node => node.active).length, 4);
  assert.ok(sync.center.ringDegrees > 0 && sync.center.ringDegrees < 357.12);
  const full = referenceFrame(sampleTimeline(14100, {authorized: true}));
  assert.equal(full.center.metric, '100.0%');
  const transfer = referenceFrame(sampleTimeline(14800, {authorized: true}));
  assert.equal(transfer.flash.visible, true);
  const complete = referenceFrame(sampleTimeline(20500, {authorized: true}));
  assert.equal(complete.flash.visible, false);
  assert.equal(complete.center.mode, 'complete');
  assert.equal(complete.center.title, 'SYSTEM ONLINE');
});

test('scan recedes on the reference clock, and reduced motion uses static keyframes', () => {
  const filling = referenceFrame(sampleTimeline(6400));
  const clearing = referenceFrame(sampleTimeline(8000));
  assert.equal(filling.scan.height, 1080);
  assert.ok(clearing.scan.height < filling.scan.height);
  const reduced = referenceFrame(sampleTimeline(5500, {reducedMotion: true}));
  assert.equal(reduced.scan.height, 1080);
  assert.equal(reduced.reducedMotion, true);
  assert.equal(referenceFrame(sampleTimeline(14800, {authorized: true, reducedMotion: true})).flash.visible, false);
});

test('invalid stages and non-finite numeric values cannot inject presentation or invalid styles', () => {
  assert.deepEqual(referenceFrame(null), referenceFrame({}));
  const invalid = referenceFrame({stage: 'evil', elapsedMs: Infinity, progress: NaN, activeNodes: Infinity});
  assert.equal(invalid.stage, 'wake');
  assert.equal(invalid.scan.visible, false);
  assert.equal(invalid.nodes.filter(node => node.active).length, 0);
  assert.doesNotMatch(JSON.stringify(invalid), /NaN|Infinity|evil/);
  assert.equal(referenceFrame({stage: 'authorize', elapsedMs: 13_300, progress: 999}).center.metric, '99.2%');
});

test('reference view model is CSP-safe UMD without CommonJS globals in the browser', () => {
  const context = vm.createContext({globalThis: {ProjectZeroReferenceTiming: timing}});
  const source = fs.readFileSync(require.resolve('../renderer/boot/reference-layout.js'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(typeof context.globalThis.ProjectZeroReferenceLayout.referenceFrame, 'function');
  assert.doesNotMatch(source, /eval\s*\(|new Function|innerHTML|https?:\/\/(?!github\.com)/);
});
