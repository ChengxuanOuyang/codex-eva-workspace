# 阶段 1：Electron 与 Codex 基础实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 交付一个可运行的 macOS Electron 应用，播放原创 PROJECT ZERO 启动序列，安全启动官方 Codex app-server，并在后端就绪后完成 99.2% 驾驶员确认。

**架构：** Electron 主进程启动受保护的随机端口回环服务；Renderer 只访问该服务并保持 Node 隔离；`CodexBridge` 以 stdio 启动官方 Codex。启动动画与后端初始化并行，但确认按钮由真实健康状态控制。

**技术栈：** Electron 45.2.3、Node.js 24 LTS、CommonJS、node:test、ESLint 10.14.0、Playwright 1.65.0、electron-builder 26.18.0。

---

## 文件结构

- `package.json`：脚本、锁定依赖、Electron 入口和构建配置。
- `package-lock.json`：可复现依赖图。
- `eslint.config.mjs`：Node、Electron 和浏览器代码 lint。
- `.gitignore`：构建、本地数据、私人主题和凭据防护。
- `LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`：MIT 和上游归属。
- `app/main.cjs`：Electron 生命周期和窗口。
- `app/runtime-paths.cjs`：Application Support、日志和资源路径。
- `app/codex-discovery.cjs`：Codex 可执行文件探测。
- `workbench/bridge.cjs`：官方 app-server JSON-RPC 生命周期。
- `workbench/service.cjs`：随机回环端口和健康 API。
- `renderer/boot/index.html`、`boot.css`、`boot.js`：原创启动序列。
- `renderer/shared/api.js`：受限 HTTP 调用。
- `tests/foundation.test.cjs`：仓库与许可证约束。
- `tests/codex-discovery.test.cjs`：Codex 探测顺序。
- `tests/bridge.test.cjs`：app-server 请求与失败生命周期。
- `tests/service-security.test.cjs`：Host、Origin、Cookie 和绑定地址。
- `tests/boot-state.test.cjs`：99.2% 状态机。
- `tests/e2e/boot.test.cjs`：Electron 真实窗口启动。

### 任务 1：建立可复现的 Electron 工程

**文件：** 创建 `package.json`、`eslint.config.mjs`、`.gitignore`、`LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、`tests/foundation.test.cjs`

- [ ] **步骤 1：编写失败的仓库约束测试**

```js
// tests/foundation.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pkg = require('../package.json');

test('application metadata and exact runtime versions are pinned', () => {
  assert.equal(pkg.name, 'project-zero-rei-codex-workbench');
  assert.equal(pkg.main, 'app/main.cjs');
  for (const version of Object.values({...pkg.dependencies, ...pkg.devDependencies})) {
    assert.doesNotMatch(version, /^[~^*]|latest$/);
  }
});

