const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {CodexBridge} = require('../workbench/bridge.cjs');

function createFakeChild(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
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

function createFixture({initializeResponses = []} = {}) {
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
    });
    calls.push({executable, args, options});
    children.push(child);
    return child;
  };
  return {bridge: new CodexBridge('/path/codex', spawnProcess), calls, children, messages};
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

test('a delayed exit from an old child does not disconnect a new child', async () => {
  const {bridge, children} = createFixture();
  let disconnected = 0;
  bridge.on('disconnected', () => {
    disconnected += 1;
  });
  await bridge.start();
  const oldChild = children[0];
  bridge.stop();
  await bridge.start();

  oldChild.emit('exit', 9);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(bridge.connected, true);
  assert.equal(disconnected, 0);
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
