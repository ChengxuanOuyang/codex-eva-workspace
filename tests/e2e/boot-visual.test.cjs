'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const manifest = require('../fixtures/reference-video-manifest.json');
const {verifyRecord, validateDirectory} = require('../../scripts/verify-reference-frames.cjs');
const {configurePresentation, seekPresentation} = require('./boot-support.cjs');
const VIEWPORTS = [{width: 1440, height: 900}, {width: 1280, height: 800}];
const ICONS = ['core', 'core', 'link', 'link', 'data', 'data', 'shield', 'shield', 'render', 'render', 'pilot', 'pilot'];

async function windowMode(page, expected) {
  await page.waitForFunction(async mode => await ProjectZeroTestBridge.readWindowMode() === mode, expected);
}

function verifyCanvas(actual, frame) {
  const expected = frame.canvas;
  assert.equal(actual.stage, frame.stage);
  assert.equal(actual.headingText, expected.headingText);
  assert.ok(Math.abs(actual.progress - expected.progress) < .00001, `logical ${frame.logicalMs}: ${actual.progress} != ${expected.progress}`);
  assert.equal(actual.activeNodes, expected.activeNodes);
  assert.equal(actual.progressDrawn, expected.progressDrawn);
  assert.equal(actual.mark, expected.mark);
  assert.deepEqual(actual.iconStates, ICONS.map((icon, index) => `${icon}:${index < expected.activeNodes ? 'active' : 'idle'}`));
  assert.equal(actual.scan.drawn, expected.scan.drawn);
  for (const field of ['position', 'top']) {
    if (expected.scan[field] === null) assert.equal(actual.scan[field], null);
    else assert.ok(Math.abs(actual.scan[field] - expected.scan[field]) < .00001);
  }
}

for (const mode of ['reference', 'canvas']) test(`${mode}: video keyframes, real styles, audio gate and fullscreen handoff`, {timeout: 120000}, async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), `zero-visual-${mode}-data-`));
  const requestedCapture = mode === 'reference' ? process.env.PROJECT_ZERO_REFERENCE_SCREENSHOTS : null;
  const captureRoot = requestedCapture ? await validateDirectory(requestedCapture)
    : await fs.mkdtemp(path.join(os.tmpdir(), `zero-visual-${mode}-frames-`));
  t.after(async () => { await fs.rm(dataRoot, {recursive: true, force: true}); if (!requestedCapture) await fs.rm(captureRoot, {recursive: true, force: true}); });
  let app;
  try {
    app = await electron.launch({args: ['.'], env: {...process.env, NODE_ENV: 'test', PROJECT_ZERO_TEST_DATA_ROOT: dataRoot,
      PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')}});
    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
    await configurePresentation(page, mode);
    await windowMode(page, 'fullscreen');
    const viewports = requestedCapture ? [...VIEWPORTS, {width: 1920, height: 1080}] : VIEWPORTS;
    for (const viewport of viewports) {
      await page.emulateMedia({reducedMotion: 'no-preference'});
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForFunction(expected => globalThis.ProjectZeroRendererDirectorInstance?.mode() === expected && globalThis.audioAcceptance, mode);
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.fonts.load('900 76px "Unit02 Mincho"'));
      assert.equal(await page.evaluate(() => document.fonts.check('900 76px "Unit02 Mincho"')), true);
      for (const frame of manifest.frames) {
        if (frame.logicalMs === 14100) {
          const before = await page.evaluate(() => ({time: audioAcceptance.time(), record: ProjectZeroRendererDirectorInstance.lastRenderRecord()}));
          await page.waitForTimeout(150);
          assert.deepEqual(await page.evaluate(() => ({time: audioAcceptance.time(), record: ProjectZeroRendererDirectorInstance.lastRenderRecord()})), before, '99.2 gate freezes audio and nodes');
          assert.ok(Math.abs(before.time - 13.3) < .001);
          await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
          await page.getByRole('button', {name: /确认驾驶员授权并完成同步/}).click();
          await page.waitForFunction(() => document.body.dataset.phase === 'completing');
          assert.ok(await page.evaluate(() => audioAcceptance.calls.some(call => call.name === 'resume')));
        }
        await seekPresentation(page, frame.logicalMs);
        if (frame.logicalMs === 20500) {
          await page.locator('#workbench-shell').waitFor({state: 'visible'});
          await windowMode(page, 'windowed');
          assert.equal(await page.locator('#boot-screen').isHidden(), true);
          continue;
        }
        const record = await page.evaluate(() => ProjectZeroRendererDirectorInstance.lastRenderRecord());
        assert.equal(await page.locator('body').getAttribute('data-stage'), frame.stage);
        if (mode === 'reference') {
          verifyRecord(record, frame);
          assert.equal(await page.locator('#progress-value').textContent(), frame.progress.toFixed(1));
          assert.equal(await page.locator('#ring-progress').getAttribute('aria-valuenow'), frame.progress.toFixed(1));
          assert.equal(record.mark, frame.mode === 'mark' && frame.logicalMs > 0 ? 'private' : 'not-drawn');
          assert.equal(await page.locator('.reference-node-icon').count(), 0);
          assert.equal(await page.locator('.reference-node[hidden]').count(), frame.logicalMs === 0 ? 12 : 2);
          assert.equal(await page.evaluate(() => [...document.querySelectorAll('.reference-node')].every(node => /^(WARNING|EMERGENCY)$/.test(node.textContent))), true);
          if (requestedCapture && viewport.width === 1920) {
            const base = path.join(captureRoot, `reference-${frame.logicalMs}`);
            await page.locator('#reference-sequence').screenshot({path: `${base}.png`, scale: 'css'});
            await fs.writeFile(`${base}.json`, JSON.stringify(record));
          }
        } else verifyCanvas(record, frame);
        const layout = await page.evaluate(() => [document.documentElement.scrollWidth === innerWidth, document.documentElement.scrollHeight === innerHeight]);
        assert.deepEqual(layout, [true, true]);
        await page.screenshot({path: path.join(captureRoot, `${mode}-${viewport.width}x${viewport.height}-${frame.logicalMs}.png`), scale: 'css'});
      }
    }
    assert.deepEqual(await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => new URL(url).origin !== location.origin)), []);
    // Reduced motion retains sampled information while suppressing wave movement and flashes.
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(expected => globalThis.ProjectZeroRendererDirectorInstance?.mode() === expected && globalThis.audioAcceptance, mode);
    await seekPresentation(page, 10500);
    const reduced = await page.evaluate(() => ProjectZeroRendererDirectorInstance.lastRenderRecord());
    assert.equal(reduced.reducedMotion, true);
    if (mode === 'reference') {
      assert.equal(reduced.metricText, '29.0%');
      assert.equal(reduced.flashVisible, false);
      // Prove that the acceptance oracle fails for actual DOM deviations.
      const sampled = manifest.frames.find(frame => frame.logicalMs === 10500);
      await page.evaluate(() => { document.querySelector('.reference-node').style.opacity = '1'; });
      const altered = await page.evaluate(() => ProjectZeroRendererDirectorInstance.lastRenderRecord());
      assert.throws(() => verifyRecord(altered, sampled));
    } else assert.equal(reduced.progress, 99.2);
  } finally { await app?.close(); }
});

