'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const pkg = require('../../package.json');
const {unpackedApplicationDirectory} = require('../../scripts/pack.cjs');
const {
  assertNoSensitiveArchiveContent,
  assertThemeMatchesExpected,
  entries,
  read
} = require('./asar-assertions.cjs');

const projectRoot = path.join(__dirname, '..', '..');

async function packagedExecutable() {
  return path.join(
    unpackedApplicationDirectory(projectRoot),
    `${pkg.build.productName}.app`,
    'Contents',
    'MacOS',
    pkg.build.productName
  );
}

function publicArchive() {
  return path.join(
    unpackedApplicationDirectory(projectRoot),
    `${pkg.build.productName}.app`,
    'Contents',
    'Resources',
    'app.asar'
  );
}

test('public ASAR contains only the tracked PILOT VOIDGLASS product and exact scenes', async () => {
  const archive = publicArchive();
  const archiveEntries = entries(archive);
  const index = read(archive, 'renderer/boot/index.html').toString('utf8');
  const manifests = archiveEntries.filter(entry => /assets\/themes\/.+\/assets\.json$/.test(entry));
  assert.deepEqual(manifests, ['assets/themes/project-zero/assets.json']);
  const packagedManifest = JSON.parse(read(archive, manifests[0]).toString('utf8'));
  const trackedManifestPath = path.join(
    projectRoot,
    'assets',
    'themes',
    'project-zero',
    'assets.json'
  );
  const expectedManifest = JSON.parse(await fs.readFile(trackedManifestPath, 'utf8'));
  const expectedRuntime = new Map();
  const packagedRuntime = new Map();

  assert.match(index, /<title>PROJECT ZERO \/\/ PILOT CODEX WORKBENCH<\/title>/);
  assert.equal(expectedManifest.themeId, 'voidglass-pilot');
  assert.equal(expectedManifest.subject, 'PILOT-00 / VOIDGLASS');
  assert.equal(expectedManifest.assets.length, 3);
  for (const asset of expectedManifest.assets) {
    const runtime = path.posix.normalize(path.posix.join(
      path.posix.dirname(manifests[0]),
      asset.runtime.file
    ));
    expectedRuntime.set(
      asset.runtime.file,
      await fs.readFile(path.resolve(path.dirname(trackedManifestPath), asset.runtime.file))
    );
    packagedRuntime.set(asset.runtime.file, read(archive, runtime));
  }
  assertThemeMatchesExpected({
    expectedManifest,
    packagedManifest,
    expectedRuntime,
    packagedRuntime
  });
  assertNoSensitiveArchiveContent(archive);
});

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
