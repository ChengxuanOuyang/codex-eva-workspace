const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createWorkbenchService} = require('../workbench/service.cjs');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";

let fixtureRoot;
let bootRoot;
let sharedRoot;
let service;
let address;
let retryCalls;

test.before(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-service-'));
  bootRoot = path.join(fixtureRoot, 'boot');
  sharedRoot = path.join(fixtureRoot, 'shared');
  await fs.mkdir(bootRoot);
  await fs.mkdir(sharedRoot);
  await fs.writeFile(path.join(bootRoot, 'index.html'), '<!doctype html><title>PROJECT ZERO</title>');
  await fs.writeFile(path.join(bootRoot, 'boot.css'), 'body { color: #102934; }');
  await fs.writeFile(path.join(bootRoot, 'boot.js'), 'globalThis.bootLoaded = true;');
  await fs.mkdir(path.join(bootRoot, 'assets'));
  await fs.writeFile(path.join(bootRoot, 'assets', 'scene-a-sync.webp'), 'scene-a');
  await fs.writeFile(path.join(bootRoot, 'assets', 'scene-b-awakening.webp'), 'scene-b');
  await fs.writeFile(path.join(bootRoot, 'assets', 'scene-c-online.webp'), 'scene-c');
  await fs.writeFile(path.join(sharedRoot, 'api.js'), 'globalThis.apiLoaded = true;');
  await fs.writeFile(path.join(bootRoot, 'secret.txt'), 'must not be served');
  retryCalls = 0;
  service = createWorkbenchService({
    snapshot: () => ({ready: true, code: 'READY'}),
    retryInitialization: () => {
      retryCalls += 1;
      return Promise.resolve({ready: true, code: 'READY'});
    },
    bootRoot,
    sharedRoot
  });
  address = await service.listen();
});

test.after(async () => {
  await service?.close();
  if (fixtureRoot) await fs.rm(fixtureRoot, {recursive: true, force: true});
});

