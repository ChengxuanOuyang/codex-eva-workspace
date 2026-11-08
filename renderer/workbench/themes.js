'use strict';

(function installThemes(root) {
  const appliedColors = new Set();
  function option(theme) {
    return {value: theme.id, label: `${theme.name} — ${theme.author}`};
  }

  function apply(theme) {
    for (const name of appliedColors) document.documentElement.style.removeProperty(`--theme-${name}`);
    appliedColors.clear();
    document.documentElement.style.removeProperty('--theme-workbench-background');
    document.documentElement.style.removeProperty('--theme-workbench-portrait');
    const colors = theme?.colors || {};
    for (const [name, value] of Object.entries(colors)) {
      if (/^[a-z][a-z0-9-]*$/i.test(name) && typeof value === 'string') {
        document.documentElement.style.setProperty(`--theme-${name}`, value);
        appliedColors.add(name);
      }
    }
    document.documentElement.dataset.theme = theme?.id || 'project-zero';
    if (theme?.background) document.documentElement.style.setProperty(
      '--theme-workbench-background', `url("/api/themes/asset?theme=${encodeURIComponent(theme.id)}&kind=background")`
    );
    if (theme?.portrait) document.documentElement.style.setProperty(
      '--theme-workbench-portrait', `url("/api/themes/asset?theme=${encodeURIComponent(theme.id)}&kind=portrait")`
    );
    if (theme?.audio && typeof root.Audio === 'function') {
      const audio = new root.Audio(`/api/themes/asset?theme=${encodeURIComponent(theme.id)}&kind=audio`);
      void audio.play().catch(() => {});
    }
  }

  root.ProjectZeroThemes = {option, apply};
})(window);
