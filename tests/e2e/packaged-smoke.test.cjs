'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const pkg = require('../../package.json');

async function packagedExecutable() {
  const dist = path.join(__dirname, '..', '..', 'dist');
  const directories = (await fs.readdir(dist, {withFileTypes: true}))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mac'))
    .map(entry => entry.name)
    .sort();
  assert.ok(directories.length > 0, 'npm run pack must create a mac app directory');
  return path.join(
    dist,
    directories[0],
    `${pkg.build.productName}.app`,
    'Contents',
    'MacOS',
    pkg.build.productName
  );
}

test('packaged app starts from packaged resources with production fake gates closed', {timeout: 30000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-packaged-'));
  const fakeTracePath = path.join(root, 'fake-calls.txt');
  let app;

  try {
    app = await electron.launch({
      executablePath: await packagedExecutable(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PROJECT_ZERO_TEST_TRACE: fakeTracePath,
        PROJECT_ZERO_TEST_BRIDGE_MODULE: path.join(__dirname, '..', 'support', 'fake-codex.cjs')
      }
    });
    const page = await app.firstWindow();
    await page.getByRole('heading', {name: '等待用户确认'}).waitFor();
    await page.waitForFunction(() => !document.querySelector('#confirm-button').disabled);
    assert.match(page.url(), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  } finally {
    await app?.close();
  }

  await assert.rejects(fs.access(fakeTracePath), {code: 'ENOENT'});
  await fs.rm(root, {recursive: true, force: true});
});
