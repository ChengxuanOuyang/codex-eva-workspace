'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const {findCodex} = require('./codex-discovery.cjs');
const {runtimePaths} = require('./runtime-paths.cjs');
const {windowOptions} = require('./window-options.cjs');
const {CodexBridge} = require('../workbench/bridge.cjs');
const {WorkbenchRuntime} = require('../workbench/runtime.cjs');
const {createWorkbenchService} = require('../workbench/service.cjs');

const CODEX_NOT_FOUND_MESSAGE = 'No executable Codex installation was found.';
const CLEANUP_FAILED_MESSAGE = 'Shutdown cleanup failed; retrying once.';
const CLEANUP_FINAL_FAILED_MESSAGE = 'Shutdown cleanup failed after retry; forcing process exit.';
const FORCE_EXIT_TIMEOUT_MS = 2000;
const SERVICE_CLOSE_TIMEOUT_MS = 2000;
const MAX_MODEL_CATALOG_PAGES = 100;
const READINESS_FAILED_MESSAGE = 'Codex readiness could not be verified.';
const READINESS_CODES = new Set([
  'INITIALIZING',
  'CODEX_NOT_FOUND',
  'SIGNED_OUT',
  'NO_LAUNCHABLE_MODEL',
  'DISCONNECTED',
  'READY'
]);
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

function createReadinessStore() {
  let snapshot = Object.freeze({ready: false, code: 'INITIALIZING'});
  return Object.freeze({
    get: () => snapshot,
    set(code) {
      if (!READINESS_CODES.has(code)) throw TypeError('Invalid readiness code');
      if (snapshot.code === code) return snapshot;
      snapshot = Object.freeze({ready: code === 'READY', code});
      return snapshot;
    }
  });
}

