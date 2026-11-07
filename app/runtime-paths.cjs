'use strict';

const path = require('node:path');

function runtimePaths(userData) {
  return {
    state: path.join(userData, 'state', 'state.json'),
    logs: path.join(userData, 'logs'),
    themes: path.join(userData, 'themes')
  };
}

module.exports = {runtimePaths};
