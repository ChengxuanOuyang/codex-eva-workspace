'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const renderer = path.join(__dirname, '..', 'renderer');
const read = file => fs.readFileSync(path.join(renderer, file), 'utf8');
const privateConfig = {
  displayName: 'PRIVATE REI', mark: '/private/boot-mark.webp',
  portrait: '/private/rei-portrait.webp', soundtrack: '/private/startup-reference.wav',
  audioStartMs: 0, audioEndMs: 20500
};

function themeFixture() {
  const properties = new Map();
  const nodes = {'[data-workbench-unit]': {}, '[data-workbench-pilot]': {}};
  const documentElement = {dataset: {}, style: {
    getPropertyValue: name => properties.get(name) || '',
    setProperty: (name, value) => properties.set(name, value),
    removeProperty: name => properties.delete(name)
  }};
  const root = {document: {documentElement, querySelector: selector => nodes[selector]}};
  vm.runInNewContext(read('workbench/themes.js'), {window: root});
  return {themes: root.ProjectZeroThemes, documentElement, nodes};
}

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))[1];
}

test('private workbench publishes the zero-unit identity and restores the public identity', () => {
  const {themes, nodes, documentElement} = themeFixture();
  themes.applyPrivateConfig(privateConfig);
  assert.ok(themes.presentation, 'workbench presentation metadata is available');
  assert.equal(themes.presentation.unit, 'EVANGELION-00');
  assert.equal(themes.presentation.pilot, 'REI / 绫波丽');
  assert.equal(themes.presentation.portraitUrl, '/private/rei-portrait.webp');
  assert.equal(nodes['[data-workbench-unit]'].textContent, 'EVANGELION-00 零号机');
  assert.equal(nodes['[data-workbench-pilot]'].textContent, 'REI / 绫波丽');
  themes.apply({id: 'project-zero'});
  assert.equal(themes.presentation.unit, 'EVANGELION-00');
  themes.applyPrivateConfig(null);
  assert.equal(themes.presentation.unit, 'PROJECT ZERO');
  assert.equal(themes.presentation.portraitUrl, null);
  assert.equal(documentElement.style.getPropertyValue('--theme-workbench-portrait'), '');
  assert.equal(nodes['[data-workbench-pilot]'].textContent, 'LOCAL / PILOT-00');
});

test('public and malformed configurations never enable the private portrait', () => {
  const {themes, documentElement} = themeFixture();
  for (const config of [null, {...privateConfig, portrait: '/private/other.webp'},
    {...privateConfig, extra: true}]) {
    themes.applyPrivateConfig(config);
    assert.ok(themes.presentation, 'public workbench presentation metadata is available');
    assert.equal(themes.presentation.portraitUrl, null);
    assert.equal(documentElement.dataset.privateWorkbench, 'false');
    assert.equal(documentElement.style.getPropertyValue('--theme-workbench-portrait'), '');
  }
});

test('Rei stays below chat, terminal and settings with bounded decorative treatment', () => {
  const css = read('workbench/workbench.css');
  const portrait = block(css, '.workbench-portrait');
  const zIndex = selector => {
    const match = block(css, selector).match(/z-index:\s*(\d+)/);
    assert.ok(match, `${selector} has an explicit functional layer`);
    return Number(match[1]);
  };
  const portraitLayer = Number(portrait.match(/z-index:\s*(\d+)/)[1]);
  for (const selector of ['.conversation-column', '.tool-dock', '.settings-panel']) {
    assert.ok(zIndex(selector) > portraitLayer, `${selector} must stay above Rei`);
  }
  assert.match(portrait, /width:\s*min\(34vw,\s*520px\)/);
  assert.ok(Number(portrait.match(/opacity:\s*([.\d]+)/)[1]) <= .38);
  assert.match(portrait, /pointer-events:\s*none/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.workbench-portrait\s*\{\s*display:\s*none/);
});

test('workbench keeps project, chat, tools, permissions and retry controls reachable', () => {
  const html = read('boot/index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'functional IDs must be unique');
  for (const id of ['workbench-shell', 'workbench-app', 'project-form', 'project-path',
    'new-thread-button', 'project-list', 'thread-list', 'archived-toggle', 'message-list',
    'composer', 'prompt-input', 'model-select', 'effort-select', 'attachment-input',
    'attachment-list', 'cancel-turn-button', 'send-button', 'approval-list', 'approval-count',
    'shell-retry-button', 'retry-button', 'tool-list', 'file-list', 'refresh-files-button',
    'terminal-panel', 'terminal-view', 'terminal-create', 'terminal-close', 'git-panel',
    'git-files', 'git-refresh', 'plugins-panel', 'plugin-confirm', 'settings-panel',
    'setting-theme', 'settings-save', 'diagnostics-export']) assert.ok(ids.includes(id), id);
  for (const name of ['项目和任务', '项目列表', '会话列表', '执行和文件', '本地工具', '工作台工具']) {
    assert.ok(html.includes(`aria-label="${name}"`), name);
  }
  assert.match(html, /data-workbench-unit/);
  assert.match(html, /data-workbench-pilot/);
  assert.match(html, /class="panel-code" aria-hidden="true">CORE WORKSPACE/);
});
