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
const CLEANUP_FAILED_MESSAGE = 'Shutdown cleanup failed; retrying once.';
const CLEANUP_FINAL_FAILED_MESSAGE = 'Shutdown cleanup failed after retry; forcing process exit.';
const FORCE_EXIT_TIMEOUT_MS = 2000;
const SERVICE_CLOSE_TIMEOUT_MS = 2000;
const READINESS_FAILED_MESSAGE = 'Codex readiness could not be verified.';
const PLAN_TYPES = new Set([
  'free', 'go', 'plus', 'pro', 'prolite', 'team',
  'self_serve_business_prolite', 'self_serve_business_usage_based', 'business',
  'ent26', 'enterprise_cbp_automation', 'enterprise_cbp_usage_based', 'enterprise',
  'edu', 'edu_plus', 'edu_pro', 'unknown'
]);

function readinessError() {
  const error = Error(READINESS_FAILED_MESSAGE);
  error.code = 'CODEX_READINESS_INVALID';
  return error;
}

function validAccountResponse(response) {
  if (!response || typeof response !== 'object' || typeof response.requiresOpenaiAuth !== 'boolean') return false;
  const account = response.account;
  if (!account || typeof account !== 'object' || typeof account.type !== 'string') return false;
  if (account.type === 'apiKey') return true;
  if (account.type === 'amazonBedrock') {
    return account.usesCodexManagedCredentials === undefined ||
      typeof account.usesCodexManagedCredentials === 'boolean';
  }
  return account.type === 'chatgpt' &&
    (typeof account.email === 'string' || account.email === null) &&
    PLAN_TYPES.has(account.planType);
}

function validModel(model) {
  return model && typeof model === 'object' &&
    ['id', 'model', 'displayName', 'description', 'defaultReasoningEffort']
      .every(field => typeof model[field] === 'string') &&
    typeof model.hidden === 'boolean' &&
    typeof model.isDefault === 'boolean' &&
    Array.isArray(model.supportedReasoningEfforts) &&
    model.supportedReasoningEfforts.every(option =>
      option && typeof option === 'object' &&
      typeof option.reasoningEffort === 'string' &&
      typeof option.description === 'string'
    );
}

function validModelResponse(response) {
  return response && typeof response === 'object' &&
    Array.isArray(response.data) &&
    response.data.every(validModel) &&
    (response.nextCursor === undefined || response.nextCursor === null ||
      typeof response.nextCursor === 'string');
}

async function verifyCodexReadiness(bridge) {
  const account = await bridge.request('account/read', {});
  const models = await bridge.request('model/list', {});
  if (!validAccountResponse(account) || !validModelResponse(models)) throw readinessError();
  return Object.freeze({
    ready: true,
    checks: Object.freeze({account: true, models: true})
  });
}

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
  const readiness = await verifyCodexReadiness(bridge);

  const service = serviceFactory({
    snapshot: () => readiness,
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
  onCleanupError = message => console.error(`[PROJECT ZERO] ${message}`),
  retryDelayMs = 50,
  maxCleanupAttempts = 2
} = {}) {
  let cleanupStarted = false;
  let readyToQuit = false;
  let cleanupAttempts = 0;

  const runCleanup = () => {
    cleanupStarted = true;
    cleanupAttempts += 1;
    Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
      .then(results => {
        if (results.some(result => result.status === 'rejected')) {
          if (cleanupAttempts < maxCleanupAttempts) {
            onCleanupError(CLEANUP_FAILED_MESSAGE);
            setTimeout(() => {
              cleanupStarted = false;
              runCleanup();
            }, retryDelayMs);
            return;
          }
          onCleanupError(CLEANUP_FINAL_FAILED_MESSAGE);
          readyToQuit = true;
          app.exit(1);
          return;
        }
        readyToQuit = true;
        app.quit();
      });
  };

  app.on('before-quit', event => {
    if (readyToQuit) return;
    event.preventDefault();
    if (cleanupStarted) return;
    runCleanup();
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
  CLEANUP_FINAL_FAILED_MESSAGE,
  CODEX_NOT_FOUND_MESSAGE,
  READINESS_FAILED_MESSAGE,
  bootstrap,
  closeServiceAndConfirm,
  executableOnPath,
  forceChildExit,
  installCleanupHandler,
  restrictNavigation,
  startWorkbench,
  stopBridgeAndConfirm,
  verifyCodexReadiness
};
