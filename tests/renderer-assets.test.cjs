'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const rendererRoot = path.join(__dirname, '..', 'renderer');

async function read(relativePath) {
  return fs.readFile(path.join(rendererRoot, relativePath), 'utf8');
}

test('boot document uses the exact product name and only local allowlisted assets', async () => {
  const html = await read('boot/index.html');

  assert.match(html, /<title>PROJECT ZERO \/\/ REI CODEX WORKBENCH<\/title>/);
  assert.match(html, /href="\/boot\.css"/);
  assert.match(html, /src="\/shared\/api\.js"/);
  assert.match(html, /src="\/boot\.js"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('served renderer code contains no Node API, embedded token, or remote resource', async () => {
  const source = (await Promise.all([
    read('boot/boot.js'),
    read('shared/api.js')
  ])).join('\n');

  assert.doesNotMatch(source, /\brequire\s*\(|\bprocess\.|module\.exports/);
  assert.doesNotMatch(source, /bearer\s+|api[_-]?key|session[_-]?token/i);
  assert.doesNotMatch(source, /https?:\/\//i);
});

test('reduced motion removes large fluid and orbit animation', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.fluid-layer[^}]*animation: none !important/s);
  assert.match(css, /\.orbit[^}]*animation: none !important/s);
});
