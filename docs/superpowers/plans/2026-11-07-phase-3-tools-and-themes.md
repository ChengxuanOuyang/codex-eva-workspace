# 阶段 3：开发工具与主题实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 增加终端、Git、插件、私人主题、原创音频、设置与诊断，同时保持 Codex 权限和手动工具权限的清晰分离。

**架构：** 每个开发工具由独立服务模块负责参数校验与生命周期；Renderer 通过固定 API 操作。主题包使用声明文件和 Application Support 沙箱；声音只加载仓库内已登记许可证的原创文件或用户本地文件。

**技术栈：** node-pty 1.1.0、xterm 6.0.0、xterm-addon-fit 0.11.0、Git CLI、Codex plugin CLI、Node.js、Electron。

---

## 文件结构

- `workbench/terminal.cjs`：PTY 会话和有界输出。
- `workbench/git-service.cjs`：非 shell Git 参数调用。
- `workbench/plugins.cjs`：官方插件目录和变更。
- `workbench/themes.cjs`：主题声明、导入和路径安全。
- `workbench/diagnostics.cjs`：脱敏诊断包。
- `renderer/workbench/terminal.js`、`git.js`、`plugins.js`、`themes.js`、`settings.js`：工具 UI。
- `renderer/vendor/`：本地 xterm 资源。
- `assets/audio/`：原创播报和音效；每个资产有来源/许可记录。
- `assets/themes/project-zero/manifest.json`：默认原创主题。
- `docs/theme-packs.md`：私人主题包格式。
- `tests/terminal.test.cjs`、`git-service.test.cjs`、`plugins.test.cjs`、`themes.test.cjs`、`diagnostics.test.cjs`：模块测试。
- `tests/e2e/tools.test.cjs`：工具端到端测试。

### 任务 1：实现受控多会话终端

**文件：** 创建 `workbench/terminal.cjs`、`tests/terminal.test.cjs`，修改 `package.json`、`THIRD_PARTY_NOTICES.md`

- [ ] **步骤 1：编写失败测试**

