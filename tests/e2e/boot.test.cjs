'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const {_electron: electron} = require('playwright');

const execFileAsync = promisify(execFile);

function requestFails(url) {
  return new Promise(resolve => {
    const request = http.get(url, () => resolve(false));
    request.setTimeout(1000, () => request.destroy(Error('request timed out')));
    request.on('error', () => resolve(true));
  });
}

async function processTable() {
  const {stdout} = await execFileAsync('ps', ['-axo', 'pid=,ppid=,command=']);
  return stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match && {pid: Number(match[1]), ppid: Number(match[2]), command: match[3]};
  }).filter(Boolean);
}

function descendants(rows, rootPid) {
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (pids.has(row.ppid) && !pids.has(row.pid)) {
        pids.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter(row => pids.has(row.pid));
}

async function waitForTestPage(app) {
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
  await page.waitForFunction(() =>
    typeof globalThis.ProjectZeroTestBridge?.setPresentationElapsed === 'function'
      && typeof globalThis.ProjectZeroTestBridge?.readWindowMode === 'function'
      && typeof globalThis.ProjectZeroBootCanvasInstance?.lastRenderRecord === 'function');
  return page;
}

async function assertExactReady(page) {
  const readiness = await page.evaluate(async () => {
    const response = await fetch('/health', {cache: 'no-store'});
    const health = await response.json();
    return {ready: health.ready, code: health.code};
  });
  assert.deepEqual(readiness, {ready: true, code: 'READY'});
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

async function assertClockPausedAtGate(page) {
  const before = await page.evaluate(() => ({
    render: globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord(),
    clock: document.querySelector('#clock-readout').textContent
  }));
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    render: globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord(),
    clock: document.querySelector('#clock-readout').textContent
  }));
  assert.deepEqual(after, before);
  assert.equal(after.render.stage, 'authorize');
  assert.equal(after.render.progress, 99.2);
  assert.equal(after.render.activeNodes, 12);
  assert.equal(after.clock, 'T+015.5');
}

async function finishConfirmedPresentation(page) {
  await page.getByRole('button', {name: /确认驾驶员授权并完成同步/}).click();
  await page.waitForFunction(() => document.body.dataset.phase === 'completing');
  await page.evaluate(() => globalThis.ProjectZeroTestBridge.setPresentationElapsed(20500));
  await page.waitForFunction(() => document.body.dataset.phase === 'complete');
  await page.locator('#workbench-shell').waitFor({state: 'visible'});
  await waitForWindowMode(page, 'windowed');
}

