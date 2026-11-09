'use strict';

(function installProjectZeroBoot(root) {
  const PRIVATE_THEME_URL = '/private/theme.json';
  const PRIVATE_MARK_URL = '/private/boot-mark.webp';
  const PRIVATE_PORTRAIT_URL = '/private/rei-portrait.webp';
  const PRIVATE_SOUNDTRACK_URLS = new Set([
    '/private/startup-reference.wav',
    '/private/startup-reference.m4a'
  ]);
  const AUTHORIZATION_MS = 15_500;
  const PRESENTATION_END_MS = 20_500;
  const PRIVATE_THEME_FIELDS = Object.freeze([
    'audioEndMs',
    'audioStartMs',
    'displayName',
    'mark',
    'portrait',
    'soundtrack'
  ]);
  const PUBLIC_PRESENTATION = Object.freeze({
    audio: null,
    audioStartMs: 0,
    audioEndMs: PRESENTATION_END_MS,
    portrait: null
  });
  const STAGE_TEXT = Object.freeze({
    wake: Object.freeze({
      heading: '系统唤醒',
      caption: '正在初始化本地启动序列',
      live: '系统唤醒阶段。'
    }),
    scan: Object.freeze({
      heading: '系统扫描',
      caption: '正在检查本地工作台组件',
      live: '系统扫描阶段。'
    }),
    synchronize: Object.freeze({
      heading: '系统同步中',
      caption: '正在建立本地工作台链路',
      live: '同步进度正在推进。'
    }),
    authorize: Object.freeze({
      heading: '等待用户确认',
      caption: '同步锁定在 99.2%',
      live: '同步已到达 99.2%，等待后端就绪和用户确认。'
    }),
    connect: Object.freeze({
      heading: '正在完成同步',
      caption: '正在连接本地工作台',
      live: '用户确认已记录，正在完成连接。'
    })
  });
  const READINESS_DETAILS = Object.freeze({
    INITIALIZING: Object.freeze({
      backend: '初始化中',
      diagnostic: '正在连接官方 Codex 服务；请稍候。',
      retry: false
    }),
    CODEX_NOT_FOUND: Object.freeze({
      backend: '未找到 Codex',
      diagnostic: '未检测到可用的 Codex 安装。请安装或配置后重试。',
      retry: true
    }),
    SIGNED_OUT: Object.freeze({
      backend: '需要登录',
      diagnostic: 'Codex 尚未登录。请完成官方 ChatGPT 登录后重试。',
      retry: true
    }),
    NO_LAUNCHABLE_MODEL: Object.freeze({
      backend: '无可用模型',
      diagnostic: '当前账户没有可启动的 Codex 模型。请检查账户后重试。',
      retry: true
    }),
    DISCONNECTED: Object.freeze({
      backend: '连接已断开',
      diagnostic: 'Codex 连接已断开。请重试建立本地连接。',
      retry: true
    }),
    READY: Object.freeze({backend: '已就绪', retry: false})
  });

  function createBootController({
    api,
    bootCanvas = root.ProjectZeroBootCanvasInstance,
    clock,
    createAudioClock = root.ProjectZeroAudioClock?.createAudioClock,
    document,
    fetch: fetchPrivate = typeof root.fetch === 'function' ? root.fetch.bind(root) : undefined,
    loadSequenceAudio = root.ProjectZeroSequenceAudio?.loadSequenceAudio,
    now,
    reducedMotion,
    sampleTimeline = root.ProjectZeroTimeline?.sampleTimeline,
    forceFullPlayback = false,
    volume = 0.65,
    root: eventRoot
  }) {
    const circumference = 2 * Math.PI * 132;
    const elements = {
      backend: document.querySelector('#backend-state'),
      authorization: document.querySelector('#pilot-authorization'),
      caption: document.querySelector('#phase-caption'),
      clock: document.querySelector('#clock-readout'),
      confirm: document.querySelector('#confirm-button'),
      diagnostic: document.querySelector('#diagnostic-text'),
      heading: document.querySelector('#sync-heading'),
      live: document.querySelector('#boot-live-status'),
      progress: document.querySelector('#progress-value'),
      progressbar: document.querySelector('#ring-progress'),
      retry: document.querySelector('#retry-button'),
      ring: document.querySelector('#ring-stroke'),
      skip: document.querySelector('#skip-button'),
      bootScreen: document.querySelector('#boot-screen'),
      workbench: document.querySelector('#workbench-shell'),
      shellReadiness: document.querySelector('#shell-readiness-text'),
      shellLinkState: document.querySelector('#shell-link-state'),
      shellDiagnostic: document.querySelector('#shell-diagnostic-text'),
      shellRetry: document.querySelector('#shell-retry-button')
    };
    let state = {phase: 'syncing', progress: 0, ready: false, confirmed: false};
    let currentSnapshot;
    let started = false;
    let destroyed = false;
    let healthGeneration = 0;
    let healthController;
    let retryController;
    let completionController;
    let retryInFlight = false;
    let confirmationInFlight = false;
    let skipInFlight = false;
    let completionInFlight = false;
    let gatePaused = false;
    let healthTimer;
    let transitionTimer;
    let transitionResolve;
    let readinessCode = 'INITIALIZING';
    let audioClock;
    let presentationPromise;

    function setText(element, value) {
      if (!destroyed && element && element.textContent !== value) element.textContent = value;
    }

    function normalizedVolume() {
      const numeric = Number(volume);
      return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.65;
    }

    function silentTrack() {
      let currentTime = 0;
      let trackVolume = normalizedVolume();
      const track = {
        play: () => Promise.reject(new Error('SILENT_PRESENTATION_CLOCK')),
        pause() {},
        close: () => Promise.resolve()
      };
      Object.defineProperties(track, {
        currentTime: {
          enumerable: true,
          get: () => currentTime,
          set: value => { currentTime = Number.isFinite(value) ? Math.max(0, value) : 0; }
        },
        volume: {
          enumerable: true,
          get: () => trackVolume,
          set: value => {
            trackVolume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : trackVolume;
          }
        }
      });
      return track;
    }

    function normalizePrivateTheme(theme) {
      if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return PUBLIC_PRESENTATION;
      const fields = Object.keys(theme).sort();
      if (fields.length !== PRIVATE_THEME_FIELDS.length
        || fields.some((field, index) => field !== PRIVATE_THEME_FIELDS[index])) {
        return PUBLIC_PRESENTATION;
      }
      if (typeof theme.displayName !== 'string'
        || theme.mark !== PRIVATE_MARK_URL
        || theme.portrait !== PRIVATE_PORTRAIT_URL
        || !PRIVATE_SOUNDTRACK_URLS.has(theme.soundtrack)
        || !Number.isSafeInteger(theme.audioStartMs)
        || !Number.isSafeInteger(theme.audioEndMs)
        || theme.audioStartMs < 0
        || theme.audioEndMs - theme.audioStartMs !== PRESENTATION_END_MS) {
        return PUBLIC_PRESENTATION;
      }
      return Object.freeze({
        audio: theme.soundtrack,
        audioStartMs: theme.audioStartMs,
        audioEndMs: theme.audioEndMs,
        portrait: PRIVATE_PORTRAIT_URL
      });
    }

    async function loadPresentationTheme() {
      if (typeof fetchPrivate !== 'function') return PUBLIC_PRESENTATION;
      try {
        const response = await fetchPrivate(PRIVATE_THEME_URL, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {Accept: 'application/json'}
        });
        if (!response?.ok) return PUBLIC_PRESENTATION;
        return normalizePrivateTheme(await response.json());
      } catch {
        return PUBLIC_PRESENTATION;
      }
    }

    function applyPrivatePresentation(theme) {
      const style = document.documentElement?.style;
      if (!style) return;
      if (theme.portrait === PRIVATE_PORTRAIT_URL) {
        style.setProperty('--theme-workbench-portrait', `url("${PRIVATE_PORTRAIT_URL}")`);
      } else {
        style.removeProperty('--theme-workbench-portrait');
      }
    }

    function stageText(snapshot) {
      return STAGE_TEXT[snapshot?.stage] || STAGE_TEXT.wake;
    }

    function renderAccessibleState(snapshot) {
      const progress = Math.max(0, Math.min(100, snapshot.progress));
      const text = stageText(snapshot);
      document.body.dataset.stage = snapshot.stage;
      setText(elements.progress, progress.toFixed(1));
      setText(elements.clock, `T+${(snapshot.elapsedMs / 1000).toFixed(1).padStart(5, '0')}`);
      elements.ring.setAttribute('stroke-dashoffset', String(circumference * (1 - progress / 100)));
      elements.progressbar.setAttribute('aria-valuenow', progress.toFixed(1));
      elements.authorization.hidden = snapshot.stage !== 'authorize' || state.confirmed;
      elements.confirm.disabled = confirmationInFlight
        || !(snapshot.stage === 'authorize'
          && state.progress === api.MAX_UNCONFIRMED_PROGRESS
          && state.ready
          && !state.confirmed);

      if (state.phase === 'complete') {
        setText(elements.heading, 'SYSTEM ONLINE');
        setText(elements.caption, '本地工作台已就绪');
        setText(elements.live, '本地工作台已就绪。');
      } else if (state.phase === 'completing') {
        setText(elements.heading, '正在完成同步');
        setText(elements.caption, '用户确认已记录');
        setText(elements.live, text.live);
      } else if (state.phase === 'failed') {
        setText(elements.heading, '等待服务响应');
        setText(elements.caption, '动态演示不会绕过连接检查');
        setText(elements.live, snapshot.stage === 'authorize'
          ? '同步已到达 99.2%，等待后端恢复。'
          : text.live);
      } else if (snapshot.stage === 'authorize' || state.phase === 'waiting') {
        setText(elements.heading, state.ready ? '等待用户确认' : '等待后端就绪');
        setText(elements.caption, '同步锁定在 99.2%');
        setText(elements.live, text.live);
      } else {
        setText(elements.heading, text.heading);
        setText(elements.caption, text.caption);
        setText(elements.live, text.live);
      }
    }

    function render() {
      if (destroyed || !currentSnapshot) return;
      document.body.dataset.phase = state.phase;
      document.body.dataset.scene = state.phase === 'complete' ? 'online' : 'sync';
      renderAccessibleState(currentSnapshot);
      if (state.phase === 'complete') {
        setText(elements.diagnostic, '同步已由用户确认，正在进入工作台。');
        setText(elements.backend, '已就绪');
      } else if (state.phase === 'completing') {
        setText(elements.diagnostic, '正在安全切换至工作台界面。');
      }
    }

    function dispatch(event) {
      if (destroyed) return false;
      const wasConfirmed = state.confirmed;
      const next = api.nextBootState(state, event);
      if (next === state) {
        render();
        return false;
      }
      state = next;
      if (event.type === 'failed' && wasConfirmed && !gatePaused) {
        audioClock?.pause();
        gatePaused = true;
      }
      render();
      if (state.phase === 'complete') unbindBootInteractions();
      return true;
    }

    function renderTimeline(elapsedMs) {
      if (destroyed || typeof sampleTimeline !== 'function') return;
      const snapshot = sampleTimeline(elapsedMs, {
        authorized: state.confirmed,
        reducedMotion
      });
      currentSnapshot = snapshot;
      document.body.dataset.stage = snapshot.stage;
      bootCanvas?.render?.(snapshot);
      const delta = snapshot.progress - state.progress;
      if (delta > 0) dispatch({type: 'tick', delta});
      else render();
      if (!state.confirmed && snapshot.elapsedMs >= AUTHORIZATION_MS && !gatePaused) {
        gatePaused = true;
        audioClock?.pause();
      }
    }

    function normalizeReadiness(health) {
      if (!health || typeof health !== 'object') return 'DISCONNECTED';
      if (Object.hasOwn(READINESS_DETAILS, health.code)) {
        if (health.code === 'READY') return health.ready === true ? 'READY' : 'DISCONNECTED';
        return health.ready === true ? 'DISCONNECTED' : health.code;
      }
      return health.ready === true ? 'READY' : 'INITIALIZING';
    }

    function applyReadiness(health, {retrying = false} = {}) {
      const code = normalizeReadiness(health);
      readinessCode = code;
      document.body.dataset.readiness = code.toLowerCase();
      if (state.phase === 'complete') {
        const details = READINESS_DETAILS[code];
        setText(elements.shellReadiness, code === 'READY' ? '本地链路已就绪' : details.backend);
        setText(elements.shellLinkState, code);
        setText(elements.shellDiagnostic, code === 'READY'
          ? 'Codex 链路正在接受持续本地健康检查。'
          : details.diagnostic);
      } else if (code === 'READY') {
        dispatch({type: 'ready'});
        setText(elements.backend, READINESS_DETAILS.READY.backend);
        setText(elements.diagnostic, state.progress === api.MAX_UNCONFIRMED_PROGRESS
          ? '安全条件已满足，请进行用户确认。'
          : '本地后端已就绪，等待同步演示完成。');
      } else {
        if (code !== 'INITIALIZING' || state.ready || state.confirmed) dispatch({type: 'failed'});
        const details = READINESS_DETAILS[code];
        setText(elements.backend, details.backend);
        setText(elements.diagnostic, details.diagnostic);
      }
      const canRetry = READINESS_DETAILS[code].retry;
      elements.retry.hidden = state.phase === 'complete' || !(canRetry || retrying);
      elements.retry.disabled = retrying || !canRetry;
      elements.shellRetry.hidden = state.phase !== 'complete' || !(canRetry || retrying);
      elements.shellRetry.disabled = retrying || !canRetry;
    }

    function scheduleHealth(delay) {
      if (destroyed || healthTimer !== undefined) return;
      healthTimer = clock.setTimeout(pollHealth, delay);
    }

    function stopHealth() {
      healthGeneration += 1;
      if (healthTimer !== undefined) clock.clearTimeout(healthTimer);
      healthTimer = undefined;
      healthController?.abort();
      healthController = undefined;
    }

    async function pollHealth() {
      healthTimer = undefined;
      if (destroyed) return;
      const generation = ++healthGeneration;
      const controller = new root.AbortController();
      healthController = controller;

      try {
        const health = await api.health({signal: controller.signal});
        if (destroyed || generation !== healthGeneration) return;
        applyReadiness(health);
      } catch {
        if (destroyed || generation !== healthGeneration || controller.signal.aborted) return;
        applyReadiness({ready: false, code: 'DISCONNECTED'});
      } finally {
        if (generation === healthGeneration) {
          healthController = undefined;
          scheduleHealth(500);
        }
      }
    }

    async function retryInitialization() {
      const activeRetry = state.phase === 'complete' ? elements.shellRetry : elements.retry;
      if (destroyed || retryInFlight || activeRetry.hidden
        || !READINESS_DETAILS[readinessCode].retry) return;
      retryInFlight = true;
      stopHealth();
      applyReadiness({ready: false, code: 'INITIALIZING'}, {retrying: true});
      const controller = new root.AbortController();
      retryController = controller;
      try {
        await api.retryReadiness({signal: controller.signal});
        if (destroyed || controller.signal.aborted) return;
        scheduleHealth(0);
      } catch {
        if (destroyed || controller.signal.aborted) return;
        applyReadiness({ready: false, code: 'DISCONNECTED'});
        scheduleHealth(500);
      } finally {
        if (retryController === controller) retryController = undefined;
        if (!destroyed) retryInFlight = false;
      }
    }

    async function confirm() {
      if (destroyed || confirmationInFlight || skipInFlight || completionInFlight
        || state.confirmed || state.ready !== true
        || state.progress !== api.MAX_UNCONFIRMED_PROGRESS
        || currentSnapshot?.stage !== 'authorize') return;
      confirmationInFlight = true;
      render();
      stopHealth();
      const generation = ++healthGeneration;
      const controller = new root.AbortController();
      healthController = controller;
      try {
        const health = await api.health({signal: controller.signal});
        if (destroyed || generation !== healthGeneration || controller.signal.aborted) return;
        if (health?.ready !== true || health.code !== 'READY') {
          applyReadiness({ready: false, code: 'DISCONNECTED'});
          return;
        }
        applyReadiness(health);
        if (!dispatch({type: 'confirm'})) return;
        gatePaused = false;
        await audioClock?.resume();
        if (destroyed || generation !== healthGeneration) return;
      } catch {
        if (destroyed || generation !== healthGeneration || controller.signal.aborted) return;
        applyReadiness({ready: false, code: 'DISCONNECTED'});
      } finally {
        if (healthController === controller) healthController = undefined;
        if (!destroyed && generation === healthGeneration) scheduleHealth(500);
        confirmationInFlight = false;
        render();
      }
    }

    async function skipPresentation() {
      if (destroyed || forceFullPlayback || skipInFlight
        || confirmationInFlight || completionInFlight
        || state.phase === 'completing' || state.phase === 'complete') return;
      skipInFlight = true;
      try {
        if (!audioClock) await presentationPromise;
        if (destroyed || !audioClock) return;
        await audioClock.fadeOut(150);
        if (destroyed) return;
        audioClock.seek(AUTHORIZATION_MS);
        if (destroyed) return;
        if (!dispatch({type: 'skip'})) return;
        gatePaused = true;
        renderTimeline(AUTHORIZATION_MS);
      } catch {
        if (!destroyed) applyReadiness({ready: false, code: 'DISCONNECTED'});
      } finally {
        skipInFlight = false;
        render();
      }
    }

    function waitForCurtain() {
      return new Promise(resolve => {
        transitionResolve = resolve;
        transitionTimer = clock.setTimeout(() => {
          transitionTimer = undefined;
          transitionResolve = undefined;
          resolve(true);
        }, 180);
      });
    }

    async function completePresentation() {
      if (destroyed || completionInFlight || state.phase !== 'completing') return;
      completionInFlight = true;
      stopHealth();
      document.body.dataset.transition = 'closing';
      try {
        if (!await waitForCurtain() || destroyed) return;
        const controller = new root.AbortController();
        completionController = controller;
        await api.completePresentation({signal: controller.signal});
        if (destroyed || controller.signal.aborted || state.phase !== 'completing') return;
        elements.bootScreen.hidden = true;
        elements.workbench.hidden = false;
        dispatch({type: 'complete'});
        delete document.body.dataset.transition;
        applyReadiness({ready: true, code: 'READY'});
        scheduleHealth(500);
      } catch {
        if (destroyed || completionController?.signal.aborted) return;
        delete document.body.dataset.transition;
        applyReadiness({ready: false, code: 'DISCONNECTED'});
        scheduleHealth(500);
      } finally {
        completionController = undefined;
        completionInFlight = false;
      }
    }

    function onKeydown(event) {
      if (event.key !== 'Escape') return;
      return skipPresentation();
    }

    function unbindBootInteractions() {
      elements.confirm.removeEventListener('click', confirm);
      elements.retry.removeEventListener('click', retryInitialization);
      elements.skip.removeEventListener('click', skipPresentation);
      eventRoot.removeEventListener('keydown', onKeydown);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopHealth();
      retryController?.abort();
      retryController = undefined;
      completionController?.abort();
      completionController = undefined;
      if (transitionTimer !== undefined) clock.clearTimeout(transitionTimer);
      transitionTimer = undefined;
      const resolveTransition = transitionResolve;
      transitionResolve = undefined;
      resolveTransition?.(false);
      if (audioClock) void Promise.resolve(audioClock.destroy()).catch(() => {});
      unbindBootInteractions();
      elements.shellRetry.removeEventListener('click', retryInitialization);
      eventRoot.removeEventListener('pagehide', destroy);
    }

    async function initializePresentation() {
      const theme = await loadPresentationTheme();
      if (destroyed) return;
      applyPrivatePresentation(theme);
      let decodedTrack = silentTrack();
      if (theme.audio && typeof loadSequenceAudio === 'function') {
        try {
          decodedTrack = await loadSequenceAudio(theme.audio, {
            fetch: fetchPrivate,
            AudioContext: root.AudioContext || root.webkitAudioContext
          });
        } catch {
          decodedTrack = silentTrack();
        }
      }
      if (destroyed) {
        await Promise.resolve(decodedTrack.close?.()).catch(() => {});
        return;
      }
      decodedTrack.volume = normalizedVolume();
      if (typeof createAudioClock !== 'function') return;
      audioClock = createAudioClock({
        audio: decodedTrack,
        startSeconds: theme.audioStartMs / 1000,
        endSeconds: theme.audioEndMs / 1000,
        now,
        onTick: elapsedMs => renderTimeline(elapsedMs),
        onEnd: () => completePresentation(),
        requestAnimationFrame: typeof eventRoot.requestAnimationFrame === 'function'
          ? eventRoot.requestAnimationFrame.bind(eventRoot)
          : undefined,
        cancelAnimationFrame: typeof eventRoot.cancelAnimationFrame === 'function'
          ? eventRoot.cancelAnimationFrame.bind(eventRoot)
          : undefined,
        setTimeout: clock.setTimeout.bind(clock),
        clearTimeout: clock.clearTimeout.bind(clock)
      });
      if (destroyed) {
        await Promise.resolve(audioClock.destroy()).catch(() => {});
        return;
      }
      await audioClock.start();
    }

    function start() {
      if (started || destroyed) return presentationPromise || Promise.resolve();
      started = true;
      document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
      elements.ring.setAttribute('stroke-dasharray', String(circumference));
      elements.confirm.addEventListener('click', confirm);
      elements.retry.addEventListener('click', retryInitialization);
      elements.shellRetry.addEventListener('click', retryInitialization);
      elements.skip.addEventListener('click', skipPresentation);
      eventRoot.addEventListener('keydown', onKeydown);
      eventRoot.addEventListener('pagehide', destroy);
      elements.skip.hidden = forceFullPlayback;
      currentSnapshot = sampleTimeline(0, {authorized: false, reducedMotion});
      bootCanvas?.render?.(currentSnapshot);
      render();
      scheduleHealth(0);
      presentationPromise = initializePresentation().catch(() => {
        if (!destroyed) applyReadiness({ready: false, code: 'DISCONNECTED'});
      });
      return presentationPromise;
    }

    return {destroy, getState: () => state, start};
  }

  root.ProjectZeroBoot = Object.freeze({createBootController});

  if (root.document && root.ProjectZeroApi && !root.ProjectZeroBootController) {
    let bootSettings = {};
    try { bootSettings = JSON.parse(root.localStorage?.getItem('project-zero.settings.v1') || '{}'); } catch {}
    root.ProjectZeroBootController = createBootController({
      api: root.ProjectZeroApi,
      clock: root,
      document: root.document,
      now: () => root.performance.now(),
      reducedMotion: bootSettings.reducedMotion === true
        || root.matchMedia('(prefers-reduced-motion: reduce)').matches,
      forceFullPlayback: bootSettings.forceFullPlayback === true,
      volume: Number.isFinite(Number(bootSettings.volume)) ? Number(bootSettings.volume) : 0.65,
      root
    });
    void root.ProjectZeroBootController.start();
  }
}(globalThis));
