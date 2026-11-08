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
      const permissions = approval.params.permissions ? JSON.stringify(approval.params.permissions, null, 2) : '';
      detail.textContent = [approval.params.command, approval.params.reason, permissions, approval.params.itemId]
        .filter(Boolean).join('\n');
      const answers = {};
      const questions = document.createElement('div');
      questions.className = 'approval-questions';
      for (const question of approval.params.questions || []) {
        const label = document.createElement('label');
        label.textContent = question.question || question.header || question.id;
        const options = Array.isArray(question.options) ? question.options : [];
        const input = options.length ? document.createElement('select') : document.createElement('input');
        for (const option of options) {
          const node = document.createElement('option');
          node.value = option.label;
          node.textContent = option.description ? `${option.label} — ${option.description}` : option.label;
          input.append(node);
        }
        input.addEventListener('change', () => { answers[question.id] = input.value; });
        answers[question.id] = input.value;
        label.append(input);
        questions.append(label);
      }
      const actions = document.createElement('div');
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.className = 'secondary-action';
      decline.textContent = '拒绝';
      decline.addEventListener('click', () => respond(approval.id, false));
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = '允许本次';
      accept.addEventListener('click', () => respond(approval.id, true, answers));
      actions.append(decline, accept);
      card.append(title, detail, questions, actions);
      container.append(card);
    }
  }

  root.ProjectZeroApprovals = Object.freeze({render});
}(globalThis));
