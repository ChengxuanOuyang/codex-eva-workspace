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

function stopBridgeAndWait(bridge) {
  const child = bridge.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    bridge.stop();
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      child.removeListener('exit', finish);
      child.removeListener('close', finish);
      resolve();
    };
    child.once('exit', finish);
    child.once('close', finish);

    try {
      bridge.stop();
      if (child.exitCode !== null || child.signalCode !== null) finish();
    } catch (error) {
      child.removeListener('exit', finish);
      child.removeListener('close', finish);
      reject(error);
    }
  });
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
  publicRoot = path.join(__dirname, '..', 'renderer', 'boot'),
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
  cleanups.unshift(() => stopBridgeAndWait(bridge));
  await bridge.start();

  const service = serviceFactory({
    snapshot: () => ({ready: bridge.connected}),
    publicRoot
  });
  cleanups.unshift(() => service.close());
  const address = await service.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  const window = new BrowserWindow(windowOptions());
  restrictNavigation(window.webContents, origin);
  await window.loadURL(`${origin}/`);

  return {bridge, service, window, origin, paths};
}

function installCleanupHandler(app, cleanups) {
  let cleanupStarted = false;
  let readyToQuit = false;

  app.on('before-quit', event => {
    if (readyToQuit) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;

    Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
      .then(() => {
        readyToQuit = true;
        app.quit();
      });
  });
}

function bootstrap() {
  const {app, BrowserWindow, dialog} = require('electron');
  const cleanups = [];
  installCleanupHandler(app, cleanups);
  app.on('window-all-closed', () => app.quit());

  startWorkbench({app, BrowserWindow, cleanups}).catch(error => {
    const message = error.code === 'CODEX_NOT_FOUND'
      ? CODEX_NOT_FOUND_MESSAGE
      : 'The workbench could not be started.';
    console.error(`[PROJECT ZERO] ${message}`);
    dialog.showErrorBox('PROJECT ZERO startup failed', message);
    app.quit();
  });
}

function shouldBootstrap({
  electronVersion = process.versions.electron,
  isMainModule = require.main === module
} = {}) {
  return Boolean(electronVersion || isMainModule);
}

if (shouldBootstrap()) bootstrap();

module.exports = {
  CODEX_NOT_FOUND_MESSAGE,
  executableOnPath,
  installCleanupHandler,
  restrictNavigation,
  shouldBootstrap,
  startWorkbench,
  stopBridgeAndWait
};
