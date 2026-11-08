'use strict';

(function installApprovals(root) {
  function approvalTitle(method) {
    if (method.includes('commandExecution')) return '需要执行命令';
    if (method.includes('fileChange')) return '需要修改文件';
    if (method.includes('permissions')) return '需要扩展权限';
    return '需要你的输入';
  }

  function render(container, approvals, respond) {
    container.replaceChildren();
    for (const approval of approvals) {
      const card = document.createElement('article');
      card.className = 'approval-card';
      const title = document.createElement('strong');
      title.textContent = approvalTitle(approval.method);
      const detail = document.createElement('code');
      detail.textContent = approval.params.command || approval.params.reason || approval.params.itemId || '';
      const actions = document.createElement('div');
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.className = 'secondary-action';
      decline.textContent = '拒绝';
      decline.addEventListener('click', () => respond(approval.id, false));
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = '允许本次';
      accept.addEventListener('click', () => respond(approval.id, true));
      actions.append(decline, accept);
      card.append(title, detail, actions);
      container.append(card);
    }
  }

  root.ProjectZeroApprovals = Object.freeze({render});
}(globalThis));
