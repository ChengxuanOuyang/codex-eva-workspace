'use strict';

(function installProjectZeroBoot(root) {
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

  function createBootController({api, clock, document, now, reducedMotion, root: eventRoot}) {
    const circumference = 2 * Math.PI * 132;
    const startedAt = now();
    const elements = {
      backend: document.querySelector('#backend-state'),
      caption: document.querySelector('#phase-caption'),
      clock: document.querySelector('#clock-readout'),
      confirm: document.querySelector('#confirm-button'),
      diagnostic: document.querySelector('#diagnostic-text'),
      heading: document.querySelector('#sync-heading'),
      progress: document.querySelector('#progress-value'),
      progressbar: document.querySelector('#ring-progress'),
      retry: document.querySelector('#retry-button'),
      ring: document.querySelector('#ring-stroke'),
      skip: document.querySelector('#skip-button'),
      bootScreen: document.querySelector('#boot-screen'),
      workbench: document.querySelector('#workbench-shell')
    };
    let state = {phase: 'syncing', progress: 0, ready: false, confirmed: false};
    let started = false;
    let destroyed = false;
    let skipAvailable = false;
    let healthGeneration = 0;
    let healthController;
    let retryController;
    let retryInFlight = false;
    let healthTimer;
    let tickTimer;
    let clockTimer;
    let skipTimer;
    let completeTimer;
    let awakeningTimer;
    let opening = true;

    function setText(element, value) {
      if (!destroyed && element.textContent !== value) element.textContent = value;
    }

    function stopTicker() {
      if (tickTimer === undefined) return;
      clock.clearInterval(tickTimer);
      tickTimer = undefined;
    }

    function freezePresentation() {
      if (clockTimer !== undefined) clock.clearInterval(clockTimer);
      clockTimer = undefined;
    }

    function stopPresentation() {
      stopTicker();
      freezePresentation();
      if (skipTimer !== undefined) clock.clearTimeout(skipTimer);
      skipTimer = undefined;
      if (awakeningTimer !== undefined) clock.clearTimeout(awakeningTimer);
      awakeningTimer = undefined;
    }

    function stopHealth() {
      healthGeneration += 1;
      if (healthTimer !== undefined) clock.clearTimeout(healthTimer);
      healthTimer = undefined;
      healthController?.abort();
      healthController = undefined;
    }

    function render() {
      if (destroyed) return;
      const progress = Math.max(0, Math.min(100, state.progress));
      document.body.dataset.phase = state.phase;
      document.body.dataset.scene = state.phase === 'complete' ? 'online' : opening ? 'awakening' : 'sync';
      setText(elements.progress, progress.toFixed(1).padStart(4, '0'));
      elements.ring.setAttribute('stroke-dashoffset', String(circumference * (1 - progress / 100)));
      elements.progressbar.setAttribute('aria-valuenow', progress.toFixed(1));
      elements.confirm.disabled = !(progress === api.MAX_UNCONFIRMED_PROGRESS && state.ready && !state.confirmed);

      if (state.phase === 'complete') {
        setText(elements.heading, 'SYSTEM ONLINE');
        setText(elements.caption, '本地工作台已就绪');
        setText(elements.diagnostic, '同步已由用户确认，正在进入工作台。');
        setText(elements.backend, '已就绪');
      } else if (state.phase === 'completing') {
        setText(elements.heading, '正在完成同步');
        setText(elements.caption, '用户确认已记录');
        setText(elements.diagnostic, '正在安全切换至工作台界面。');
      } else if (state.phase === 'failed') {
        setText(elements.heading, '等待服务响应');
        setText(elements.caption, '动态演示不会绕过连接检查');
      } else if (state.phase === 'waiting') {
        setText(elements.heading, progress === api.MAX_UNCONFIRMED_PROGRESS ? '等待用户确认' : '等待安全条件');
        setText(elements.caption, '演示已简化，后台检查仍在继续');
      } else if (progress === api.MAX_UNCONFIRMED_PROGRESS) {
        setText(elements.heading, state.ready ? '等待用户确认' : '等待后端就绪');
        setText(elements.caption, '同步锁定在 99.2%');
      }
    }

    function dispatch(event) {
      if (destroyed) return false;
      const next = api.nextBootState(state, event);
      if (event.type === 'failed' && completeTimer !== undefined) {
        clock.clearTimeout(completeTimer);
        completeTimer = undefined;
      }
      if (next === state) {
        if (state.phase === 'waiting') freezePresentation();
        return false;
      }
      state = next;
      render();
      if (state.phase === 'waiting') freezePresentation();
      if (state.progress === api.MAX_UNCONFIRMED_PROGRESS) stopTicker();
      if (state.phase === 'complete') unbindInteractions();
      return true;
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
      document.body.dataset.readiness = code.toLowerCase();
      if (code === 'READY') {
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
      elements.retry.hidden = !(canRetry || retrying);
      elements.retry.disabled = retrying || !canRetry;
    }

    function scheduleHealth(delay) {
      if (destroyed || state.phase === 'complete') return;
      healthTimer = clock.setTimeout(pollHealth, delay);
    }

    function completionFailure(health) {
      const code = normalizeReadiness(health);
      return code === 'READY' || code === 'INITIALIZING'
        ? {ready: false, code: 'DISCONNECTED'}
        : {ready: false, code};
    }

    async function pollHealth() {
      healthTimer = undefined;
      if (destroyed || state.phase === 'complete') return;
      const generation = ++healthGeneration;
      const controller = new root.AbortController();
      healthController = controller;

      try {
        const health = await api.health({signal: controller.signal});
        if (destroyed || generation !== healthGeneration || state.phase === 'complete') return;
        applyReadiness(health);
      } catch {
        if (destroyed || generation !== healthGeneration || controller.signal.aborted || state.phase === 'complete') return;
        applyReadiness({ready: false, code: 'DISCONNECTED'});
      } finally {
        if (generation === healthGeneration) {
          healthController = undefined;
          scheduleHealth(500);
        }
      }
    }

    async function retryInitialization() {
      if (destroyed || retryInFlight || elements.retry.hidden) return;
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

    async function revalidateCompletion() {
      if (destroyed || state.phase !== 'completing') return;
      stopHealth();
      const generation = ++healthGeneration;
      const controller = new root.AbortController();
      healthController = controller;

      try {
        const health = await api.health({signal: controller.signal});
        if (destroyed || generation !== healthGeneration || state.phase !== 'completing') return;
        if (health?.ready !== true || health.code !== 'READY') {
          applyReadiness(completionFailure(health));
          return;
        }
        dispatch({type: 'complete'});
        stopHealth();
        stopPresentation();
        elements.bootScreen.hidden = true;
        elements.workbench.hidden = false;
        destroy();
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

    function skipPresentation() {
      if (!skipAvailable) return;
      opening = false;
      dispatch({type: 'skip'});
      stopPresentation();
    }

    function confirm() {
      if (!dispatch({type: 'confirm'})) return;
      completeTimer = clock.setTimeout(() => {
        completeTimer = undefined;
        return revalidateCompletion();
      }, reducedMotion ? 120 : 720);
    }

    function onKeydown(event) {
      if (event.key !== 'Escape') return;
      skipPresentation();
    }

    function unbindInteractions() {
      elements.confirm.removeEventListener('click', confirm);
      elements.retry.removeEventListener('click', retryInitialization);
      elements.skip.removeEventListener('click', skipPresentation);
      eventRoot.removeEventListener('keydown', onKeydown);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPresentation();
      stopHealth();
      retryController?.abort();
      retryController = undefined;
      if (completeTimer !== undefined) clock.clearTimeout(completeTimer);
      completeTimer = undefined;
      unbindInteractions();
      eventRoot.removeEventListener('pagehide', destroy);
    }

    function start() {
      if (started || destroyed) return;
      started = true;
      document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
      elements.ring.setAttribute('stroke-dasharray', String(circumference));
      elements.confirm.addEventListener('click', confirm);
      elements.retry.addEventListener('click', retryInitialization);
      elements.skip.addEventListener('click', skipPresentation);
      eventRoot.addEventListener('keydown', onKeydown);
      eventRoot.addEventListener('pagehide', destroy);
      skipTimer = clock.setTimeout(() => {
        skipTimer = undefined;
        if (destroyed) return;
        skipAvailable = true;
        elements.skip.hidden = false;
      }, 3000);
      awakeningTimer = clock.setTimeout(() => {
        awakeningTimer = undefined;
        if (destroyed || state.phase === 'complete') return;
        opening = false;
        render();
      }, 600);
      tickTimer = clock.setInterval(() => dispatch({
        type: 'tick',
        delta: reducedMotion ? 1.2 : 0.42
      }), 80);
      clockTimer = clock.setInterval(() => {
        const elapsed = (now() - startedAt) / 1000;
        setText(elements.clock, `T+${elapsed.toFixed(1).padStart(5, '0')}`);
      }, 100);
      render();
      scheduleHealth(0);
    }

    return {destroy, getState: () => state, start};
  }

  root.ProjectZeroBoot = Object.freeze({createBootController});

  if (root.document && root.ProjectZeroApi && !root.ProjectZeroBootController) {
    root.ProjectZeroBootController = createBootController({
      api: root.ProjectZeroApi,
      clock: root,
      document: root.document,
      now: () => root.performance.now(),
      reducedMotion: root.matchMedia('(prefers-reduced-motion: reduce)').matches,
      root
    });
    root.ProjectZeroBootController.start();
  }
}(globalThis));
