'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const {findCodex} = require('./codex-discovery.cjs');
const {runtimePaths} = require('./runtime-paths.cjs');
const {windowOptions} = require('./window-options.cjs');
const {CodexBridge} = require('../workbench/bridge.cjs');
const {createWorkbenchService} = require('../workbench/service.cjs');

const CODEX_NOT_FOUND_MESSAGE = 'No executable Codex installation was found.';
const CLEANUP_FAILED_MESSAGE = 'Shutdown could not be confirmed; PROJECT ZERO will remain open.';
const FORCE_EXIT_TIMEOUT_MS = 2000;
const SERVICE_CLOSE_TIMEOUT_MS = 2000;

function executableOnPath(name, environmentPath = process.env.PATH) {
  if (!environmentPath) return null;

  for (const directory of environmentPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next PATH entry.
    }
  }
  return null;
}

function restrictNavigation(webContents, origin) {
  webContents.on('will-navigate', (event, target) => {
    try {
      if (new URL(target).origin === origin) return;
    } catch {
      // Invalid navigation targets are denied below.
    }
    event.preventDefault();
  });
  webContents.setWindowOpenHandler(() => ({action: 'deny'}));
}

function childHasExited(child) {
  return !child || child.pid === null || child.pid === undefined ||
    child.exitCode !== null || child.signalCode !== null;
}

function forceChildExit(child, timeoutMs = FORCE_EXIT_TIMEOUT_MS) {
  if (childHasExited(child)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', exited);
      child.removeListener('close', exited);
    };
    const exited = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const failed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Error(CLEANUP_FAILED_MESSAGE));
    };
    const timer = setTimeout(failed, timeoutMs);

    child.once('exit', exited);
    child.once('close', exited);
    try {
      if (child.kill('SIGKILL') === false && !childHasExited(child)) return failed();
      if (childHasExited(child)) exited();
    } catch {
      failed();
    }
  });
}

async function stopBridgeAndConfirm(bridge, {forceExitTimeoutMs = FORCE_EXIT_TIMEOUT_MS} = {}) {
  const originalChild = bridge.child || bridge.stoppingChild;
  try {
    await bridge.stop();
  } catch {
    const stoppingChild = bridge.stoppingChild || originalChild;
    if (childHasExited(stoppingChild)) return;
    await forceChildExit(stoppingChild, forceExitTimeoutMs);
    return;
  }

  const stoppingChild = bridge.stoppingChild || originalChild;
  if (!childHasExited(stoppingChild)) {
    await forceChildExit(stoppingChild, forceExitTimeoutMs);
  }
}

function boundedCleanup(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(CLEANUP_FAILED_MESSAGE)), timeoutMs);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function closeServiceAndConfirm(service, {closeTimeoutMs = SERVICE_CLOSE_TIMEOUT_MS} = {}) {
  service.server?.closeAllConnections?.();
  await boundedCleanup(service.close(), closeTimeoutMs);
  if (service.server?.listening) throw Error(CLEANUP_FAILED_MESSAGE);
}

async function startWorkbench({
  app,
  BrowserWindow,
  mkdir = fsPromises.mkdir,
  locateCodex = findCodex,
  pathCodex,
  resolvePathCodex = executableOnPath,
  userPath = process.env.PROJECT_ZERO_CODEX_PATH,
  CodexBridgeClass = CodexBridge,
  serviceFactory = createWorkbenchService,
  bootRoot = path.join(__dirname, '..', 'renderer', 'boot'),
  sharedRoot = path.join(__dirname, '..', 'renderer', 'shared'),
  cleanups = []
}) {
  await app.whenReady();

  const paths = runtimePaths(app.getPath('userData'));
  await mkdir(path.dirname(paths.state), {recursive: true});
  await mkdir(paths.logs, {recursive: true});
  await mkdir(paths.themes, {recursive: true});

  const discoveredPathCodex = pathCodex === undefined ? resolvePathCodex('codex') : pathCodex;
  const executable = locateCodex({pathCodex: discoveredPathCodex, userPath});
  if (!executable) {
    const error = Error(CODEX_NOT_FOUND_MESSAGE);
    error.code = 'CODEX_NOT_FOUND';
    throw error;
  }

  const bridge = new CodexBridgeClass(executable);
  cleanups.unshift(() => stopBridgeAndConfirm(bridge));
  await bridge.start();

  const service = serviceFactory({
    snapshot: () => ({ready: bridge.connected}),
    bootRoot,
    sharedRoot
  });
  cleanups.unshift(() => closeServiceAndConfirm(service));
  const address = await service.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  const window = new BrowserWindow(windowOptions());
  restrictNavigation(window.webContents, origin);
  await window.loadURL(`${origin}/`);

  return {bridge, service, window, origin, paths};
}

function installCleanupHandler(app, cleanups, {
  onCleanupError = message => console.error(`[PROJECT ZERO] ${message}`)
} = {}) {
  let cleanupStarted = false;
  let readyToQuit = false;

  app.on('before-quit', event => {
    if (readyToQuit) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;

    Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
      .then(results => {
        if (results.some(result => result.status === 'rejected')) {
          cleanupStarted = false;
          onCleanupError(CLEANUP_FAILED_MESSAGE);
          return;
        }
        readyToQuit = true;
        app.quit();
      });
  });
}

function bootstrap({app, BrowserWindow, dialog}, startOptions = {}) {
  const cleanups = [];
  installCleanupHandler(app, cleanups);
  app.on('window-all-closed', () => app.quit());

  startWorkbench({app, BrowserWindow, cleanups, ...startOptions}).catch(error => {
    const message = error.code === 'CODEX_NOT_FOUND'
      ? CODEX_NOT_FOUND_MESSAGE
      : 'The workbench could not be started.';
    console.error(`[PROJECT ZERO] ${message}`);
    dialog.showErrorBox('PROJECT ZERO startup failed', message);
    app.quit();
  });
}

module.exports = {
  CLEANUP_FAILED_MESSAGE,
  CODEX_NOT_FOUND_MESSAGE,
  bootstrap,
  closeServiceAndConfirm,
  executableOnPath,
  forceChildExit,
  installCleanupHandler,
  restrictNavigation,
  startWorkbench,
  stopBridgeAndConfirm
};
