'use strict';

const ROUTE_METHODS = new Map([
  ['/api/workbench', ['GET']],
  ['/api/events', ['GET']],
  ['/api/projects', ['POST']],
  ['/api/threads', ['POST']],
  ['/api/threads/send', ['POST']],
  ['/api/threads/cancel', ['POST']],
  ['/api/threads/rename', ['POST']],
  ['/api/threads/archive', ['POST']],
  ['/api/approvals/respond', ['POST']],
  ['/api/files/list', ['POST']],
  ['/api/files/read', ['POST']],
  ['/api/attachments', ['POST']]
  ,['/api/terminal/list', ['POST']]
  ,['/api/terminal/create', ['POST']]
  ,['/api/terminal/input', ['POST']]
  ,['/api/terminal/resize', ['POST']]
  ,['/api/terminal/close', ['POST']]
  ,['/api/terminal/events', ['GET']]
  ,['/api/git/status', ['POST']]
  ,['/api/git/diff', ['POST']]
  ,['/api/git/mutate', ['POST']]
  ,['/api/plugins/list', ['POST']]
  ,['/api/plugins/change', ['POST']]
  ,['/api/themes/list', ['GET']]
  ,['/api/themes/import', ['POST']]
  ,['/api/themes/export', ['POST']]
  ,['/api/themes/asset', ['GET']]
  ,['/api/diagnostics', ['GET']]
  ,['/api/settings', ['POST']]
]);

function objectBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Invalid request');
  return req.body;
}

function stringField(body, name) {
  if (typeof body[name] !== 'string' || body[name].length === 0) throw new Error('Invalid request');
  return body[name];
}

function attachmentIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid request');
  return value.map(attachment => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment) ||
        typeof attachment.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(attachment.id) ||
        Object.keys(attachment).some(key => key !== 'id')) throw new Error('Invalid request');
    return {id: attachment.id};
  });
}

