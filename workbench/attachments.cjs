'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_ENCODED_BYTES = 12 * 1024 * 1024;
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 12_000;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function pngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Invalid image signature');
  }
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid image signature');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return {height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5)};
    }
    offset += length;
  }
  throw new Error('Invalid image dimensions');
}

function validateDimensions(dimensions) {
  const {width, height} = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error('Invalid image dimensions');
  }
  return dimensions;
}

async function createAttachmentStore(root) {
  const attachmentRoot = path.join(root, 'attachments');
  await fs.mkdir(attachmentRoot, {recursive: true, mode: 0o700});
  const rootStats = await fs.lstat(attachmentRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error('Invalid attachment root');

  return {
    async save({dataUrl}) {
      if (typeof dataUrl !== 'string') throw new Error('Invalid image type');
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
      if (!match) throw new Error('Invalid image type');
      const [, mime, encoded] = match;
      if (Buffer.byteLength(encoded) > MAX_ENCODED_BYTES) throw new Error('Image exceeds encoded size limit');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > MAX_DECODED_BYTES) throw new Error('Image exceeds decoded size limit');
      const dimensions = validateDimensions(mime === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes));
      const id = crypto.randomUUID();
      const extension = mime === 'image/png' ? 'png' : 'jpg';
      const imagePath = path.join(attachmentRoot, `${id}.${extension}`);
      const metadataPath = path.join(attachmentRoot, `${id}.json`);
      const temporaryMetadataPath = path.join(attachmentRoot, `${id}.json.tmp`);
      await fs.writeFile(imagePath, bytes, {flag: 'wx', mode: 0o600});
      const metadata = {id, path: imagePath, mime, size: bytes.length, ...dimensions};
      await fs.writeFile(temporaryMetadataPath, `${JSON.stringify(metadata)}\n`, {flag: 'wx', mode: 0o600});
      await fs.rename(temporaryMetadataPath, metadataPath);
      return metadata;
    },
    async get(id) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Invalid attachment id');
      }
      const metadata = JSON.parse(await fs.readFile(path.join(attachmentRoot, `${id}.json`), 'utf8'));
      if (metadata?.id !== id || !['image/png', 'image/jpeg'].includes(metadata.mime)) throw new Error('Invalid attachment metadata');
      const extension = metadata.mime === 'image/png' ? 'png' : 'jpg';
      const imagePath = path.join(attachmentRoot, `${id}.${extension}`);
      const stats = await fs.lstat(imagePath);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Invalid attachment file');
      return {...metadata, path: imagePath};
    }
  };
}

module.exports = {createAttachmentStore};
