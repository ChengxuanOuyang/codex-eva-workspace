'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  createBootCanvas,
  drawBootFrame,
  loadBootAssets,
  prepareBootAssets
} = require('../renderer/boot/boot-canvas.js');

function recordingContext({drawImageError = false} = {}) {
  const commands = [];
  const tags = [];
  const context = {
    canvas: {width: 0, height: 0},
    projectZeroRecord(tag, detail) {
      tags.push({tag, detail});
      commands.push(['record', tag, detail]);
    },
    save() { commands.push(['save']); },
    restore() { commands.push(['restore']); },
    beginPath() { commands.push(['beginPath']); },
    closePath() { commands.push(['closePath']); },
    moveTo(...args) { commands.push(['moveTo', ...args]); },
    lineTo(...args) { commands.push(['lineTo', ...args]); },
    rect(...args) { commands.push(['rect', ...args]); },
    arc(...args) { commands.push(['arc', ...args]); },
    fill() { commands.push(['fill']); },
    stroke() { commands.push(['stroke']); },
    clip() { commands.push(['clip']); },
    fillRect(...args) { commands.push(['fillRect', ...args]); },
    clearRect(...args) { commands.push(['clearRect', ...args]); },
    fillText(...args) { commands.push(['fillText', ...args]); },
    strokeText(...args) { commands.push(['strokeText', ...args]); },
    translate(...args) { commands.push(['translate', ...args]); },
    rotate(...args) { commands.push(['rotate', ...args]); },
    scale(...args) { commands.push(['scale', ...args]); },
    setTransform(...args) { commands.push(['setTransform', ...args]); },
    drawImage(...args) {
      commands.push(['drawImage', ...args.slice(1)]);
      if (drawImageError) throw new TypeError('invalid image');
    },
    createLinearGradient(...args) {
      commands.push(['createLinearGradient', ...args]);
      return {addColorStop(...stop) { commands.push(['addColorStop', ...stop]); }};
    },
    measureText(text) { return {width: text.length * 10}; }
  };

  for (const property of [
    'fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font',
    'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'shadowBlur', 'shadowColor'
  ]) {
    Object.defineProperty(context, property, {
      get() { return undefined; },
      set(value) { commands.push([property, value]); }
    });
  }

  return {commands, context, tags};
}

function imageRealm({decodeError = false} = {}) {
  const sandbox = vm.createContext({decodeError});
  vm.runInContext(`
    class FixtureHTMLImageElement {
      constructor() {
        this.complete = false;
        this.naturalWidth = 0;
        this.naturalHeight = 0;
        this.decodeCalls = 0;
        this.ownerDocument = {defaultView: {HTMLImageElement: FixtureHTMLImageElement}};
      }
      set src(value) { this._src = value; }
      get src() { return this._src; }
      async decode() {
        this.decodeCalls += 1;
        if (decodeError) throw new TypeError('decode failed');
        this.complete = true;
        this.naturalWidth = 640;
        this.naturalHeight = 640;
      }
      get [Symbol.toStringTag]() { return 'HTMLImageElement'; }
    }
    globalThis.image = new FixtureHTMLImageElement();
  `, sandbox);
  return sandbox.image;
}

function fixedSnapshot(overrides = {}) {
  return Object.freeze({
    elapsedMs: 0,
    stage: 'wake',
    progress: 0,
    scan: 0,
    activeNodes: 0,
    headingKey: 'boot.wake.heading',
    captionKey: 'boot.wake.caption',
    reducedMotion: false,
    ...overrides
  });
}

function tagNames(records) {
  return records.map(record => record.tag);
}

