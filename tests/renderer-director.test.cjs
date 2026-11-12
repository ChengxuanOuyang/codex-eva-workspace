'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {sampleTimeline} = require('../renderer/boot/timeline.js');

function createDirector(options) {
  const module = require('../renderer/boot/renderer-director.js');
  return module.createRendererDirector(options);
}

function fixture(preferReference = true) {
  const events = [];
  const referenceLayer = {hidden: true, setAttribute() {}};
  const canvasLayer = {hidden: false, setAttribute() {}};
  const reference = {
    snapshots: [], failRender: false, failResize: false,
    render(snapshot, assets) {
      events.push('reference.render');
      this.snapshots.push(snapshot);
      this.assets = assets;
      if (this.failRender) throw Error('render failed');
    },
    resize(viewport) { events.push('reference.resize'); this.viewport = viewport; if (this.failResize) throw Error('resize failed'); },
    lastRenderRecord() { return {renderer: 'reference'}; },
    destroy() { events.push('reference.destroy'); throw Error('cleanup failed'); }
  };
  const canvas = {
    snapshots: [],
    render(snapshot) {
      events.push('canvas.render');
      this.referenceHiddenWhilePainting = referenceLayer.hidden;
      this.snapshots.push(snapshot);
    },
    resize(viewport) { events.push('canvas.resize'); this.viewport = viewport; },
    lastRenderRecord() { return {renderer: 'canvas'}; },
    destroy() { events.push('canvas.destroy'); }
  };
  const director = createDirector({reference, canvas, preferReference, referenceLayer, canvasLayer});
  return {director, reference, canvas, referenceLayer, canvasLayer, events};
}

test('exports the same director API in CommonJS and CSP-safe browser scripts', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/boot/renderer-director.js'), 'utf8'), context);
  assert.equal(typeof context.ProjectZeroRendererDirector.createRendererDirector, 'function');
});

test('complete private selection renders reference and falls back with the exact frozen snapshot before hiding it', () => {
  const view = fixture();
  const initial = sampleTimeline(5500);
  const next = sampleTimeline(10500);
  const assets = {mark: {}};
  view.director.render(initial, assets);
  assert.equal(view.director.mode(), 'reference');
  assert.equal(view.referenceLayer.hidden, false);
  assert.equal(view.canvasLayer.hidden, true);
  assert.equal(view.reference.assets, assets);
  view.reference.failRender = true;
  view.director.render(next, assets);
  assert.equal(view.director.mode(), 'canvas');
  assert.equal(view.canvas.snapshots.at(-1), next);
  assert.equal(view.reference.snapshots.at(-1), next);
  assert.equal(Object.isFrozen(next), true);
  assert.equal(view.referenceLayer.hidden, true);
  assert.equal(view.canvas.referenceHiddenWhilePainting, false);
  assert.equal(view.canvasLayer.hidden, false);
  assert.deepEqual(view.director.lastRenderRecord(), {renderer: 'canvas'});
});

test('public or unavailable private assets select only Canvas', () => {
  const view = fixture(false);
  view.director.render(sampleTimeline(5500));
  assert.equal(view.director.mode(), 'canvas');
  assert.equal(view.reference.snapshots.length, 0);
  assert.equal(view.canvas.snapshots.length, 1);
});

test('reference resize failure paints the last snapshot without advancing elapsed or active nodes', () => {
  const view = fixture();
  const snapshot = sampleTimeline(10500, {reducedMotion: true});
  view.director.render(snapshot);
  view.reference.failResize = true;
  const viewport = {width: 390, height: 844};
  view.director.resize(viewport);
  assert.equal(view.director.mode(), 'canvas');
  assert.equal(view.canvas.snapshots.at(-1), snapshot);
  assert.equal(view.canvas.snapshots.at(-1).elapsedMs, 10500);
  assert.equal(view.canvas.snapshots.at(-1).activeNodes, snapshot.activeNodes);
  assert.deepEqual(view.canvas.viewport, viewport);
});

