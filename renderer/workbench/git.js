'use strict';

(function installGit(root) {
  function createButton(label, action, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', action);
    return button;
  }

  function mount({container, branch, refreshButton, getProjectId, isBusy, request, showError}) {
    async function refresh() {
      const projectId = getProjectId();
      if (!projectId) {
        branch.textContent = 'NO PROJECT';
        container.replaceChildren();
        return;
      }
      try {
        const status = await request('/api/git/status', {projectId});
        branch.textContent = status.branch || 'DETACHED';
        container.replaceChildren();
        if (!status.files.length) {
          const empty = document.createElement('p');
          empty.textContent = '工作树干净。';
          container.append(empty);
        }
        for (const file of status.files) {
          const row = document.createElement('div');
          row.className = 'git-file';
          const code = document.createElement('code');
          code.textContent = `${file.index}${file.worktree} ${file.path}`;
          const staged = file.index !== ' ' && file.index !== '?';
          const action = staged ? 'unstage' : 'stage';
          const label = `${staged ? '取消暂存' : '暂存'} ${file.path}`;
          row.append(code, createButton(label, async () => {
            try {
              const next = await request('/api/git/mutate', {projectId, operation: action, path: file.path});
              branch.textContent = next.branch;
              await refresh();
            } catch (error) { showError(error); }
          }, isBusy()));
          container.append(row);
        }
      } catch (error) { showError(error); }
    }
    refreshButton.addEventListener('click', refresh);
    return {refresh};
  }
  root.ProjectZeroGit = {mount};
})(window);