function validAccountResponse(response) {
  if (!response || typeof response !== 'object' || typeof response.requiresOpenaiAuth !== 'boolean') return false;
  const account = response.account;
  if (account === undefined || account === null) return true;
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
    model.defaultReasoningEffort.length > 0 &&
    Array.isArray(model.supportedReasoningEfforts) &&
    model.supportedReasoningEfforts.every(option =>
      option && typeof option === 'object' &&
      typeof option.reasoningEffort === 'string' && option.reasoningEffort.length > 0 &&
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

function launchableModel(model) {
  return validModel(model) && !model.hidden &&
    ['id', 'model', 'displayName'].every(field => model[field].trim().length > 0) &&
    model.defaultReasoningEffort.trim().length > 0 &&
    model.supportedReasoningEfforts.length > 0 &&
    model.supportedReasoningEfforts.some(option =>
      option.reasoningEffort === model.defaultReasoningEffort
    );
}

async function verifyCodexReadiness(bridge) {
  const requirements = await bridge.request('configRequirements/read', {});
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) {
    throw readinessError();
  }
  const account = await bridge.request('account/read', {});
  if (!validAccountResponse(account)) throw readinessError();

  const models = [];
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < MAX_MODEL_CATALOG_PAGES; page += 1) {
    const response = await bridge.request('model/list', cursor === undefined ? {} : {cursor});
    if (!validModelResponse(response)) throw readinessError();
    models.push(...response.data);
    if (response.nextCursor === undefined || response.nextCursor === null) break;
    if (cursors.has(response.nextCursor)) throw readinessError();
    cursors.add(response.nextCursor);
    cursor = response.nextCursor;
    if (page === MAX_MODEL_CATALOG_PAGES - 1) throw readinessError();
  }

  if ((account.account === null || account.account === undefined) && account.requiresOpenaiAuth) {
    return 'SIGNED_OUT';
  }
  if (!models.some(launchableModel)) return 'NO_LAUNCHABLE_MODEL';
  return 'READY';
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

function createReadinessCoordinator({
  readiness,
  locateCodex,
  pathCodex,
  resolvePathCodex,
  userPath,
  CodexBridgeClass
}) {
  const ownedBridges = new Set();
  const disconnectHandlers = new Map();
  const notificationHandlers = new Map();
  const validationRecords = new Map();
  let activeBridge = null;
  let attempt = 0;
  let closed = false;
  let inFlight = null;

  function detachBridgeHandlers(bridge) {
    const disconnectHandler = disconnectHandlers.get(bridge);
    if (disconnectHandler) {
      bridge.off?.('disconnected', disconnectHandler);
      bridge.removeListener?.('disconnected', disconnectHandler);
      disconnectHandlers.delete(bridge);
    }
    const notificationHandler = notificationHandlers.get(bridge);
    if (notificationHandler) {
      bridge.off?.('notification', notificationHandler);
      bridge.removeListener?.('notification', notificationHandler);
      notificationHandlers.delete(bridge);
    }
  }

  async function stopOwnedBridge(bridge) {
    if (!bridge) return;
    detachBridgeHandlers(bridge);
    await stopBridgeAndConfirm(bridge);
    ownedBridges.delete(bridge);
    if (activeBridge === bridge) activeBridge = null;
  }

  function validateBridge(bridge, attemptId) {
    const existing = validationRecords.get(bridge);
    if (existing) {
      existing.queued = true;
      return existing.promise;
    }

    const record = {queued: false, promise: null};
    const operation = Promise.resolve().then(async () => {
      do {
        record.queued = false;
        const code = await verifyCodexReadiness(bridge);
        if (closed || attemptId !== attempt || activeBridge !== bridge || bridge.connected === false) {
          return readiness.get();
        }
        if (!record.queued) {
          readiness.set(code);
          return readiness.get();
        }
      } while (record.queued);
      return readiness.get();
    }).catch(() => {
      if (!closed && attemptId === attempt && activeBridge === bridge && bridge.connected !== false) {
        readiness.set('DISCONNECTED');
      }
      return readiness.get();
    }).finally(() => {
      if (validationRecords.get(bridge) === record) validationRecords.delete(bridge);
    });
    record.promise = operation;
    validationRecords.set(bridge, record);
    return operation;
  }

  async function initialize(attemptId) {
    const previousBridge = activeBridge;
    if (previousBridge) await stopOwnedBridge(previousBridge);
    if (closed || attemptId !== attempt) return readiness.get();

    const discoveredPathCodex = pathCodex === undefined ? resolvePathCodex('codex') : pathCodex;
    const executable = locateCodex({pathCodex: discoveredPathCodex, userPath});
    if (!executable) {
      readiness.set('CODEX_NOT_FOUND');
      return readiness.get();
    }
    if (closed || attemptId !== attempt) return readiness.get();

    const bridge = new CodexBridgeClass(executable);
    ownedBridges.add(bridge);
    activeBridge = bridge;
    let disconnected = false;
    const revokeReadiness = () => {
      if (closed || activeBridge !== bridge || attemptId !== attempt) return;
      disconnected = true;
      readiness.set('DISCONNECTED');
    };
    const revalidateAccountSnapshot = message => {
      if (!message || typeof message !== 'object' || message.method !== 'account/updated') return;
      if (closed || activeBridge !== bridge || attemptId !== attempt || bridge.connected === false) return;
      readiness.set('INITIALIZING');
      void validateBridge(bridge, attemptId);
    };
    if (typeof bridge.on === 'function') {
      disconnectHandlers.set(bridge, revokeReadiness);
      bridge.on('disconnected', revokeReadiness);
      notificationHandlers.set(bridge, revalidateAccountSnapshot);
      bridge.on('notification', revalidateAccountSnapshot);
    }

    await bridge.start();
    if (closed || attemptId !== attempt || disconnected || bridge.connected === false) {
      return readiness.get();
    }
    await validateBridge(bridge, attemptId);
    return readiness.get();
  }

  function retry() {
    if (inFlight) return inFlight;
    if (closed) return Promise.resolve(readiness.get());
    readiness.set('INITIALIZING');
    const attemptId = ++attempt;
    const operation = Promise.resolve()
      .then(() => initialize(attemptId))
      .catch(() => {
        if (!closed && attemptId === attempt) readiness.set('DISCONNECTED');
        return readiness.get();
      })
      .finally(() => {
        if (inFlight === operation) inFlight = null;
      });
    inFlight = operation;
    return operation;
  }

  async function close() {
    closed = true;
    attempt += 1;
    const results = await Promise.allSettled([...ownedBridges].map(stopOwnedBridge));
    if (results.some(result => result.status === 'rejected')) throw Error(CLEANUP_FAILED_MESSAGE);
  }

  return Object.freeze({
    close,
    get bridge() { return activeBridge; },
    retry
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
  bootRoot = path.join(__dirname, '..', 'renderer', 'boot'),
  sharedRoot = path.join(__dirname, '..', 'renderer', 'shared'),
  workbenchRoot = path.join(__dirname, '..', 'renderer', 'workbench'),
  dataRoot = app.getPath('userData'),
  cleanups = []
}) {
  await app.whenReady();

  const paths = runtimePaths(app.getPath('userData'));
  await mkdir(path.dirname(paths.state), {recursive: true});
  await mkdir(paths.logs, {recursive: true});
  await mkdir(paths.themes, {recursive: true});

  const readiness = createReadinessStore();
  const coordinator = createReadinessCoordinator({
    readiness,
    locateCodex,
    pathCodex,
    resolvePathCodex,
    userPath,
    CodexBridgeClass
  });
  cleanups.unshift(() => coordinator.close());

  const runtime = new WorkbenchRuntime({coordinator, readiness, dataRoot});
  cleanups.unshift(() => runtime.close());

  const service = serviceFactory({
    snapshot: readiness.get,
    retryInitialization: () => runtime.retry(),
    bootRoot,
    sharedRoot,
    workbenchRoot,
    controller: runtime
  });
  cleanups.unshift(() => closeServiceAndConfirm(service));
  const address = await service.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  const window = new BrowserWindow(windowOptions());
  restrictNavigation(window.webContents, origin);
  await window.loadURL(`${origin}/`);

  const initialization = runtime.retry();
  const resources = {service, window, origin, paths, initialization, retryInitialization: () => runtime.retry(), runtime};
  Object.defineProperty(resources, 'bridge', {
    enumerable: true,
    get: () => coordinator.bridge
  });
  return resources;
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
  createReadinessCoordinator,
  createReadinessStore,
  executableOnPath,
  forceChildExit,
  installCleanupHandler,
  restrictNavigation,
  startWorkbench,
  stopBridgeAndConfirm,
  verifyCodexReadiness
};
