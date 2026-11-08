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
  ['/api/approvals/respond', ['POST']]
]);

function objectBody(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Invalid request');
  return req.body;
}

function stringField(body, name) {
  if (typeof body[name] !== 'string' || body[name].length === 0) throw new Error('Invalid request');
  return body[name];
}

function writeEvent(res, snapshot) {
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function createWorkbenchRoutes(controller) {
  async function handle(req, res, {send, setSecurityHeaders}) {
    if (!ROUTE_METHODS.has(req.url)) return false;
    if (req.url === '/api/workbench') {
      send(res, 200, controller.snapshot());
      return true;
    }
    if (req.url === '/api/events') {
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
        attachments: Array.isArray(body.attachments) ? body.attachments : []
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
    }
    send(res, status, result);
    return true;
  }

  return {handle, routeMethods: ROUTE_METHODS};
}

module.exports = {createWorkbenchRoutes};