test('a successful resize never samples a new timeline frame', () => {
  const view = fixture();
  const snapshot = sampleTimeline(10500);
  view.director.render(snapshot);
  view.director.resize({width: 2560, height: 1600});
  assert.deepEqual(view.reference.snapshots, [snapshot]);
  assert.deepEqual(view.director.lastRenderRecord(), {renderer: 'reference'});
});

test('repeated fallback stays on Canvas and repeated destroy tolerates renderer cleanup failure', () => {
  const view = fixture();
  view.director.render(sampleTimeline(1000));
  view.reference.failRender = true;
  view.director.render(sampleTimeline(5500));
  view.director.render(sampleTimeline(10500));
  view.director.resize({width: 390, height: 844});
  assert.equal(view.reference.snapshots.length, 2);
  assert.equal(view.canvas.snapshots.length, 2);
  view.director.destroy();
  view.director.destroy();
  const count = view.events.length;
  view.director.render(sampleTimeline(13300));
  view.director.resize({width: 100, height: 100});
  assert.equal(view.events.length, count);
  assert.equal(view.events.filter(event => event === 'reference.destroy').length, 1);
  assert.equal(view.events.filter(event => event === 'canvas.destroy').length, 1);
  assert.equal(view.director.lastRenderRecord(), null);
});

test('reentrant destroy during a failed reference render cannot revive Canvas', () => {
  const view = fixture();
  view.reference.render = () => { view.director.destroy(); throw Error('already destroyed'); };
  assert.doesNotThrow(() => view.director.render(sampleTimeline(5500)));
  assert.equal(view.canvas.snapshots.length, 0);
  assert.equal(view.referenceLayer.hidden, true);
});


test('a failed first reference frame falls back without briefly exposing an empty reference layer', () => {
  const view = fixture();
  view.reference.failRender = true;
  const snapshot = sampleTimeline(0);
  view.director.render(snapshot);
  assert.equal(view.director.mode(), 'canvas');
  assert.equal(view.canvas.referenceHiddenWhilePainting, true);
  assert.equal(view.canvas.snapshots.at(-1), snapshot);
});

test('a Canvas frame failure preserves the visible reference until a later successful fallback', () => {
  const view = fixture();
  view.director.render(sampleTimeline(5500));
  view.reference.failRender = true;
  const render = view.canvas.render.bind(view.canvas);
  view.canvas.render = () => { throw Error('Canvas unavailable'); };
  const snapshot = sampleTimeline(10500);
  assert.throws(() => view.director.render(snapshot), /Canvas unavailable/);
  assert.equal(view.referenceLayer.hidden, false);
  assert.equal(view.canvasLayer.hidden, true);
  assert.equal(view.director.mode(), 'reference');
  view.canvas.render = render;
  view.director.render(snapshot);
  assert.equal(view.director.mode(), 'canvas');
  assert.equal(view.reference.snapshots.length, 2);
  assert.equal(view.canvas.snapshots.at(-1), snapshot);
});

