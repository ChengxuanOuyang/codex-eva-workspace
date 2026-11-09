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
  entries,
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
  const modules = path.join(root, 'node_modules');
  await fs.mkdir(modules);
  for (const dependency of ['node-addon-api', 'node-pty']) {
    const source = path.dirname(require.resolve(`${dependency}/package.json`));
    await fs.cp(source, path.join(modules, dependency), {recursive: true});
  }
  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  packageJson.build.npmRebuild = false;
  await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

test('synthetic private theme packs independently, preserves public files, and launches', {
  timeout: 120000
}, async t => {
  const before = await trackedHashes();
  const temporaryProject = await isolatedProject(t);
  await runElectronBuilder({
    projectRoot: temporaryProject,
    environment: process.env,
    arguments: ['--dir']
  });
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
  const publicApplication = path.join(
    publicApplicationDirectory,
    `${pkg.build.productName}.app`
  );
  const archive = path.join(application, 'Contents', 'Resources', 'app.asar');
  const publicArchive = path.join(publicApplication, 'Contents', 'Resources', 'app.asar');
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(themeRoot, 'assets.json'), 'utf8'));

  assert.equal(output, path.join(await fs.realpath(temporaryProject), 'dist-private'));
  assert.notEqual(privateApplicationDirectory, publicApplicationDirectory);
  await fs.access(publicArchive);
  const privateResources = new Map([
    ['boot-mark.webp', 'renderer/boot/private/boot-mark.webp'],
    ['rei-portrait.webp', 'renderer/boot/private/rei-portrait.webp'],
    ['startup-reference.wav', 'renderer/boot/private/startup-reference.wav']
  ]);
  for (const [fixtureFile, archivePath] of privateResources) {
    const asset = fixtureManifest.assets.find(candidate => candidate.file === fixtureFile);
    const expectedHash = sha256(await fs.readFile(path.join(themeRoot, asset.file)));
    assert.equal(asset.sha256, expectedHash);
    assert.equal(sha256(read(archive, archivePath)), expectedHash);
    assert.equal(entries(publicArchive).includes(archivePath), false);
  }
  const index = read(archive, 'renderer/boot/index.html').toString('utf8');
  const privateConfigText = read(archive, 'renderer/boot/private/theme.json').toString('utf8');
  const privateConfig = JSON.parse(privateConfigText);
  assert.match(index, /<title>PROJECT ZERO \/\/ TEST PRIVATE THEME<\/title>/);
  assert.deepEqual(privateConfig, {
    displayName: 'PROJECT ZERO // TEST PRIVATE THEME',
    mark: '/private/boot-mark.webp',
    portrait: '/private/rei-portrait.webp',
    soundtrack: '/private/startup-reference.wav',
    audioStartMs: 0,
    audioEndMs: 20_500
  });
  assert.equal(privateConfigText.includes(themeRoot), false);
  assert.equal(privateConfigText.includes(temporaryProject), false);
  assert.equal(entries(publicArchive).some(entry => entry.startsWith('renderer/boot/private/')), false);
  assert.deepEqual(await trackedHashes(), before);
  assertNoSensitiveArchiveContent(publicArchive);
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
    await page.locator('#boot-sequence').waitFor();
    assert.equal(await page.title(), 'PROJECT ZERO // TEST PRIVATE THEME');
  } finally {
    await app?.close();
  }
});
