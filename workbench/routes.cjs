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
    if (!ROUTE_METHODS.has(req.url)) return false;
    if (req.url === '/api/workbench') {
      await controller.ready?.();
      send(res, 200, controller.snapshot());
      return true;
    }
    if (req.url === '/api/events') {
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

    const body = objectBody(req);
    let result;
    let status = 200;
    if (req.url === '/api/projects') {
      result = await controller.addProject(stringField(body, 'path'));
      status = 201;
    } else if (req.url === '/api/threads') {
      result = await controller.createThread({
        projectId: stringField(body, 'projectId'),
        model: stringField(body, 'model'),
        effort: stringField(body, 'effort')
      });
      status = 201;
    } else if (req.url === '/api/threads/send') {
      result = await controller.send({
        threadId: stringField(body, 'threadId'),
        text: stringField(body, 'text'),
        model: stringField(body, 'model'),
        effort: stringField(body, 'effort'),
        attachments: attachmentIds(body.attachments)
      });
      status = 202;
    } else if (req.url === '/api/threads/cancel') {
      await controller.cancel(stringField(body, 'threadId'));
      result = {accepted: true};
      status = 202;
    } else if (req.url === '/api/threads/rename') {
      result = await controller.renameThread(stringField(body, 'threadId'), stringField(body, 'title'));
    } else if (req.url === '/api/threads/archive') {
      if (typeof body.archived !== 'boolean') throw new Error('Invalid request');
      result = await controller.archiveThread(stringField(body, 'threadId'), body.archived);
    } else if (req.url === '/api/approvals/respond') {
      if (typeof body.accept !== 'boolean') throw new Error('Invalid request');
      await controller.answerApproval({id: stringField(body, 'id'), accept: body.accept, answers: body.answers});
      result = {accepted: true};
    } else if (req.url === '/api/files/list') {
      result = await controller.listFiles(stringField(body, 'projectId'), typeof body.path === 'string' ? body.path : '');
    } else if (req.url === '/api/files/read') {
      result = await controller.readFile(stringField(body, 'projectId'), stringField(body, 'path'));
    } else if (req.url === '/api/attachments') {
      result = await controller.saveAttachment({dataUrl: stringField(body, 'dataUrl')});
      status = 201;
    }
    send(res, status, result);
    return true;
  }

  return {handle, routeMethods: ROUTE_METHODS};
}

module.exports = {createWorkbenchRoutes};
