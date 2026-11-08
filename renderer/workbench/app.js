'use strict';

(function installWorkbench(root) {
  const state = {
    snapshot: {projects: [], threads: [], models: [], approvals: []},
    selectedProjectId: null,
    selectedThreadId: null,
    serviceOnline: false,
    filePath: '',
    attachments: []
  };
  let started = false;
  let eventSource;
  let reconnectTimer;
  let reconnectDelay = 500;

  const elements = {};

  async function request(requestPath, body) {
    const response = await fetch(requestPath, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '本地请求失败');
    return payload;
  }

  function showError(error) {
    elements.error.textContent = error?.message || '本地工作台发生错误';
    elements.error.hidden = false;
  }

  function clearError() {
    elements.error.hidden = true;
    elements.error.textContent = '';
  }

  function selectedThread() {
    return state.snapshot.threads.find(thread => thread.id === state.selectedThreadId) || null;
  }

  function selectedModel() {
    return state.snapshot.models.find(model => model.id === elements.model.value) || state.snapshot.models[0] || null;
  }

  function fillSelect(select, values, selected, label) {
    const signature = values.map(value => `${value.value}:${value.label}`).join('|');
    if (select.dataset.signature !== signature) {
      select.replaceChildren();
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value.value;
        option.textContent = value.label;
        select.append(option);
      }
      select.dataset.signature = signature;
    }
    if (values.some(value => value.value === selected)) select.value = selected;
    select.setAttribute('aria-label', label);
  }

  function renderProjects() {
    elements.projects.replaceChildren();
    for (const project of state.snapshot.projects) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = project.name;
      button.title = project.path;
      button.className = project.id === state.selectedProjectId ? 'selected' : '';
      button.addEventListener('click', () => {
        state.selectedProjectId = project.id;
        const thread = state.snapshot.threads.find(item => item.projectId === project.id && !item.archived);
        state.selectedThreadId = thread?.id || null;
        state.filePath = '';
        render();
        void loadFiles();
      });
      elements.projects.append(button);
    }
  }

  function renderThreads() {
    const threads = state.snapshot.threads.filter(thread => thread.projectId === state.selectedProjectId && !thread.archived);
    elements.threadCount.textContent = String(threads.length).padStart(2, '0');
    elements.threads.replaceChildren();
    for (const thread of threads) {
      const row = document.createElement('div');
      row.className = 'thread-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = thread.title || '新任务';
      button.className = thread.id === state.selectedThreadId ? 'selected' : '';
      button.addEventListener('click', () => {
        state.selectedThreadId = thread.id;
        render();
      });
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'thread-action';
      rename.textContent = '改名';
      rename.setAttribute('aria-label', `重命名 ${thread.title || '新任务'}`);
      rename.addEventListener('click', () => {
        const input = document.createElement('input');
        input.value = thread.title || '新任务';
        input.setAttribute('aria-label', '任务名称');
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = '保存名称';
        save.addEventListener('click', async () => {
          const title = input.value.trim();
          if (!title) return;
          try {
            await request('/api/threads/rename', {threadId: thread.id, title});
            thread.title = title;
            render();
            await refreshSnapshot();
          } catch (error) { showError(error); }
        });
        row.replaceChildren(input, save);
        input.focus();
      });
      const archive = document.createElement('button');
      archive.type = 'button';
      archive.className = 'thread-action';
      archive.textContent = '归档';
      archive.setAttribute('aria-label', `归档 ${thread.title || '新任务'}`);
      archive.addEventListener('click', async () => {
        try {
          await request('/api/threads/archive', {threadId: thread.id, archived: true});
          thread.archived = true;
          render();
          await refreshSnapshot();
        } catch (error) { showError(error); }
      });
      row.append(button, rename, archive);
      elements.threads.append(row);
    }
  }

  function renderModelOptions(thread) {
    const currentModel = thread?.model || elements.model.value || state.snapshot.models.find(model => model.isDefault)?.id || state.snapshot.models[0]?.id;
    fillSelect(elements.model, state.snapshot.models.map(model => ({value: model.id, label: model.displayName})), currentModel, '模型');
    const model = selectedModel();
    const currentEffort = thread?.effort || elements.effort.value || model?.defaultEffort;
    fillSelect(elements.effort, (model?.efforts || []).map(effort => ({value: effort, label: effort})), currentEffort, '推理强度');
  }

  function render() {
    if (!state.selectedProjectId && state.snapshot.projects.length) state.selectedProjectId = state.snapshot.projects[0].id;
    const projectThreads = state.snapshot.threads.filter(thread => thread.projectId === state.selectedProjectId && !thread.archived);
    if (!projectThreads.some(thread => thread.id === state.selectedThreadId)) state.selectedThreadId = projectThreads[0]?.id || null;
    const thread = selectedThread();
    renderProjects();
    renderThreads();
    renderModelOptions(thread);
    root.ProjectZeroConversation.renderMessages(elements.messages, thread?.messages || []);
    root.ProjectZeroConversation.renderTools(elements.tools, thread?.tools || []);
    root.ProjectZeroApprovals.render(elements.approvals, state.snapshot.approvals || [], respondApproval);
    elements.approvalCount.textContent = String(state.snapshot.approvals?.length || 0).padStart(2, '0');
    const active = Boolean(thread?.activeTurn);
    elements.turnState.textContent = active ? '执行中' : thread?.status === 'failed' ? '失败' : '待命';
    elements.newThread.disabled = !state.serviceOnline || !state.selectedProjectId || !state.snapshot.models.length;
    elements.prompt.disabled = !state.serviceOnline || !thread || active;
    elements.send.disabled = elements.prompt.disabled;
    elements.cancel.hidden = !active;
    elements.cancel.disabled = !state.serviceOnline;
    elements.model.disabled = !state.serviceOnline || active || !state.snapshot.models.length;
    elements.effort.disabled = elements.model.disabled;
    elements.attachmentInput.disabled = elements.prompt.disabled || !selectedModel()?.inputModalities.includes('image');
    elements.attachmentList.replaceChildren();
    for (const attachment of state.attachments) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'attachment-chip';
      chip.textContent = attachment.name;
      chip.title = '点击移除';
      chip.addEventListener('click', () => {
        state.attachments = state.attachments.filter(item => item.id !== attachment.id);
        render();
      });
      elements.attachmentList.append(chip);
    }
    elements.refreshFiles.disabled = !state.serviceOnline || !state.selectedProjectId;
  }

  async function refreshSnapshot() {
    state.snapshot = await request('/api/workbench');
    state.serviceOnline = true;
    elements.serviceState.textContent = 'ONLINE';
    render();
  }

  function connectEvents() {
    eventSource?.close();
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('snapshot', event => {
      state.snapshot = JSON.parse(event.data);
      state.serviceOnline = true;
      reconnectDelay = 500;
      elements.serviceState.textContent = 'ONLINE';
      clearError();
      render();
    });
    eventSource.onerror = () => {
      eventSource.close();
      state.serviceOnline = false;
      elements.serviceState.textContent = 'OFFLINE';
      render();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectEvents, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    };
  }

  async function addProject(event) {
    event.preventDefault();
    clearError();
    try {
      const project = await request('/api/projects', {path: elements.projectPath.value.trim()});
      elements.projectPath.value = '';
      state.selectedProjectId = project.id;
      state.selectedThreadId = null;
      await refreshSnapshot();
      await loadFiles();
    } catch (error) {
      showError(error);
    }
  }

  async function createThread() {
    clearError();
    try {
      const thread = await request('/api/threads', {
        projectId: state.selectedProjectId,
        model: elements.model.value,
        effort: elements.effort.value
      });
      state.selectedThreadId = thread.id;
      await refreshSnapshot();
      elements.prompt.focus();
    } catch (error) {
      showError(error);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = elements.prompt.value.trim();
    if (!text || !state.selectedThreadId) return;
    elements.prompt.value = '';
    clearError();
    try {
      await request('/api/threads/send', {
        threadId: state.selectedThreadId,
        text,
        model: elements.model.value,
        effort: elements.effort.value,
        attachments: state.attachments.map(attachment => ({id: attachment.id}))
      });
      state.attachments = [];
      await refreshSnapshot();
    } catch (error) {
      elements.prompt.value = text;
      showError(error);
    }
  }

  async function cancelTurn() {
    try {
      await request('/api/threads/cancel', {threadId: state.selectedThreadId});
    } catch (error) {
      showError(error);
    }
  }

  async function respondApproval(id, accept, answers = {}) {
    try {
      await request('/api/approvals/respond', {id, accept, answers});
    } catch (error) {
      showError(error);
    }
  }

  function dataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result), {once: true});
      reader.addEventListener('error', () => reject(new Error('无法读取图片')), {once: true});
      reader.readAsDataURL(file);
    });
  }

  async function uploadAttachments() {
    const files = [...elements.attachmentInput.files];
    elements.attachmentInput.value = '';
    for (const file of files) {
      try {
        const saved = await request('/api/attachments', {dataUrl: await dataUrl(file)});
        state.attachments.push({...saved, name: file.name});
      } catch (error) {
        showError(error);
      }
    }
    render();
  }

  async function loadFiles() {
    if (!state.selectedProjectId) return;
    try {
      const entries = await request('/api/files/list', {projectId: state.selectedProjectId, path: state.filePath});
      root.ProjectZeroFiles.render(elements.files, entries, openFile);
    } catch (error) {
      showError(error);
    }
  }

  async function openFile(entry) {
    if (entry.type === 'directory') {
      state.filePath = entry.path;
      await loadFiles();
      return;
    }
    try {
      const preview = await request('/api/files/read', {projectId: state.selectedProjectId, path: entry.path});
      elements.filePreview.textContent = preview.text;
      elements.filePreview.hidden = false;
    } catch (error) {
      showError(error);
    }
  }

  function bindElements() {
    Object.assign(elements, {
      error: document.querySelector('#workbench-error'),
      projectForm: document.querySelector('#project-form'),
      projectPath: document.querySelector('#project-path'),
      projects: document.querySelector('#project-list'),
      newThread: document.querySelector('#new-thread-button'),
      threads: document.querySelector('#thread-list'),
      threadCount: document.querySelector('#thread-count'),
      messages: document.querySelector('#message-list'),
      composer: document.querySelector('#composer'),
      prompt: document.querySelector('#prompt-input'),
      model: document.querySelector('#model-select'),
      effort: document.querySelector('#effort-select'),
      attachmentInput: document.querySelector('#attachment-input'),
      attachmentList: document.querySelector('#attachment-list'),
      send: document.querySelector('#send-button'),
      cancel: document.querySelector('#cancel-turn-button'),
      turnState: document.querySelector('#turn-state'),
      serviceState: document.querySelector('#local-service-state'),
      approvals: document.querySelector('#approval-list'),
      approvalCount: document.querySelector('#approval-count'),
      tools: document.querySelector('#tool-list'),
      files: document.querySelector('#file-list'),
      filePreview: document.querySelector('#file-preview'),
      refreshFiles: document.querySelector('#refresh-files-button')
    });
  }

  async function start() {
    if (started) return;
    started = true;
    bindElements();
    elements.projectForm.addEventListener('submit', addProject);
    elements.newThread.addEventListener('click', createThread);
    elements.composer.addEventListener('submit', sendMessage);
    elements.cancel.addEventListener('click', cancelTurn);
    elements.model.addEventListener('change', () => renderModelOptions(null));
    elements.attachmentInput.addEventListener('change', uploadAttachments);
    elements.refreshFiles.addEventListener('click', loadFiles);
    try {
      await refreshSnapshot();
      connectEvents();
      await loadFiles();
    } catch (error) {
      state.serviceOnline = false;
      elements.serviceState.textContent = 'OFFLINE';
      showError(error);
      render();
      connectEvents();
    }
  }

  const shell = document.querySelector('#workbench-shell');
  if (shell && !shell.hidden) void start();
  else if (shell) {
    const observer = new MutationObserver(() => {
      if (shell.hidden) return;
      observer.disconnect();
      void start();
    });
    observer.observe(shell, {attributes: true, attributeFilter: ['hidden']});
  }

  root.ProjectZeroWorkbench = Object.freeze({start});
}(globalThis));
