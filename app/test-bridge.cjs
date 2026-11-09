'use strict';

const path = require('node:path');

const TEST_WINDOW_MODE_CHANNEL = 'project-zero:test:window-mode';
const TEST_PRELOAD_PATH = path.join(__dirname, 'test-preload.cjs');

function installTestBridge(ipcMain, window) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('TEST_BRIDGE_IPC_REQUIRED');
  }
  if (!window?.webContents) throw new TypeError('TEST_BRIDGE_WINDOW_REQUIRED');

  const readWindowMode = event => {
    if (event?.sender !== window.webContents) return 'fallback';
    try {
      if (typeof window.isDestroyed === 'function' && window.isDestroyed()) return 'fallback';
      const fullscreen = window.isFullScreen()
        || (typeof window.isSimpleFullScreen === 'function' && window.isSimpleFullScreen());
      return fullscreen ? 'fullscreen' : 'windowed';
    } catch {
      return 'fallback';
    }
  };
  ipcMain.handle(TEST_WINDOW_MODE_CHANNEL, readWindowMode);

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    ipcMain.removeHandler(TEST_WINDOW_MODE_CHANNEL);
  };
}

module.exports = {installTestBridge, TEST_PRELOAD_PATH, TEST_WINDOW_MODE_CHANNEL};
