'use strict';

(function installProjectZeroBoot(root) {
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
      ring: document.querySelector('#ring-progress'),
      skip: document.querySelector('#skip-button')
    };
    let state = {phase: 'syncing', progress: 0, ready: false, confirmed: false};
    let started = false;
    let destroyed = false;
    let skipAvailable = false;
    let healthGeneration = 0;
    let healthController;
    let healthTimer;
    let tickTimer;
    let clockTimer;
    let skipTimer;
    let completeTimer;

    function setText(element, value) {
      if (!destroyed && element.textContent !== value) element.textContent = value;
    }

    function stopTicker() {
      if (tickTimer === undefined) return;
      clock.clearInterval(tickTimer);
      tickTimer = undefined;
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
      setText(elements.progress, progress.toFixed(1).padStart(4, '0'));
      elements.ring.setAttribute('stroke-dashoffset', String(circumference * (1 - progress / 100)));
      elements.ring.setAttribute('aria-valuenow', progress.toFixed(1));
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
      if (next === state) return false;
      state = next;
      render();
      if (state.progress === api.MAX_UNCONFIRMED_PROGRESS) stopTicker();
      return true;
    }

    function scheduleHealth(delay) {
      if (destroyed || state.phase === 'complete') return;
      healthTimer = clock.setTimeout(pollHealth, delay);
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
        if (health && health.ready === true) {
          dispatch({type: 'ready'});
          setText(elements.backend, '已就绪');
          setText(elements.diagnostic, state.progress === api.MAX_UNCONFIRMED_PROGRESS
            ? '安全条件已满足，请进行用户确认。'
            : '本地后端已就绪，等待同步演示完成。');
        } else {
          if (state.ready) dispatch({type: 'failed'});
          setText(elements.backend, '初始化中');
          setText(elements.diagnostic, '本地后端尚未就绪；检查将在 500ms 后重试。');
        }
      } catch {
        if (destroyed || generation !== healthGeneration || controller.signal.aborted || state.phase === 'complete') return;
        dispatch({type: 'failed'});
        setText(elements.backend, '暂不可用');
        setText(elements.diagnostic, '连接检查暂不可用；已隐藏底层错误，正在重试。');
      } finally {
        if (generation === healthGeneration) {
          healthController = undefined;
          scheduleHealth(500);
        }
      }
    }

    function skipPresentation() {
      if (!skipAvailable) return;
      dispatch({type: 'skip'});
      stopTicker();
    }

    function confirm() {
      if (!dispatch({type: 'confirm'})) return;
      completeTimer = clock.setTimeout(() => {
        completeTimer = undefined;
        dispatch({type: 'complete'});
        stopTicker();
        stopHealth();
        if (clockTimer !== undefined) clock.clearInterval(clockTimer);
        clockTimer = undefined;
      }, reducedMotion ? 120 : 720);
    }

    function onKeydown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      skipPresentation();
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stopTicker();
      stopHealth();
      if (clockTimer !== undefined) clock.clearInterval(clockTimer);
      if (skipTimer !== undefined) clock.clearTimeout(skipTimer);
      if (completeTimer !== undefined) clock.clearTimeout(completeTimer);
      elements.confirm.removeEventListener('click', confirm);
      elements.skip.removeEventListener('click', skipPresentation);
      eventRoot.removeEventListener('keydown', onKeydown);
      eventRoot.removeEventListener('pagehide', destroy);
    }

    function start() {
      if (started || destroyed) return;
      started = true;
      document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
      elements.ring.setAttribute('stroke-dasharray', String(circumference));
      elements.confirm.addEventListener('click', confirm);
      elements.skip.addEventListener('click', skipPresentation);
      eventRoot.addEventListener('keydown', onKeydown);
      eventRoot.addEventListener('pagehide', destroy);
      skipTimer = clock.setTimeout(() => {
        skipTimer = undefined;
        if (destroyed) return;
        skipAvailable = true;
        elements.skip.hidden = false;
      }, 3000);
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

  if (root.document && root.ProjectZeroApi) {
    const controller = createBootController({
      api: root.ProjectZeroApi,
      clock: root,
      document: root.document,
      now: () => root.performance.now(),
      reducedMotion: root.matchMedia('(prefers-reduced-motion: reduce)').matches,
      root
    });
    controller.start();
  }
}(globalThis));
