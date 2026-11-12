'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {parseArguments, validateDirectory, openRegular, verifyReferenceFrames} = require('../scripts/verify-reference-frames.cjs');

test('reference verifier accepts only the narrow absolute MP4 and temporary screenshot interface', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zero-reference-security-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  for (const args of [[], ['--video', 'relative.mp4', '--screenshots', directory], ['--video', '/video.mov', '--screenshots', directory], ['--video', '/video.mp4', '--screenshots', directory, '--force']]) assert.throws(() => parseArguments(args));
  assert.deepEqual(parseArguments(['--video', '/video.mp4', '--screenshots', directory]), {video: '/video.mp4', screenshots: directory});
  const real = path.join(directory, 'real');
  await fs.mkdir(real);
  const link = path.join(directory, 'link');
  await fs.symlink(real, link);
  await assert.rejects(validateDirectory(link));
  await assert.rejects(validateDirectory(process.cwd()));
  await assert.rejects(validateDirectory(os.tmpdir()));
  const regular = path.join(directory, 'video.mp4');
  await fs.writeFile(regular, '0000ftypisom');
  const videoLink = path.join(directory, 'linked.mp4');
  await fs.symlink(regular, videoLink);
  await assert.rejects(openRegular(videoLink, 100));
  await assert.rejects(openRegular(directory, 100));
  const logs = [];
  const result = await verifyReferenceFrames({argv: ['--video', regular, '--screenshots', real], log: line => logs.push(line)});
  assert.equal(result.passed, false);
  assert.ok(logs.some(line => line.startsWith('SHA256 ')));
  assert.ok(logs.includes('FAIL video-identity'));
  assert.ok(logs.some(line => /^REFERENCE_FRAMES FAIL frames=0 failures=1$/.test(line)));
  assert.equal(logs.some(line => line.includes(directory)), false);
});

const crypto = require('node:crypto');
const {withVerifiedVideo} = require('../scripts/verify-reference-frames.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function videoFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zero-video-race-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const video = path.join(directory, 'input.mp4');
  const bytes = Buffer.from('0000ftypisom0000original-video-object');
  await fs.writeFile(video, bytes);
  return {directory, video, bytes};
}

test('verified decoder opens a private hardlink to the held SHA object and removes its authority afterward', async t => {
  assert.equal(typeof withVerifiedVideo, 'function');
  const fixture = await videoFixture(t);
  const before = await fs.stat(fixture.video);
  let protectedPath;
  const result = await withVerifiedVideo({video: fixture.video, expectedSha256: hash(fixture.bytes), inspect: async bound => {
    protectedPath = bound;
    const linked = await fs.lstat(bound);
    assert.equal(linked.ino, before.ino);
    assert.equal(linked.dev, before.dev);
    assert.equal((await fs.stat(path.dirname(bound))).mode & 0o777, 0o700);
    assert.equal(linked.isSymbolicLink(), false);
    return 'decoded';
  }});
  assert.equal(result, 'decoded');
  await assert.rejects(fs.access(protectedPath));
  await assert.rejects(fs.access(path.dirname(protectedPath)));
  assert.equal((await fs.stat(fixture.video)).nlink, before.nlink);
});

for (const race of ['in-place-restore', 'path-swap-restore']) test(`verified decoding rejects ${race} while preserving the held source and cleaning authority`, async t => {
  assert.equal(typeof withVerifiedVideo, 'function');
  const fixture = await videoFixture(t);
  let protectedPath;
  await assert.rejects(withVerifiedVideo({video: fixture.video, expectedSha256: hash(fixture.bytes), inspect: async bound => {
    protectedPath = bound;
    if (race === 'in-place-restore') {
      const before = await fs.stat(fixture.video);
      await fs.writeFile(fixture.video, Buffer.from(fixture.bytes).fill(65, 16));
      await fs.writeFile(fixture.video, fixture.bytes);
      await fs.utimes(fixture.video, before.atime, before.mtime);
    } else {
      const saved = path.join(fixture.directory, 'saved.mp4');
      await fs.rename(fixture.video, saved);
      await fs.writeFile(fixture.video, Buffer.from(fixture.bytes).fill(66, 16));
      assert.deepEqual(await fs.readFile(bound), fixture.bytes, 'the decoder remains bound to the original inode');
      await fs.unlink(fixture.video);
      await fs.rename(saved, fixture.video);
    }
    return 'must not pass';
  }}));
  assert.deepEqual(await fs.readFile(fixture.video), fixture.bytes);
  await assert.rejects(fs.access(protectedPath));
  await assert.rejects(fs.access(path.dirname(protectedPath)));
});

test('independent central pixel probe rejects a missing or materially changed layer', () => {
  const {verifyCentralProbe} = require('../scripts/verify-reference-frames.cjs');
  assert.equal(verifyCentralProbe({video: 20, screenshot: 0}), false);
  assert.equal(verifyCentralProbe({video: 20, screenshot: 5}), false);
  assert.equal(verifyCentralProbe({video: 20, screenshot: 50}), false);
  assert.equal(verifyCentralProbe({video: 20, screenshot: 20}), true);
});
