'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_LOG_BYTES = 256 * 1024;
const SAFE_METADATA_KEYS = new Set(['appVersion', 'codexVersion', 'nodeVersion', 'platform', 'arch']);
const BLOCKED_CODES = /(?:TOKEN|SECRET|PASSWORD|AUTH|KEY|MESSAGE|CHAT|PROMPT|PRIVATE)/;

function sanitizeMetadata(metadata = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function extractCodes(text) {
  const codes = [];
  const seen = new Set();
  for (const match of text.matchAll(/\b[A-Z][A-Z0-9_]{2,63}\b/g)) {
    const code = match[0];
    if (BLOCKED_CODES.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

async function readLogTail(logPath) {
  try {
    const handle = await fs.open(logPath, 'r');
    try {
      const {size} = await handle.stat();
      const length = Math.min(size, MAX_LOG_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, size - length));
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function collectDiagnostics({dataRoot, metadata = {}, connection = {}} = {}) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
    throw new TypeError('dataRoot must be an absolute path');
  }

  const logText = await readLogTail(path.join(dataRoot, 'logs', 'app.log'));
  const safeCode = typeof connection.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(connection.code)
    && !BLOCKED_CODES.test(connection.code) ? connection.code : null;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    metadata: sanitizeMetadata(metadata),
    connection: {
      ready: connection.ready === true,
      code: safeCode
    },
    logCodes: extractCodes(logText)
  };
}

module.exports = {collectDiagnostics, extractCodes};
