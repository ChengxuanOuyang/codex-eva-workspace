'use strict';

const path = require('node:path');

function configureProductUserData(app, pathModule = path) {
  const userData = pathModule.join(app.getPath('appData'), 'Project Zero');
  app.setPath('userData', userData);
  return userData;
}

function bridgeOptionsForEnvironment(environment, {
  isPackaged = true,
  loadTestBridge = require
} = {}) {
  if (isPackaged || environment.NODE_ENV !== 'test' ||
      typeof environment.PROJECT_ZERO_TEST_BRIDGE_MODULE !== 'string') return {};
  const testBridge = loadTestBridge(environment.PROJECT_ZERO_TEST_BRIDGE_MODULE);
  if (!testBridge || typeof testBridge.createBridgeOptions !== 'function') return {};
  return testBridge.createBridgeOptions(environment);
}

if (process.versions.electron && process.type === 'browser') {
  const electron = require('electron');
  configureProductUserData(electron.app);
  const {bootstrap} = require('./lifecycle.cjs');
  bootstrap(electron, bridgeOptionsForEnvironment(process.env, {isPackaged: electron.app.isPackaged}));
}

module.exports = {bridgeOptionsForEnvironment, configureProductUserData};
