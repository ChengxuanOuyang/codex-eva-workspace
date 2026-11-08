'use strict';

const MAX_UNCONFIRMED_PROGRESS = 99.2;
const ACCEPTED_EVENTS = new Set(['tick', 'ready', 'failed', 'confirm', 'skip', 'complete']);

function nextBootState(state, event) {
  if (!event || !ACCEPTED_EVENTS.has(event.type)) return state;

  switch (event.type) {
    case 'tick': {
      if (state.phase === 'completing' || state.phase === 'complete') return state;
      const delta = Number.isFinite(event.delta) ? Math.max(0, event.delta) : 0;
      const progress = Math.min(MAX_UNCONFIRMED_PROGRESS, state.progress + delta);
      return progress === state.progress ? state : {...state, progress};
    }
    case 'ready':
      if (state.ready || state.phase === 'complete') return state;
      return {...state, phase: state.phase === 'failed' ? 'waiting' : state.phase, ready: true};
    case 'failed':
      if (state.phase === 'complete') return state;
      if (state.phase === 'failed' && !state.ready) return state;
      return {...state, phase: 'failed', ready: false, confirmed: false};
    case 'confirm':
      if (state.phase === 'completing' || state.phase === 'complete') return state;
      if (state.progress !== MAX_UNCONFIRMED_PROGRESS || !state.ready) return state;
      return {...state, phase: 'completing', confirmed: true};
    case 'skip':
      if (state.phase === 'completing' || state.phase === 'complete') return state;
      if (state.phase === 'waiting' && state.progress === MAX_UNCONFIRMED_PROGRESS) return state;
      return {...state, phase: 'waiting', progress: MAX_UNCONFIRMED_PROGRESS};
    case 'complete':
      if (state.phase === 'complete') return state;
      if (state.phase !== 'completing' || !state.confirmed) return state;
      return {...state, phase: 'complete', progress: 100};
    default:
      return state;
  }
}

module.exports = {MAX_UNCONFIRMED_PROGRESS, nextBootState};