test('wake frame draws the fixed 1920 by 1080 surface, fine grid, original mark, labels, icons, and twelve nodes', () => {
  const recording = recordingContext();
  drawBootFrame(recording.context, fixedSnapshot(), {}, {width: 1920, height: 1080});

  assert.equal(DESIGN_WIDTH, 1920);
  assert.equal(DESIGN_HEIGHT, 1080);
  assert.deepEqual(recording.commands.find(command => command[0] === 'fillRect'), ['fillRect', 0, 0, 1920, 1080]);
  assert.deepEqual(tagNames(recording.tags).filter(tag => tag.startsWith('node:')), [
    'node:left:01:idle', 'node:right:01:idle',
    'node:left:02:idle', 'node:right:02:idle',
    'node:left:03:idle', 'node:right:03:idle',
    'node:left:04:idle', 'node:right:04:idle',
    'node:left:05:idle', 'node:right:05:idle',
    'node:left:06:idle', 'node:right:06:idle'
  ]);
  assert.deepEqual(tagNames(recording.tags).filter(tag => tag.startsWith('icon:')), [
    'icon:left:01:core', 'icon:right:01:core',
    'icon:left:02:link', 'icon:right:02:link',
    'icon:left:03:data', 'icon:right:03:data',
    'icon:left:04:shield', 'icon:right:04:shield',
    'icon:left:05:render', 'icon:right:05:render',
    'icon:left:06:pilot', 'icon:right:06:pilot'
  ]);
  assert.deepEqual(tagNames(recording.tags).filter(tag => tag.startsWith('label:')), [
    'label:zh:\u7cfb\u7edf\u542f\u52a8',
    'label:ja:\u8d77\u52d5\u7cfb\u7d71',
    'label:tech:LOCAL-CONTROL',
    'label:tech:SYNC-MONITOR'
  ]);
  assert.ok(tagNames(recording.tags).includes('grid:fine'));
  assert.ok(tagNames(recording.tags).includes('mark:fallback:project-zero'));
  assert.ok(recording.commands.filter(command => command[0] === 'lineTo').length >= 60);
  assert.ok(recording.commands.some(command => command[0] === 'fillText' && command[1] === 'PROJECT ZERO'));
});

test('the same fixed wake input retains a concrete deterministic command digest', () => {
  const recording = recordingContext();
  drawBootFrame(recording.context, fixedSnapshot(), {}, {width: 1920, height: 1080});
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({commands: recording.commands, tags: recording.tags}))
    .digest('hex');

  assert.equal(digest, 'b42f22f95431de04b791c663b0c5c1019022bff03a1426ce939975d475d9d488');
});

test('link icons start each loop as an independent canvas subpath', () => {
  const recording = recordingContext();
  drawBootFrame(recording.context, fixedSnapshot(), {}, {width: 1920, height: 1080});

  const previousIcon = recording.commands.findIndex(command => command[0] === 'record' && command[1] === 'icon:right:01:core');
  const linkIcon = recording.commands.findIndex(command => command[0] === 'record' && command[1] === 'icon:left:02:link');
  const segment = recording.commands.slice(previousIcon + 1, linkIcon);
  const arcs = segment.map((command, index) => command[0] === 'arc' ? index : -1).filter(index => index >= 0);
  assert.equal(arcs.length, 2);
  assert.deepEqual(segment.slice(arcs[0] + 1, arcs[1]).map(command => command[0]), ['stroke', 'beginPath']);
});

test('scan frame records the restrained orange field and system-check labels', () => {
  const recording = recordingContext();
  drawBootFrame(recording.context, fixedSnapshot({
    elapsedMs: 5500,
    stage: 'scan',
    scan: 0.72,
    headingKey: 'boot.scan.heading',
    captionKey: 'boot.scan.caption'
  }), {}, {width: 1440, height: 900});

  assert.ok(tagNames(recording.tags).includes('scan:orange-field'));
  assert.ok(tagNames(recording.tags).includes('scan:wave-edge'));
  assert.ok(tagNames(recording.tags).includes('label:zh:\u7cfb\u7edf\u68c0\u67e5'));
  assert.ok(tagNames(recording.tags).includes('label:ja:\u63a5\u7d9a\u76e3\u8996'));
  assert.ok(recording.commands.some(command => command[0] === 'fillStyle' && command[1] === 'rgba(232, 100, 38, 0.34)'));
});