function silentWav(durationSeconds) {
  const sampleRate = 8000;
  const dataBytes = durationSeconds * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test('real browser selects both renderers, keeps one accessible control layer and falls back at the same frame',
  {timeout: 30000}, async t => {
    const path = require('node:path');
    const {chromium} = require('playwright');
    const {createWorkbenchService} = require('../workbench/service.cjs');
    const rendererRoot = path.join(__dirname, '..', 'renderer');
    const service = createWorkbenchService({snapshot: () => ({ready: true, code: 'READY'}),
      bootRoot: path.join(rendererRoot, 'boot'), sharedRoot: path.join(rendererRoot, 'shared')});
    const address = await service.listen();
    let browser;
    t.after(async () => { await browser?.close(); await service.close(); });
    browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
    const page = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'});
    let privateAvailable = true;
    let markDecodes = true;
    await page.route('**/private/theme.json', route => route.fulfill(privateAvailable ? {
      json: {displayName: 'TEST PRIVATE', mark: '/private/boot-mark.webp', portrait: '/private/rei-portrait.webp',
        soundtrack: '/private/startup-reference.wav', audioStartMs: 0, audioEndMs: 20500}
    } : {status: 404, body: ''}));
    await page.route('**/private/startup-reference.wav', route => route.fulfill({body: silentWav(20.5), contentType: 'audio/wav'}));
    await page.route('**/private/boot-mark.webp', route => route.fulfill(markDecodes ? {
      path: path.join(rendererRoot, 'boot', 'assets', 'scene-a-sync.webp'), contentType: 'image/webp'
    } : {body: 'undecodable', contentType: 'image/webp'}));
    const directorSource = fs.readFileSync(require.resolve('../renderer/boot/renderer-director.js'), 'utf8');
    await page.route('**/renderer-director.js', route => route.fulfill({contentType: 'text/javascript', body: directorSource + `
      const referenceFactory = ProjectZeroReferenceRenderer.createReferenceRenderer;
      globalThis.ProjectZeroReferenceRenderer = {createReferenceRenderer(...args) {
        const renderer = referenceFactory(...args);
        return {...renderer, render(snapshot, assets) {
          globalThis.referenceSnapshot = snapshot;
          if (globalThis.failReferenceRender) throw Error('test render failure');
          return renderer.render(snapshot, assets);
        }, resize(viewport) {
          if (globalThis.failReferenceResize) throw Error('test resize failure');
          return renderer.resize(viewport);
        }};
      }};
      const canvas = ProjectZeroBootCanvasInstance;
      globalThis.ProjectZeroBootCanvasInstance = {...canvas, render(snapshot) {
        globalThis.canvasPaintReferenceHidden = document.querySelector('#reference-sequence').hidden;
        return canvas.render(snapshot);
      }};
    `}));
    await page.addInitScript(() => {
      globalThis.ProjectZeroTestBridge = {
        readWindowMode: () => 'fullscreen',
        setPresentationElapsed(elapsedMs) {
          document.documentElement.setAttribute('data-project-zero-test-presentation-elapsed', elapsedMs);
          dispatchEvent(new Event('project-zero:test-presentation-elapsed'));
        }
      };
    });
    const url = `http://127.0.0.1:${address.port}/`;
    await page.goto(url, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => ProjectZeroRendererDirectorInstance?.mode() === 'reference');
    await page.evaluate(() => ProjectZeroTestBridge.setPresentationElapsed(10500));
    const reference = await page.evaluate(() => {
      const layer = document.querySelector('#reference-sequence');
      const record = ProjectZeroRendererDirectorInstance.lastRenderRecord();
      return {mode: ProjectZeroRendererDirectorInstance.mode(), record,
        referenceDisplay: getComputedStyle(layer).display,
        canvasDisplay: getComputedStyle(document.querySelector('#boot-sequence')).display,
        layerSemantics: ['#boot-sequence', '#reference-sequence'].map(selector => document.querySelector(selector).getAttribute('aria-hidden')),
        progressbars: document.querySelectorAll('[role=progressbar]').length,
        live: document.querySelectorAll('#boot-live-status').length,
        controls: ['#pilot-authorization', '#skip-button', '#retry-button'].map(selector => document.querySelectorAll(selector).length),
        layerControls: layer.querySelectorAll('button, [role=progressbar], [aria-live]').length,
        fadeMs: getComputedStyle(layer).transitionDuration.split(',').map(value => parseFloat(value) * 1000),
        elapsedMs: referenceSnapshot.elapsedMs};
    });
    assert.equal(reference.mode, 'reference');
    assert.equal(reference.canvasDisplay, 'none');
    assert.notEqual(reference.referenceDisplay, 'none');
    assert.deepEqual(reference.layerSemantics, ['true', 'true']);
    assert.equal(reference.progressbars, 1);
    assert.equal(reference.live, 1);
    assert.deepEqual(reference.controls, [1, 1, 1]);
    assert.equal(reference.layerControls, 0);
    assert.ok(reference.fadeMs.every(value => value <= 180));
    assert.equal(reference.record.flashVisible, false);
    assert.equal(reference.record.reducedMotion, true);
    assert.equal(reference.elapsedMs, 10500);
    assert.equal(await page.locator('#progress-value').textContent(), '29.0');
    assert.equal(await page.locator('#ring-progress').getAttribute('aria-valuenow'), '29.0');
    await page.setViewportSize({width: 390, height: 844});
    const resized = await page.evaluate(() => ({elapsedMs: referenceSnapshot.elapsedMs,
      activeNodes: ProjectZeroRendererDirectorInstance.lastRenderRecord().activeNodes}));
    assert.equal(resized.elapsedMs, reference.elapsedMs);
    assert.equal(resized.activeNodes, reference.record.activeNodes);
    const fallback = await page.evaluate(() => {
      globalThis.failReferenceRender = true;
      ProjectZeroTestBridge.setPresentationElapsed(10500);
      return {mode: ProjectZeroRendererDirectorInstance.mode(),
        sameSnapshot: ProjectZeroBootCanvasInstance.lastSnapshot() === referenceSnapshot,
        frozen: Object.isFrozen(referenceSnapshot), hiddenDuringPaint: canvasPaintReferenceHidden,
        referenceHidden: document.querySelector('#reference-sequence').hidden,
        canvasDisplay: getComputedStyle(document.querySelector('#boot-sequence')).display,
        record: ProjectZeroRendererDirectorInstance.lastRenderRecord()};
    });
    assert.equal(fallback.mode, 'canvas');
    assert.equal(fallback.sameSnapshot, true);
    assert.equal(fallback.frozen, true);
    assert.equal(fallback.hiddenDuringPaint, false);
    assert.equal(fallback.referenceHidden, true);
    assert.notEqual(fallback.canvasDisplay, 'none');
    assert.equal(fallback.record.activeNodes, 12);
    assert.equal(fallback.record.reducedMotion, true);
    const resizePaints = await page.evaluate(() => {
      const before = ProjectZeroBootCanvasInstance.lastRenderRecord().renderCount;
      dispatchEvent(new Event('resize'));
      return ProjectZeroBootCanvasInstance.lastRenderRecord().renderCount - before;
    });
    assert.equal(resizePaints, 1, 'the director is the sole resize owner after selection');
    await page.reload({waitUntil: 'networkidle'});
    await page.waitForFunction(() => globalThis.ProjectZeroRendererDirectorInstance?.mode() === 'reference');
    await page.evaluate(() => {
      ProjectZeroTestBridge.setPresentationElapsed(10500);
      globalThis.failReferenceResize = true;
    });
    await page.setViewportSize({width: 1440, height: 900});
    await page.waitForFunction(() => ProjectZeroRendererDirectorInstance.mode() === 'canvas');
    assert.deepEqual(await page.evaluate(() => ({
      sameSnapshot: ProjectZeroBootCanvasInstance.lastSnapshot() === referenceSnapshot,
      elapsedMs: ProjectZeroBootCanvasInstance.lastSnapshot().elapsedMs,
      activeNodes: ProjectZeroRendererDirectorInstance.lastRenderRecord().activeNodes,
      referenceHidden: document.querySelector('#reference-sequence').hidden,
      hiddenDuringPaint: canvasPaintReferenceHidden
    })), {sameSnapshot: true, elapsedMs: 10500, activeNodes: 12,
      referenceHidden: true, hiddenDuringPaint: false});
    for (const scenario of ['missing private', 'undecodable mark']) {
      privateAvailable = scenario !== 'missing private';
      markDecodes = scenario !== 'undecodable mark';
      await page.reload({waitUntil: 'networkidle'});
      await page.waitForFunction(() => globalThis.ProjectZeroRendererDirectorInstance);
      assert.equal(await page.evaluate(() => ProjectZeroRendererDirectorInstance.mode()), 'canvas', scenario);
      assert.equal(await page.evaluate(() => document.querySelector('#reference-sequence').hidden), true, scenario);
    }
  });

test('a repeated resize fallback attempts Canvas only once when it cannot paint', () => {
  const view = fixture();
  view.director.render(sampleTimeline(5500));
  view.reference.failResize = true;
  let attempts = 0;
  view.canvas.render = () => { attempts += 1; throw Error('Canvas unavailable'); };
  assert.throws(() => view.director.resize({width: 390, height: 844}), /Canvas unavailable/);
  assert.equal(attempts, 1);
  assert.throws(() => view.director.resize({width: 1440, height: 900}), /Canvas unavailable/);
  assert.equal(attempts, 2);
  assert.equal(view.referenceLayer.hidden, false);
});
