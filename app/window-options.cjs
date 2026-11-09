'use strict';

function windowOptions(preloadPath) {
  return {
    show: false,
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0b151a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(preloadPath ? {preload: preloadPath} : {})
    }
  };
}

module.exports = {windowOptions};
