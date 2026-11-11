'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createWorkbenchService} = require('../workbench/service.cjs');

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
  assert.match(html, /href="\/fonts\/mincho\.css"/);
  assert.match(html, /src="\/shared\/api\.js"/);
  assert.match(html, /src="\/boot-canvas\.js"/);
  assert.match(html, /src="\/boot\.js"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('reference font is exact-allowlisted with its OFL notice', async () => {
  const bootRoot = path.join(rendererRoot, 'boot');
  const service = createWorkbenchService({
    snapshot: () => ({ready: true}),
    bootRoot,
    sharedRoot: path.join(rendererRoot, 'shared')
  });

  try {
    const address = await service.listen();
    for (const requestPath of ['/fonts/mincho.css', '/fonts/unit02-mincho-black.woff2']) {
      const response = await request(address, requestPath);
      assert.equal(response.status, 200, requestPath);
      assert.equal(response.headers['content-security-policy'], "default-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'");
    }
    for (const requestPath of [
      '/fonts/../package.json',
      '/fonts/mincho.css?cache=1',
      '/fonts\\\\unit02-mincho-black.woff2',
      '/fonts/unlisted.woff2'
    ]) {
      const response = await request(address, requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.deepEqual(JSON.parse(response.body), {error: 'Not found'}, requestPath);
    }
  } finally {
    await service.close();
  }

  const [font, css, notice, sources] = await Promise.all([
    fs.readFile(path.join(rendererRoot, 'fonts', 'unit02-mincho-black.woff2')),
    read('fonts/mincho.css'),
    read('fonts/OFL-NotoSerifCJK.txt'),
    read('fonts/SOURCES.md')
  ]);
  assert.equal(require('node:crypto').createHash('sha256').update(font).digest('hex'), '9fc4a47a81d503580674d4b754b84b17557e57ca53136abd6c563a6892c93d65');
  assert.match(css, /^@font-face \{\n  font-family: "Unit02 Mincho";\n  src: url\("\/fonts\/unit02-mincho-black\.woff2"\) format\("woff2"\);\n  font-display: swap;\n  font-weight: 900;\n\}\n$/);
  assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(sources, /Noto Serif CJK SC Black/);
  assert.match(sources, /SIL Open Font License 1\.1/);
});

test('boot presentation uses one canvas with hidden semantics and keeps controls in the DOM', async () => {
  const html = await read('boot/index.html');
  const css = await read('boot/boot.css');

  assert.match(html, /<canvas[^>]*id="boot-sequence"[^>]*aria-hidden="true"/);
  assert.match(html, /id="ring-progress"[^>]*role="progressbar"/);
  assert.match(html, /id="boot-live-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="pilot-authorization"/);
  assert.match(html, /id="pilot-authorization"[^>]*hidden/);
  assert.match(html, /id="transition-curtain"/);
  assert.match(html, /id="skip-button"[^>]*aria-label="跳过动态演示"/);
  assert.match(html, /id="confirm-button"[^>]*aria-label="确认驾驶员授权并完成同步"/);
  assert.match(html, /id="retry-button"[^>]*aria-label="重新检查 Codex 连接"/);
  assert.doesNotMatch(`${html}\n${css}`, /pilot-silhouette|cockpit|helmet|骑士|荧光绿/i);
  assert.doesNotMatch(`${html}\n${css}`, /\bHIDDEN\b/);
  assert.doesNotMatch(`${html}\n${css}`, /(?:data:image|https?:\/\/)/i);
  assert.match(css, /\.boot-presentation[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /#boot-sequence[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(css, /\.visually-hidden[^}]*clip:\s*rect\(0 0 0 0\)/s);
});

test('boot scripts load in the required deterministic order', async () => {
  const html = await read('boot/index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(match => match[1]);
  const start = scripts.indexOf('/shared/api.js');

  assert.notEqual(start, -1);
  assert.deepEqual(scripts.slice(start, start + 9), [
    '/shared/api.js',
    '/motion.js',
    '/stage-layout.js',
    '/reference-timing.js',
    '/timeline.js',
    '/boot-canvas.js',
    '/sequence-audio.js',
    '/audio-clock.js',
    '/boot.js'
  ]);
});

test('canvas source pins the exact MIT code origins while excluding upstream media', async () => {
  const source = await read('boot/boot-canvas.js');

  assert.match(source, /https:\/\/github\.com\/Iris-change\/eva-codex-workbench/);
  assert.match(source, /b12753e063d6b8752b4e0994e851d5cc0950f85b/);
  for (const file of ['unified-sequence.js', 'boot-atmosphere.js', 'stage-layout.js']) {
    assert.match(source, new RegExp(file.replace('.', '\\.')));
  }
  assert.match(source, /Adapted MIT code scope/);
  assert.match(source, /NERV marks[^.]*not covered/);
  assert.match(source, /voice\/audio[^.]*not covered/);
  assert.doesNotMatch(source, /data:image/);
  assert.match(source, /['"]\/private\/theme\.json['"]/);
  assert.match(source, /['"]\/private\/boot-mark\.webp['"]/);
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

function request(address, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: address.port, path: requestPath
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
    });
    req.on('error', reject);
    req.end();
  });
}

test('declarative boot modules are served through exact allowlist entries only', async () => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-zero-boot-modules-'));
  const bootRoot = path.join(fixtureRoot, 'boot');
  const sharedRoot = path.join(fixtureRoot, 'shared');
  const service = createWorkbenchService({snapshot: () => ({ready: true}), bootRoot, sharedRoot});
  const scripts = [
    'motion.js',
    'stage-layout.js',
    'reference-timing.js',
    'timeline.js',
    'boot-canvas.js',
    'sequence-audio.js',
    'audio-clock.js'
  ];

  try {
    await fs.mkdir(bootRoot);
    await fs.mkdir(sharedRoot);
    for (const script of scripts) {
      await fs.writeFile(path.join(bootRoot, script), `globalThis.${script} = true;`);
    }
    const address = await service.listen();

    for (const script of scripts) {
      const response = await request(address, `/${script}`);
      assert.equal(response.status, 200, script);
      assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8', script);
    }

    for (const requestPath of [
      '/unlisted-boot-module.js',
      '/audio-clock.js?cache=1',
      '/sequence-audio.js.bak',
      '/boot/audio-clock.js'
    ]) {
      const unknown = await request(address, requestPath);
      assert.equal(unknown.status, 404, requestPath);
      assert.deepEqual(JSON.parse(unknown.body), {error: 'Not found'}, requestPath);
    }
  } finally {
    await service.close();
    await fs.rm(fixtureRoot, {recursive: true, force: true});
  }
});

test('reduced motion limits boot composition changes to a short cross-fade', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.boot-control-layer[^}]*transition:\s*opacity 180ms/s);
  assert.match(css, /body\[data-motion="reduced"\] \.boot-control-layer[^}]*transition:\s*opacity 180ms/s);
  assert.match(css, /body\[data-motion="reduced"\] #boot-sequence[^}]*transition:\s*opacity 180ms/s);
  assert.doesNotMatch(css, /transition-duration:\s*(?:[2-9]\d\d|\d{4,})ms[^;]*!important/s);
});

test('full-screen boot has no scrolling and narrow layouts keep every action reachable', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /html,\s*body[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(css, /body:not\(\[data-phase="complete"\]\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\[data-phase="complete"\][^}]*overflow:\s*auto/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.skip-button[^}]*top:/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pilot-authorization[^}]*left:/s);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.diagnostic-panel[^}]*max-height:/s);
  assert.match(css, /@media \(max-width: 640px\) and \(max-height: 600px\)[\s\S]*\.boot-presentation[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(max-width: 640px\) and \(max-height: 600px\)[\s\S]*\.pilot-authorization[^}]*position:\s*relative/s);
  assert.match(css, /@media \(max-width: 640px\) and \(max-height: 600px\)[\s\S]*\.pilot-authorization[^}]*margin:\s*66px 12px 12px/s);
  assert.match(css, /@media \(max-width: 640px\) and \(max-height: 600px\)[\s\S]*\.diagnostic-panel[^}]*position:\s*relative/s);
  assert.match(css, /\.pilot-authorization\[hidden\] \+ \.diagnostic-panel[^}]*margin-top:\s*66px/s);
});

