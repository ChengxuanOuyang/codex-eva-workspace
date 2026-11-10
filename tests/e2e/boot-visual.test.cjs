'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');

const KEYFRAMES = Object.freeze([
  Object.freeze({elapsedMs: 0, stage: 'wake', progress: 0, activeNodes: 0,
    scan: {drawn: false, position: null, top: null}, headingText: 'SYSTEM WAKE', mark: 'fallback'}),
  Object.freeze({elapsedMs: 1500, stage: 'wake', progress: 0, activeNodes: 0,
    scan: {drawn: false, position: null, top: null}, headingText: 'SYSTEM WAKE', mark: 'fallback'}),
  Object.freeze({elapsedMs: 3500, stage: 'scan', progress: 0, activeNodes: 0,
    scan: {drawn: true, position: 1, top: 210}, headingText: 'SYSTEM CHECK', mark: 'fallback'}),
  Object.freeze({elapsedMs: 5500, stage: 'scan', progress: 0, activeNodes: 0,
    scan: {drawn: true, position: 1, top: 210}, headingText: 'SYSTEM CHECK', mark: 'fallback'}),
  Object.freeze({elapsedMs: 8500, stage: 'synchronize', progress: 99.2, activeNodes: 12,
    scan: {drawn: false, position: null, top: null}, headingText: 'SYNCHRONIZATION', mark: 'not-drawn'}),
  Object.freeze({elapsedMs: 10500, stage: 'synchronize', progress: 99.2, activeNodes: 12,
    scan: {drawn: false, position: null, top: null}, headingText: 'SYNCHRONIZATION', mark: 'not-drawn'}),
  Object.freeze({elapsedMs: 12500, stage: 'synchronize', progress: 99.2, activeNodes: 12,
    scan: {drawn: false, position: null, top: null}, headingText: 'SYNCHRONIZATION', mark: 'not-drawn'}),
  Object.freeze({elapsedMs: 15500, stage: 'authorize', progress: 99.2, activeNodes: 12,
    scan: {drawn: false, position: null, top: null}, headingText: 'PILOT AUTHORIZATION', mark: 'not-drawn'})
]);
const ICONS = Object.freeze(['core', 'core', 'link', 'link', 'data', 'data',
  'shield', 'shield', 'render', 'render', 'pilot', 'pilot']);
const VIEWPORTS = Object.freeze([
  Object.freeze({width: 1440, height: 900}),
  Object.freeze({width: 1280, height: 800})
]);

function expectedIconStates(activeNodes) {
  return ICONS.map((icon, index) => `${icon}:${index < activeNodes ? 'active' : 'idle'}`);
}

async function pngSize(file) {
  const header = await fs.readFile(file);
  assert.equal(header.subarray(1, 4).toString('ascii'), 'PNG');
  return {width: header.readUInt32BE(16), height: header.readUInt32BE(20)};
}

async function setPresentationElapsed(page, elapsedMs) {
  const renderCount = await page.evaluate(() =>
    globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord().renderCount);
  await page.evaluate(value => globalThis.ProjectZeroTestBridge.setPresentationElapsed(value), elapsedMs);
  await page.waitForFunction(previousCount =>
    globalThis.ProjectZeroBootCanvasInstance?.lastRenderRecord?.()?.renderCount > previousCount,
  renderCount);
}

async function readWindowMode(page) {
  return page.evaluate(() => globalThis.ProjectZeroTestBridge.readWindowMode());
}