test('skip button pauses at 99.2, preserves READY gating, restores window mode and closes cleanly',
  {timeout: 30000}, async () => {
    let app;
    let origin;
    let taskProcessIds = [];
    const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-e2e-'));
    const tracePath = path.join(traceRoot, 'codex-calls.txt');
    const disconnectSignalPath = path.join(traceRoot, 'disconnect.signal');

    try {
      app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PROJECT_ZERO_TEST_DATA_ROOT: path.join(traceRoot, 'data'),
          PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs'),
          PROJECT_ZERO_TEST_TRACE: tracePath,
          PROJECT_ZERO_TEST_DISCONNECT_SIGNAL: disconnectSignalPath
        }
      });
      const page = await waitForTestPage(app);
      await waitForWindowMode(page, 'fullscreen');
      assert.equal(await page.evaluate(() => globalThis.ProjectZeroTestBridge.readWindowMode()), 'fullscreen');

      await page.getByRole('button', {name: /跳过动态演示/}).click();
      await page.waitForFunction(() =>
        globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord()?.stage === 'authorize'
          && globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord()?.progress === 99.2);
      assert.equal(await page.locator('#progress-value').textContent(), '99.2');
      assert.equal(await page.locator('body').getAttribute('data-stage'), 'authorize');
      await assertClockPausedAtGate(page);
      await assertExactReady(page);
      await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
      assert.equal(await page.locator('.pilot-silhouette').count(), 0);
      assert.equal(await page.locator('#boot-sequence').count(), 1);

      const taskProcesses = descendants(await processTable(), app.process().pid);
      taskProcessIds = taskProcesses.map(row => row.pid);
      assert.equal(
        taskProcesses.some(row => /\bcodex\b.*\bapp-server\b/.test(row.command)),
        false,
        'the in-memory bridge must not spawn a Codex child'
      );

      const url = new URL(page.url());
      origin = url.origin;
      assert.equal(url.hostname, '127.0.0.1');
      assert.equal(url.protocol, 'http:');
      const remoteResources = await page.evaluate(() => performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(resource => new URL(resource).origin !== location.origin));
      assert.deepEqual(remoteResources, []);
      await page.evaluate(() => {
        globalThis.__projectZeroSawOnline = document.body.dataset.scene === 'online';
        new MutationObserver(() => {
          if (document.body.dataset.scene === 'online') globalThis.__projectZeroSawOnline = true;
        }).observe(document.body, {attributes: true, attributeFilter: ['data-scene']});
      });

      const confirm = page.getByRole('button', {name: /确认驾驶员授权并完成同步/});
      await confirm.click();
      await page.waitForFunction(() => document.body.dataset.phase === 'completing');
      await fs.writeFile(disconnectSignalPath, 'disconnect');
      await page.waitForFunction(() => document.body.dataset.phase === 'failed', null, {timeout: 2000});
      assert.notEqual(await page.locator('body').getAttribute('data-scene'), 'online');
      assert.equal(await page.evaluate(() => globalThis.__projectZeroSawOnline), false);
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await page.locator('#workbench-shell').isHidden(), true);
      await page.getByText('Codex 连接已断开。请重试建立本地连接。', {exact: true}).waitFor();

      await fs.rm(disconnectSignalPath, {force: true});
      await page.getByRole('button', {name: '重新检查 Codex'}).click();
      await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
      await assertExactReady(page);
      await finishConfirmedPresentation(page);
      assert.equal(await page.evaluate(() => globalThis.ProjectZeroTestBridge.readWindowMode()), 'windowed');
      assert.equal(await page.locator('#boot-screen').isHidden(), true);
      assert.equal(await page.locator('#workbench-shell [data-feature="chat"]').count(), 1);
      await page.getByRole('heading', {name: '核心工作台'}).waitFor();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.workbench-scene')).opacity === '1');

      await fs.writeFile(disconnectSignalPath, 'disconnect-after-shell');
      await page.waitForFunction(() => document.body.dataset.readiness === 'disconnected', null, {timeout: 2000});
      await page.getByText('DISCONNECTED', {exact: true}).waitFor();
      const shellRetry = page.locator('#shell-retry-button');
      await shellRetry.waitFor({state: 'visible'});
      assert.equal(await page.locator('#boot-screen').isHidden(), true);
      assert.equal(await page.locator('#workbench-shell').isVisible(), true);
      assert.equal(await page.locator('body').getAttribute('data-phase'), 'complete');

      await fs.rm(disconnectSignalPath, {force: true});
      await shellRetry.click();
      await page.waitForFunction(() => document.body.dataset.readiness === 'ready');
      await page.getByText('READY', {exact: true}).waitFor();
      assert.equal(await shellRetry.isHidden(), true);
      assert.equal(await page.locator('#workbench-shell').isVisible(), true);
      assert.equal(await page.locator('body').getAttribute('data-phase'), 'complete');
    } finally {
      await app?.close();
    }

    const calls = (await fs.readFile(tracePath, 'utf8')).trim().split('\n');
    assert.ok(calls.filter(call => call === 'configRequirements/read').length >= 2);
    assert.ok(calls.includes('disconnected'));
    await fs.rm(traceRoot, {recursive: true, force: true});

    assert.ok(origin, 'the workbench origin was captured before shutdown');
    assert.equal(await requestFails(`${origin}/health`), true, 'the loopback listener closed with the app');
    const survivingPids = new Set((await processTable()).map(row => row.pid));
    assert.deepEqual(taskProcessIds.filter(pid => survivingPids.has(pid)), [], 'the app left no task child alive');
  });

test('Escape invokes the same paused READY-gated skip path', {timeout: 30000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-escape-e2e-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  let app;

  try {
    app = await electron.launch({
      args: ['.'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PROJECT_ZERO_TEST_DATA_ROOT: path.join(root, 'data'),
        PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')
      }
    });
    const page = await waitForTestPage(app);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() =>
      globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord()?.stage === 'authorize'
        && globalThis.ProjectZeroBootCanvasInstance.lastRenderRecord()?.progress === 99.2);
    assert.equal(await page.locator('#progress-value').textContent(), '99.2');
    await assertClockPausedAtGate(page);
    await assertExactReady(page);
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
    await finishConfirmedPresentation(page);
    assert.equal(await page.evaluate(() => globalThis.ProjectZeroTestBridge.readWindowMode()), 'windowed');
  } finally {
    await app?.close();
  }
});
