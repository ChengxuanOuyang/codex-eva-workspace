'use strict';

(function installThemes(root) {
  function option(theme) {
    return {value: theme.id, label: `${theme.name} — ${theme.author}`};
  }

  function apply(theme) {
    const colors = theme?.colors || {};
    for (const [name, value] of Object.entries(colors)) {
      if (/^[a-z][a-z0-9-]*$/i.test(name) && typeof value === 'string') {
        document.documentElement.style.setProperty(`--theme-${name}`, value);
      }
    }
    document.documentElement.dataset.theme = theme?.id || 'project-zero';
  }

  root.ProjectZeroThemes = {option, apply};
})(window);
