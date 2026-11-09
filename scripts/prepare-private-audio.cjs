'use strict';

const crypto = require('node:crypto');
const {execFile: execFileCallback} = require('node:child_process');
const {constants} = require('node:fs');
const defaultFs = require('node:fs/promises');
const path = require('node:path');
const {promisify} = require('node:util');

const defaultExecFile = promisify(execFileCallback);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const AFCONVERT = '/usr/bin/afconvert';

class PrivateAudioPreparationError extends Error {
  constructor(cause) {
    super('PRIVATE_AUDIO_PREP_FAILED', {cause});
    this.name = 'PrivateAudioPreparationError';
    this.code = 'PRIVATE_AUDIO_PREP_FAILED';
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 || argv[0] !== '--input' ||
      argv[2] !== '--output' || typeof argv[1] !== 'string' ||
      typeof argv[3] !== 'string') throw Error('AUDIO_ARGUMENTS');
  const input = argv[1];
  const output = argv[3];
  if (!path.isAbsolute(input) || !path.isAbsolute(output) ||
      path.extname(input) !== '.mp4' || path.extname(output) !== '.m4a' ||
      path.resolve(input) === path.resolve(output)) throw Error('AUDIO_ARGUMENTS');
  return {input, output};
}

async function openRegularInput(target, fsModule) {
  const handle = await fsModule.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    const current = await fsModule.lstat(target);
    if (!identity.isFile() || current.isSymbolicLink() || !current.isFile() ||
        !sameIdentity(identity, current)) throw Error('AUDIO_INPUT');
    return {handle, identity, target};
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function openRealDirectory(target, fsModule) {
  const resolved = path.resolve(target);
  const handle = await fsModule.open(
    resolved,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const identity = await handle.stat();
    const current = await fsModule.lstat(resolved);
    const real = await fsModule.realpath(resolved);
    if (!identity.isDirectory() || current.isSymbolicLink() || !current.isDirectory() ||
        !sameIdentity(identity, current)) throw Error('AUDIO_OUTPUT_PARENT');
    return {handle, identity, real, target: resolved};
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function regularInputMatches(input, fsModule) {
  try {
    const held = await input.handle.stat();
    const current = await fsModule.lstat(input.target);
    return held.isFile() && sameIdentity(held, input.identity) &&
      current.isFile() && !current.isSymbolicLink() &&
      sameIdentity(current, input.identity);
  } catch {
    return false;
  }
}

async function directoryMatches(directory, fsModule) {
  try {
    const held = await directory.handle.stat();
    const current = await fsModule.lstat(directory.target);
    return held.isDirectory() && sameIdentity(held, directory.identity) &&
      current.isDirectory() && !current.isSymbolicLink() &&
      sameIdentity(current, directory.identity) &&
      await fsModule.realpath(directory.target) === directory.real;
  } catch {
    return false;
  }
}

function readAtom(bytes, offset, boundary) {
  if (offset < 0 || offset + 8 > boundary) throw Error('AUDIO_CONTAINER');
  let size = bytes.readUInt32BE(offset);
  const type = bytes.toString('ascii', offset + 4, offset + 8);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > boundary) throw Error('AUDIO_CONTAINER');
    const largeSize = bytes.readBigUInt64BE(offset + 8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('AUDIO_CONTAINER');
    size = Number(largeSize);
    header = 16;
  } else if (size === 0) {
    size = boundary - offset;
  }
  if (size < header || offset + size > boundary) throw Error('AUDIO_CONTAINER');
  return {type, start: offset + header, end: offset + size, next: offset + size};
}

function findAtom(bytes, type, start = 0, end = bytes.length) {
  let offset = start;
  while (offset < end) {
    const atom = readAtom(bytes, offset, end);
    if (atom.type === type) return atom;
    offset = atom.next;
  }
  return null;
}

function m4aDurationMs(bytes) {
  const ftyp = findAtom(bytes, 'ftyp');
  const moov = findAtom(bytes, 'moov');
  if (!ftyp || !moov || ftyp.end - ftyp.start < 8) throw Error('AUDIO_CONTAINER');
  const mvhd = findAtom(bytes, 'mvhd', moov.start, moov.end);
  if (!mvhd) throw Error('AUDIO_DURATION');
  const version = bytes.readUInt8(mvhd.start);
  let timescale;
  let duration;
  if (version === 0) {
    if (mvhd.start + 20 > mvhd.end) throw Error('AUDIO_DURATION');
    timescale = bytes.readUInt32BE(mvhd.start + 12);
    duration = BigInt(bytes.readUInt32BE(mvhd.start + 16));
  } else if (version === 1) {
    if (mvhd.start + 32 > mvhd.end) throw Error('AUDIO_DURATION');
    timescale = bytes.readUInt32BE(mvhd.start + 20);
    duration = bytes.readBigUInt64BE(mvhd.start + 24);
  } else {
    throw Error('AUDIO_DURATION');
  }
  if (timescale === 0 || duration === 0n) throw Error('AUDIO_DURATION');
  const milliseconds = Number((duration * 1000n + BigInt(Math.floor(timescale / 2))) /
    BigInt(timescale));
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw Error('AUDIO_DURATION');
  return milliseconds;
}

async function readVerifiedOutput(target, parent, fsModule) {
  const handle = await fsModule.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const identity = await handle.stat();
    const current = await fsModule.lstat(target);
    if (!identity.isFile() || current.isSymbolicLink() || !current.isFile() ||
        !sameIdentity(identity, current) || identity.size <= 0 ||
        identity.size > MAX_OUTPUT_BYTES) throw Error('AUDIO_OUTPUT');
    const bytes = await handle.readFile();
    if (bytes.length !== identity.size || bytes.length > MAX_OUTPUT_BYTES) {
      throw Error('AUDIO_OUTPUT');
    }
    const after = await fsModule.lstat(target);
    if (after.isSymbolicLink() || !after.isFile() || !sameIdentity(identity, after) ||
        !await directoryMatches(parent, fsModule)) throw Error('AUDIO_OUTPUT');
    return {
      bytes: bytes.length,
      durationMs: m4aDurationMs(bytes),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function preparePrivateAudio({
  argv,
  execFile = defaultExecFile,
  fsModule = defaultFs,
  log = console.log
} = {}) {
  let inputHandle;
  let parentHandle;
  try {
    const {input, output} = parseArguments(argv);
    inputHandle = await openRegularInput(input, fsModule);
    parentHandle = await openRealDirectory(path.dirname(output), fsModule);
    const existing = await fsModule.lstat(output).catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) throw Error('AUDIO_OUTPUT_EXISTS');
    if (!await regularInputMatches(inputHandle, fsModule) ||
        !await directoryMatches(parentHandle, fsModule)) throw Error('AUDIO_IDENTITY');

    await execFile(AFCONVERT, [
      input,
      output,
      '-f', 'm4af',
      '-d', 'aac',
      '-b', '128000'
    ]);

    if (!await regularInputMatches(inputHandle, fsModule) ||
        !await directoryMatches(parentHandle, fsModule)) throw Error('AUDIO_IDENTITY');
    const summary = await readVerifiedOutput(output, parentHandle, fsModule);
    log(`PRIVATE_AUDIO_READY bytes=${summary.bytes} duration_ms=${summary.durationMs} sha256=${summary.sha256}`);
    return Object.freeze(summary);
  } catch (error) {
    if (error instanceof PrivateAudioPreparationError) throw error;
    throw new PrivateAudioPreparationError(error);
  } finally {
    await inputHandle?.handle.close().catch(() => {});
    await parentHandle?.handle.close().catch(() => {});
  }
}

if (require.main === module) {
  preparePrivateAudio({argv: process.argv.slice(2)}).catch(() => {
    console.error('PRIVATE_AUDIO_PREP_FAILED');
    process.exitCode = 1;
  });
}

module.exports = {
  PrivateAudioPreparationError,
  m4aDurationMs,
  preparePrivateAudio
};
