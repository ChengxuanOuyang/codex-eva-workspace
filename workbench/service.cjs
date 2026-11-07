'use strict';

const crypto = require('node:crypto');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

async function readIndex(publicRoot) {
  const root = path.resolve(publicRoot);
  const indexPath = path.resolve(root, 'index.html');
  if (path.dirname(indexPath) !== root) return null;

  let handle;
  try {
    handle = await fs.open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    return await handle.readFile({encoding: 'utf8'});
  } finally {
    await handle?.close();
  }
}

async function serveIndex(publicRoot, res) {
  try {
    const body = await readIndex(publicRoot);
    if (body === null) return send(res, 404, {error: 'Not found'});

    setSecurityHeaders(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body));
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

function createWorkbenchService({snapshot, publicRoot}) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    if (req.headers.host !== `127.0.0.1:${port}`) {
      return send(res, 403, {error: 'Invalid host'});
    }
    if (req.url.startsWith('/api/') && !hasSession(req, token)) {
      return send(res, 403, {error: 'Open the workbench first'});
    }
    if (STATE_CHANGING_METHODS.has(req.method) && req.headers.origin !== origin) {
      return send(res, 403, {error: 'Invalid origin'});
    }
    if (req.url === '/health') return send(res, 200, {app: 'PROJECT-ZERO', ready: snapshot().ready});
    if (req.url === '/') {
      res.setHeader('Set-Cookie', `project_zero_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return serveIndex(publicRoot, res);
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
