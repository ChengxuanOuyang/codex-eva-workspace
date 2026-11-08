'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {collectDiagnostics} = require('../workbench/diagnostics.cjs');

test('diagnostics omit credentials, chat content and private themes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-diagnostics-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.mkdir(path.join(root, 'logs'), {recursive: true});
  await fs.mkdir(path.join(root, 'state'), {recursive: true});
  await fs.mkdir(path.join(root, 'themes', 'private-rei'), {recursive: true});
  await fs.writeFile(path.join(root, 'state', 'state.json'), JSON.stringify({messages: ['user message secret']}));
  await fs.writeFile(path.join(root, 'auth.json'), '{"access_token":"sk-secret-token"}');
  await fs.writeFile(path.join(root, 'themes', 'private-rei', 'portrait.png'), 'private');
  await fs.writeFile(path.join(root, 'logs', 'app.log'), 'READY\naccess_token=sk-secret-token\nCODEX_DISCONNECTED\n');

  const bundle = await collectDiagnostics({
    dataRoot: root,
    metadata: {appVersion: '0.1.0', codexVersion: '0.150.0', nodeVersion: '26.4.0', platform: 'darwin'},
    connection: {ready: false, code: 'CODEX_DISCONNECTED'}
  });
  const text = JSON.stringify(bundle);
  assert.doesNotMatch(text, /auth\.json|access_token|sk-secret|private-rei|user message secret/);
  assert.match(text, /codexVersion/);
  assert.deepEqual(bundle.logCodes, ['READY', 'CODEX_DISCONNECTED']);
});