test('authorization is hidden until the authorization or waiting stage regardless of early readiness', async () => {
  const css = await read('boot/boot.css');

  assert.match(css, /\.pilot-authorization\[hidden\][^}]*display:\s*none/s);
  assert.match(css, /body\[data-stage="authorize"\] \.pilot-authorization/);
  assert.match(css, /body\[data-phase="waiting"\] \.pilot-authorization/);
  assert.doesNotMatch(css, /body\[data-readiness="ready"\] \.pilot-authorization/);
});

test('reference analysis fixes source priority without private paths, captures, or social identity', async () => {
  const analysis = await fs.readFile(path.join(__dirname, '..', 'docs', 'reference-analysis.md'), 'utf8');

  assert.match(analysis, /EVA startup recording is the sole primary reference/i);
  assert.match(analysis, /engineering reference only/i);
  assert.match(analysis, /Kamen Rider recording is a secondary motion reference only/i);
  assert.match(analysis, /node cascades/i);
  assert.match(analysis, /authorization flash/i);
  assert.match(analysis, /progress-linked/i);
  assert.match(analysis, /completion handoff/i);
  assert.doesNotMatch(analysis, /\/(?:Users|home|private|var|tmp)\/|[A-Z]:\\/);
  assert.doesNotMatch(analysis, /<img|!\[[^\]]*\]\(|screenshot|screen capture|截图/i);
  assert.doesNotMatch(analysis, /@[a-z0-9_]{2,}|social account|账号|handle/i);
});

test('small functional text colors meet 4.5 to 1 contrast on the ice surface', async () => {
  const css = await read('boot/boot.css');
  const muted = css.match(/--muted:\s*(#[0-9a-f]{6})/i)[1];
  const accent = css.match(/--orange-deep:\s*(#[0-9a-f]{6})/i)[1];

  assert.ok(contrast(muted, '#f6fbfa') >= 4.5, `muted contrast was ${contrast(muted, '#f6fbfa')}`);
  assert.ok(contrast(accent, '#f6fbfa') >= 4.5, `accent contrast was ${contrast(accent, '#f6fbfa')}`);
});
