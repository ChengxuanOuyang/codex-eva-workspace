'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const pkg = require('../../package.json');
const {unpackedApplicationDirectory} = require('../../scripts/pack.cjs');

async function packagedExecutable() {
  const projectRoot = path.join(__dirname, '..', '..');
  return path.join(
    unpackedApplicationDirectory(projectRoot),
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