function writeEvent(res, snapshot) {
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function createWorkbenchRoutes(controller) {
  async function handle(req, res, {send, setSecurityHeaders}) {
    const routePath = req.routePath || new URL(req.url, 'http://127.0.0.1').pathname;
    if (!ROUTE_METHODS.has(routePath)) return false;
    if (routePath === '/api/workbench') {
      await controller.ready?.();
      send(res, 200, controller.snapshot());
      return true;
    }
    if (routePath === '/api/events') {
      await controller.ready?.();
      setSecurityHeaders(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      writeEvent(res, controller.snapshot());
      const update = snapshot => writeEvent(res, snapshot);
      const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
      keepalive.unref?.();
      controller.on('snapshot', update);
      req.once('close', () => {
        clearInterval(keepalive);
        controller.off('snapshot', update);
      });
      return true;
    }
    if (routePath === '/api/terminal/events') {
      const id = new URL(req.url, 'http://127.0.0.1').searchParams.get('id');
      if (!id) throw new Error('Invalid request');
      setSecurityHeaders(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      const unsubscribe = controller.terminalSubscribe(id, res, req.headers['last-event-id']);
      const keepalive = setInterval(() => res.write(': keepalive\n\n'), 15_000);
      keepalive.unref?.();
      req.once('close', () => { clearInterval(keepalive); unsubscribe(); });
      return true;
    }
    if (routePath === '/api/themes/list') {
      send(res, 200, await controller.themeList());
      return true;
    }
    if (routePath === '/api/themes/asset') {
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      const asset = await controller.themeAsset(query.get('theme'), query.get('kind'));
      setSecurityHeaders(res);
      res.statusCode = 200;
      res.setHeader('Content-Type', asset.mime);
      res.setHeader('Content-Length', asset.bytes.length);
      res.setHeader('Cache-Control', 'no-store');
      res.end(asset.bytes);
      return true;
    }
    if (routePath === '/api/diagnostics') {
      send(res, 200, await controller.diagnostics());
      return true;
    }

    const body = objectBody(req);
    let result;
    let status = 200;
    if (routePath === '/api/projects') {
      result = await controller.addProject(stringField(body, 'path'));
      status = 201;
    } else if (routePath === '/api/threads') {
      result = await controller.createThread({
        projectId: stringField(body, 'projectId'),
        model: stringField(body, 'model'),
        effort: stringField(body, 'effort')
      });
      status = 201;
    } else if (routePath === '/api/threads/send') {
      result = await controller.send({
        threadId: stringField(body, 'threadId'),
        text: stringField(body, 'text'),
        model: stringField(body, 'model'),
        effort: stringField(body, 'effort'),
        attachments: attachmentIds(body.attachments)
      });
      status = 202;
    } else if (routePath === '/api/threads/cancel') {
      await controller.cancel(stringField(body, 'threadId'));
      result = {accepted: true};
      status = 202;
    } else if (routePath === '/api/threads/rename') {
      result = await controller.renameThread(stringField(body, 'threadId'), stringField(body, 'title'));
    } else if (routePath === '/api/threads/archive') {
      if (typeof body.archived !== 'boolean') throw new Error('Invalid request');
      result = await controller.archiveThread(stringField(body, 'threadId'), body.archived);
    } else if (routePath === '/api/approvals/respond') {
      if (typeof body.accept !== 'boolean') throw new Error('Invalid request');
      await controller.answerApproval({id: stringField(body, 'id'), accept: body.accept, answers: body.answers});
      result = {accepted: true};
    } else if (routePath === '/api/files/list') {
      result = await controller.listFiles(stringField(body, 'projectId'), typeof body.path === 'string' ? body.path : '');
    } else if (routePath === '/api/files/read') {
      result = await controller.readFile(stringField(body, 'projectId'), stringField(body, 'path'));
    } else if (routePath === '/api/attachments') {
      result = await controller.saveAttachment({dataUrl: stringField(body, 'dataUrl')});
      status = 201;
    } else if (routePath === '/api/terminal/list') {
      result = await controller.terminalList(stringField(body, 'projectId'));
    } else if (routePath === '/api/terminal/create') {
      result = await controller.terminalCreate(stringField(body, 'projectId'), {cols: body.cols, rows: body.rows});
      status = 201;
    } else if (routePath === '/api/terminal/input') {
      result = controller.terminalInput(stringField(body, 'id'), stringField(body, 'data'));
    } else if (routePath === '/api/terminal/resize') {
      result = controller.terminalResize(stringField(body, 'id'), body.cols, body.rows);
    } else if (routePath === '/api/terminal/close') {
      result = controller.terminalClose(stringField(body, 'id'));
    } else if (routePath === '/api/git/status') {
      result = await controller.gitStatus(stringField(body, 'projectId'));
    } else if (routePath === '/api/git/diff') {
      result = await controller.gitDiff(stringField(body, 'projectId'), {path: body.path, staged: body.staged === true});
    } else if (routePath === '/api/git/mutate') {
      result = await controller.gitMutate(stringField(body, 'projectId'), body);
    } else if (routePath === '/api/plugins/list') {
      result = await controller.pluginList(stringField(body, 'projectId'));
    } else if (routePath === '/api/plugins/change') {
      result = await controller.pluginChange(stringField(body, 'projectId'), stringField(body, 'id'), stringField(body, 'operation'));
    } else if (routePath === '/api/themes/import') {
      result = await controller.themeImport(stringField(body, 'path'));
      status = 201;
    } else if (routePath === '/api/themes/export') {
      result = await controller.themeExport(stringField(body, 'themeId'));
    } else if (routePath === '/api/settings') {
      result = await controller.saveSettings({codexPath: typeof body.codexPath === 'string' ? body.codexPath : ''});
    }
    send(res, status, result);
    return true;
  }

  return {handle, routeMethods: ROUTE_METHODS};
}

module.exports = {createWorkbenchRoutes};
