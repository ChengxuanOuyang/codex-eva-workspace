'use strict';

(function installFiles(root) {
  function render(container, entries, open) {
    container.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `file-entry file-${entry.type}`;
      button.textContent = `${entry.type === 'directory' ? '▸' : '·'} ${entry.name}`;
      button.addEventListener('click', () => open(entry));
      container.append(button);
    }
  }

  root.ProjectZeroFiles = Object.freeze({render});
}(globalThis));
