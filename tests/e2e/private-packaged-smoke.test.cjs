'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {_electron: electron} = require('playwright');
const pkg = require('../../package.json');
const {packPrivateTheme} = require('../../scripts/pack-private-theme.cjs');
const {unpackedApplicationDirectory} = require('../../scripts/pack.cjs');
const {
  assertNoSensitiveArchiveContent,
  read,
  sha256
} = require('./asar-assertions.cjs');

const projectRoot = path.join(__dirname, '..', '..');
const themeRoot = path.join(__dirname, '..', 'fixtures', 'private-theme-valid');
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

test('synthetic private theme packs independently, preserves public files, and launches', {
  timeout: 120000
}, async () => {
  const before = await trackedHashes();
  const output = await packPrivateTheme({projectRoot, themeRoot});
  const privateApplicationDirectory = unpackedApplicationDirectory(projectRoot, {
    outputDirectory: 'dist-private'
  });
  const publicApplicationDirectory = unpackedApplicationDirectory(projectRoot);
  const application = path.join(privateApplicationDirectory, `${pkg.build.productName}.app`);
  const archive = path.join(application, 'Contents', 'Resources', 'app.asar');
  const fixtureManifest = JSON.parse(await fs.readFile(path.join(themeRoot, 'assets.json'), 'utf8'));

  assert.equal(output, path.join(await fs.realpath(projectRoot), 'dist-private'));
  assert.notEqual(privateApplicationDirectory, publicApplicationDirectory);
  await fs.access(path.join(publicApplicationDirectory, `${pkg.build.productName}.app`));
  for (const asset of fixtureManifest.assets) {
    assert.equal(
      sha256(read(archive, `renderer/boot/assets/${asset.file}`)),
      asset.sha256
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
