'use strict';

(function installConversation(root) {
  function appendTextWithCode(container, text) {
    const parts = String(text).split('```');
    parts.forEach((part, index) => {
      const element = document.createElement(index % 2 === 0 ? 'p' : 'pre');
      element.textContent = part;
      container.append(element);
    });
  }

  function renderMessages(container, messages) {
    container.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-conversation';
      const label = document.createElement('p');
      label.lang = 'ja';
      label.textContent = '準備完了';
      const title = document.createElement('strong');
      title.textContent = '发送第一条任务指令';
      const detail = document.createElement('span');
      detail.textContent = '响应和工具事件会在这里实时显示。';
      empty.append(label, title, detail);
      container.append(empty);
      return;
    }
    for (const message of messages) {
      const article = document.createElement('article');
      article.className = `message message-${message.role === 'user' ? 'user' : 'assistant'}`;
      const role = document.createElement('span');
      role.className = 'message-role';
      role.textContent = message.role === 'user' ? 'PILOT' : 'CODEX';
      const content = document.createElement('div');
      content.className = 'message-content';
      appendTextWithCode(content, message.text || '');
      article.append(role, content);
      container.append(article);
    }
    container.scrollTop = container.scrollHeight;
  }

  function renderTools(container, tools) {
    container.replaceChildren();
    for (const tool of tools.slice().reverse()) {
      const card = document.createElement('article');
      card.className = 'tool-card';
      const heading = document.createElement('strong');
      heading.textContent = tool.type === 'fileChange' ? '文件变更' : '命令执行';
      const title = document.createElement('code');
      title.textContent = tool.title || tool.type;
      const output = document.createElement('pre');
      output.textContent = tool.output || tool.status || '';
      card.append(heading, title, output);
      container.append(card);
    }
  }

  root.ProjectZeroConversation = Object.freeze({renderMessages, renderTools});
}(globalThis));