test('synchronization and authorization keyframes draw rings, exact 99.2 percent, and a bounded authorization flash', () => {
  const sync = recordingContext();
  drawBootFrame(sync.context, fixedSnapshot({
    elapsedMs: 12500,
    stage: 'synchronize',
    progress: 56.7,
    activeNodes: 7,
    headingKey: 'boot.synchronize.heading',
    captionKey: 'boot.synchronize.caption'
  }), {}, {width: 1920, height: 1080});
  assert.ok(tagNames(sync.tags).includes('ring:sync'));
  assert.ok(tagNames(sync.tags).includes('progress:56.7'));
  assert.ok(sync.commands.filter(command => command[0] === 'arc').length >= 4);

  const authorize = recordingContext();
  drawBootFrame(authorize.context, fixedSnapshot({
    elapsedMs: 15500,
    stage: 'authorize',
    progress: 99.2,
    activeNodes: 12,
    headingKey: 'boot.authorize.heading',
    captionKey: 'boot.authorize.caption'
  }), {}, {width: 1920, height: 1080});
  assert.ok(tagNames(authorize.tags).includes('ring:sync'));
  assert.ok(tagNames(authorize.tags).includes('progress:99.2'));
  assert.ok(tagNames(authorize.tags).includes('flash:authorization'));
  assert.ok(tagNames(authorize.tags).includes('authorization:pilot-00'));
  assert.ok(authorize.commands.some(command => command[0] === 'fillText' && command[1] === '99.2'));
});

test('connect keyframes draw the connection title, exact 100 percent, and completed handoff', () => {
  const connecting = recordingContext();
  drawBootFrame(connecting.context, fixedSnapshot({
    elapsedMs: 17500,
    stage: 'connect',
    progress: 99.6,
    activeNodes: 12,
    headingKey: 'boot.connect.heading',
    captionKey: 'boot.connect.caption'
  }), {}, {width: 1920, height: 1080});
  assert.ok(tagNames(connecting.tags).includes('connection:title'));
  assert.ok(tagNames(connecting.tags).includes('progress:99.6'));

  const complete = recordingContext();
  drawBootFrame(complete.context, fixedSnapshot({
    elapsedMs: 20500,
    stage: 'connect',
    progress: 100,
    activeNodes: 12,
    headingKey: 'boot.connect.heading',
    captionKey: 'boot.connect.caption'
  }), {}, {width: 1920, height: 1080});
  assert.ok(tagNames(complete.tags).includes('progress:100.0'));
  assert.ok(tagNames(complete.tags).includes('handoff:complete'));
  assert.ok(complete.commands.some(command => command[0] === 'fillText' && command[1] === 'WORKBENCH CONNECTION'));
  assert.ok(complete.commands.some(command => command[0] === 'fillText' && command[1] === 'SYSTEM ONLINE'));
});

test('a decoded cross-realm image becomes an immutable private asset bundle', async () => {
  const privateMark = imageRealm();
  const assets = await prepareBootAssets({mark: privateMark});
  assert.equal(Object.isFrozen(assets), true);
  assert.equal(assets.mark, privateMark);
  assert.equal(privateMark.decodeCalls, 1);

  const injected = recordingContext();
  drawBootFrame(injected.context, fixedSnapshot(), assets, {width: 1920, height: 1080});
  assert.ok(tagNames(injected.tags).includes('mark:private'));
  assert.equal(injected.commands.filter(command => command[0] === 'drawImage').length, 1);
  assert.equal(tagNames(injected.tags).includes('mark:fallback:project-zero'), false);
});

test('private mark loading uses only the fixed theme and mark URLs', async () => {
  const privateMark = imageRealm();
  const requests = [];
  const assets = await loadBootAssets({
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({mark: '/private/boot-mark.webp'})};
    },
    createImage: () => privateMark
  });

  assert.deepEqual(requests.map(request => request.url), ['/private/theme.json']);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(privateMark.src, '/private/boot-mark.webp');
  assert.equal(assets.mark, privateMark);
});

