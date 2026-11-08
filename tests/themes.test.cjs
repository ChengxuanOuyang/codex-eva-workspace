'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {ThemeManager} = require('../workbench/themes.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-themes-'));
  const installRoot = path.join(root, 'data');
  const packRoot = path.join(root, 'pack');
  await fs.mkdir(packRoot);
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return {manager: new ThemeManager({dataRoot: installRoot}), packRoot};
}

async function writePack(packRoot, overrides = {}) {
  const manifest = {
    schemaVersion: 1,
    id: 'private-blue',
    name: 'Private Blue',
    author: 'Local Pilot',
    colors: {accent: '#55a5b8', surface: '#edf6f7'},
    background: 'background.png',
    portrait: null,
    audio: null,
    ...overrides
  };
  await fs.writeFile(path.join(packRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  await fs.writeFile(path.join(packRoot, 'background.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  return manifest;
}

test('theme import installs only declared local assets', async t => {
  const {manager, packRoot} = await fixture(t);
  await writePack(packRoot);
  const installed = await manager.importPack(packRoot);
  assert.equal(installed.id, 'private-blue');
  const themes = await manager.list();
  assert.equal(themes.length, 1);
  assert.equal(themes[0].background, true);
  assert.equal(themes[0].portrait, false);
  assert.deepEqual(await manager.readAsset('private-blue', 'background'), {
    bytes: Buffer.from('89504e470d0a1a0a', 'hex'), mime: 'image/png'
  });
  assert.equal(await fs.readFile(path.join(installed.path, 'background.png'), 'hex'), '89504e470d0a1a0a');
});

test('theme import rejects traversal, scripts and undeclared files', async t => {
  const {manager, packRoot} = await fixture(t);
  await writePack(packRoot, {background: '../outside.png'});
  await assert.rejects(manager.importPack(packRoot), /path/);

  const second = await fixture(t);
  await writePack(second.packRoot, {background: 'theme.svg'});
  await fs.writeFile(path.join(second.packRoot, 'theme.svg'), '<svg/>');
  await assert.rejects(second.manager.importPack(second.packRoot), /type/);

  const third = await fixture(t);
  await writePack(third.packRoot, {script: 'theme.js'});
  await fs.writeFile(path.join(third.packRoot, 'theme.js'), 'alert(1)');
  await assert.rejects(third.manager.importPack(third.packRoot), /schema/);

  const fourth = await fixture(t);
  await writePack(fourth.packRoot);
  await fs.writeFile(path.join(fourth.packRoot, 'extra.txt'), 'undeclared');
  await assert.rejects(fourth.manager.importPack(fourth.packRoot), /undeclared/);
});

test('private theme settings export never includes local asset bytes or paths', async t => {
  const {manager, packRoot} = await fixture(t);
  await writePack(packRoot);
  await manager.importPack(packRoot);
  assert.deepEqual(await manager.exportSettings('private-blue'), {themeId: 'private-blue'});
});
