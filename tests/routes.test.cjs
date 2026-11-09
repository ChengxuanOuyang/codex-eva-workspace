'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createWorkbenchService} = require('../workbench/service.cjs');

class FakeController extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
  }
  snapshot() { return {version: 1, projects: [], threads: [], models: []}; }
  async addProject(projectPath) { this.calls.push(['addProject', projectPath]); return {id: 'p1', path: projectPath}; }
  async createThread(input) { this.calls.push(['createThread', input]); return {id: 't1'}; }
  async send(input) { this.calls.push(['send', input]); return {id: input.threadId}; }
  async cancel(id) { this.calls.push(['cancel', id]); }
  async renameThread(id, title) { this.calls.push(['renameThread', id, title]); }
  async archiveThread(id, archived) { this.calls.push(['archiveThread', id, archived]); }
  async answerApproval(input) { this.calls.push(['answerApproval', input]); }
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-routes-'));
  const bootRoot = path.join(root, 'boot');
  const sharedRoot = path.join(root, 'shared');
  await fs.mkdir(bootRoot);
  await fs.mkdir(sharedRoot);
  await fs.writeFile(path.join(bootRoot, 'index.html'), '<!doctype html>');
  await fs.writeFile(path.join(bootRoot, 'boot.css'), '');
  await fs.writeFile(path.join(bootRoot, 'boot.js'), '');
  await fs.mkdir(path.join(bootRoot, 'assets'));
  for (const name of ['scene-a-sync.webp', 'scene-b-awakening.webp', 'scene-c-online.webp']) {
    await fs.writeFile(path.join(bootRoot, 'assets', name), name);
  }
  await fs.writeFile(path.join(sharedRoot, 'api.js'), '');
  const controller = new FakeController();
  const service = createWorkbenchService({
    snapshot: () => ({ready: true, code: 'READY'}), bootRoot, sharedRoot, controller
  });
  const address = await service.listen();
  t.after(async () => {
    await service.close();
    await fs.rm(root, {recursive: true, force: true});
  });
  return {controller, service, address};
}

function request(address, {requestPath = '/', method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {...headers};
    if (body !== undefined) requestHeaders['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({host: '127.0.0.1', port: address.port, path: requestPath, method, headers: requestHeaders}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function session(address) {
  const opened = await request(address, {});
  return opened.headers['set-cookie'][0].split(';', 1)[0];
}

test('workbench routes explicitly dispatch validated JSON actions', async t => {
  const {address, controller} = await fixture(t);
  const cookie = await session(address);
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await request(address, {
    requestPath: '/api/projects', method: 'POST',
    headers: {Cookie: cookie, Origin: origin, 'Content-Type': 'application/json'},
    body: JSON.stringify({path: '/tmp/project'})
  });

  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(response.body), {id: 'p1', path: '/tmp/project'});
  assert.deepEqual(controller.calls, [['addProject', '/tmp/project']]);

  const unknown = await request(address, {
    requestPath: '/api/not-a-method', method: 'POST',
    headers: {Cookie: cookie, Origin: origin, 'Content-Type': 'application/json'}, body: '{}'
  });
  assert.equal(unknown.status, 404);
});

test('events endpoint sends an initial snapshot over authenticated SSE', async t => {
  const {address} = await fixture(t);
  const cookie = await session(address);
  const event = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: address.port, path: '/api/events', method: 'GET', headers: {Cookie: cookie}
    }, res => {
      res.once('data', chunk => {
        resolve({status: res.statusCode, contentType: res.headers['content-type'], body: chunk.toString()});
        req.destroy();
      });
    });
    req.on('error', error => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });

  assert.equal(event.status, 200);
  assert.equal(event.contentType, 'text/event-stream; charset=utf-8');
  assert.match(event.body, /^event: snapshot\ndata: /);
});

test('browser completion API posts to the exact same-origin route and forwards AbortSignal', async () => {
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'api.js'), 'utf8');
  const calls = [];
  const sandbox = {
    fetch: async (url, options) => {
      calls.push({url, options});
      return {status: 204};
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/shared/api.js'});
  const controller = new AbortController();

  const result = await sandbox.ProjectZeroApi.completePresentation({signal: controller.signal});

  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/presentation/complete');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.signal, controller.signal);
});

test('browser completion API exposes only a stable error when completion fails', async () => {
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'renderer', 'shared', 'api.js'), 'utf8');
  const sandbox = {fetch: async () => ({status: 500})};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: 'renderer/shared/api.js'});

  await assert.rejects(
    sandbox.ProjectZeroApi.completePresentation(),
    error => error.message === 'Presentation completion unavailable'
  );
});
