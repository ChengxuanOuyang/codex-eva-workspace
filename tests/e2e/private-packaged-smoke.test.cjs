'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const pkg = require('../../package.json');
const {packPrivateTheme} = require('../../scripts/pack-private-theme.cjs');
const {
  runElectronBuilder,
  unpackedApplicationDirectory
} = require('../../scripts/pack.cjs');
const {
  assertNoSensitiveArchiveContent,
  read,
  sha256
} = require('./asar-assertions.cjs');

const projectRoot = path.join(__dirname, '..', '..');
const themeRoot = path.join(__dirname, '..', 'fixtures', 'private-theme-valid');
const projectEntries = [
  'app', 'assets', 'LICENSE', 'NOTICE.md', 'package.json',
  'renderer', 'THIRD_PARTY_NOTICES.md', 'workbench'
];
const publicFiles = [
  'renderer/boot/index.html',
  'renderer/boot/assets/scene-a-sync.webp',
  'renderer/boot/assets/scene-b-awakening.webp',
  'renderer/boot/assets/scene-c-online.webp',
  'assets/themes/project-zero/assets.json',
  'assets/themes/project-zero/ASSET-LICENSE.md'
];

async function trackedHashes() {
  return Object.fromEntries(await Promise.all(publicFiles.map(async file => [
    file,
    crypto.createHash('sha256').update(await fs.readFile(path.join(projectRoot, file))).digest('hex')
  ])));
}

async function isolatedProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-private-e2e-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const entry of projectEntries) {
    await fs.cp(path.join(projectRoot, entry), path.join(root, entry), {recursive: true});
  }
  return root;
}

test('synthetic private theme packs independently, preserves public files, and launches', {
  timeout: 120000
}, async t => {
  const before = await trackedHashes();
  const temporaryProject = await isolatedProject(t);
  const output = await packPrivateTheme({
    projectRoot: temporaryProject,
    themeRoot,
    runBuilder: runElectronBuilder
  });
  const privateApplicationDirectory = unpackedApplicationDirectory(temporaryProject, {
    outputDirectory: 'dist-private'
  });
  const publicApplicationDirectory = unpackedApplicationDirectory(temporaryProject);
  const application = path.join(privateApplicationDirectory, `${pkg.build.productName}.app`);
  const archive = path.join(application, 'Contents', 'Resources', 'app.asar');
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(themeRoot, 'assets.json'), 'utf8'));

  assert.equal(output, path.join(await fs.realpath(temporaryProject), 'dist-private'));
  assert.notEqual(privateApplicationDirectory, publicApplicationDirectory);
  await assert.rejects(
    fs.access(path.join(publicApplicationDirectory, `${pkg.build.productName}.app`)),
    {code: 'ENOENT'}
  );
  for (const asset of fixtureManifest.assets) {
    const expectedHash = sha256(await fs.readFile(path.join(themeRoot, asset.file)));
    assert.equal(asset.sha256, expectedHash);
    assert.equal(
      sha256(read(archive, `renderer/boot/assets/${asset.file}`)),
      expectedHash
    );
  }
  const index = read(archive, 'renderer/boot/index.html').toString('utf8');
  assert.match(index, /<title>PROJECT ZERO \/\/ TEST PRIVATE THEME<\/title>/);
  assert.deepEqual(await trackedHashes(), before);
  assertNoSensitiveArchiveContent(archive, {allowTestPrivateTitle: true});

  let app;
  try {
    app = await electron.launch({
      executablePath: path.join(
        application,
        'Contents',
        'MacOS',
        pkg.build.productName
      )
    });
    const page = await app.firstWindow();
    await page.getByRole('heading', {name: /TEST PRIVATE THEME/}).waitFor();
    assert.equal(await page.title(), 'PROJECT ZERO // TEST PRIVATE THEME');
  } finally {
    await app?.close();
  }
});
