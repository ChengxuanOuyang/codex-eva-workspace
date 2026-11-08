'use strict';

const fs = require('node:fs');

function candidatePaths(userPath, pathCodex) {
  return [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    pathCodex,
    userPath
  ].filter(Boolean);
}

function isExecutable(path) {
  try {
    if (!fs.statSync(path).isFile()) return false;
    fs.accessSync(path, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findCodex({userPath, pathCodex, exists = isExecutable} = {}) {
  return candidatePaths(userPath, pathCodex).find(exists) || null;
}

module.exports = {candidatePaths, findCodex};
