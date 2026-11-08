'use strict';

(function installSettings(root) {
  const STORAGE_KEY = 'project-zero.settings.v1';
  const defaults = Object.freeze({
    volume: 0.65,
    reducedMotion: false,
    skipAfterSeconds: 3,
    forceFullPlayback: false,
    themeId: 'project-zero',
    codexPath: ''
  });

  function normalize(value = {}) {
    return {
      volume: Math.max(0, Math.min(1, Number(value.volume ?? defaults.volume))),
      reducedMotion: value.reducedMotion === true,
      skipAfterSeconds: 3,
      forceFullPlayback: value.forceFullPlayback === true,
      themeId: typeof value.themeId === 'string' && value.themeId ? value.themeId : defaults.themeId,
      codexPath: typeof value.codexPath === 'string' ? value.codexPath : ''
    };
  }

  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch { return {...defaults}; }
  }

  function save(value) {
    const settings = normalize(value);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return settings;
  }

  root.ProjectZeroSettings = {defaults, load, save, normalize};
})(window);
