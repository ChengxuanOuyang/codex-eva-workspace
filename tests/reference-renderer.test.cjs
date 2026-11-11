'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const {chromium} = require('playwright');
const {createReferenceRenderer} = require('../renderer/boot/reference-renderer.js');
const {createWorkbenchService} = require('../workbench/service.cjs');

test('renderer exports a CSP-safe browser UMD API', () => {
  assert.equal(typeof createReferenceRenderer, 'function');
  const context = vm.createContext({globalThis: {ProjectZeroReferenceLayout: require('../renderer/boot/reference-layout.js')}});
  const source = fs.readFileSync(require.resolve('../renderer/boot/reference-renderer.js'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(typeof context.globalThis.ProjectZeroReferenceRenderer.createReferenceRenderer, 'function');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new Function|setInterval|requestAnimationFrame/);
});

test('real Chromium DOM renders computed records and keeps the canvas fallback intact', {timeout: 30000}, async t => {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  const service = createWorkbenchService({snapshot: () => ({ready: true, code: 'READY'}),
    bootRoot: path.join(rendererRoot, 'boot'), sharedRoot: path.join(rendererRoot, 'shared')});
  const address = await service.listen();
  let browser;
  t.after(async () => { await browser?.close(); await service.close(); });
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  // Task 3 tests the rendering surface independently of the existing director.
  await page.route('**/boot.js', route => route.fulfill({body: '', contentType: 'text/javascript'}));
  await page.goto(`http://127.0.0.1:${address.port}/`, {waitUntil: 'networkidle'});
  await page.evaluate(() => {
    const root = document.querySelector('#reference-sequence');
    globalThis.referenceTestRenderer = ProjectZeroReferenceRenderer.createReferenceRenderer(root, {exposeRenderRecord: true});
  });

  await t.test('reference layer starts hidden and does not replace or hide the canvas', async () => {
    assert.deepEqual(await page.evaluate(() => ({
      hidden: document.querySelector('#reference-sequence').hidden,
      ariaHidden: document.querySelector('#reference-sequence').getAttribute('aria-hidden'),
      canvasVisible: getComputedStyle(document.querySelector('#boot-sequence')).display !== 'none',
      record: referenceTestRenderer.lastRenderRecord()
    })), {hidden: true, ariaHidden: 'true', canvasVisible: true, record: null});
  });

  await page.evaluate(() => {
    const root = document.querySelector('#reference-sequence');
    root.hidden = false;
    referenceTestRenderer.render(ProjectZeroReferenceLayout.referenceFrame(ProjectZeroTimeline.sampleTimeline(13300)));
  });

  await t.test('render record comes from computed DOM styles and visible nodes', async () => {
    const record = await page.evaluate(() => referenceTestRenderer.lastRenderRecord());
    assert.equal(record.visibleNodeCount, 12);
    assert.equal(record.activeNodeCount, 12);
    assert.equal(record.metricText, '99.2%');
    assert.equal(record.scanVisible, false);
    assert.equal(record.computed.backgroundColor, 'rgb(237, 246, 250)');
    assert.match(record.computed.titleFontFamily, /Unit02 Mincho/);
    assert.equal(record.header.unit, 'EVANGELION-00');
    assert.equal(record.header.pilot, '零号机');
    assert.equal(record.headingText, 'PILOT AUTHORIZATION');
    assert.equal(record.ringDegrees, 357.12);
    assert.deepEqual(await page.evaluate(() => ({
      guide: getComputedStyle(document.querySelector('.reference-ring-guide')).stroke,
      nodeFill: getComputedStyle(document.querySelector('.reference-node-hex')).fill
    })), {guide: 'rgb(167, 208, 216)', nodeFill: 'rgb(167, 208, 216)'});
    assert.deepEqual(record.nodeLabels, Array.from({length: 12}, (_, i) => i % 2 ? 'EMERGENCY' : 'WARNING'));
    const fontLoaded = await page.evaluate(async () => {
      await document.fonts.load('900 40px "Unit02 Mincho"');
      return document.fonts.check('900 40px "Unit02 Mincho"');
    });
    assert.equal(fontLoaded, true);
  });

  await t.test('spoofed timeline metadata cannot change actual DOM output', async () => {
    assert.deepEqual(await page.evaluate(() => {
      const before = referenceTestRenderer.lastRenderRecord();
      referenceTestRenderer.render({...ProjectZeroTimeline.sampleTimeline(13300), headingKey: '<img src=x>',
        iconStates: ['evil:active'], markUrl: 'https://invalid.example', center: {title: 'fake'}});
      const after = referenceTestRenderer.lastRenderRecord();
      return [before.headingText, after.headingText, document.querySelectorAll('#reference-sequence img').length,
        after.iconStates.some(icon => icon.startsWith('evil'))];
    }), ['PILOT AUTHORIZATION', 'PILOT AUTHORIZATION', 0, false]);
  });

  await t.test('records observe actual DOM visibility and computed CSS rather than cached input', async () => {
    const record = await page.evaluate(() => {
      document.querySelector('.reference-node').hidden = true;
      document.querySelector('.reference-metric').textContent = 'DOM VALUE';
      document.querySelector('#reference-sequence').style.backgroundColor = 'rgb(1, 2, 3)';
      return referenceTestRenderer.lastRenderRecord();
    });
    assert.equal(record.visibleNodeCount, 11);
    assert.equal(record.activeNodeCount, 11);
    assert.equal(record.metricText, 'DOM VALUE');
    assert.equal(record.computed.backgroundColor, 'rgb(1, 2, 3)');
    await page.evaluate(() => {
      document.querySelector('#reference-sequence').style.removeProperty('background-color');
      referenceTestRenderer.render(ProjectZeroTimeline.sampleTimeline(13300));
    });
  });

  await t.test('scan height, cue, flash and completion title follow real DOM branches', async () => {
    const frames = await page.evaluate(() => [5500, 10500, 14800, 20500].map(time => {
      referenceTestRenderer.render(ProjectZeroTimeline.sampleTimeline(time, {authorized: time > 13300}));
      return referenceTestRenderer.lastRenderRecord();
    }));
    assert.equal(frames[0].scanVisible, true);
    assert.ok(frames[0].scanHeight > 0 && frames[0].scanHeight < 1080);
    assert.equal(frames[0].cue.zh, 'LCL 循环注入');
    assert.equal(frames[1].activeNodeCount, 4);
    assert.equal(frames[1].scanVisible, false);
    assert.equal(frames[2].flashVisible, true);
    assert.equal(frames[3].flashVisible, false);
    assert.equal(frames[3].headingText, 'SYSTEM ONLINE');
    assert.equal(frames[3].metricText, '');
  });

  await t.test('responsive scale centers the fixed logical surface without overflow or resetting the frame', async () => {
    for (const viewport of [{width: 1440, height: 900}, {width: 2560, height: 1600}, {width: 390, height: 844}]) {
      await page.setViewportSize(viewport);
      const size = await page.evaluate(view => {
        referenceTestRenderer.resize(view);
        const rect = document.querySelector('#reference-sequence').getBoundingClientRect();
        return {width: rect.width, height: rect.height, x: rect.x, y: rect.y,
          heading: document.querySelector('.reference-heading').textContent};
      }, viewport);
      const scale = Math.min(viewport.width / 1920, viewport.height / 1080);
      assert.ok(Math.abs(size.width - 1920 * scale) < 0.01);
      assert.ok(Math.abs(size.height - 1080 * scale) < 0.01);
      assert.ok(Math.abs(size.x - (viewport.width - size.width) / 2) < 0.01);
      assert.ok(Math.abs(size.y - (viewport.height - size.height) / 2) < 0.01);
      assert.equal(size.heading, 'SYSTEM ONLINE');
    }
  });

  await t.test('only the decoded fixed private image is accepted as a mark; arbitrary URLs are ignored', async () => {
    await page.route('**/private/boot-mark.webp', route => route.fulfill({
      path: path.join(rendererRoot, 'boot', 'assets', 'scene-a-sync.webp'), contentType: 'image/webp'
    }));
    const result = await page.evaluate(async () => {
      const snapshot = ProjectZeroTimeline.sampleTimeline(1500);
      referenceTestRenderer.render(snapshot, {mark: {src: '/private/boot-mark.webp', complete: true, naturalWidth: 64}});
      const rejected = referenceTestRenderer.lastRenderRecord().mark;
      const original = document.createElement('img');
      original.src = '/assets/scene-a-sync.webp';
      await original.decode();
      referenceTestRenderer.render(snapshot, {mark: original});
      const wrongPath = referenceTestRenderer.lastRenderRecord().mark;
      const mark = document.createElement('img');
      mark.src = '/private/boot-mark.webp';
      await mark.decode();
      referenceTestRenderer.render(snapshot, {mark});
      return [rejected, wrongPath, referenceTestRenderer.lastRenderRecord().mark,
        document.querySelectorAll('.reference-mark img').length,
        document.querySelector('.reference-mark img').getAttribute('src')];
    });
    assert.deepEqual(result, ['fallback', 'fallback', 'private', 1, '/private/boot-mark.webp']);
  });

  await t.test('reduced motion suppresses flashes, production records stay private, and destroy removes owned DOM', async () => {
    const result = await page.evaluate(() => {
      referenceTestRenderer.render(ProjectZeroTimeline.sampleTimeline(14800, {authorized: true, reducedMotion: true}));
      const reduced = referenceTestRenderer.lastRenderRecord();
      referenceTestRenderer.destroy();
      const root = document.querySelector('#reference-sequence');
      const emptyChildren = root.querySelectorAll('.reference-node').length;
      const production = ProjectZeroReferenceRenderer.createReferenceRenderer(root);
      root.hidden = false;
      production.render(ProjectZeroTimeline.sampleTimeline(13300));
      const hiddenRecord = production.lastRenderRecord();
      production.destroy();
      return {flash: reduced.flashVisible, reduced: reduced.reducedMotion, hiddenRecord, emptyChildren,
        hidden: root.hidden, disposedRecord: referenceTestRenderer.lastRenderRecord()};
    });
    assert.deepEqual(result, {flash: false, reduced: true, hiddenRecord: null, emptyChildren: 0, hidden: true, disposedRecord: null});
  });
});
