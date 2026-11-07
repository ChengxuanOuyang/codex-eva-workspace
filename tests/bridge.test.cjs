const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {CodexBridge} = require('../workbench/bridge.cjs');

function exitChild(child, code = null, signal = 'SIGTERM') {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('exit', code, signal);
  child.emit('close', code, signal);
}

function createFakeChild(onMessage, {autoExit, childPid, hasPid, killResult}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  if (hasPid) child.pid = childPid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.killed = true;
    if (autoExit) setImmediate(() => exitChild(child));
    return killResult;
  };

  let input = '';
  child.stdin.on('data', chunk => {
    input += chunk.toString();
    const lines = input.split('\n');
    input = lines.pop();
    for (const line of lines) {
      if (line) onMessage(JSON.parse(line), child);
    }
  });
  return child;
}

function createFixture({
  initializeResponses = [],
  autoExit = true,
  childPid = 1234,
  hasPid = true,
  killResult = true,
  stopTimeoutMs
} = {}) {
  const calls = [];
  const children = [];
  const messages = [];
  const spawnProcess = (executable, args, options) => {
    const child = createFakeChild((message, currentChild) => {
      messages.push({child: currentChild, message});
      if (message.method === 'initialize') {
        const response = initializeResponses.shift() || {result: {}};
        setImmediate(() => currentChild.stdout.write(`${JSON.stringify({id: message.id, ...response})}\n`));
      }
    }, {autoExit, childPid, hasPid, killResult});
    calls.push({executable, args, options});
    children.push(child);
    return child;
  };
  return {
    bridge: new CodexBridge('/path/codex', spawnProcess, {stopTimeoutMs}),
    calls,
    children,
    messages
  };
}

test('start launches app-server and completes the initialize handshake', async () => {
  const {bridge, calls, messages} = createFixture();

  await bridge.start();

  assert.deepEqual(calls[0].args, [
    'app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'
  ]);
  assert.equal(messages[0].message.method, 'initialize');
  assert.deepEqual(messages[1].message, {method: 'initialized', params: {}});
  assert.equal(bridge.connected, true);
  bridge.stop();
});

test('stop rejects every pending request', async () => {
  const {bridge} = createFixture();
  await bridge.start();
  const first = bridge.request('thread/list');
  const second = bridge.request('model/list');

  bridge.stop();

  await assert.rejects(first, /Codex connection stopped/);
  await assert.rejects(second, /Codex connection stopped/);
});

test('delayed events from an old child do not disconnect a new child', async () => {
  const {bridge, children} = createFixture();
  let disconnected = 0;
  const notifications = [];
  bridge.on('disconnected', () => {
    disconnected += 1;
  });
  bridge.on('notification', message => notifications.push(message));
  await bridge.start();
  const oldChild = children[0];
  bridge.stop();
  await bridge.start();

  oldChild.emit('exit', 9);
  oldChild.emit('error', Error('old child error'));
  oldChild.stdout.emit('error', Error('old stdout error'));
  oldChild.stderr.emit('error', Error('old stderr error'));
  oldChild.stdout.write(`${JSON.stringify({method: 'old/notification', params: {}})}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(bridge.connected, true);
  assert.equal(disconnected, 0);
  assert.deepEqual(notifications, []);
  bridge.stop();
});

test('stderr content is drained without being forwarded', async () => {
  const {bridge, children} = createFixture();
  const diagnostics = [];
  bridge.on('diagnostic', message => diagnostics.push(message));
  await bridge.start();

  children[0].stderr.write('account: private@example.com\n');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(diagnostics, []);
  bridge.stop();
});

test('an initialize failure cleans up the child and permits retry', async () => {
  const {bridge, children} = createFixture({
    initializeResponses: [{error: {message: 'initialize rejected'}}, {result: {}}]
  });

  await assert.rejects(bridge.start(), /initialize rejected/);

  assert.equal(children[0].killed, true);
  await bridge.start();
  assert.equal(bridge.connected, true);
  bridge.stop();
});

test('an initialize failure does not reject until the child has exited', async () => {
  const {bridge, children} = createFixture({
    initializeResponses: [{error: {message: 'initialize rejected'}}],
    autoExit: false
  });
  let outcome;
  const starting = bridge.start().then(
    () => { outcome = {status: 'resolved'}; },
    error => { outcome = {status: 'rejected', error}; }
  );

  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children[0].killed, true);
  assert.equal(outcome, undefined);

  exitChild(children[0]);
  await starting;
  assert.equal(outcome.status, 'rejected');
  assert.match(outcome.error.message, /initialize rejected/);
});

test('an initialize failure remains the startup error when stopping times out', async () => {
  const {bridge} = createFixture({
    initializeResponses: [{error: {message: 'initialize rejected'}}],
    autoExit: false,
    stopTimeoutMs: 5
  });

  await assert.rejects(bridge.start(), /initialize rejected/);
  await assert.rejects(bridge.stop(), /did not exit/);
});

test('repeated stop returns the same promise until the child exits', async () => {
  const {bridge, children} = createFixture({autoExit: false});
  await bridge.start();

  const first = bridge.stop();
  const second = bridge.stop();
  assert.ok(first instanceof Promise);
  assert.equal(second, first);

  let stopped = false;
  first.then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);

  exitChild(children[0]);
  await first;
  assert.equal(stopped, true);
});

test('stop rejects within its bound when a live child ignores termination', async () => {
  const {bridge} = createFixture({autoExit: false, stopTimeoutMs: 5});
  await bridge.start();
  const stopping = bridge.stop().then(
    () => 'resolved',
    () => 'rejected'
  );

  const outcome = await Promise.race([
    stopping,
    new Promise(resolve => setTimeout(() => resolve('test-timeout'), 30))
  ]);

  assert.equal(outcome, 'rejected');
});

test('a spawn error stops without waiting for an exit from an unspawned child', async () => {
  const {bridge, children} = createFixture({autoExit: false, hasPid: false, killResult: false});
  const starting = bridge.start();

  children[0].emit('error', Error('spawn failed'));

  await assert.rejects(starting, /spawn failed/);
  assert.equal(children[0].killed, true);
});

test('active stdout and stderr pipe errors disconnect the bridge', async () => {
  for (const streamName of ['stdout', 'stderr']) {
    const {bridge, children} = createFixture();
    await bridge.start();
    const disconnected = new Promise(resolve => bridge.once('disconnected', resolve));

    children[0][streamName].emit('error', Error(`${streamName} pipe failed`));

    assert.equal(await disconnected, `${streamName} pipe failed`);
    assert.equal(bridge.connected, false);
  }
});
