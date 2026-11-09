'use strict';

const crypto = require('node:crypto');
const {constants} = require('node:fs');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createWorkbenchRoutes} = require('./routes.cjs');

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const MAX_ATTACHMENT_BODY_BYTES = 13 * 1024 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const ABSENT_PRIVATE_FILE_ERROR_CODES = new Set(['EACCES', 'ELOOP', 'ENOENT', 'ENOTDIR', 'EPERM']);

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

function sendEmpty(res, status) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.end();
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
  const requestLimit = req.routePath === '/api/attachments' ? MAX_ATTACHMENT_BODY_BYTES : MAX_REQUEST_BODY_BYTES;
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

async function readRegularFile(rootDirectory, fileName, boundaryDirectory = rootDirectory) {
  const root = path.resolve(rootDirectory);
  const boundary = path.resolve(boundaryDirectory);
  const filePath = path.resolve(root, fileName);
  const relativePath = path.relative(root, filePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return null;

  const canonicalBoundary = await fs.realpath(boundary);
  const canonicalRoot = await fs.realpath(root);
  const canonicalRootRelativePath = path.relative(canonicalBoundary, canonicalRoot);
  if (canonicalRootRelativePath.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRootRelativePath)) return null;
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

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isAbsentPrivateFileError(error) {
  return ABSENT_PRIVATE_FILE_ERROR_CODES.has(error?.code);
}

async function pathMatchesHandle(fileSystem, targetPath, handleStats, expectedType, statOptions) {
  try {
    const pathStats = await fileSystem.lstat(targetPath, statOptions);
    return sameFileIdentity(pathStats, handleStats) && expectedType(pathStats);
  } catch (error) {
    if (isAbsentPrivateFileError(error)) return false;
    throw error;
  }
}

function sameDirectorySnapshot(left, right) {
  return sameFileIdentity(left, right) &&
    left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
}

async function closePinnedHandles(pinnedFiles) {
  const results = await Promise.allSettled([...pinnedFiles.values()].map(file => file.handle.close()));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
}

async function openPinnedPrivateFiles({bootRoot, privateBootRoot, privateFiles, fileSystem}) {
  const candidates = new Map();
  const pinnedFiles = new Map();
  let bootHandle;
  let privateHandle;
  try {
    try {
      const directoryFlags = constants.O_RDONLY | (constants.O_DIRECTORY || 0) | constants.O_NOFOLLOW;
      bootHandle = await fileSystem.open(bootRoot, directoryFlags);
      privateHandle = await fileSystem.open(privateBootRoot, directoryFlags);
    } catch (error) {
      if (isAbsentPrivateFileError(error)) return pinnedFiles;
      throw error;
    }
    const bootSnapshot = await bootHandle.stat({bigint: true});
    const privateSnapshot = await privateHandle.stat({bigint: true});
    if (!bootSnapshot.isDirectory() || !privateSnapshot.isDirectory()) return pinnedFiles;

    for (const [requestPath, file] of privateFiles) {
      const filePath = path.join(privateBootRoot, file.fileName);
      let handle;
      try {
        const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0);
        handle = await fileSystem.open(filePath, fileFlags);
        const stats = await handle.stat();
        if (!stats.isFile()) {
          await handle.close();
          continue;
        }
        candidates.set(requestPath, {
          handle,
          identity: stats,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs
        });
      } catch (error) {
        await handle?.close().catch(() => {});
        if (isAbsentPrivateFileError(error)) continue;
        throw error;
      }
    }
    if (candidates.size === 0) return pinnedFiles;

    let canonicalBootRoot;
    let canonicalPrivateRoot;
    try {
      canonicalBootRoot = await fileSystem.realpath(bootRoot);
      canonicalPrivateRoot = await fileSystem.realpath(privateBootRoot);
    } catch (error) {
      if (isAbsentPrivateFileError(error)) return pinnedFiles;
      throw error;
    }
    if (path.relative(canonicalBootRoot, canonicalPrivateRoot) !== 'private') return pinnedFiles;

    for (const [requestPath, file] of privateFiles) {
      const candidate = candidates.get(requestPath);
      if (!candidate) continue;
      const filePath = path.join(privateBootRoot, file.fileName);
      let canonicalFile;
      try {
        canonicalFile = await fileSystem.realpath(filePath);
      } catch (error) {
        if (isAbsentPrivateFileError(error)) continue;
        throw error;
      }
      if (path.relative(canonicalPrivateRoot, canonicalFile) !== file.fileName) continue;
      const valid = await pathMatchesHandle(
        fileSystem,
        filePath,
        candidate.identity,
        pathStats => pathStats.isFile()
      );
      if (!valid) continue;
      candidates.delete(requestPath);
      pinnedFiles.set(requestPath, candidate);
    }
    const bootAfter = await bootHandle.stat({bigint: true});
    const privateAfter = await privateHandle.stat({bigint: true});
    const rootsStayedPinned = sameDirectorySnapshot(bootSnapshot, bootAfter) &&
      sameDirectorySnapshot(privateSnapshot, privateAfter) &&
      await pathMatchesHandle(
        fileSystem,
        bootRoot,
        bootSnapshot,
        pathStats => pathStats.isDirectory(),
        {bigint: true}
      ) &&
      await pathMatchesHandle(
        fileSystem,
        privateBootRoot,
        privateSnapshot,
        pathStats => pathStats.isDirectory(),
        {bigint: true}
      );
    if (!rootsStayedPinned) {
      await closePinnedHandles(pinnedFiles);
      pinnedFiles.clear();
    }
    return pinnedFiles;
  } catch (error) {
    await closePinnedHandles(pinnedFiles);
    throw error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      closePinnedHandles(candidates),
      privateHandle?.close(),
      bootHandle?.close()
    ].filter(Boolean));
    const cleanupFailure = cleanupResults.find(result => result.status === 'rejected');
    if (cleanupFailure) throw cleanupFailure.reason;
  }
}

