'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {checkAssetLicenses} = require('../scripts/check-asset-licenses.cjs');

test('bundled reference font retains its OFL notice and source record', async () => {
  const fontsRoot = path.join(__dirname, '..', 'renderer', 'fonts');
  const [notice, sources] = await Promise.all([
    fs.readFile(path.join(fontsRoot, 'OFL-NotoSerifCJK.txt'), 'utf8'),
    fs.readFile(path.join(fontsRoot, 'SOURCES.md'), 'utf8')
  ]);

  assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(sources, /Noto Serif CJK SC Black/);
  assert.match(sources, /OFL-NotoSerifCJK\.txt/);
});

test('every redistributable asset requires a license record and matching digest', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-licenses-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = path.join(root, 'assets', 'audio');
  await fs.mkdir(directory, {recursive: true});
  const bytes = Buffer.from('original audio');
  await fs.writeFile(path.join(directory, 'tone.wav'), bytes);
  await fs.writeFile(path.join(directory, 'LICENSES.json'), JSON.stringify({assets: [{
    file: 'tone.wav', license: 'CC0-1.0', sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  }]}));
  assert.deepEqual(await checkAssetLicenses({root}), {missing: [], digestMismatches: []});
  await fs.writeFile(path.join(directory, 'unlisted.mp3'), 'missing');
  assert.deepEqual((await checkAssetLicenses({root})).missing, ['audio/unlisted.mp3']);
});
