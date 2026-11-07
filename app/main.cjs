'use strict';

if (process.versions.electron && process.type === 'browser') {
  const {bootstrap} = require('./lifecycle.cjs');
  bootstrap(require('electron'));
}
