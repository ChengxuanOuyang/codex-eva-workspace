'use strict';

(function runBootSequence() {
  const api = globalThis.ProjectZeroApi;
  const reducedMotion = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const circumference = 2 * Math.PI * 132;
  const startedAt = performance.now();
  let skipAvailable = false;
  let tickTimer;
  let healthTimer;
  let clockTimer;
  let state = {phase: 'syncing', progress: 0, ready: false, confirmed: false};

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

  document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
  elements.ring.setAttribute('stroke-dasharray', String(circumference));

  function render() {
    const progress = Math.max(0, Math.min(100, state.progress));
    document.body.dataset.phase = state.phase;
    elements.progress.textContent = progress.toFixed(1).padStart(4, '0');
    elements.ring.setAttribute('stroke-dashoffset', String(circumference * (1 - progress / 100)));
    elements.confirm.disabled = !(progress === api.MAX_UNCONFIRMED_PROGRESS && state.ready && !state.confirmed);

    if (state.phase === 'complete') {
      elements.heading.textContent = 'SYSTEM ONLINE';
      elements.caption.textContent = '本地工作台已就绪';
      elements.diagnostic.textContent = '同步已由用户确认，正在进入工作台。';
      elements.backend.textContent = '已就绪';
    } else if (state.phase === 'completing') {
      elements.heading.textContent = '正在完成同步';
      elements.caption.textContent = '用户确认已记录';
      elements.diagnostic.textContent = '正在安全切换至工作台界面。';
    } else if (state.phase === 'failed') {
      elements.heading.textContent = '等待服务响应';
      elements.caption.textContent = '动态演示不会绕过连接检查';
    } else if (state.phase === 'waiting') {
      elements.heading.textContent = progress === api.MAX_UNCONFIRMED_PROGRESS ? '等待用户确认' : '等待安全条件';
      elements.caption.textContent = '演示已简化，后台检查仍在继续';
    } else if (progress === api.MAX_UNCONFIRMED_PROGRESS) {
      elements.heading.textContent = state.ready ? '等待用户确认' : '等待后端就绪';
      elements.caption.textContent = '同步锁定在 99.2%';
    }
  }

  function dispatch(event) {
    const next = api.nextBootState(state, event);
    if (next === state) return false;
    state = next;
    render();
    return true;
  }

  async function checkHealth() {
    try {
      const health = await api.health();
      if (health && health.ready === true) {
        dispatch({type: 'ready'});
        elements.backend.textContent = '已就绪';
        elements.diagnostic.textContent = state.progress === api.MAX_UNCONFIRMED_PROGRESS
          ? '安全条件已满足，请进行用户确认。'
          : '本地后端已就绪，等待同步演示完成。';
      } else {
        if (state.ready) dispatch({type: 'failed'});
        elements.backend.textContent = '初始化中';
        elements.diagnostic.textContent = '本地后端尚未就绪；检查将在 500ms 后重试。';
      }
    } catch {
      dispatch({type: 'failed'});
      elements.backend.textContent = '暂不可用';
      elements.diagnostic.textContent = '连接检查暂不可用；已隐藏底层错误，正在重试。';
    }
  }

  function skipPresentation() {
    if (skipAvailable) dispatch({type: 'skip'});
  }

  elements.confirm.addEventListener('click', () => {
    if (!dispatch({type: 'confirm'})) return;
    globalThis.setTimeout(() => {
      dispatch({type: 'complete'});
      globalThis.clearInterval(tickTimer);
      globalThis.clearInterval(healthTimer);
    }, reducedMotion ? 120 : 720);
  });
  elements.skip.addEventListener('click', skipPresentation);
  globalThis.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    skipPresentation();
  });

  globalThis.setTimeout(() => {
    skipAvailable = true;
    elements.skip.hidden = false;
  }, 3000);

  tickTimer = globalThis.setInterval(() => {
    dispatch({type: 'tick', delta: reducedMotion ? 1.2 : 0.42});
  }, 80);
  healthTimer = globalThis.setInterval(checkHealth, 500);
  clockTimer = globalThis.setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    elements.clock.textContent = `T+${elapsed.toFixed(1).padStart(5, '0')}`;
    if (state.phase === 'complete') globalThis.clearInterval(clockTimer);
  }, 100);

  render();
  checkHealth();
}());
