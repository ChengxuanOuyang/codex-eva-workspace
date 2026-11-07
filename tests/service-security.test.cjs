const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createWorkbenchService} = require('../workbench/service.cjs');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";

let publicRoot;
let service;
let address;

test.before(async () => {
  publicRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-service-'));
  await fs.writeFile(path.join(publicRoot, 'index.html'), '<!doctype html><title>PROJECT ZERO</title>');
  await fs.writeFile(path.join(publicRoot, 'secret.txt'), 'must not be served');
  service = createWorkbenchService({snapshot: () => ({ready: true}), publicRoot});
  address = await service.listen();
});

test.after(async () => {
  await service?.close();
  if (publicRoot) await fs.rm(publicRoot, {recursive: true, force: true});
});

function request({requestPath = '/', method = 'GET', headers = {}} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: requestPath,
      method,
      headers
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
    });
    req.on('error', reject);
    req.end();
  });
}

async function openWorkbench() {
  const response = await request();
  const setCookie = response.headers['set-cookie'];
  assert.ok(setCookie);
  return {response, cookie: setCookie[0].split(';', 1)[0]};
}

test('listens only on a random IPv4 loopback port', () => {
  assert.equal(service.server.address().address, '127.0.0.1');
  assert.equal(service.server.address().port, address.port);
  assert.notEqual(address.port, 0);
});

test('rejects a Host that is not the exact listening origin', async () => {
  const response = await request({headers: {Host: `localhost:${address.port}`}});

  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), {error: 'Invalid host'});
});

test('opening the root sets a protected strict session cookie', async () => {
  const {response} = await openWorkbench();
  const cookie = response.headers['set-cookie'][0];

  assert.equal(response.status, 200);
  assert.equal(response.body, '<!doctype html><title>PROJECT ZERO</title>');
  assert.match(cookie, /^project_zero_session=[0-9a-f]{64};/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; SameSite=Strict(?:;|$)/);
  assert.match(cookie, /; Path=\/(?:;|$)/);
});

test('rejects API access without the session cookie', async () => {
  const response = await request({requestPath: '/api/state'});

  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), {error: 'Open the workbench first'});
});

test('rejects a state-changing request with a non-matching Origin', async () => {
  const {cookie} = await openWorkbench();
  const response = await request({
    requestPath: '/api/state',
    method: 'POST',
    headers: {Cookie: cookie, Origin: `http://localhost:${address.port}`}
  });

  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), {error: 'Invalid origin'});
});

test('allows state-changing requests only with the exact Origin', async () => {
  const {cookie} = await openWorkbench();
  const response = await request({
    requestPath: '/api/state',
    method: 'POST',
    headers: {Cookie: cookie, Origin: `http://127.0.0.1:${address.port}`}
  });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {ready: true});
});

test('adds browser hardening headers to every response type', async () => {
  const responses = await Promise.all([
    request(),
    request({requestPath: '/health'}),
    request({requestPath: '/api/state'}),
    request({requestPath: '/missing'}),
    request({headers: {Host: `localhost:${address.port}`}})
  ]);

  for (const response of responses) {
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['content-security-policy'], CSP);
  }
});

test('serves only the root index from publicRoot', async () => {
  for (const requestPath of ['/index.html', '/secret.txt', '/../package.json', '/..%2fpackage.json']) {
    const response = await request({requestPath});
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
  }
});