test('missing, malformed, undecodable, or untrusted private marks use the original fallback', async () => {
  const failedDecode = await prepareBootAssets({mark: imageRealm({decodeError: true})});
  const plainObject = await prepareBootAssets({
    mark: {complete: true, naturalWidth: 640, naturalHeight: 640, decode: async () => {}}
  });
  const invalidTheme = await loadBootAssets({
    fetch: async () => ({ok: true, json: async () => ({mark: '/arbitrary/mark.webp'})}),
    createImage: () => imageRealm()
  });
  const missingTheme = await loadBootAssets({
    fetch: async () => ({ok: false}),
    createImage: () => imageRealm()
  });
  const failedLoad = await loadBootAssets({
    fetch: async () => { throw new TypeError('load failed'); },
    createImage: () => imageRealm()
  });

  for (const assets of [failedDecode, plainObject, invalidTheme, missingTheme, failedLoad]) {
    const recording = recordingContext();
    drawBootFrame(recording.context, fixedSnapshot(), assets, {width: 1920, height: 1080});
    assert.ok(tagNames(recording.tags).includes('mark:fallback:project-zero'));
    assert.equal(recording.commands.some(command => command[0] === 'drawImage'), false);
  }

  const failed = recordingContext({drawImageError: true});
  const decoded = await prepareBootAssets({mark: imageRealm()});
  drawBootFrame(failed.context, fixedSnapshot(), decoded, {width: 1920, height: 1080});
  assert.ok(tagNames(failed.tags).includes('mark:private:error'));
  assert.ok(tagNames(failed.tags).includes('mark:fallback:project-zero'));
});

test('reduced motion resolves from the snapshot, product setting, or media query and holds static keyframes', () => {
  const direct = recordingContext();
  drawBootFrame(direct.context, fixedSnapshot({
    stage: 'scan', scan: 0.37, reducedMotion: true
  }), {}, {width: 1920, height: 1080});
  assert.deepEqual(direct.tags.find(record => record.tag === 'scan:orange-field').detail, {top: 210});

  const recording = recordingContext();
  const canvas = {
    clientWidth: 1920,
    clientHeight: 1080,
    width: 0,
    height: 0,
    style: {},
    getContext: () => recording.context
  };
  const bootCanvas = createBootCanvas(canvas, {
    dataMotion: () => 'reduced',
    prefersReducedMotion: () => false
  });
  bootCanvas.render(fixedSnapshot({stage: 'synchronize', progress: 56.7, activeNodes: 7}));
  assert.ok(tagNames(recording.tags).includes('progress:99.2'));
  assert.equal(tagNames(recording.tags).includes('progress:56.7'), false);

  const mediaRecording = recordingContext();
  const mediaCanvas = {...canvas, getContext: () => mediaRecording.context};
  createBootCanvas(mediaCanvas, {
    dataMotion: () => 'full',
    prefersReducedMotion: () => true
  }).render(fixedSnapshot({stage: 'scan', scan: 0.21}));
  assert.deepEqual(mediaRecording.tags.find(record => record.tag === 'scan:orange-field').detail, {top: 210});
});

test('boot canvas clamps high-DPI backing store at two and resizing preserves the last timeline snapshot', () => {
  const recording = recordingContext();
  const canvas = {
    clientWidth: 800,
    clientHeight: 450,
    width: 0,
    height: 0,
    style: {},
    getContext(kind) {
      assert.equal(kind, '2d');
      return recording.context;
    }
  };
  const bootCanvas = createBootCanvas(canvas, {devicePixelRatio: () => 3});
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 900);
  assert.equal(canvas.style.width, '800px');
  assert.equal(canvas.style.height, '450px');
  assert.deepEqual(recording.commands.at(-1), ['setTransform', 2, 0, 0, 2, 0, 0]);

  const snapshot = fixedSnapshot({elapsedMs: 12500, stage: 'synchronize', progress: 56.7, activeNodes: 7});
  bootCanvas.render(snapshot);
  bootCanvas.resize(640, 360, 1.5);
  assert.equal(canvas.width, 960);
  assert.equal(canvas.height, 540);
  assert.equal(bootCanvas.lastSnapshot(), snapshot);
  assert.deepEqual(bootCanvas.viewport(), {width: 640, height: 360, pixelRatio: 1.5});
  assert.ok(tagNames(recording.tags).includes('progress:56.7'));

  bootCanvas.resize(320, 180, 0.75);
  assert.equal(canvas.width, 240);
  assert.equal(canvas.height, 135);
  assert.deepEqual(bootCanvas.viewport(), {width: 320, height: 180, pixelRatio: 0.75});
});
