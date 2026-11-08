'use strict';

(function installPlugins(root) {
  function mount({container, refreshButton, dialog, dialogText, confirmButton, getProjectId, request, showError}) {
    let pending;
    async function refresh() {
      const projectId = getProjectId();
      if (!projectId) return container.replaceChildren();
      try {
        const catalog = await request('/api/plugins/list', {projectId});
        container.replaceChildren();
        for (const [operation, plugins] of [['uninstall', catalog.installed], ['install', catalog.available]]) {
          for (const plugin of plugins) {
            const row = document.createElement('div');
            row.className = 'plugin-row';
            const label = document.createElement('span');
            label.textContent = `${plugin.name} · ${plugin.version}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = `${operation === 'install' ? '安装' : '卸载'} ${plugin.name}`;
            button.addEventListener('click', () => {
              pending = {projectId, id: plugin.id, operation};
              dialogText.textContent = `确认${operation === 'install' ? '安装' : '卸载'}官方目录插件“${plugin.name}”？`;
              dialog.showModal();
            });
            row.append(label, button);
            container.append(row);
          }
        }
      } catch (error) { showError(error); }
    }
    confirmButton.addEventListener('click', async () => {
      if (!pending) return;
      const change = pending;
      pending = null;
      dialog.close();
      try { await request('/api/plugins/change', change); await refresh(); }
      catch (error) { showError(error); }
    });
    refreshButton.addEventListener('click', refresh);
    return {refresh};
  }
  root.ProjectZeroPlugins = {mount};
})(window);
