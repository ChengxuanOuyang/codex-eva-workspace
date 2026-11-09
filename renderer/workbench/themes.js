'use strict';

(function installThemes(root) {
  const PRIVATE_CONFIG_FIELDS = Object.freeze([
    'audioEndMs',
    'audioStartMs',
    'displayName',
    'mark',
    'portrait',
    'soundtrack'
  ]);
  const PRIVATE_PORTRAIT = '/private/rei-portrait.webp';
  const PRIVATE_PORTRAIT_CSS = `url("${PRIVATE_PORTRAIT}")`;
  const PRIVATE_SOUNDTRACKS = new Set([
    '/private/startup-reference.wav',
    '/private/startup-reference.m4a'
  ]);
  const appliedColors = new Set();
  const element = root.document.documentElement;
  let privateWorkbench = element.style.getPropertyValue('--theme-workbench-portrait') ===
    PRIVATE_PORTRAIT_CSS;

  function isPrivateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
    const fields = Object.keys(config).sort();
    return fields.length === PRIVATE_CONFIG_FIELDS.length &&
      fields.every((field, index) => field === PRIVATE_CONFIG_FIELDS[index]) &&
      typeof config.displayName === 'string' && config.displayName.length > 0 &&
      config.mark === '/private/boot-mark.webp' &&
      config.portrait === PRIVATE_PORTRAIT &&
      PRIVATE_SOUNDTRACKS.has(config.soundtrack) &&
      Number.isSafeInteger(config.audioStartMs) && config.audioStartMs >= 0 &&
      Number.isSafeInteger(config.audioEndMs) &&
      config.audioEndMs - config.audioStartMs === 20_500;
  }

  function syncPrivatePortrait() {
    element.dataset.privateWorkbench = String(privateWorkbench);
    if (privateWorkbench) {
      element.style.setProperty('--theme-workbench-portrait', PRIVATE_PORTRAIT_CSS);
    } else {
      element.style.removeProperty('--theme-workbench-portrait');
    }
  }

  function applyPrivateConfig(config) {
    privateWorkbench = isPrivateConfig(config);
    syncPrivatePortrait();
    return privateWorkbench;
  }

  function option(theme) {
    return {value: theme.id, label: `${theme.name} — ${theme.author}`};
  }

  function apply(theme) {
    for (const name of appliedColors) element.style.removeProperty(`--theme-${name}`);
    appliedColors.clear();
    element.style.removeProperty('--theme-workbench-background');
    const colors = theme?.colors || {};
    for (const [name, value] of Object.entries(colors)) {
      if (/^[a-z][a-z0-9-]*$/i.test(name) && typeof value === 'string') {
        element.style.setProperty(`--theme-${name}`, value);
        appliedColors.add(name);
      }
    }
    element.dataset.theme = theme?.id || 'project-zero';
    if (theme?.background) element.style.setProperty(
      '--theme-workbench-background', `url("/api/themes/asset?theme=${encodeURIComponent(theme.id)}&kind=background")`
    );
    syncPrivatePortrait();
    if (theme?.audio && typeof root.Audio === 'function') {
      const audio = new root.Audio(`/api/themes/asset?theme=${encodeURIComponent(theme.id)}&kind=audio`);
      void audio.play().catch(() => {});
    }
  }

  syncPrivatePortrait();
  root.ProjectZeroThemes = Object.freeze({option, apply, applyPrivateConfig});
})(window);
