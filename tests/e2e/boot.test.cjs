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

test('application reaches user confirmation without remote content and closes cleanly', {timeout: 30000}, async () => {
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
        PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs'),
        PROJECT_ZERO_TEST_TRACE: tracePath,
        PROJECT_ZERO_TEST_DISCONNECT_SIGNAL: disconnectSignalPath
      }
    });
    const page = await app.firstWindow();
    const confirm = page.getByRole('button', {name: '确认并完成同步'});

    await page.waitForFunction(() => document.body.dataset.scene === 'awakening');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-awakening')).opacity === '1');
    await page.waitForFunction(() => document.body.dataset.scene === 'sync');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.scene-sync')).opacity === '1');

    await page.getByRole('button', {name: /跳过动态演示/}).click();
    await page.getByText('99.2', {exact: true}).waitFor({timeout: 1000});
    await page.getByRole('heading', {name: '等待用户确认'}).waitFor();
    await assert.doesNotReject(confirm.waitFor({state: 'visible'}));
    await assert.doesNotReject(page.getByText('99.2', {exact: true}).waitFor());
    await assert.doesNotReject(confirm.waitFor({state: 'attached'}));
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);

    assert.equal(await page.locator('.pilot-silhouette').count(), 0);
    assert.equal(await page.locator('.scene-art[aria-hidden="true"]').count(), 3);
    assert.equal(await page.getByRole('img', {name: 'PROJECT ZERO 00 原创系统徽记'}).count(), 1);

    const taskProcesses = descendants(await processTable(), app.process().pid);
    taskProcessIds = taskProcesses.map(row => row.pid);
    assert.equal(
      taskProcesses.some(row => /\bcodex\b.*\bapp-server\b/.test(row.command)),
      false,
      'the in-memory bridge must not spawn a Codex child'
    );

    const url = new URL(page.url());
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.protocol, 'http:');
    origin = url.origin;

    assert.equal(await page.locator('script[src^="http"]').count(), 0);
    assert.equal(await page.locator('link[rel="stylesheet"][href^="http"]').count(), 0);
    const resourceUrls = await page.evaluate(() =>
      performance.getEntriesByType('resource').map(entry => entry.name)
    );
    for (const resourceUrl of resourceUrls) {
      assert.equal(new URL(resourceUrl).origin, origin, `remote resource loaded: ${resourceUrl}`);
    }

    await page.evaluate(() => {
      globalThis.__projectZeroSawOnline = document.body.dataset.scene === 'online';
      new MutationObserver(() => {
        if (document.body.dataset.scene === 'online') globalThis.__projectZeroSawOnline = true;
      }).observe(document.body, {attributes: true, attributeFilter: ['data-scene']});
    });
    await confirm.click();
    await page.waitForFunction(() => document.body.dataset.phase === 'completing');
    await fs.writeFile(disconnectSignalPath, 'disconnect');
    await page.waitForFunction(() => document.body.dataset.phase === 'failed', null, {timeout: 2000});
    assert.notEqual(await page.locator('body').getAttribute('data-scene'), 'online');
    assert.equal(await page.evaluate(() => globalThis.__projectZeroSawOnline), false);
    assert.equal(await confirm.isDisabled(), true);
    await page.getByText('Codex 连接已断开。请重试建立本地连接。', {exact: true}).waitFor();

    await fs.rm(disconnectSignalPath, {force: true});
    await page.getByRole('button', {name: '重新检查 Codex'}).click();
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);

    await confirm.click();
    await page.waitForFunction(() => document.body.dataset.phase === 'complete');
    await page.waitForFunction(() => document.body.dataset.scene === 'online');
    await page.locator('#workbench-shell').waitFor({state: 'visible'});
    await page.getByRole('heading', {name: '核心工作台将在阶段 2 启用'}).waitFor();
    assert.equal(await page.locator('#boot-screen').isHidden(), true);
    assert.equal(await page.getByRole('button', {name: '确认并完成同步'}).count(), 0);
    assert.equal(await page.getByRole('button', {name: /跳过动态演示/}).count(), 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.workbench-scene')).opacity === '1');
    assert.equal(await page.locator('#workbench-shell [data-feature="chat"]').count(), 0);
  } finally {
    await app?.close();
  }

  const calls = (await fs.readFile(tracePath, 'utf8')).trim().split('\n');
  assert.deepEqual(calls, ['account/read', 'model/list', 'disconnected', 'account/read', 'model/list']);
  await fs.rm(traceRoot, {recursive: true, force: true});

  assert.ok(origin, 'the workbench origin was captured before shutdown');
  assert.equal(await requestFails(`${origin}/health`), true, 'the loopback listener closed with the app');
  const survivingPids = new Set((await processTable()).map(row => row.pid));
  assert.deepEqual(taskProcessIds.filter(pid => survivingPids.has(pid)), [], 'the app left no task child alive');
});