async function readPinnedPrivateFile(file) {
  if (!file) return null;
  const before = await file.handle.stat();
  if (!before.isFile() || !sameFileIdentity(before, file.identity) ||
      before.size !== file.size || before.mtimeMs !== file.mtimeMs || before.ctimeMs !== file.ctimeMs) return null;

  const body = Buffer.alloc(file.size);
  let offset = 0;
  while (offset < body.length) {
    const {bytesRead} = await file.handle.read(body, offset, body.length - offset, offset);
    if (bytesRead === 0) return null;
    offset += bytesRead;
  }

  const after = await file.handle.stat();
  if (!sameFileIdentity(after, file.identity) || after.size !== file.size ||
      after.mtimeMs !== file.mtimeMs || after.ctimeMs !== file.ctimeMs) return null;
  return body;
}

async function serveFile(root, fileName, contentType, res, boundaryRoot) {
  try {
    const body = await readRegularFile(root, fileName, boundaryRoot);
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

async function servePinnedPrivateFile(file, contentType, res) {
  try {
    const body = await readPinnedPrivateFile(file);
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
  onPresentationComplete = async () => {},
  bootRoot,
  sharedRoot,
  workbenchRoot = path.join(bootRoot, '..', 'workbench'),
  controller,
  privateFileSystem = fs
}) {
  const token = crypto.randomBytes(32).toString('hex');
  const privateBootRoot = path.join(bootRoot, 'private');
  const privateFiles = new Map([
    ['/private/theme.json', {fileName: 'theme.json', contentType: 'application/json; charset=utf-8'}],
    ['/private/boot-mark.webp', {fileName: 'boot-mark.webp', contentType: 'image/webp'}],
    ['/private/rei-portrait.webp', {fileName: 'rei-portrait.webp', contentType: 'image/webp'}],
    ['/private/startup-reference.wav', {fileName: 'startup-reference.wav', contentType: 'audio/wav'}],
    ['/private/startup-reference.m4a', {fileName: 'startup-reference.m4a', contentType: 'audio/mp4'}]
  ]);
  const staticFiles = new Map([
    ['/boot.css', {root: bootRoot, fileName: 'boot.css', contentType: 'text/css; charset=utf-8'}],
    ['/boot.js', {root: bootRoot, fileName: 'boot.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/motion.js', {root: bootRoot, fileName: 'motion.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/stage-layout.js', {root: bootRoot, fileName: 'stage-layout.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/timeline.js', {root: bootRoot, fileName: 'timeline.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/sequence-audio.js', {root: bootRoot, fileName: 'sequence-audio.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/audio-clock.js', {root: bootRoot, fileName: 'audio-clock.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/shared/api.js', {root: sharedRoot, fileName: 'api.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/workbench.css', {root: workbenchRoot, fileName: 'workbench.css', contentType: 'text/css; charset=utf-8'}],
    ['/workbench.js', {root: workbenchRoot, fileName: 'app.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/conversation.js', {root: workbenchRoot, fileName: 'conversation.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/approvals.js', {root: workbenchRoot, fileName: 'approvals.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/files.js', {root: workbenchRoot, fileName: 'files.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/terminal.js', {root: workbenchRoot, fileName: 'terminal.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/git.js', {root: workbenchRoot, fileName: 'git.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/plugins.js', {root: workbenchRoot, fileName: 'plugins.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/settings.js', {root: workbenchRoot, fileName: 'settings.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/themes.js', {root: workbenchRoot, fileName: 'themes.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/vendor/xterm.css', {root: path.join(workbenchRoot, '..', 'vendor'), fileName: 'xterm.css', contentType: 'text/css; charset=utf-8'}],
    ['/vendor/xterm.js', {root: path.join(workbenchRoot, '..', 'vendor'), fileName: 'xterm.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/vendor/xterm-addon-fit.js', {root: path.join(workbenchRoot, '..', 'vendor'), fileName: 'xterm-addon-fit.js', contentType: 'text/javascript; charset=utf-8'}],
    ['/assets/scene-a-sync.webp', {root: bootRoot, fileName: 'assets/scene-a-sync.webp', contentType: 'image/webp'}],
    ['/assets/scene-b-awakening.webp', {root: bootRoot, fileName: 'assets/scene-b-awakening.webp', contentType: 'image/webp'}],
    ['/assets/scene-c-online.webp', {root: bootRoot, fileName: 'assets/scene-c-online.webp', contentType: 'image/webp'}],
    ...[...privateFiles].map(([requestPath, file]) => [requestPath, {...file, pinnedPrivate: true}])
    ,['/audio/system-awake.wav', {root: path.join(bootRoot, '..', '..', 'assets', 'audio'), fileName: 'system-awake.wav', contentType: 'audio/wav'}]
    ,['/audio/sync-start.wav', {root: path.join(bootRoot, '..', '..', 'assets', 'audio'), fileName: 'sync-start.wav', contentType: 'audio/wav'}]
    ,['/audio/pilot-confirm.wav', {root: path.join(bootRoot, '..', '..', 'assets', 'audio'), fileName: 'pilot-confirm.wav', contentType: 'audio/wav'}]
    ,['/audio/system-online.wav', {root: path.join(bootRoot, '..', '..', 'assets', 'audio'), fileName: 'system-online.wav', contentType: 'audio/wav'}]
  ]);
  const workbenchRoutes = controller ? createWorkbenchRoutes(controller) : null;
  const routeMethods = new Map([
    ['/', ['GET']],
    ['/workbench', ['GET']],
    ['/health', ['GET']],
    ['/api/state', ['GET']],
    ['/api/readiness/retry', ['POST']],
    ['/api/presentation/complete', ['POST']],
    ...[...staticFiles.keys()].map(route => [route, ['GET']]),
    ...[...(workbenchRoutes?.routeMethods || new Map())]
  ]);
  let pinnedPrivateFiles = new Map();
  let presentationCompletion;
  let listenPromise;
  let server;

  function completePresentation() {
    if (!presentationCompletion) {
      presentationCompletion = Promise.resolve().then(() => onPresentationComplete());
    }
    return presentationCompletion;
  }

  async function handleRequest(req, res) {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    let requestUrl;
    try { requestUrl = new URL(req.url, origin); } catch { return send(res, 400, {error: 'Invalid request'}); }
    req.routePath = requestUrl.pathname;

    if (req.headers.host !== `127.0.0.1:${port}`) {
      return send(res, 403, {error: 'Invalid host'});
    }
    const allowedMethods = routeMethods.get(req.url);
    if (allowedMethods && !allowedMethods.includes(req.method)) {
      return methodNotAllowed(res, allowedMethods);
    }
    if (req.routePath.startsWith('/api/') && !hasSession(req, token)) {
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
      if (staticFile.pinnedPrivate) {
        return servePinnedPrivateFile(pinnedPrivateFiles.get(req.url), staticFile.contentType, res);
      }
      return serveFile(staticFile.root, staticFile.fileName, staticFile.contentType, res, staticFile.boundaryRoot);
    }
    if (req.routePath === '/api/state') return send(res, 200, snapshot());
    if (req.routePath === '/api/readiness/retry') {
      void Promise.resolve(retryInitialization()).catch(() => {});
      return send(res, 202, {accepted: true});
    }
    if (req.url === '/api/presentation/complete') {
      try {
        await completePresentation();
        return sendEmpty(res, 204);
      } catch {
        return send(res, 500, {error: 'Presentation completion failed'});
      }
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
    listen: () => {
      if (!listenPromise) {
        listenPromise = (async () => {
          pinnedPrivateFiles = await openPinnedPrivateFiles({
            bootRoot,
            privateBootRoot,
            privateFiles,
            fileSystem: privateFileSystem
          });
          try {
            return await new Promise((resolve, reject) => {
              const failed = error => {
                server.off('error', failed);
                reject(error);
              };
              server.once('error', failed);
              try {
                server.listen(0, '127.0.0.1', () => {
                  server.off('error', failed);
                  resolve(server.address());
                });
              } catch (error) {
                server.off('error', failed);
                reject(error);
              }
            });
          } catch (error) {
            const preparedFiles = pinnedPrivateFiles;
            pinnedPrivateFiles = new Map();
            await closePinnedHandles(preparedFiles);
            throw error;
          }
        })();
      }
      return listenPromise;
    },
    close: async () => {
      await listenPromise?.catch(() => {});
      let serverError;
      try {
        await new Promise((resolve, reject) => {
          server.close(error => {
            if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') resolve();
            else reject(error);
          });
        });
      } catch (error) {
        serverError = error;
      }
      const preparedFiles = pinnedPrivateFiles;
      pinnedPrivateFiles = new Map();
      let handleError;
      try {
        await closePinnedHandles(preparedFiles);
      } catch (error) {
        handleError = error;
      }
      if (serverError) throw serverError;
      if (handleError) throw handleError;
    },
    server
  };
}

module.exports = {createWorkbenchService};
