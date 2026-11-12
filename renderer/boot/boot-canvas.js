/*
 * Continuous-stage structure adapted from
 * https://github.com/Iris-change/eva-codex-workbench at commit
 * b12753e063d6b8752b4e0994e851d5cc0950f85b.
 * Adapted MIT code scope: the single Canvas stage pattern from
 * unified-sequence.js, the symmetric time-stable node-bank structure from
 * boot-atmosphere.js, and the persistent central-anchor geometry from
 * stage-layout.js. Upstream NERV marks, character art, voice/audio, fonts,
 * and all other media are not covered by this code adaptation and were not
 * copied. Every public visual drawn below is original PROJECT ZERO geometry.
 */
(function exposeBootCanvas(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProjectZeroBootCanvas = api;

  if (root?.document) {
    const canvas = root.document.querySelector('#boot-sequence');
    if (canvas) {
      const instance = api.createBootCanvas(canvas, {
        dataMotion: () => root.document.body?.dataset?.motion,
        devicePixelRatio: () => root.devicePixelRatio || 1,
        exposeRenderRecord: typeof root.ProjectZeroTestBridge?.setPresentationElapsed === 'function'
          && typeof root.ProjectZeroTestBridge?.readWindowMode === 'function',
        prefersReducedMotion: () => root.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      });
      const initialSnapshot = root.ProjectZeroTimeline?.sampleTimeline?.(0) || {
        elapsedMs: 0,
        stage: 'wake',
        progress: 0,
        scan: 0,
        activeNodes: 0,
        headingKey: 'boot.wake.heading',
        captionKey: 'boot.wake.caption',
        reducedMotion: false
      };
      instance.render(initialSnapshot);
      const resizeCanvas = () => instance.resize();
      root.addEventListener('resize', resizeCanvas);
      root.ProjectZeroBootCanvasInstance = Object.freeze({...instance,
        releaseWindowResize: () => root.removeEventListener('resize', resizeCanvas)
      });
      void api.loadBootAssets({
        createImage: () => root.document.createElement('img'),
        fetch: typeof root.fetch === 'function' ? root.fetch.bind(root) : undefined
      }).then(assets => instance.setAssets(assets));
    }
  }
})(typeof globalThis === 'object' ? globalThis : this, function createBootCanvasModule() {
  'use strict';

  const DESIGN_WIDTH = 1920;
  const DESIGN_HEIGHT = 1080;
  const PRIVATE_THEME_URL = '/private/theme.json';
  const PRIVATE_MARK_URL = '/private/boot-mark.webp';
  const TAU = Math.PI * 2;
  const assetBundles = new WeakSet();
  const frameRecordSinks = new WeakMap();
  const EMPTY_ASSETS = Object.freeze({});
  assetBundles.add(EMPTY_ASSETS);
  const NODE_LABELS = Object.freeze([
    Object.freeze({code: 'core', zh: '核心', ja: '中枢', tech: 'CORE'}),
    Object.freeze({code: 'link', zh: '桥接', ja: '接続', tech: 'LINK'}),
    Object.freeze({code: 'data', zh: '数据', ja: '情報', tech: 'DATA'}),
    Object.freeze({code: 'shield', zh: '边界', ja: '防護', tech: 'GUARD'}),
    Object.freeze({code: 'render', zh: '显示', ja: '表示', tech: 'RENDER'}),
    Object.freeze({code: 'pilot', zh: '驾驶', ja: '操縦', tech: 'PILOT'})
  ]);

  const PALETTE = Object.freeze({
    ice: '#edf6f8',
    iceLight: '#f8fcfc',
    ink: '#102934',
    muted: '#4d6873',
    cyan: '#5c9fb2',
    cyanSoft: '#a7d0d8',
    cyanPale: 'rgba(96, 164, 181, 0.12)',
    orange: '#e86426',
    orangeDeep: '#9b3614',
    orangeField: 'rgba(232, 100, 38, 0.34)',
    green: '#397e72',
    line: 'rgba(25, 76, 91, 0.15)',
    lineStrong: 'rgba(25, 76, 91, 0.34)'
  });

  function record(context, tag, detail) {
    frameRecordSinks.get(context)?.(tag, detail);
    if (typeof context.projectZeroRecord === 'function') context.projectZeroRecord(tag, detail);
  }

  function renderRecordCollector() {
    const state = {
      stage: null,
      progress: null,
      progressDrawn: false,
      activeNodes: 0,
      scan: {drawn: false, position: null, top: null},
      iconStates: [],
      headingKey: null,
      headingText: null,
      mark: null,
      reducedMotion: false
    };

    return Object.freeze({
      capture(tag, detail) {
        if (tag === 'heading:title') {
          state.stage = detail.stage;
          state.headingKey = detail.key;
          state.headingText = detail.text;
          state.reducedMotion = detail.reducedMotion;
        } else if (tag === 'progress:state') {
          state.progress = detail.value;
          state.progressDrawn = detail.drawn;
        } else if (tag === 'scan:state') {
          state.scan = {...detail};
        } else if (tag.startsWith('icon:') && detail) {
          state.iconStates.push(`${detail.code}:${detail.state}`);
          if (detail.state === 'active') state.activeNodes += 1;
        } else if (tag === 'mark:private') {
          state.mark = 'private';
        } else if (tag === 'mark:fallback:project-zero') {
          state.mark = 'fallback';
        } else if (tag === 'mark:not-drawn') {
          state.mark = 'not-drawn';
        }
      },
      finish() {
        return Object.freeze({
          stage: state.stage,
          progress: state.progress,
          progressDrawn: state.progressDrawn,
          activeNodes: state.activeNodes,
          scan: Object.freeze({...state.scan}),
          iconStates: Object.freeze([...state.iconStates]),
          headingKey: state.headingKey,
          headingText: state.headingText,
          mark: state.mark,
          reducedMotion: state.reducedMotion
        });
      }
    });
  }

  function makeAssets(mark) {
    if (!mark) return EMPTY_ASSETS;
    const assets = Object.freeze({mark});
    assetBundles.add(assets);
    return assets;
  }

  function trustedAssets(assets) {
    return assets && assetBundles.has(assets) ? assets : EMPTY_ASSETS;
  }

  function isDecodedHtmlImage(value) {
    const realm = value?.ownerDocument?.defaultView;
    const ImageConstructor = realm?.HTMLImageElement;
    return typeof ImageConstructor === 'function'
      && value instanceof ImageConstructor
      && value.complete === true
      && Number.isFinite(value.naturalWidth)
      && value.naturalWidth > 0
      && Number.isFinite(value.naturalHeight)
      && value.naturalHeight > 0;
  }

  function isNativeImageBitmap(value) {
    if (Object.prototype.toString.call(value) !== '[object ImageBitmap]') return false;
    const Constructor = Object.getPrototypeOf(value)?.constructor;
    if (typeof Constructor !== 'function' || Constructor.name !== 'ImageBitmap') return false;
    if (!/\[native code\]/.test(Function.prototype.toString.call(Constructor))) return false;
    return Number.isFinite(value.width) && value.width > 0
      && Number.isFinite(value.height) && value.height > 0;
  }

  async function prepareBootAssets(input = {}) {
    const mark = input && typeof input === 'object' ? input.mark : undefined;
    if (isNativeImageBitmap(mark)) return makeAssets(mark);
    const realmConstructor = mark?.ownerDocument?.defaultView?.HTMLImageElement;
    if (typeof realmConstructor !== 'function' || !(mark instanceof realmConstructor)) return EMPTY_ASSETS;
    if (typeof mark.decode !== 'function') return EMPTY_ASSETS;
    try {
      await mark.decode();
    } catch {
      return EMPTY_ASSETS;
    }
    return isDecodedHtmlImage(mark) ? makeAssets(mark) : EMPTY_ASSETS;
  }

  async function loadBootAssets({fetch: fetchPrivate, createImage} = {}) {
    if (typeof fetchPrivate !== 'function' || typeof createImage !== 'function') return EMPTY_ASSETS;
    try {
      const response = await fetchPrivate(PRIVATE_THEME_URL, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {Accept: 'application/json'}
      });
      if (!response?.ok) return EMPTY_ASSETS;
      const theme = await response.json();
      if (!theme || theme.mark !== PRIVATE_MARK_URL) return EMPTY_ASSETS;
      const mark = createImage();
      mark.src = PRIVATE_MARK_URL;
      return prepareBootAssets({mark});
    } catch {
      return EMPTY_ASSETS;
    }
  }

  function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
  }

  function safeSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const stages = new Set(['wake', 'scan', 'synchronize', 'authorize', 'connect']);
    const normalized = {
      elapsedMs: Math.max(0, finite(source.elapsedMs)),
      stage: stages.has(source.stage) ? source.stage : 'wake',
      progress: clamp(source.progress, 0, 100),
      scan: clamp(source.scan, 0, 1),
      activeNodes: Math.round(clamp(source.activeNodes, 0, 12)),
      reducedMotion: source.reducedMotion === true
    };
    if (!normalized.reducedMotion) return normalized;
    if (normalized.stage === 'scan') normalized.scan = 1;
    if (normalized.stage === 'synchronize' || normalized.stage === 'authorize') {
      normalized.progress = 99.2;
      normalized.activeNodes = 12;
    }
    if (normalized.stage === 'connect' && normalized.progress < 100) {
      normalized.progress = 99.2;
      normalized.activeNodes = 12;
    }
    return normalized;
  }

  function safeViewport(viewport) {
    const source = viewport && typeof viewport === 'object' ? viewport : {};
    return {
      width: Math.max(1, finite(source.width, DESIGN_WIDTH)),
      height: Math.max(1, finite(source.height, DESIGN_HEIGHT))
    };
  }

  function line(context, fromX, fromY, toX, toY) {
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
  }

  function drawSurface(context, viewport) {
    context.fillStyle = PALETTE.ice;
    context.fillRect(0, 0, viewport.width, viewport.height);
    const wash = context.createLinearGradient(0, 0, viewport.width, viewport.height);
    wash.addColorStop(0, PALETTE.iceLight);
    wash.addColorStop(0.55, 'rgba(237, 246, 248, 0)');
    wash.addColorStop(1, 'rgba(82, 151, 169, 0.12)');
    context.fillStyle = wash;
    context.fillRect(0, 0, viewport.width, viewport.height);
    record(context, 'surface:ice', {width: viewport.width, height: viewport.height});
  }

  function drawFineGrid(context) {
    context.strokeStyle = PALETTE.line;
    context.lineWidth = 1;
    for (let x = 0; x <= DESIGN_WIDTH; x += 60) line(context, x, 0, x, DESIGN_HEIGHT);
    for (let y = 0; y <= DESIGN_HEIGHT; y += 48) line(context, 0, y, DESIGN_WIDTH, y);

    context.strokeStyle = 'rgba(25, 76, 91, 0.24)';
    line(context, 80, 80, 1840, 80);
    line(context, 80, 1000, 1840, 1000);
    line(context, 960, 80, 960, 1000);
    record(context, 'grid:fine');
  }

  function hexPath(context, x, y, radius) {
    context.beginPath();
    for (let point = 0; point < 6; point += 1) {
      const angle = Math.PI / 6 + point * Math.PI / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
  }

  function drawCoreIcon(context, x, y, size) {
    context.beginPath();
    context.arc(x, y, size * 0.22, 0, TAU);
    context.stroke();
    line(context, x, y - size * 0.38, x, y - size * 0.08);
  }

  function drawLinkIcon(context, x, y, size) {
    context.beginPath();
    context.arc(x - size * 0.17, y, size * 0.18, -Math.PI * 0.7, Math.PI * 0.7);
    context.stroke();
    context.beginPath();
    context.arc(x + size * 0.17, y, size * 0.18, Math.PI * 0.3, Math.PI * 1.7);
    context.stroke();
  }

  function drawDataIcon(context, x, y, size) {
    for (let index = 0; index < 3; index += 1) {
      const width = size * (0.22 + index * 0.12);
      line(context, x - width, y + size * (index - 1) * 0.2, x + width, y + size * (index - 1) * 0.2);
    }
  }

  function drawShieldIcon(context, x, y, size) {
    context.beginPath();
    context.moveTo(x, y - size * 0.4);
    context.lineTo(x + size * 0.32, y - size * 0.2);
    context.lineTo(x + size * 0.22, y + size * 0.25);
    context.lineTo(x, y + size * 0.42);
    context.lineTo(x - size * 0.22, y + size * 0.25);
    context.lineTo(x - size * 0.32, y - size * 0.2);
    context.closePath();
    context.stroke();
  }

  function drawRenderIcon(context, x, y, size) {
    context.beginPath();
    context.rect(x - size * 0.36, y - size * 0.25, size * 0.72, size * 0.5);
    context.stroke();
    line(context, x - size * 0.12, y + size * 0.38, x + size * 0.12, y + size * 0.38);
  }

  function drawPilotIcon(context, x, y, size) {
    context.beginPath();
    context.arc(x, y - size * 0.18, size * 0.14, 0, TAU);
    context.moveTo(x - size * 0.3, y + size * 0.34);
    context.arc(x, y + size * 0.28, size * 0.3, Math.PI, TAU);
    context.stroke();
  }

  const ICON_DRAWERS = Object.freeze({
    core: drawCoreIcon,
    link: drawLinkIcon,
    data: drawDataIcon,
    shield: drawShieldIcon,
    render: drawRenderIcon,
    pilot: drawPilotIcon
  });

  function drawNode(context, side, index, active) {
    const label = NODE_LABELS[index];
    const x = side === 'left' ? 205 : 1715;
    const y = 205 + index * 135;
    const number = String(index + 1).padStart(2, '0');
    const textDirection = side === 'left' ? 1 : -1;
    const textX = x + textDirection * 82;

    context.save();
    context.fillStyle = active ? 'rgba(92, 159, 178, 0.2)' : 'rgba(255, 255, 255, 0.54)';
    context.strokeStyle = active ? PALETTE.cyan : PALETTE.lineStrong;
    context.lineWidth = active ? 3 : 1.5;
    hexPath(context, x, y, 48);
    context.fill();
    context.stroke();

    context.strokeStyle = active ? PALETTE.orange : PALETTE.muted;
    context.lineWidth = 2;
    ICON_DRAWERS[label.code](context, x, y, 48);
    record(context, `icon:${side}:${number}:${label.code}`, {
      code: label.code,
      side,
      number,
      state: active ? 'active' : 'idle'
    });

    context.fillStyle = PALETTE.ink;
    context.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = side === 'left' ? 'left' : 'right';
    context.textBaseline = 'middle';
    context.fillText(`${number}  ${label.tech}`, textX, y - 13);
    context.fillStyle = PALETTE.muted;
    context.font = '500 15px "Helvetica Neue", Arial, sans-serif';
    context.fillText(`${label.zh} / ${label.ja}`, textX, y + 17);
    context.restore();

    record(context, `node:${side}:${number}:${active ? 'active' : 'idle'}`);
  }

  function drawNodeBanks(context, activeNodes) {
    for (let index = 0; index < NODE_LABELS.length; index += 1) {
      drawNode(context, 'left', index, index * 2 < activeNodes);
      drawNode(context, 'right', index, index * 2 + 1 < activeNodes);
    }
  }

  function drawFallbackMark(context) {
    context.save();
    context.translate(960, 462);
    context.strokeStyle = PALETTE.ink;
    context.fillStyle = 'rgba(248, 252, 252, 0.82)';
    context.lineWidth = 4;
    hexPath(context, 0, 0, 168);
    context.fill();
    context.stroke();

    context.strokeStyle = PALETTE.orange;
    context.lineWidth = 18;
    line(context, -94, 72, 78, -96);
    line(context, -42, -102, 96, 70);
    context.fillStyle = PALETTE.ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '800 72px Georgia, "Times New Roman", serif';
    context.fillText('PZ', 0, -8);
    context.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText('SYSTEM 00', 0, 62);
    context.font = '600 25px Georgia, "Times New Roman", serif';
    context.fillText('PROJECT ZERO', 0, 225);
    context.restore();
    record(context, 'mark:fallback:project-zero');
  }

  function drawMark(context, assets) {
    if (assets?.mark) {
      try {
        context.drawImage(assets.mark, 755, 258, 410, 410);
        record(context, 'mark:private');
        return;
      } catch {
        record(context, 'mark:private:error');
      }
    }
    drawFallbackMark(context);
  }

  function drawStageLabels(context, snapshot) {
    const stageCopy = {
      wake: ['SYSTEM WAKE', '系统启动', '起動系統'],
      scan: ['SYSTEM CHECK', '系统检查', '接続監視'],
      synchronize: ['SYNCHRONIZATION', '同步监测', '同期監視'],
      authorize: ['PILOT AUTHORIZATION', '驾驶员确认', '操縦確認'],
      connect: ['WORKBENCH CONNECTION', '工作台连接', '接続完了']
    }[snapshot.stage];

    context.fillStyle = PALETTE.ink;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.font = '600 52px Georgia, "Times New Roman", serif';
    context.fillText(stageCopy[0], 960, 150);
    record(context, 'heading:title', {
      stage: snapshot.stage,
      key: `boot.${snapshot.stage}.heading`,
      text: stageCopy[0],
      reducedMotion: snapshot.reducedMotion
    });
    context.fillStyle = PALETTE.muted;
    context.font = '600 18px "Helvetica Neue", Arial, sans-serif';
    context.fillText(`${stageCopy[1]}  /  ${stageCopy[2]}`, 960, 188);
    record(context, `label:zh:${stageCopy[1]}`);
    record(context, `label:ja:${stageCopy[2]}`);

    context.fillStyle = PALETTE.muted;
    context.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textAlign = 'left';
    context.fillText('LOCAL-CONTROL  /  LOOPBACK-ONLY', 96, 57);
    context.textAlign = 'right';
    context.fillText('SYNC-MONITOR  /  PROJECT-ZERO-00', 1824, 57);
    record(context, 'label:tech:LOCAL-CONTROL');
    record(context, 'label:tech:SYNC-MONITOR');
  }

  function drawScanField(context, snapshot) {
    if (snapshot.stage !== 'scan') {
      record(context, 'scan:state', {drawn: false, position: null, top: null});
      return;
    }
    const top = 980 - snapshot.scan * 770;
    context.save();
    context.beginPath();
    context.moveTo(0, top + 20);
    for (let x = 0; x <= DESIGN_WIDTH; x += 80) {
      const wave = Math.sin((x / DESIGN_WIDTH) * Math.PI * 6) * 18;
      context.lineTo(x, top + wave);
    }
    context.lineTo(DESIGN_WIDTH, DESIGN_HEIGHT);
    context.lineTo(0, DESIGN_HEIGHT);
    context.closePath();
    context.fillStyle = PALETTE.orangeField;
    context.fill();
    context.strokeStyle = PALETTE.orange;
    context.lineWidth = 5;
    context.stroke();
    context.restore();
    record(context, 'scan:state', {drawn: true, position: snapshot.scan, top});
    record(context, 'scan:orange-field', {top});
    record(context, 'scan:wave-edge');
  }

  function drawSyncRings(context, snapshot) {
    if (!['synchronize', 'authorize', 'connect'].includes(snapshot.stage)) {
      record(context, 'progress:state', {drawn: false, value: snapshot.progress});
      return;
    }
    const progressRadians = -Math.PI / 2 + TAU * (snapshot.progress / 100);
    const isComplete = snapshot.progress >= 100;
    context.save();
    context.translate(960, 522);
    context.strokeStyle = 'rgba(79, 148, 169, 0.24)';
    context.lineWidth = 3;
    for (const radius of [174, 220, 268]) {
      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.stroke();
    }
    context.strokeStyle = isComplete ? PALETTE.green : PALETTE.cyan;
    context.lineWidth = 14;
    context.lineCap = 'square';
    context.beginPath();
    context.arc(0, 0, 220, -Math.PI / 2, progressRadians);
    context.stroke();

    context.fillStyle = PALETTE.ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '300 108px ui-monospace, SFMono-Regular, Menlo, monospace';
    const progressText = snapshot.progress.toFixed(1);
    context.fillText(progressText, 0, -8);
    context.fillStyle = isComplete ? PALETTE.green : PALETTE.orangeDeep;
    context.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText('%  SYNCHRONIZATION', 0, 72);
    context.restore();
    record(context, 'progress:state', {drawn: true, value: Number(progressText)});
    record(context, 'ring:sync');
    record(context, `progress:${progressText}`);
  }

  function drawAuthorization(context, snapshot) {
    if (snapshot.stage !== 'authorize') return;
    context.save();
    context.fillStyle = 'rgba(238, 135, 72, 0.12)';
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    context.fillStyle = 'rgba(248, 252, 252, 0.94)';
    context.strokeStyle = PALETTE.orange;
    context.lineWidth = 3;
    context.fillRect(640, 840, 640, 116);
    context.beginPath();
    context.rect(640, 840, 640, 116);
    context.stroke();
    context.fillStyle = PALETTE.orangeDeep;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText('PILOT-00  /  AUTHORIZATION REQUIRED', 960, 884);
    context.fillStyle = PALETTE.ink;
    context.font = '600 16px "Helvetica Neue", Arial, sans-serif';
    context.fillText('系统信息检查完成 · 等待本地确认', 960, 920);
    context.restore();
    record(context, 'flash:authorization');
    record(context, 'authorization:pilot-00');
  }

  function drawConnection(context, snapshot) {
    if (snapshot.stage !== 'connect') return;
    context.save();
    context.fillStyle = 'rgba(237, 246, 248, 0.88)';
    context.fillRect(560, 816, 800, 154);
    context.strokeStyle = snapshot.progress >= 100 ? PALETTE.green : PALETTE.cyan;
    context.lineWidth = 3;
    context.beginPath();
    context.rect(560, 816, 800, 154);
    context.stroke();
    context.fillStyle = PALETTE.ink;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 32px Georgia, "Times New Roman", serif';
    context.fillText('WORKBENCH CONNECTION', 960, 864);
    context.font = '600 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillStyle = PALETTE.muted;
    context.fillText('LOCAL SESSION  /  HANDOFF CHANNEL', 960, 905);
    record(context, 'connection:title');

    if (snapshot.progress >= 100) {
      context.fillStyle = PALETTE.green;
      context.font = '700 21px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.fillText('SYSTEM ONLINE', 960, 944);
      record(context, 'handoff:complete');
    }
    context.restore();
  }

  function drawBootFrame(context, snapshotInput, assets = {}, viewportInput = {}) {
    if (!context) throw new TypeError('BOOT_CANVAS_CONTEXT_REQUIRED');
    const snapshot = safeSnapshot(snapshotInput);
    const safeAssets = trustedAssets(assets);
    const viewport = safeViewport(viewportInput);
    const scale = Math.min(viewport.width / DESIGN_WIDTH, viewport.height / DESIGN_HEIGHT);
    const offsetX = (viewport.width - DESIGN_WIDTH * scale) / 2;
    const offsetY = (viewport.height - DESIGN_HEIGHT * scale) / 2;
    const collector = renderRecordCollector();
    const previousRecordSink = frameRecordSinks.get(context);
    frameRecordSinks.set(context, collector.capture);

    try {
      context.save();
      drawSurface(context, viewport);
      context.translate(offsetX, offsetY);
      context.scale(scale, scale);
      drawFineGrid(context);
      drawScanField(context, snapshot);
      drawNodeBanks(context, snapshot.activeNodes);
      drawStageLabels(context, snapshot);
      if (!['synchronize', 'authorize', 'connect'].includes(snapshot.stage)) {
        drawMark(context, safeAssets);
      } else {
        record(context, 'mark:not-drawn');
      }
      drawSyncRings(context, snapshot);
      drawAuthorization(context, snapshot);
      drawConnection(context, snapshot);
      context.restore();
    } finally {
      if (previousRecordSink) frameRecordSinks.set(context, previousRecordSink);
      else frameRecordSinks.delete(context);
    }
    return collector.finish();
  }

  function createBootCanvas(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('BOOT_CANVAS_ELEMENT_REQUIRED');
    const context = canvas.getContext('2d');
    if (!context) throw new TypeError('BOOT_CANVAS_2D_REQUIRED');
    let assets = trustedAssets(options.assets);
    const pixelRatioSource = options.devicePixelRatio;
    const dataMotionSource = options.dataMotion;
    const mediaPreferenceSource = options.prefersReducedMotion;
    const exposeRenderRecord = options.exposeRenderRecord === true;
    let currentViewport = {width: 1, height: 1, pixelRatio: 1};
    let currentSnapshot;
    let currentRenderRecord;
    let renderCount = 0;

    function sourcePixelRatio(explicit) {
      if (Number.isFinite(explicit)) return explicit;
      if (typeof pixelRatioSource === 'function') return pixelRatioSource();
      return Number.isFinite(pixelRatioSource) ? pixelRatioSource : 1;
    }

    function prefersReducedMotion(snapshot) {
      if (snapshot?.reducedMotion === true) return true;
      if (typeof dataMotionSource === 'function' && dataMotionSource() === 'reduced') return true;
      return typeof mediaPreferenceSource === 'function' && mediaPreferenceSource() === true;
    }

    function snapshotForMotion(snapshot) {
      if (!prefersReducedMotion(snapshot)) return snapshot;
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      return source.reducedMotion === true ? source : {...source, reducedMotion: true};
    }

    function drawCurrentSnapshot() {
      const record = drawBootFrame(
        context,
        snapshotForMotion(currentSnapshot),
        assets,
        currentViewport
      );
      currentRenderRecord = Object.freeze({renderCount: ++renderCount, ...record});
    }

    function resize(width = canvas.clientWidth, height = canvas.clientHeight, explicitPixelRatio) {
      const safeWidth = Math.max(1, Math.round(finite(width, 1)));
      const safeHeight = Math.max(1, Math.round(finite(height, 1)));
      const sourceRatio = sourcePixelRatio(explicitPixelRatio);
      const pixelRatio = Number.isFinite(sourceRatio) && sourceRatio > 0 ? Math.min(sourceRatio, 2) : 1;
      canvas.width = Math.round(safeWidth * pixelRatio);
      canvas.height = Math.round(safeHeight * pixelRatio);
      canvas.style.width = `${safeWidth}px`;
      canvas.style.height = `${safeHeight}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      currentViewport = {width: safeWidth, height: safeHeight, pixelRatio};
      if (currentSnapshot) drawCurrentSnapshot();
      return currentViewport;
    }

    function render(snapshot) {
      currentSnapshot = snapshot;
      drawCurrentSnapshot();
    }

    function setAssets(nextAssets) {
      assets = trustedAssets(nextAssets);
      if (currentSnapshot) drawCurrentSnapshot();
      return assets;
    }

    resize();
    const api = {
      lastSnapshot: () => currentSnapshot,
      render,
      resize,
      setAssets,
      viewport: () => ({...currentViewport})
    };
    if (exposeRenderRecord) api.lastRenderRecord = () => currentRenderRecord;
    return Object.freeze(api);
  }

  return Object.freeze({
    DESIGN_HEIGHT,
    DESIGN_WIDTH,
    createBootCanvas,
    drawBootFrame,
    loadBootAssets,
    prepareBootAssets
  });
});
