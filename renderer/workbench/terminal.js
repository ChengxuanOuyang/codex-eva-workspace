'use strict';

(function installTerminal(root) {
  let terminal;
  let fit;
  let source;
  let sessionId;
  let mounted = false;

  function mount({container, createButton, closeButton, getProjectId, request, showError}) {
    if (mounted) return;
    mounted = true;
    terminal = new root.Terminal({convertEol: true, cursorBlink: true, fontSize: 12, theme: {
      background: '#071419', foreground: '#d9eeee', cursor: '#f26a22'
    }});
    fit = new root.FitAddon.FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.writeln('PROJECT ZERO local terminal — create a session to begin.');
    terminal.onData(data => {
      if (sessionId) void request('/api/terminal/input', {id: sessionId, data}).catch(showError);
    });

    async function attach(session) {
      source?.close();
      sessionId = session.id;
      terminal.reset();
      terminal.write(session.buffer || '');
      source = new EventSource(`/api/terminal/events?id=${encodeURIComponent(session.id)}`);
      source.addEventListener('output', event => terminal.write(JSON.parse(event.data)));
      source.addEventListener('snapshot', event => {
        const snapshot = JSON.parse(event.data);
        terminal.reset();
        terminal.write(snapshot.buffer || '');
      });
      source.addEventListener('exit', () => terminal.writeln('\r\n[session exited]'));
      source.onerror = () => {};
      closeButton.disabled = false;
      fit.fit();
      await request('/api/terminal/resize', {id: session.id, cols: terminal.cols, rows: terminal.rows});
      terminal.focus();
    }

    createButton.addEventListener('click', async () => {
      const projectId = getProjectId();
      if (!projectId) return showError(new Error('请先选择项目'));
      try {
        fit.fit();
        await attach(await request('/api/terminal/create', {projectId, cols: terminal.cols, rows: terminal.rows}));
      } catch (error) { showError(error); }
    });
    closeButton.addEventListener('click', async () => {
      if (!sessionId) return;
      const closing = sessionId;
      sessionId = null;
      source?.close();
      source = null;
      closeButton.disabled = true;
      try { await request('/api/terminal/close', {id: closing}); }
      catch (error) { showError(error); }
      terminal.writeln('\r\n[session closed]');
    });
    window.addEventListener('resize', () => fit.fit());
  }

  function activate() { requestAnimationFrame(() => fit?.fit()); }
  root.ProjectZeroTerminal = {mount, activate};
})(window);