test('private and credential-bearing paths are ignored', () => {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  for (const entry of ['private-themes/', '.env', 'auth.json', 'dist/', 'node_modules/']) {
    assert.match(ignore, new RegExp(entry.replace(/[./]/g, '\\$&')));
  }
});
```

- [ ] **步骤 2：运行测试并确认因 `package.json` 缺失而失败**

运行：`node --test tests/foundation.test.cjs`
预期：FAIL，包含 `Cannot find module '../package.json'`。

- [ ] **步骤 3：创建最小工程配置**

```json
{
  "name": "project-zero-rei-codex-workbench",
  "version": "0.1.0-preview.0",
  "private": true,
  "description": "Unofficial local-first PROJECT ZERO Codex workbench for macOS",
  "main": "app/main.cjs",
  "license": "MIT",
  "engines": {"node": ">=24"},
  "scripts": {
    "start": "electron .",
    "dev": "electron .",
    "lint": "eslint .",
    "test": "node --test",
    "test:e2e": "node --test tests/e2e/*.test.cjs",
    "verify": "npm run lint && npm test",
    "pack": "electron-builder --dir",
    "dist:mac:arm64": "electron-builder --mac dmg zip --arm64",
    "dist:mac:x64": "electron-builder --mac dmg zip --x64"
  },
  "dependencies": {},
  "devDependencies": {
    "electron": "45.2.3",
    "electron-builder": "26.18.0",
    "eslint": "10.14.0",
    "playwright": "1.65.0"
  },
  "build": {
    "appId": "dev.chengxuan.projectzero",
    "productName": "PROJECT ZERO",
    "asar": true,
    "files": ["app/**/*", "workbench/**/*", "renderer/**/*", "package.json", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"],
    "mac": {"category": "public.app-category.developer-tools", "hardenedRuntime": false, "identity": null}
  }
}
```

`.gitignore` 必须逐行包含：`node_modules/`、`dist/`、`.env`、`.env.*`、`auth.json`、`private-themes/`、`workbench/data/`、`*.log`、`.DS_Store`。

`NOTICE.md` 必须写明：项目非官方；上游 `Iris-change/eva-codex-workbench` 的 MIT 代码仅选择性移植；未包含上游视觉、语音或 EVA 素材。`THIRD_PARTY_NOTICES.md` 先登记 Electron、Playwright 与 electron-builder，后续任务增补。

- [ ] **步骤 4：安装依赖并运行测试与 lint**

运行：`npm install && npm run lint && node --test tests/foundation.test.cjs`
预期：生成 `package-lock.json`；lint 与 2 个测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add package.json package-lock.json eslint.config.mjs .gitignore LICENSE NOTICE.md THIRD_PARTY_NOTICES.md tests/foundation.test.cjs
git commit -m "chore: establish Electron project foundation"
```

### 任务 2：实现 Codex 探测与 app-server 桥

**文件：** 创建 `app/codex-discovery.cjs`、`workbench/bridge.cjs`、`tests/codex-discovery.test.cjs`、`tests/bridge.test.cjs`

- [ ] **步骤 1：编写探测顺序和桥生命周期失败测试**

```js
// tests/codex-discovery.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const {candidatePaths, findCodex} = require('../app/codex-discovery.cjs');

test('bundled ChatGPT binary precedes PATH and user selection', () => {
  assert.deepEqual(candidatePaths('/custom/codex', '/path/codex').slice(0, 3), [
    '/Applications/ChatGPT.app/Contents/Resources/codex', '/path/codex', '/custom/codex'
  ]);
});

test('findCodex returns the first executable candidate', () => {
  const result = findCodex({exists: p => p === '/path/codex', pathCodex: '/path/codex'});
  assert.equal(result, '/path/codex');
});
```

`tests/bridge.test.cjs` 用一个假 child process 验证：启动参数必须为 `app-server --listen stdio:// -c analytics.enabled=false`；`initialize` 成功后发送 `initialized`；停止时所有 pending promise 被拒绝；旧进程的延迟退出不会断开新进程。

- [ ] **步骤 2：运行测试并确认模块缺失失败**

运行：`node --test tests/codex-discovery.test.cjs tests/bridge.test.cjs`
预期：FAIL，两个目标模块不存在。

- [ ] **步骤 3：实现探测模块与桥的最小公开接口**

```js
// app/codex-discovery.cjs
'use strict';
const fs = require('node:fs');
function candidatePaths(userPath, pathCodex) {
  return ['/Applications/ChatGPT.app/Contents/Resources/codex', pathCodex, userPath].filter(Boolean);
}
function findCodex({userPath, pathCodex, exists = p => fs.existsSync(p)} = {}) {
  return candidatePaths(userPath, pathCodex).find(exists) || null;
}
module.exports = {candidatePaths, findCodex};
```

`workbench/bridge.cjs` 实现 `CodexBridge.start()`、`request()`、`respond()`、`stop()`，逐行解析 stdout JSON，不转发可能含账号信息的 stderr；只导出 `CodexBridge`。以已审查的上游 MIT bridge 生命周期为基线，并在文件头保留来源注释。

- [ ] **步骤 4：运行定向测试**

运行：`node --test tests/codex-discovery.test.cjs tests/bridge.test.cjs`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add app/codex-discovery.cjs workbench/bridge.cjs tests/codex-discovery.test.cjs tests/bridge.test.cjs NOTICE.md
git commit -m "feat: discover and initialize official Codex app-server"
```

### 任务 3：建立 Application Support 路径和安全回环服务

**文件：** 创建 `app/runtime-paths.cjs`、`workbench/service.cjs`、`tests/runtime-paths.test.cjs`、`tests/service-security.test.cjs`

- [ ] **步骤 1：编写路径和 HTTP 边界失败测试**

```js
// tests/runtime-paths.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const {runtimePaths} = require('../app/runtime-paths.cjs');
test('all writable files stay below userData', () => {
  const p = runtimePaths('/tmp/project-zero');
  assert.equal(p.state, '/tmp/project-zero/state/state.json');
  assert.equal(p.logs, '/tmp/project-zero/logs');
  assert.equal(p.themes, '/tmp/project-zero/themes');
});
```

`tests/service-security.test.cjs` 启动服务于端口 `0`，断言 `server.address().address === '127.0.0.1'`；错误 Host 返回 403；首次 `/` 设置 `HttpOnly; SameSite=Strict` Cookie；无 Cookie 的 `/api/state` 返回 403；错误 Origin 的 POST 返回 403。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/runtime-paths.test.cjs tests/service-security.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现服务工厂**

```js
// workbench/service.cjs
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
function createWorkbenchService({snapshot, publicRoot}) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, {error: 'Invalid host'});
    if (req.url === '/health') return send(res, 200, {app: 'PROJECT-ZERO', ready: snapshot().ready});
    if (req.url === '/') {
      res.setHeader('Set-Cookie', `project_zero_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return serveIndex(publicRoot, res);
    }
    if (req.url.startsWith('/api/') && !hasSession(req, token)) return send(res, 403, {error: 'Open the workbench first'});
    if (req.url === '/api/state') return send(res, 200, snapshot());
    return send(res, 404, {error: 'Not found'});
  });
  return {listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address()))), close: () => new Promise(resolve => server.close(resolve)), server};
}
module.exports = {createWorkbenchService};
```

同文件中的 `send`、`serveIndex`、`hasSession` 必须完整实现；所有响应添加 `nosniff`、`no-referrer` 和严格 CSP。

- [ ] **步骤 4：运行定向测试**

运行：`node --test tests/runtime-paths.test.cjs tests/service-security.test.cjs`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add app/runtime-paths.cjs workbench/service.cjs tests/runtime-paths.test.cjs tests/service-security.test.cjs
git commit -m "feat: add protected loopback workbench service"
```

### 任务 4：实现 Electron 生命周期和原生窗口

**文件：** 创建 `app/main.cjs`、`app/window-options.cjs`、`tests/window-options.test.cjs`

- [ ] **步骤 1：编写窗口安全选项失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {windowOptions} = require('../app/window-options.cjs');
test('renderer is isolated from Node', () => {
  const options = windowOptions('/app/preload.cjs');
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/window-options.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现主进程**

`app/main.cjs` 必须按此顺序执行：`app.whenReady()`；创建运行目录；发现 Codex；创建 `CodexBridge`；启动 `createWorkbenchService`；创建 `BrowserWindow`；加载返回的 `http://127.0.0.1:<port>/`；拒绝 `will-navigate` 到非本地 origin；拒绝所有 `setWindowOpenHandler`；在 `before-quit` 中等待服务、桥和终端关闭。

窗口初始大小 `1500x950`，最小大小 `1100x720`，背景色 `#0b151a`。不得创建登录项。

- [ ] **步骤 4：运行测试并进行开发启动烟雾测试**

运行：`node --test tests/window-options.test.cjs && npm start`
预期：测试 PASS；窗口打开；DevTools 不自动打开；关闭窗口后 Electron 和 Codex 子进程退出。

- [ ] **步骤 5：Commit**

```bash
git add app/main.cjs app/window-options.cjs tests/window-options.test.cjs
git commit -m "feat: host workbench in isolated Electron window"
```

### 任务 5：实现 99.2% 启动状态机和原创界面

**文件：** 创建 `renderer/boot/boot-state.cjs`、`renderer/boot/index.html`、`renderer/boot/boot.css`、`renderer/boot/boot.js`、`renderer/shared/api.js`、`tests/boot-state.test.cjs`

- [ ] **步骤 1：编写状态机失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {nextBootState} = require('../renderer/boot/boot-state.cjs');
test('progress cannot pass 99.2 before backend readiness and confirmation', () => {
  let s = {phase: 'syncing', progress: 98, ready: false, confirmed: false};
  s = nextBootState(s, {type: 'tick', delta: 4});
  assert.equal(s.progress, 99.2);
  assert.equal(nextBootState(s, {type: 'confirm'}).progress, 99.2);
  s = nextBootState(s, {type: 'ready'});
  s = nextBootState(s, {type: 'confirm'});
  assert.equal(s.phase, 'completing');
});
test('skip changes presentation only', () => {
  const s = nextBootState({phase: 'syncing', progress: 20, ready: false, confirmed: false}, {type: 'skip'});
  assert.equal(s.phase, 'waiting');
  assert.equal(s.ready, false);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/boot-state.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现纯状态机和界面**

`nextBootState` 只接受 `tick`、`ready`、`failed`、`confirm`、`skip`、`complete`；任何未知事件返回原状态。`confirm` 只有在 `progress === 99.2 && ready` 时进入 `completing`。`skip` 进入无动画等待页而不是工作台。

HTML/CSS 按批准视觉实现冰白控制面、原创 `PROJECT ZERO` 几何印记、侧边状态六边形、橙色流体层和同步环；不得包含 NERV、官方人物图或参考视频像素。`prefers-reduced-motion: reduce` 禁用液面大幅位移并缩短过渡。

`boot.js` 每 500ms 请求 `/health`；后端 ready 后派发 `ready`；3 秒后显示跳过；`Esc` 仅派发 `skip`；确认按钮按状态启用。

- [ ] **步骤 4：运行测试并人工确认三种路径**

运行：`npm test && npm start`
预期：状态机测试 PASS；正常路径停在 99.2%；后端未就绪时按钮禁用；`Esc` 进入等待/诊断而非绕过；Reduced Motion 下无大幅流体动画。

- [ ] **步骤 5：Commit**

```bash
git add renderer/boot renderer/shared/api.js tests/boot-state.test.cjs
git commit -m "feat: add PROJECT ZERO pilot-confirmed boot sequence"
```

### 任务 6：增加 Electron 端到端测试和开发构建

**文件：** 创建 `tests/e2e/boot.test.cjs`、修改 `package.json`

- [ ] **步骤 1：编写 Electron 启动失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {_electron: electron} = require('playwright');
test('application reaches pilot confirmation without remote content', async () => {
  const app = await electron.launch({args: ['.'], env: {...process.env, PROJECT_ZERO_FAKE_CODEX: '1'}});
  const page = await app.firstWindow();
  await page.getByText('驾驶员身份确认').waitFor();
  assert.match(page.url(), /^http:\/\/127\.0\.0\.1:/);
  assert.equal(await page.locator('script[src^="http"]').count(), 0);
  await app.close();
});
```

- [ ] **步骤 2：运行测试并确认因 fake Codex 未实现而失败**

运行：`npm run test:e2e`
预期：FAIL，应用无法进入 ready 或测试超时。

- [ ] **步骤 3：实现测试专用 fake Codex 适配器**

仅当 `NODE_ENV === 'test' && PROJECT_ZERO_FAKE_CODEX === '1'` 时，`app/main.cjs` 使用内存 bridge，返回 `account.signedIn=true` 和固定模型目录。生产打包配置不得设置该变量。

- [ ] **步骤 4：运行全阶段验证和未签名目录构建**

运行：`npm run verify && npm run test:e2e && npm run pack`
预期：全部测试 PASS；`dist/mac*/PROJECT ZERO.app` 生成；应用包内不存在参考视频、`auth.json` 或 `private-themes`。

- [ ] **步骤 5：Commit**

```bash
git add app/main.cjs tests/e2e/boot.test.cjs package.json package-lock.json
git commit -m "test: verify Electron boot and Codex readiness flow"
```

## 阶段 1 完成检查

运行：

```bash
npm ci
npm run verify
npm run test:e2e
npm run pack
```

预期：所有命令退出码 `0`；应用在测试 bridge 下停在 99.2%，确认后进入空工作台壳；真实运行能发现当前 Mac 的 ChatGPT 内置 Codex。完成后进行代码审查，再进入阶段 2。