function requestAt(targetAddress, {requestPath = '/', method = 'GET', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {...headers};
    if (body !== undefined && requestHeaders['Content-Length'] === undefined) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({
      host: '127.0.0.1',
      port: targetAddress.port,
      path: requestPath,
      method,
      headers: requestHeaders
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function request(options) {
  return requestAt(address, options);
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

test('rejects unsupported methods with an exact Allow header', async () => {
  const {cookie} = await openWorkbench();
  for (const requestPath of ['/', '/boot.css', '/boot.js', '/shared/api.js', '/health', '/api/state']) {
    const response = await request({
      requestPath,
      method: 'POST',
      headers: {Cookie: cookie, Origin: `http://127.0.0.1:${address.port}`}
    });
    assert.equal(response.status, 405, requestPath);
    assert.equal(response.headers.allow, 'GET', requestPath);
    assert.deepEqual(JSON.parse(response.body), {error: 'Method not allowed'});
  }
});

test('retry is an exact authenticated POST bound to the loopback origin', async () => {
  const {cookie} = await openWorkbench();
  retryCalls = 0;

  const wrongMethod = await request({
    requestPath: '/api/readiness/retry',
    method: 'GET',
    headers: {Cookie: cookie}
  });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'POST');

  const unauthenticated = await request({
    requestPath: '/api/readiness/retry',
    method: 'POST',
    headers: {Origin: `http://127.0.0.1:${address.port}`}
  });
  assert.equal(unauthenticated.status, 403);
  assert.deepEqual(JSON.parse(unauthenticated.body), {error: 'Open the workbench first'});

  const foreignOrigin = await request({
    requestPath: '/api/readiness/retry',
    method: 'POST',
    headers: {Cookie: cookie, Origin: 'https://example.com'}
  });
  assert.equal(foreignOrigin.status, 403);
  assert.deepEqual(JSON.parse(foreignOrigin.body), {error: 'Invalid origin'});

  const accepted = await request({
    requestPath: '/api/readiness/retry',
    method: 'POST',
    headers: {Cookie: cookie, Origin: `http://127.0.0.1:${address.port}`}
  });
  assert.equal(accepted.status, 202);
  assert.deepEqual(JSON.parse(accepted.body), {accepted: true});
  assert.equal(retryCalls, 1);
});

test('rejects unsupported request media and oversized bodies before routing', async () => {
  const unsupported = await request({
    requestPath: '/health',
    headers: {'Content-Type': 'text/plain'},
    body: '{}'
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(JSON.parse(unsupported.body), {error: 'Unsupported media type'});

  const oversized = await request({
    requestPath: '/health',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({payload: 'x'.repeat(70 * 1024)})
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(JSON.parse(oversized.body), {error: 'Request body too large'});
});

test('accepts only bounded valid JSON when a request body is present', async () => {
  const invalid = await request({
    requestPath: '/health',
    headers: {'Content-Type': 'application/json; charset=utf-8'},
    body: '{invalid'
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(JSON.parse(invalid.body), {error: 'Invalid JSON'});

  const valid = await request({
    requestPath: '/health',
    headers: {'Content-Type': 'application/json'},
    body: '{}'
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(valid.body), {app: 'PROJECT-ZERO', ready: true, code: 'READY'});
});

test('contains aborted request-body streams without unhandled rejections and remains healthy', async () => {
  const unhandledRejections = [];
  const recordUnhandledRejection = reason => unhandledRejections.push(reason);
  process.on('unhandledRejection', recordUnhandledRejection);

  try {
    await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/health',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '64'
        }
      });
      req.on('error', error => {
        if (error.code !== 'ECONNRESET') reject(error);
      });
      req.write('{"partial":', () => {
        req.destroy();
        resolve();
      });
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(unhandledRejections, []);

    const response = await request({requestPath: '/health'});
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {app: 'PROJECT-ZERO', ready: true, code: 'READY'});
  } finally {
    process.off('unhandledRejection', recordUnhandledRejection);
  }
});

test('ends oversized chunked bodies without waiting for an endless stream', async () => {
  let req;
  let keepSending;
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearInterval(keepSending);
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(() => finish({timedOut: true}), 500);
      req = http.request({
        host: '127.0.0.1',
        port: address.port,
        path: '/health',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked'
        }
      }, res => {
        res.resume();
        res.on('end', () => finish({status: res.statusCode}));
      });
      req.on('error', error => {
        if (error.code === 'ECONNRESET' || error.code === 'EPIPE') finish({closed: true});
        else reject(error);
      });
      req.write(Buffer.alloc(64 * 1024 + 1, 'x'));
      keepSending = setInterval(() => req.write(Buffer.alloc(1024, 'x')), 5);
    });

    assert.equal(result.timedOut, undefined, 'the server must not wait for the client to end its body');
    if (result.status !== undefined) assert.equal(result.status, 413);
    else assert.equal(result.closed, true);
  } finally {
    clearInterval(keepSending);
    req?.destroy();
  }
});

test('adds browser hardening headers to every response type', async () => {
  const responses = await Promise.all([
    request(),
    request({requestPath: '/boot.css'}),
    request({requestPath: '/boot.js'}),
    request({requestPath: '/shared/api.js'}),
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

test('serves the exact static allowlist with explicit MIME types', async () => {
  const expected = new Map([
    ['/boot.css', ['text/css; charset=utf-8', 'body { color: #102934; }']],
    ['/boot.js', ['text/javascript; charset=utf-8', 'globalThis.bootLoaded = true;']],
    ['/shared/api.js', ['text/javascript; charset=utf-8', 'globalThis.apiLoaded = true;']]
  ]);

  for (const [requestPath, [contentType, body]] of expected) {
    const response = await request({requestPath});
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], contentType);
    assert.equal(response.body, body);
  }
});

test('serves only the three exact boot artwork routes as WebP', async () => {
  const expected = new Map([
    ['/assets/scene-a-sync.webp', 'scene-a'],
    ['/assets/scene-b-awakening.webp', 'scene-b'],
    ['/assets/scene-c-online.webp', 'scene-c']
  ]);

  for (const [requestPath, body] of expected) {
    const response = await request({requestPath});
    assert.equal(response.status, 200, requestPath);
    assert.equal(response.headers['content-type'], 'image/webp', requestPath);
    assert.equal(response.body, body, requestPath);
  }

  for (const requestPath of [
    '/assets/',
    '/assets/scene-a-sync.png',
    '/assets/scene-a-sync.webp.bak',
    '/assets/scene-d-guess.webp',
    '/assets/scene-b-awakening.webp?cache=1'
  ]) {
    const response = await request({requestPath});
    assert.equal(response.status, 404, requestPath);
    assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
  }
});

test('rejects allowlisted artwork when the assets directory is an outside symlink', async () => {
  const isolatedFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-art-symlink-'));
  const isolatedBootRoot = path.join(isolatedFixtureRoot, 'boot');
  const isolatedSharedRoot = path.join(isolatedFixtureRoot, 'shared');
  const outsideAssets = path.join(isolatedFixtureRoot, 'outside-assets');
  const isolatedService = createWorkbenchService({
    snapshot: () => ({ready: true}),
    bootRoot: isolatedBootRoot,
    sharedRoot: isolatedSharedRoot
  });

  try {
    await fs.mkdir(isolatedBootRoot);
    await fs.mkdir(isolatedSharedRoot);
    await fs.mkdir(outsideAssets);
    for (const fileName of ['scene-a-sync.webp', 'scene-b-awakening.webp', 'scene-c-online.webp']) {
      await fs.writeFile(path.join(outsideAssets, fileName), `private ${fileName}`);
    }
    await fs.symlink(outsideAssets, path.join(isolatedBootRoot, 'assets'));
    const isolatedAddress = await isolatedService.listen();

    for (const requestPath of [
      '/assets/scene-a-sync.webp',
      '/assets/scene-b-awakening.webp',
      '/assets/scene-c-online.webp'
    ]) {
      const response = await requestAt(isolatedAddress, {requestPath});
      assert.equal(response.status, 404, requestPath);
      assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
      assert.doesNotMatch(response.body, /private|outside-assets|scene-[abc]/);
    }
  } finally {
    await isolatedService.close();
    await fs.rm(isolatedFixtureRoot, {recursive: true, force: true});
  }
});

test('serves no path outside the exact static allowlist', async () => {
  for (const requestPath of [
    '/index.html',
    '/secret.txt',
    '/boot-state.cjs',
    '/shared/../boot/boot.js',
    '/../package.json',
    '/..%2fpackage.json',
    '/boot.css?debug=true'
  ]) {
    const response = await request({requestPath});
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
  }
});

test('does not follow an index symlink outside publicRoot', async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-symlink-'));
  const isolatedBootRoot = path.join(fixtureRoot, 'boot');
  const isolatedSharedRoot = path.join(fixtureRoot, 'shared');
  const outsideIndex = path.join(fixtureRoot, 'outside.html');
  const isolatedService = createWorkbenchService({
    snapshot: () => ({ready: true}),
    bootRoot: isolatedBootRoot,
    sharedRoot: isolatedSharedRoot
  });

  try {
    await fs.mkdir(isolatedBootRoot);
    await fs.mkdir(isolatedSharedRoot);
    await fs.writeFile(outsideIndex, 'private content outside publicRoot');
    await fs.symlink(outsideIndex, path.join(isolatedBootRoot, 'index.html'));
    const isolatedAddress = await isolatedService.listen();

    const response = await requestAt(isolatedAddress);

    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
    assert.doesNotMatch(response.body, /private content|outside\.html/);
  } finally {
    await isolatedService.close();
    await fs.rm(fixtureRoot, {recursive: true, force: true});
  }
});

test('rejects a non-regular index without disclosing its path', async () => {
  const isolatedFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-directory-'));
  const isolatedBootRoot = path.join(isolatedFixtureRoot, 'boot');
  const isolatedSharedRoot = path.join(isolatedFixtureRoot, 'shared');
  const isolatedService = createWorkbenchService({
    snapshot: () => ({ready: true}),
    bootRoot: isolatedBootRoot,
    sharedRoot: isolatedSharedRoot
  });

  try {
    await fs.mkdir(isolatedBootRoot);
    await fs.mkdir(isolatedSharedRoot);
    await fs.mkdir(path.join(isolatedBootRoot, 'index.html'));
    const isolatedAddress = await isolatedService.listen();

    const response = await requestAt(isolatedAddress);

    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
    assert.doesNotMatch(response.body, /index\.html|project-zero-directory/);
  } finally {
    await isolatedService.close();
    await fs.rm(isolatedFixtureRoot, {recursive: true, force: true});
  }
});

test('returns safe 404s for symlinked, directory, and missing allowlisted assets', async () => {
  const isolatedFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-assets-'));
  const isolatedBootRoot = path.join(isolatedFixtureRoot, 'boot');
  const isolatedSharedRoot = path.join(isolatedFixtureRoot, 'shared');
  const outsideAsset = path.join(isolatedFixtureRoot, 'outside.css');
  const isolatedService = createWorkbenchService({
    snapshot: () => ({ready: true}),
    bootRoot: isolatedBootRoot,
    sharedRoot: isolatedSharedRoot
  });

  try {
    await fs.mkdir(isolatedBootRoot);
    await fs.mkdir(isolatedSharedRoot);
    await fs.writeFile(outsideAsset, 'private asset outside static roots');
    await fs.symlink(outsideAsset, path.join(isolatedBootRoot, 'boot.css'));
    await fs.mkdir(path.join(isolatedBootRoot, 'boot.js'));
    const isolatedAddress = await isolatedService.listen();

    for (const requestPath of ['/boot.css', '/boot.js', '/shared/api.js']) {
      const response = await requestAt(isolatedAddress, {requestPath});
      assert.equal(response.status, 404);
      assert.deepEqual(JSON.parse(response.body), {error: 'Not found'});
      assert.doesNotMatch(response.body, /outside|boot\.css|boot\.js|api\.js|project-zero-assets/);
    }
  } finally {
    await isolatedService.close();
    await fs.rm(isolatedFixtureRoot, {recursive: true, force: true});
  }
});

test('close resolves when the service has never listened', async () => {
  const unopened = createWorkbenchService({snapshot: () => ({ready: true}), bootRoot, sharedRoot});

  await unopened.close();
  await unopened.close();
});

test('close resolves when the service is already closed', async () => {
  const disposable = createWorkbenchService({snapshot: () => ({ready: true}), bootRoot, sharedRoot});
  await disposable.listen();

  await disposable.close();
  await disposable.close();
});

test('close rejects errors other than ERR_SERVER_NOT_RUNNING', async () => {
  const failing = createWorkbenchService({snapshot: () => ({ready: true}), bootRoot, sharedRoot});
  const closeError = Object.assign(Error('close failed'), {code: 'EIO'});
  failing.server.close = callback => callback(closeError);

  await assert.rejects(failing.close(), error => error === closeError);
});
