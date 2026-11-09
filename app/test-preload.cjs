'use strict';

const {contextBridge, ipcRenderer} = require('electron');

const MAX_PRESENTATION_ELAPSED_MS = 20_500;
const PRESENTATION_ATTRIBUTE = 'data-project-zero-test-presentation-elapsed';
const PRESENTATION_EVENT = 'project-zero:test-presentation-elapsed';
const WINDOW_MODE_CHANNEL = 'project-zero:test:window-mode';

function setPresentationElapsed(elapsedMs) {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_PRESENTATION_ELAPSED_MS) {
    throw new TypeError('TEST_PRESENTATION_ELAPSED_INVALID');
  }
  document.documentElement.setAttribute(PRESENTATION_ATTRIBUTE, String(elapsedMs));
  window.dispatchEvent(new Event(PRESENTATION_EVENT));
}

function readWindowMode() {
  return ipcRenderer.invoke(WINDOW_MODE_CHANNEL);
}

contextBridge.exposeInMainWorld('ProjectZeroTestBridge', Object.freeze({
  readWindowMode,
  setPresentationElapsed
}));
