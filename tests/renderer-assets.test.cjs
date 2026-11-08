'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const rendererRoot = path.join(__dirname, '..', 'renderer');

async function read(relativePath) {
  return fs.readFile(path.join(rendererRoot, relativePath), 'utf8');
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('boot document uses the exact product name and only local allowlisted assets', async () => {
  const html = await read('boot/index.html');

  assert.match(html, /<title>PROJECT ZERO \/\/ PILOT CODEX WORKBENCH<\/title>/);
  assert.match(html, /PROJECT ZERO <span>\/\/<\/span> PILOT CODEX WORKBENCH/);
  assert.match(html, /href="\/boot\.css"/);
  assert.match(html, /src="\/shared\/api\.js"/);
  assert.match(html, /src="\/boot\.js"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('public boot theme exposes the original PROJECT ZERO 00 mark and three local scene layers', async () => {
  const html = await read('boot/index.html');
  const css = await read('boot/boot.css');

  assert.match(html, /class="project-mark"[^>]*aria-label="PROJECT ZERO 00 原创系统徽记"/);
  for (const scene of ['awakening', 'sync', 'online']) {
    assert.match(html, new RegExp(`class="scene-art scene-${scene}"[^>]*data-scene="${scene}"[^>]*aria-hidden="true"`));
  }
  for (const asset of ['scene-b-awakening.webp', 'scene-a-sync.webp', 'scene-c-online.webp']) {
    assert.match(css, new RegExp(`url\\(["']?/assets/${asset.replace('.', '\\.') }["']?\\)`));
  }
  assert.doesNotMatch(`${html}\n${css}`, /pilot-silhouette|\bNERV\b|EVANGELION/i);
  assert.doesNotMatch(`${html}\n${css}`, /(?:data:image|https?:\/\/)/i);
  assert.match(css, /\.scene-art[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.sync-readout[^}]*z-index:\s*[2-9]/s);
  assert.match(css, /\.action-panel[^}]*z-index:\s*[2-9]/s);
});

test('dynamic synchronization ring exposes progressbar semantics', async () => {
  const html = await read('boot/index.html');

  assert.match(html, /<svg[^>]*id="ring-progress"[^>]*role="progressbar"/);
  assert.match(html, /<svg[^>]*id="ring-progress"[^>]*aria-label="同步进度"/);
  assert.match(html, /<svg[^>]*id="ring-progress"[^>]*aria-valuemin="0"/);
  assert.match(html, /<svg[^>]*id="ring-progress"[^>]*aria-valuemax="100"/);
  assert.match(html, /<svg[^>]*id="ring-progress"[^>]*aria-valuenow="0"/);
  assert.doesNotMatch(html, /<svg[^>]*role="img"/);
  assert.match(html, /<circle[^>]*id="ring-stroke"[^>]*class="ring-progress"/);
});

test('served renderer code contains no Node API, embedded token, or remote resource', async () => {
  const source = (await Promise.all([
    read('boot/boot.js'),
    read('shared/api.js')
  ])).join('\n');

  assert.doesNotMatch(source, /\brequire\s*\(|\bprocess\.|module\.exports/);
  assert.doesNotMatch(source, /bearer\s+|api[_-]?key|session[_-]?token/i);
  assert.doesNotMatch(source, /https?:\/\//i);
});

test('declarative boot modules are served only through explicit script allowlist entries', async () => {
  const service = await fs.readFile(path.join(__dirname, '..', 'workbench', 'service.cjs'), 'utf8');

  for (const script of ['motion.js', 'stage-layout.js', 'timeline.js']) {
    const source = await read(`boot/${script}`);
    assert.match(source, /ProjectZero(?:Motion|StageLayout|Timeline)/);
    assert.match(service, new RegExp(`\\['/${script.replace('.', '\\.')}', \\{root: bootRoot, fileName: '${script.replace('.', '\\.')}', contentType: 'text/javascript; charset=utf-8'\\}\\]`));
  }
});

test('reduced motion removes decorative animation and keeps scene changes to a short cross-fade', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.orbit[^}]*animation: none !important/s);
  assert.match(css, /\.ring-progress[^}]*transition: none !important/s);
  assert.match(css, /\.scene-art[^}]*transition: opacity 120ms/s);
});

test('scene artwork cross-fades without parallax and narrow layouts keep controls scroll-reachable', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /\.scene-art[^}]*transition:\s*opacity/s);
  assert.match(css, /body\[data-scene="awakening"\][^}]*\.scene-awakening[^}]*opacity:\s*1/s);
  assert.match(css, /body\[data-scene="sync"\][^}]*\.scene-sync[^}]*opacity:\s*1/s);
  assert.match(css, /body\[data-scene="online"\][^}]*\.scene-online[^}]*opacity:\s*1/s);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.boot-grid[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width: 780px\)[\s\S]*\.boot-footer[^}]*position:\s*static/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.scene-art[^}]*transition:\s*opacity 120ms/s);
});

test('waiting presentation disables every decorative animation and ring transition', async () => {
  const css = await read('boot/boot.css');

  for (const selector of ['orbit', 'telemetry span', 'signal-dot']) {
    const escaped = selector.replace('.', '\\.').replace(' ', '\\s+');
    assert.match(css, new RegExp(`body\\[data-phase="waiting"\\] \\.${escaped}[^\\{]*\\{[^}]*animation: none`, 's'));
  }
  assert.match(css, /body\[data-phase="waiting"\] \.ring-progress[^}]*transition: none/s);
});

test('small functional text colors meet 4.5 to 1 contrast on the ice surface', async () => {
  const css = await read('boot/boot.css');
  const muted = css.match(/--muted:\s*(#[0-9a-f]{6})/i)[1];
  const accent = css.match(/--orange-deep:\s*(#[0-9a-f]{6})/i)[1];

  assert.ok(contrast(muted, '#f6fbfa') >= 4.5, `muted contrast was ${contrast(muted, '#f6fbfa')}`);
  assert.ok(contrast(accent, '#f6fbfa') >= 4.5, `accent contrast was ${contrast(accent, '#f6fbfa')}`);
});
