'use strict';

const crypto = require('node:crypto');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  return send(res, 405, {error: 'Method not allowed'});
}

async function validateRequestBody(req, res) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  const hasBody = declaredLength > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) return true;
  if (!JSON_CONTENT_TYPE.test(req.headers['content-type'] || '')) {
    req.resume();
    send(res, 415, {error: 'Unsupported media type'});
    return false;
  }
  if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_REQUEST_BODY_BYTES) {
    req.resume();
    send(res, 413, {error: 'Request body too large'});
    return false;
  }

  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    send(res, 413, {error: 'Request body too large'});
    return false;
  }
  try {
    JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    send(res, 400, {error: 'Invalid JSON'});
    return false;
  }
  return true;
}

async function readRegularFile(rootDirectory, fileName) {
  const root = path.resolve(rootDirectory);
  const filePath = path.resolve(root, fileName);
  if (path.dirname(filePath) !== root) return null;

  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

async function serveFile(root, fileName, contentType, res) {
  try {
    const body = await readRegularFile(root, fileName);
    if (body === null) return send(res, 404, {error: 'Not found'});

    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    res.end(body);
  } catch {
    return send(res, 404, {error: 'Not found'});
  }
}

function hasSession(req, token) {
  const cookies = (req.headers.cookie || '').split(';');
  const session = cookies
    .map(cookie => cookie.trim().split('='))
    .find(([name]) => name === 'project_zero_session');
  if (!session || session.length !== 2) return false;

  const supplied = Buffer.from(session[1]);
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function createWorkbenchService({snapshot, bootRoot, sharedRoot}) {
  const token = crypto.randomBytes(32).toString('hex');
  const staticFiles = new Map([
    ['/boot.css', {root: bootRoot, fileName: 'boot.css', contentType: 'text/css; charset=utf-8'}],
    ['/boot.js', {root: bootRoot, fileName: 'boot.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/shared/api.js', {root: sharedRoot, fileName: 'api.js', contentType: 'text/javascript; charset=utf-8'}]
  ]);
  const allowedRoutes = new Set(['/', '/boot.css', '/boot.js', '/shared/api.js', '/health', '/api/state']);
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    if (req.headers.host !== `127.0.0.1:${port}`) {
      return send(res, 403, {error: 'Invalid host'});
    }
    if (allowedRoutes.has(req.url) && req.method !== 'GET') {
      return methodNotAllowed(res, ['GET']);
    }
    if (req.url.startsWith('/api/') && !hasSession(req, token)) {
      return send(res, 403, {error: 'Open the workbench first'});
    }
    if (STATE_CHANGING_METHODS.has(req.method) && req.headers.origin !== origin) {
      return send(res, 403, {error: 'Invalid origin'});
    }
    if (!await validateRequestBody(req, res)) return;
    if (req.url === '/health') return send(res, 200, {app: 'PROJECT-ZERO', ready: snapshot().ready});
    if (req.url === '/') {
      res.setHeader('Set-Cookie', `project_zero_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return serveFile(bootRoot, 'index.html', 'text/html; charset=utf-8', res);
    }
    const staticFile = staticFiles.get(req.url);
    if (staticFile) {
      return serveFile(staticFile.root, staticFile.fileName, staticFile.contentType, res);
    }
    if (req.url === '/api/state') return send(res, 200, snapshot());
    return send(res, 404, {error: 'Not found'});
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      const failed = error => reject(error);
      server.once('error', failed);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', failed);
        resolve(server.address());
      });
    }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => {
        if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(error);
      });
    }),
    server
  };
}

module.exports = {createWorkbenchService};
