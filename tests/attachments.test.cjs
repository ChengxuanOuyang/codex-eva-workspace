'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createAttachmentStore} = require('../workbench/attachments.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-attachments-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return createAttachmentStore(root);
}

function png(width = 1, height = 1) {
  const bytes = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 4, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes.write('IEND', 29, 4, 'ascii');
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('attachment saves a bounded PNG under an opaque local name', async t => {
  const store = await fixture(t);

  const saved = await store.save({dataUrl: png(320, 180)});

  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.equal(saved.mime, 'image/png');
  assert.equal(saved.width, 320);
  assert.equal(saved.height, 180);
  assert.match(path.basename(saved.path), /^[0-9a-f-]{36}\.png$/);
  assert.equal((await fs.stat(saved.path)).isFile(), true);
  assert.deepEqual(await store.get(saved.id), saved);
});
test('attachment rejects SVG, spoofed MIME and huge dimensions', async t => {
  const store = await fixture(t);
  const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
  const spoofed = `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`;

  await assert.rejects(store.save({dataUrl: svg}), /type/);
  await assert.rejects(store.save({dataUrl: spoofed}), /signature/);
  await assert.rejects(store.save({dataUrl: png(12_001, 1)}), /dimensions/);
});

test('attachment rejects oversized encoded input before decoding', async t => {
  const store = await fixture(t);
  const oversized = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024 + 1)}`;

  await assert.rejects(store.save({dataUrl: oversized}), /size/);
});
