'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const EMPTY_STATE = Object.freeze({version: 1, projects: Object.freeze([]), threads: Object.freeze([])});

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateState(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.threads)) {
    throw new Error('Invalid workbench state');
  }
  return value;
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '-');
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

async function createStore(root) {
  const stateRoot = path.join(root, 'state');
  const statePath = path.join(stateRoot, 'state.json');
  const temporaryPath = path.join(stateRoot, 'state.tmp');
  await fs.mkdir(stateRoot, {recursive: true});

  let state = clone(EMPTY_STATE);
  try {
    state = validateState(JSON.parse(await fs.readFile(statePath, 'utf8')));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const corruptPath = path.join(stateRoot, `state.corrupt-${safeTimestamp()}.json`);
      await fs.rename(statePath, corruptPath);
      await syncDirectory(stateRoot);
    }
  }

  let queue = Promise.resolve();
  let closed = false;

  async function flushState(value = state) {
    const body = `${JSON.stringify(value)}\n`;
    let handle;
    try {
      handle = await fs.open(temporaryPath, 'w', 0o600);
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await fs.rename(temporaryPath, statePath);
    await syncDirectory(stateRoot);
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  return {
    read() {
      return clone(state);
    },
    update(mutator) {
      if (closed) return Promise.reject(new Error('Workbench store is closed'));
      return enqueue(async () => {
        const next = clone(state);
        await mutator(next);
        validateState(next);
        await flushState(next);
        state = next;
        return clone(state);
      });
    },
    flush() {
      if (closed) return Promise.reject(new Error('Workbench store is closed'));
      return enqueue(() => flushState());
    },
    async close() {
      if (closed) return;
      closed = true;
      await enqueue(() => flushState());
    }
  };
}

module.exports = {createStore};
