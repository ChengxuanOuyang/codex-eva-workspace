'use strict';

const MAX_ITEM_TEXT = 512 * 1024;

function messageFor(thread, id) {
  let message = thread.messages.find(entry => entry.id === id);
  if (!message) {
    message = {id, role: 'assistant', text: '', status: 'streaming'};
    thread.messages.push(message);
  }
  return message;
}

function toolFor(thread, item) {
  let tool = thread.tools.find(entry => entry.id === item.id);
  if (!tool) {
    tool = {
      id: item.id,
      type: item.type,
      title: item.command || item.path || item.name || item.type,
      output: '',
      status: item.status || 'inProgress'
    };
    thread.tools.push(tool);
  }
  return tool;
}

function completedMessageText(item) {
  if (typeof item.text === 'string') return item.text.slice(-MAX_ITEM_TEXT);
  if (!Array.isArray(item.content)) return '';
  return item.content
    .filter(content => content?.type === 'output_text' && typeof content.text === 'string')
    .map(content => content.text)
    .join('')
    .slice(-MAX_ITEM_TEXT);
}

function completedToolOutput(item, fallback) {
  if (Array.isArray(item.changes)) {
    return item.changes
      .filter(change => change && typeof change.diff === 'string')
      .map(change => change.diff)
      .join('\n')
      .slice(-MAX_ITEM_TEXT);
  }
  return String(item.aggregatedOutput || item.output || fallback || '').slice(-MAX_ITEM_TEXT);
}

const TOOL_TYPES = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch']);

function reduceEvent(thread, method, params = {}) {
  thread.messages ||= [];
  thread.tools ||= [];

  if (method === 'turn/started') {
    thread.activeTurn = params.turn?.id || thread.activeTurn || null;
    thread.status = 'inProgress';
  } else if (method === 'turn/completed') {
    const status = params.turn?.status || 'completed';
    thread.status = status;
    thread.activeTurn = null;
  } else if (method === 'item/agentMessage/delta') {
    const message = messageFor(thread, params.itemId);
    message.text = (message.text + (typeof params.delta === 'string' ? params.delta : '')).slice(-MAX_ITEM_TEXT);
  } else if (method === 'item/started' && params.item?.id) {
    if (params.item.type === 'agentMessage') messageFor(thread, params.item.id);
    else if (TOOL_TYPES.has(params.item.type)) toolFor(thread, params.item);
  } else if (method === 'item/completed' && params.item?.id) {
    if (params.item.type === 'agentMessage') {
      const message = messageFor(thread, params.item.id);
      message.text = completedMessageText(params.item) || message.text;
      message.status = params.item.status || 'completed';
    } else if (TOOL_TYPES.has(params.item.type)) {
      const tool = toolFor(thread, params.item);
      tool.title = params.item.command || params.item.path || params.item.name || params.item.changes?.[0]?.path || tool.title;
      tool.output = completedToolOutput(params.item, tool.output);
      tool.status = params.item.status || 'completed';
    }
  } else if (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') {
    const item = {id: params.itemId, type: method.includes('commandExecution') ? 'commandExecution' : 'fileChange'};
    const tool = toolFor(thread, item);
    tool.output = (tool.output + (typeof params.delta === 'string' ? params.delta : '')).slice(-MAX_ITEM_TEXT);
  }
  return thread;
}

module.exports = {reduceEvent};