```js
test('terminal validates dimensions and caps retained output', async () => {
  const manager = fixtureTerminal();
  const session = manager.create({id: 'p', path: '/tmp'});
  assert.throws(() => manager.resize(session.id, 0, 24), /columns/);
  session.child.emitData('x'.repeat(700 * 1024));
  assert.ok(manager.snapshot(session.id).buffer.length <= 512 * 1024);
});
test('stop kills every workbench-owned PTY', () => {
  const manager = fixtureTerminalWithTwoSessions();
  manager.stop();
  assert.equal(manager.children.every(x => x.killed), true);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/terminal.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：安装锁定依赖并实现 TerminalManager**

运行：`npm install --save-exact node-pty@1.1.0 @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`。

`TerminalManager` 公开 `create(project)`、`list(projectId)`、`input(id,data)`、`resize(id,cols,rows)`、`subscribe(id,res,lastEventId)`、`close(id)`、`stop()`。macOS shell 优先 `process.env.SHELL`，仅接受绝对、存在且可执行路径，否则 `/bin/zsh -f`。UI 必须显示“手动终端不受 Codex 只读模式限制”。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/terminal.test.cjs`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add package.json package-lock.json workbench/terminal.cjs tests/terminal.test.cjs THIRD_PARTY_NOTICES.md
git commit -m "feat: add bounded integrated terminal sessions"
```

### 任务 2：实现非破坏性 Git 面板

**文件：** 创建 `workbench/git-service.cjs`、`tests/git-service.test.cjs`

- [ ] **步骤 1：编写真实临时仓库测试**

```js
test('Git operations preserve unstaged changes and reject unsafe paths', async () => {
  const repo = await fixtureRepo();
  await repo.write('a.txt', 'one\ntwo\n');
  const service = new GitService();
  await service.mutate(repo.project, {operation: 'stage', path: 'a.txt'});
  await repo.write('a.txt', 'one\ntwo\nthree\n');
  assert.match((await service.status(repo.project)).files[0].worktree, /M/);
  await assert.rejects(service.diff(repo.project, {path: '../secret'}), /path/);
  await assert.rejects(service.mutate(repo.project, {operation: 'force-push'}), /unsupported/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/git-service.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 GitService**

所有调用使用 `execFile('git', args, {shell:false})`；设置 `GIT_TERMINAL_PROMPT=0`；错误脱敏 URL 用户信息和常见 token。只允许 `status`、`diff`、`stage`、`unstage`、`commit`、`branch`、`switch`、`fetch`、`pull --ff-only`、`push`。分支名先经过 `git check-ref-format --branch`。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/git-service.test.cjs`
预期：本地仓库、分支、提交、隔离 bare remote 的 fetch/pull/push 全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/git-service.cjs tests/git-service.test.cjs
git commit -m "feat: add non-destructive Git workbench"
```

### 任务 3：实现官方 Codex 插件管理

**文件：** 创建 `workbench/plugins.cjs`、`tests/plugins.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
test('plugin changes accept only catalog identifiers and explicit operations', async () => {
  const manager = fixturePlugins([{id: 'openai-developers'}]);
  await manager.change('openai-developers', 'install', '/tmp/project');
  assert.deepEqual(manager.calls[0].args.slice(-3), ['plugin', 'install', 'openai-developers']);
  await assert.rejects(manager.change('../bad', 'install', '/tmp/project'), /catalog/);
  await assert.rejects(manager.change('openai-developers', 'enable', '/tmp/project'), /operation/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/plugins.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现 PluginManager**

`list(cwd)` 调用官方 `codex plugin` JSON 输出并缓存 60 秒；`change(id, operation, cwd)` 只允许当前目录返回过的 id 和 `install|uninstall`。超时 90 秒，最大输出 20 MiB，不使用 shell。需要账号连接时提示用户在官方客户端完成，不自行处理第三方 OAuth。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/plugins.test.cjs`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/plugins.cjs tests/plugins.test.cjs
git commit -m "feat: manage official Codex plugins safely"
```

### 任务 4：实现原创主题和私人主题包

**文件：** 创建 `workbench/themes.cjs`、`assets/themes/project-zero/manifest.json`、`docs/theme-packs.md`、`tests/themes.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
test('theme import rejects traversal, scripts and undeclared files', async () => {
  const themes = await fixtureThemes();
  await assert.rejects(themes.importPack(pack({background: '../outside.png'})), /path/);
  await assert.rejects(themes.importPack(pack({background: 'theme.svg'})), /type/);
  await assert.rejects(themes.importPack(pack({script: 'theme.js'})), /schema/);
});
test('private theme export excludes local copyrighted assets by default', async () => {
  const result = await fixtureThemes().exportSettings('private-rei');
  assert.equal(result.files, undefined);
  assert.equal(result.themeId, 'private-rei');
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/themes.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现严格 manifest**

`manifest.json` 只允许：`schemaVersion`、`id`、`name`、`author`、`colors`、`background`、`portrait`、`audio`。图片只允许 PNG/JPEG/WebP，音频只允许 WAV/MP3/M4A；所有 realpath 必须位于导入临时目录；禁止 HTML、SVG、CSS、JS 和任意 URL。安装时复制到 Application Support `themes/<uuid>`，不复制到仓库。

默认原创主题清单只引用仓库 `assets/themes/project-zero` 内资产，并包含 `license: MIT` 或各资产许可证标识。

默认主题固定采用已批准的「徽记 + 核心侧影」构图：公开包只包含原创 `PROJECT ZERO / 00` 徽记与原创绫波丽视觉编码。私人主题可导入用户自行提供且有权使用的官方风格图片，但这些文件只安装到 Application Support，必须被 Git、诊断、设置导出和公开构建排除；应用不得下载或附带此类素材。

- [ ] **步骤 4：运行测试并检查仓库**

运行：`node --test tests/themes.test.cjs && git check-ignore private-themes/sample.png`
预期：测试 PASS；示例私人文件被 `.gitignore` 命中。

- [ ] **步骤 5：Commit**

```bash
git add workbench/themes.cjs assets/themes/project-zero/manifest.json docs/theme-packs.md tests/themes.test.cjs
git commit -m "feat: support safe local theme packs"
```

### 任务 5：加入原创声音、设置与脱敏诊断

**文件：** 创建 `assets/audio/README.md`、`assets/audio/timeline.json`、原创 WAV 文件、`workbench/diagnostics.cjs`、`renderer/workbench/settings.js`、`renderer/workbench/themes.js`、`scripts/check-asset-licenses.cjs`、`tests/diagnostics.test.cjs`、`tests/asset-licenses.test.cjs`，修改 `package.json`

- [ ] **步骤 1：编写诊断脱敏失败测试**

```js
test('diagnostics omit credentials, chat content and private themes', async () => {
  const bundle = await collectDiagnostics(fixtureDiagnosticRoot());
  const text = JSON.stringify(bundle);
  assert.doesNotMatch(text, /auth\.json|access_token|sk-[A-Za-z0-9]/);
  assert.doesNotMatch(text, /private-themes|user message secret/);
  assert.match(text, /codexVersion/);
});

test('every redistributable asset has a license record and matching digest', async () => {
  const report = await checkAssetLicenses({root: fixtureAssets()});
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.digestMismatches, []);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/diagnostics.test.cjs tests/asset-licenses.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：创建并登记原创音频**

使用不模仿原作声优的合成或真人授权声音录制日语系统短句；每个文件在 `assets/audio/README.md` 记录文本、创作者/生成工具、日期、授权依据和 SHA-256。`timeline.json` 使用秒数定义 `system-awake`、`sync-start`、`pilot-confirm`、`system-online`。未能明确取得再分发权的文件不得提交，界面回退到原创电子音效或静音。

实现设置：音量、Reduced Motion、三秒后允许跳过、强制完整播放、当前主题、Codex 自定义路径。实现诊断：只收集 app/Codex/Node/macOS 版本、连接状态、脱敏错误码和日志尾部。

实现 `scripts/check-asset-licenses.cjs`：扫描 `assets/audio`、`assets/fonts` 和 `assets/themes`；要求每个可再分发二进制文件在同目录 `README.md` 或 `LICENSES.json` 中登记许可证与 SHA-256；摘要不一致或许可证缺失时退出码为 1。在 `package.json` 增加：

```json
{
  "scripts": {
    "licenses:check": "node scripts/check-asset-licenses.cjs"
  }
}
```

- [ ] **步骤 4：运行测试和许可证检查**

运行：`node --test tests/diagnostics.test.cjs && npm run licenses:check`
预期：PASS；每个提交的音频和字体都有清单条目。

- [ ] **步骤 5：Commit**

```bash
git add package.json assets/audio workbench/diagnostics.cjs renderer/workbench/settings.js renderer/workbench/themes.js scripts/check-asset-licenses.cjs tests/diagnostics.test.cjs tests/asset-licenses.test.cjs
git commit -m "feat: add licensed audio settings and redacted diagnostics"
```

### 任务 6：完成工具 UI 与端到端测试

**文件：** 创建 `renderer/workbench/terminal.js`、`git.js`、`plugins.js`、`renderer/vendor/*`、`tests/e2e/tools.test.cjs`，修改 `renderer/workbench/index.html`、`workbench.css`、`app.js`

- [ ] **步骤 1：编写失败端到端测试**

```js
test('terminal warning, Git stage and plugin confirmation remain explicit', async () => {
  const {app, page} = await launchToolsFixture();
  await page.getByRole('tab', {name: '终端'}).click();
  await expect(page.getByText('不受 Codex 只读模式限制')).toBeVisible();
  await page.getByRole('tab', {name: 'Git'}).click();
  await page.getByRole('button', {name: '暂存'}).first().click();
  await page.getByRole('tab', {name: '插件'}).click();
  await page.getByRole('button', {name: '安装'}).first().click();
  await expect(page.getByRole('dialog', {name: '确认插件变更'})).toBeVisible();
  await app.close();
});
```

- [ ] **步骤 2：运行测试并确认 UI 缺失失败**

运行：`npm run test:e2e -- --test-name-pattern="terminal warning"`
预期：FAIL，找不到工具 tabs。

- [ ] **步骤 3：实现工具 tabs 和本地 vendor 加载**

所有 xterm 文件从本地 `renderer/vendor` 或打包依赖路由加载；CSP 不增加 CDN。关闭工具 panel 不关闭 PTY；退出应用才终止。Git 写操作在 Codex 同项目任务执行中禁用。插件安装/卸载必须二次确认。

- [ ] **步骤 4：运行完整验证**

运行：`npm run verify && npm run test:e2e`
预期：全部 PASS；工具 UI、主题切换、启动音频和诊断导出可操作。

- [ ] **步骤 5：Commit**

```bash
git add renderer/workbench renderer/vendor tests/e2e/tools.test.cjs
git commit -m "feat: integrate terminal Git plugins and themes"
```

## 阶段 3 完成检查

```bash
npm ci
npm run verify
npm run test:e2e
npm audit --audit-level=high
```

预期：全部退出码为 `0`；手动终端边界清晰；Git 无破坏性入口；插件只接受目录 id；私人主题不进入 Git；音频许可证完整。代码审查后进入阶段 4。
