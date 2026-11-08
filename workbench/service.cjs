'use strict';

const crypto = require('node:crypto');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createWorkbenchRoutes} = require('./routes.cjs');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_ATTACHMENT_BODY_BYTES = 13 * 1024 * 1024;
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

function rejectOversizedBody(req, res) {
  req.pause();
  res.setHeader('Connection', 'close');
  res.once('finish', () => {
    if (!req.destroyed) req.destroy();
  });
  send(res, 413, {error: 'Request body too large'});
  return false;
}

function isAbortedRequest(req, error) {
  return req.destroyed || error?.code === 'ECONNRESET' || error?.code === 'ERR_STREAM_PREMATURE_CLOSE';
}

async function validateRequestBody(req, res) {
  const requestLimit = req.url === '/api/attachments' ? MAX_ATTACHMENT_BODY_BYTES : MAX_REQUEST_BODY_BYTES;
  const declaredLength = Number(req.headers['content-length'] || 0);
  const hasBody = declaredLength > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) {
    req.body = undefined;
    return true;
  }
  if (!JSON_CONTENT_TYPE.test(req.headers['content-type'] || '')) {
    req.resume();
    send(res, 415, {error: 'Unsupported media type'});
    return false;
  }
  if (!Number.isSafeInteger(declaredLength) || declaredLength > requestLimit) {
    return rejectOversizedBody(req, res);
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > requestLimit) {
        return rejectOversizedBody(req, res);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (isAbortedRequest(req, error)) return false;
    throw error;
  }
  try {
    req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    send(res, 400, {error: 'Invalid JSON'});
    return false;
  }
  return true;
}

async function readRegularFile(rootDirectory, fileName) {
  const root = path.resolve(rootDirectory);
  const filePath = path.resolve(root, fileName);
  const relativePath = path.relative(root, filePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return null;

  const canonicalRoot = await fs.realpath(root);
  const canonicalFile = await fs.realpath(filePath);
  const canonicalRelativePath = path.relative(canonicalRoot, canonicalFile);
  if (!canonicalRelativePath || canonicalRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelativePath)) return null;

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

function createWorkbenchService({
  snapshot,
  retryInitialization = () => Promise.resolve(),
  bootRoot,
  sharedRoot,
  workbenchRoot = path.join(bootRoot, '..', 'workbench'),
  controller
}) {
  const token = crypto.randomBytes(32).toString('hex');
  const staticFiles = new Map([
    ['/boot.css', {root: bootRoot, fileName: 'boot.css', contentType: 'text/css; charset=utf-8'}],
    ['/boot.js', {root: bootRoot, fileName: 'boot.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/shared/api.js', {root: sharedRoot, fileName: 'api.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/workbench.css', {root: workbenchRoot, fileName: 'workbench.css', contentType: 'text/css; charset=utf-8'}],
    ['/workbench.js', {root: workbenchRoot, fileName: 'app.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/conversation.js', {root: workbenchRoot, fileName: 'conversation.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/approvals.js', {root: workbenchRoot, fileName: 'approvals.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/files.js', {root: workbenchRoot, fileName: 'files.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/assets/scene-a-sync.webp', {root: bootRoot, fileName: 'assets/scene-a-sync.webp', contentType: 'image/webp'}],
    ['/assets/scene-b-awakening.webp', {root: bootRoot, fileName: 'assets/scene-b-awakening.webp', contentType: 'image/webp'}],
    ['/assets/scene-c-online.webp', {root: bootRoot, fileName: 'assets/scene-c-online.webp', contentType: 'image/webp'}]
  ]);
  const workbenchRoutes = controller ? createWorkbenchRoutes(controller) : null;
  const routeMethods = new Map([
    ['/', ['GET']],
    ['/workbench', ['GET']],
    ['/health', ['GET']],
    ['/api/state', ['GET']],
    ['/api/readiness/retry', ['POST']],
    ...[...staticFiles.keys()].map(route => [route, ['GET']]),
    ...[...(workbenchRoutes?.routeMethods || new Map())]
  ]);
  let server;
  async function handleRequest(req, res) {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    if (req.headers.host !== `127.0.0.1:${port}`) {
      return send(res, 403, {error: 'Invalid host'});
    }
    const allowedMethods = routeMethods.get(req.url);
    if (allowedMethods && !allowedMethods.includes(req.method)) {
      return methodNotAllowed(res, allowedMethods);
    }
    if (req.url.startsWith('/api/') && !hasSession(req, token)) {
      return send(res, 403, {error: 'Open the workbench first'});
    }
    if (STATE_CHANGING_METHODS.has(req.method) && req.headers.origin !== origin) {
      return send(res, 403, {error: 'Invalid origin'});
    }
    if (!await validateRequestBody(req, res)) return;
    if (workbenchRoutes && await workbenchRoutes.handle(req, res, {send, setSecurityHeaders})) return;
    if (req.url === '/health') return send(res, 200, {app: 'PROJECT-ZERO', ...snapshot()});
    if (req.url === '/') {
      res.setHeader('Set-Cookie', `project_zero_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return serveFile(bootRoot, 'index.html', 'text/html; charset=utf-8', res);
    }
    if (req.url === '/workbench') {
      res.setHeader('Set-Cookie', `project_zero_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return serveFile(workbenchRoot, 'index.html', 'text/html; charset=utf-8', res);
    }
    const staticFile = staticFiles.get(req.url);
    if (staticFile) {
      return serveFile(staticFile.root, staticFile.fileName, staticFile.contentType, res);
    }
    if (req.url === '/api/state') return send(res, 200, snapshot());
    if (req.url === '/api/readiness/retry') {
      void Promise.resolve(retryInitialization()).catch(() => {});
      return send(res, 202, {accepted: true});
    }
    return send(res, 404, {error: 'Not found'});
  }
  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      if (res.destroyed) return;
      if (!res.headersSent && !res.writableEnded) {
        try {
          send(res, 400, {error: 'Invalid request'});
          return;
        } catch {
          // Fall through to close an unusable response without exposing request details.
        }
      }
      res.destroy();
    });
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