async function waitForWindowMode(page, expected) {
  await page.evaluate(async mode => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (await globalThis.ProjectZeroTestBridge.readWindowMode() === mode) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Window did not enter ${mode} mode`);
  }, expected);
}

test('deterministic reduced-motion keyframes render at both acceptance viewports and complete fullscreen playback',
  {timeout: 60000}, async t => {
    const captureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-boot-frames-'));
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-boot-data-'));
    t.after(() => Promise.all([
      fs.rm(captureRoot, {recursive: true, force: true}),
      fs.rm(dataRoot, {recursive: true, force: true})
    ]));
    let app;

    try {
      app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PROJECT_ZERO_TEST_DATA_ROOT: dataRoot,
          PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')
        }
      });
      let page = await app.firstWindow();
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
      await page.waitForFunction(() => document.body?.dataset?.stage === 'wake');
      assert.deepEqual(
        await page.evaluate(() => [
          typeof globalThis.ProjectZeroTestBridge?.setPresentationElapsed,
          typeof globalThis.ProjectZeroTestBridge?.readWindowMode
        ]),
        ['function', 'function'],
        'unpackaged NODE_ENV=test must install the narrow presentation test bridge'
      );
      await page.emulateMedia({reducedMotion: 'reduce'});
      await page.reload({waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() =>
        typeof globalThis.ProjectZeroTestBridge?.setPresentationElapsed === 'function'
          && typeof globalThis.ProjectZeroTestBridge?.readWindowMode === 'function'
          && typeof globalThis.ProjectZeroBootCanvasInstance?.lastRenderRecord === 'function');
      await waitForWindowMode(page, 'fullscreen');
      assert.equal(await readWindowMode(page), 'fullscreen');

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(({width, height}) =>
          innerWidth === width && innerHeight === height, viewport);

        for (const expected of KEYFRAMES) {
          await setPresentationElapsed(page, expected.elapsedMs);
          const actual = await page.evaluate(() => {
            const snapshot = globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord();
            return {
              stage: snapshot.stage,
              domStage: document.body.dataset.stage,
              progress: snapshot.progress,
              progressDrawn: snapshot.progressDrawn,
              progressText: document.querySelector('#progress-value').textContent,
              activeNodes: snapshot.activeNodes,
              scan: snapshot.scan,
              iconStates: [...snapshot.iconStates],
              headingKey: snapshot.headingKey,
              headingText: snapshot.headingText,
              mark: snapshot.mark,
              reducedMotion: snapshot.reducedMotion
            };
          });
          assert.deepEqual(actual, {
            stage: expected.stage,
            domStage: expected.stage,
            progress: expected.progress,
            progressDrawn: ['synchronize', 'authorize'].includes(expected.stage),
            progressText: expected.progress.toFixed(1),
            activeNodes: expected.activeNodes,
            scan: expected.scan,
            iconStates: expectedIconStates(expected.activeNodes),
            headingKey: `boot.${expected.stage}.heading`,
            headingText: expected.headingText,
            mark: expected.mark,
            reducedMotion: true
          });

          const layout = await page.evaluate(() => ({
            innerWidth,
            innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight
          }));
          assert.equal(layout.scrollWidth, layout.innerWidth);
          assert.equal(layout.scrollHeight, layout.innerHeight);

          const capture = path.join(
            captureRoot,
            `${viewport.width}x${viewport.height}-${String(expected.elapsedMs).padStart(5, '0')}.png`
          );
          await page.screenshot({path: capture});
          assert.deepEqual(await pngSize(capture), viewport);
        }
      }

      const remoteResources = await page.evaluate(() => {
        const localOrigin = location.origin;
        return performance.getEntriesByType('resource')
          .map(entry => entry.name)
          .filter(url => new URL(url).origin !== localOrigin);
      });
      assert.deepEqual(remoteResources, []);

      await app.close();
      app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PROJECT_ZERO_TEST_DATA_ROOT: dataRoot,
          PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')
        }
      });
      page = await app.firstWindow();
      await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
      await page.waitForFunction(() =>
        typeof globalThis.ProjectZeroTestBridge?.setPresentationElapsed === 'function'
          && typeof globalThis.ProjectZeroBootCanvasInstance?.lastRenderRecord === 'function');
      await waitForWindowMode(page, 'fullscreen');
      assert.equal(await readWindowMode(page), 'fullscreen');
      for (const keyframe of KEYFRAMES) {
        await setPresentationElapsed(page, keyframe.elapsedMs);
      }

      const readiness = await page.evaluate(async () => {
        const response = await fetch('/health', {cache: 'no-store'});
        const health = await response.json();
        return {ready: health.ready, code: health.code};
      });
      assert.deepEqual(readiness, {ready: true, code: 'READY'});
      await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
      await page.getByRole('button', {name: /确认驾驶员授权并完成同步/}).click();
      await page.waitForFunction(() => document.body.dataset.phase === 'completing');
      await setPresentationElapsed(page, 20500);
      await page.waitForFunction(() => document.body.dataset.phase === 'complete');
      await page.locator('#workbench-shell').waitFor({state: 'visible'});
      await waitForWindowMode(page, 'windowed');
      assert.equal(await readWindowMode(page), 'windowed');
    } finally {
      await app?.close();
    }
  });
