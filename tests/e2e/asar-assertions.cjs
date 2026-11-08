'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

function entries(archive) {
  return asar.listPackage(archive).map(entry => entry.replace(/^\//, ''));
}

function files(archive) {
  return entries(archive).filter(entry => !asar.statFile(archive, entry).files);
}

function read(archive, entry) {
  return Buffer.from(asar.extractFile(archive, entry));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertNoSensitiveArchiveContent(archive, {allowTestPrivateTitle = false} = {}) {
  const archiveEntries = entries(archive);
  for (const entry of archiveEntries) {
    assert.doesNotMatch(
      entry,
      /(^|\/)(?:private-themes|tests?|fixtures|credentials?|\.env|auth\.json|\.codex)(?:\/|$)/i
    );
  }

  const textExtensions = /\.(?:cjs|mjs|js|css|html|json|md|txt|yml|yaml)$/i;
  const text = files(archive)
    .filter(entry => textExtensions.test(entry))
    .map(entry => read(archive, entry).toString('utf8'))
    .join('\n');
  assert.doesNotMatch(text, /\/Users\/[^/\s"']+/);
  assert.doesNotMatch(text, /\bharrisonrio\b/i);
  assert.doesNotMatch(text, /PROJECT ZERO\s*\/\/\s*REI PRIVATE THEME/i);
  assert.doesNotMatch(text, /\b(?:sk|ghp)_[A-Za-z0-9_-]{16,}\b/);
  assert.doesNotMatch(text, /["'](?:access_token|refresh_token|api_key)["']\s*:/i);
  if (!allowTestPrivateTitle) {
    assert.doesNotMatch(text, /PROJECT ZERO\s*\/\/\s*TEST PRIVATE THEME/i);
  }
}

module.exports = {assertNoSensitiveArchiveContent, entries, read, sha256};