for (const mode of ['reference', 'canvas']) test(`${mode}: natural media playback reaches the gate, freezes, resumes and hands off without seeking`, {timeout: 45000}, async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), `zero-natural-${mode}-`));
  t.after(() => fs.rm(dataRoot, {recursive: true, force: true}));
  let app;
  try {
    // Disable hardware output for silent acceptance; real WebAudio currentTime must still advance.
    app = await electron.launch({args: ['.', '--disable-audio-output'], env: {...process.env, NODE_ENV: 'test', PROJECT_ZERO_TEST_DATA_ROOT: dataRoot,
      PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')}});
    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
    await configurePresentation(page, mode, {canvasAudio: mode === 'canvas'});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(expected => globalThis.ProjectZeroRendererDirectorInstance?.mode() === expected && globalThis.audioAcceptance, mode);
    assert.equal(await page.evaluate(() => audioAcceptance.mode()), 'media', 'both modes use a real decoded media clock');
    await page.evaluate(() => {
      globalThis.naturalBridgeSeekCount = 0;
      addEventListener('project-zero:test-presentation-elapsed', () => { globalThis.naturalBridgeSeekCount += 1; });
    });
    const read = () => page.evaluate(() => ({time: audioAcceptance.time(), phase: document.body.dataset.phase,
      stage: document.body.dataset.stage, record: ProjectZeroRendererDirectorInstance.lastRenderRecord(), clock: document.querySelector('#clock-readout').textContent}));
    const first = await read();
    await page.waitForFunction(time => audioAcceptance.time() >= time + .35, first.time);
    const advanced = await read();
    assert.ok(advanced.time > first.time + .3);
    assert.notEqual(advanced.clock, first.clock);
    await page.waitForFunction(() => document.body.dataset.stage === 'authorize' && document.querySelector('#progress-value').textContent === '99.2', null, {timeout: 18000});
    const held = await read();
    assert.ok(Math.abs(held.time - 13.3) < .08);
    await page.waitForTimeout(450);
    assert.deepEqual(await read(), held, 'natural playback freezes audio, visual frame and state at the authorization gate');
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
    await page.getByRole('button', {name: /确认驾驶员授权并完成同步/}).click();
    await page.waitForFunction(() => audioAcceptance.time() > 13.65 && document.body.dataset.phase === 'completing');
    const resumed = await read();
    assert.ok(resumed.time > held.time + .3);
    assert.equal(resumed.stage, 'connect');
    await page.locator('#workbench-shell').waitFor({state: 'visible', timeout: 12000});
    await windowMode(page, 'windowed');
    assert.equal(await page.evaluate(() => document.body.dataset.phase), 'complete');
    assert.ok(await page.evaluate(() => audioAcceptance.time() >= 20.49));
    assert.equal(await page.evaluate(() => naturalBridgeSeekCount), 0);
    assert.deepEqual(await page.evaluate(() => audioAcceptance.calls.filter(call => call.name === 'seek')), []);
  } finally { await app?.close(); }
});
