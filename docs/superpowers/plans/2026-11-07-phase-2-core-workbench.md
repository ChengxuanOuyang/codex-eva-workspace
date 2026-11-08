# 阶段 2：核心工作台实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在阶段 1 的安全 Electron 壳中完成项目、Codex 对话、审批、历史、附件、文件和 Diff 工作流。

**架构：** `WorkbenchController` 统一协调持久化状态、CodexBridge 和事件归约器；HTTP 路由只做验证与调用；Renderer 只消费快照/SSE 并提交显式动作。所有状态转换用纯函数覆盖测试。

**技术栈：** Electron、Node.js、Codex app-server JSON-RPC、Server-Sent Events、原生 node:test、原生浏览器 JavaScript。

---

## 文件结构

- `workbench/controller.cjs`：项目、线程和动作协调。
- `workbench/store.cjs`：原子持久化与损坏恢复。
- `workbench/state-reducer.cjs`：app-server 通知归约。
- `workbench/model-options.cjs`：模型与思考强度校验。
- `workbench/attachments.cjs`：安全图片存储。
- `workbench/files.cjs`：项目内文件浏览和预览。
- `workbench/routes.cjs`：HTTP API 分发和输入限制。
- `renderer/workbench/*`：工作台布局、会话、审批、文件和 Diff UI。
- `tests/store.test.cjs`、`state-reducer.test.cjs`、`controller.test.cjs`、`approvals.test.cjs`、`attachments.test.cjs`、`files.test.cjs`：定向测试。
- `tests/e2e/core-workbench.test.cjs`：完整用户路径。

### 任务 1：实现版本化状态存储和恢复

**文件：** 创建 `workbench/store.cjs`、`tests/store.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {createStore} = require('../workbench/store.cjs');
test('store writes atomically and preserves corrupt input', async t => {
  const root = await fs.mkdtemp('/tmp/project-zero-store-');
  await fs.mkdir(`${root}/state`, {recursive: true});
  await fs.writeFile(`${root}/state/state.json`, '{broken');
  const store = await createStore(root);
  assert.deepEqual(store.read(), {version: 1, projects: [], threads: []});
  assert.equal((await fs.readdir(`${root}/state`)).some(x => x.startsWith('state.corrupt-')), true);
});
```

- [ ] **步骤 2：运行测试并确认模块缺失失败**

运行：`node --test tests/store.test.cjs`
预期：FAIL，`store.cjs` 不存在。

- [ ] **步骤 3：实现 `createStore(root)`**

公开接口固定为：`read()` 返回深拷贝；`update(mutator)` 串行化更新；`flush()` 将 `state.tmp` fsync 后 rename 为 `state.json`；`close()` flush。JSON 根对象必须为 `{version: 1, projects: [], threads: []}`。解析失败时把原文件 rename 为 `state.corrupt-<ISO-safe>.json`。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/store.test.cjs`
预期：PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/store.cjs tests/store.test.cjs
git commit -m "feat: persist versioned workbench state atomically"
```

### 任务 2：实现模型选择、线程状态和流式事件

**文件：** 创建 `workbench/model-options.cjs`、`workbench/state-reducer.cjs`、`workbench/controller.cjs`、`tests/state-reducer.test.cjs`、`tests/controller.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {reduceEvent} = require('../workbench/state-reducer.cjs');
test('interleaved deltas join by item id and completion replaces text', () => {
  const thread = {messages: [], tools: [], status: 'inProgress'};
  reduceEvent(thread, 'item/agentMessage/delta', {itemId: 'a', delta: 'A'});
  reduceEvent(thread, 'item/agentMessage/delta', {itemId: 'b', delta: 'B'});
  reduceEvent(thread, 'item/completed', {item: {id: 'a', type: 'agentMessage', text: 'Answer'}});
  assert.deepEqual(thread.messages.map(x => x.text), ['Answer', 'B']);
});
test('failed and interrupted turns never become completed', () => {
  for (const status of ['failed', 'interrupted']) {
    const thread = {messages: [], tools: [], status: 'inProgress', activeTurn: 't'};
    reduceEvent(thread, 'turn/completed', {turn: {status}});
    assert.equal(thread.status, status);
  }
});
```

`tests/controller.test.cjs` 用 fake bridge 断言 `createThread` 发送 `{cwd,sandbox:'read-only',approvalPolicy:'on-request',approvalsReviewer:'user'}`；`send` 在已有 active turn 时拒绝；恢复线程使用 `thread/resume`；`cancel` 使用真实 turn id。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/state-reducer.test.cjs tests/controller.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现纯归约器与 Controller**

`controller.cjs` 导出 `WorkbenchController`，公开方法固定为：`initialize()`、`snapshot()`、`addProject(path)`、`createThread(input)`、`send(input)`、`cancel(threadId)`、`renameThread(id,title)`、`archiveThread(id,archived)`、`handleNotification(method,params)`、`close()`。

模型必须来自 `model/list` 返回的非隐藏目录；思考强度必须属于该模型支持集合；图片仅发送给声明支持 image input 的模型。用户消息长度上限 60,000 字符。

- [ ] **步骤 4：运行测试**

运行：`node --test tests/state-reducer.test.cjs tests/controller.test.cjs`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/model-options.cjs workbench/state-reducer.cjs workbench/controller.cjs tests/state-reducer.test.cjs tests/controller.test.cjs
git commit -m "feat: manage Codex threads and streamed state"
```

### 任务 3：实现显式审批和 HTTP/SSE 路由

**文件：** 创建 `workbench/routes.cjs`、`tests/approvals.test.cjs`、修改 `workbench/service.cjs`、`workbench/controller.cjs`

- [ ] **步骤 1：编写失败的审批测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
test('unknown server requests are declined and never stored', async () => {
  const {controller, bridge} = fixture();
  controller.handleApproval({id: 9, method: 'unknown/request', params: {threadId: 't'}});
  assert.deepEqual(bridge.responses[0], {id: 9, error: {code: -32601, message: 'Unsupported request; no permission granted'}});
  assert.equal(controller.snapshot().approvals.length, 0);
});
test('permission acceptance returns only requested permissions for current turn', async () => {
  const {controller, bridge} = fixtureWithPermissionRequest();
  await controller.answerApproval({id: '7', accept: true});
  assert.deepEqual(bridge.responses[0].result, {permissions: {network: true}, scope: 'turn'});
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/approvals.test.cjs`
预期：FAIL，审批接口未实现。

- [ ] **步骤 3：实现支持的方法白名单和 SSE**

白名单只能包含：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`。未知请求立即 JSON-RPC error。回答后从内存 Map 删除请求；turn 完成时清除此 thread 的请求。

`routes.cjs` 显式匹配每个路径；POST 限制 JSON 和 128 KiB（附件除外）；`/api/events` 每 15 秒发送注释 keepalive；断开时移除 subscriber。不得用动态方法名调用 Controller。

- [ ] **步骤 4：运行服务和审批测试**

运行：`node --test tests/approvals.test.cjs tests/service-security.test.cjs`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/controller.cjs workbench/routes.cjs workbench/service.cjs tests/approvals.test.cjs tests/service-security.test.cjs
git commit -m "feat: expose guarded workbench routes and approvals"
```

### 任务 4：实现附件、文件和 Diff 安全边界

**文件：** 创建 `workbench/attachments.cjs`、`workbench/files.cjs`、`tests/attachments.test.cjs`、`tests/files.test.cjs`

- [ ] **步骤 1：编写失败测试**

```js
test('file preview rejects traversal, symlink escape and credentials', async () => {
  const files = await fixtureFiles();
  await assert.rejects(files.read('p', '../outside.txt'), /outside/);
  await assert.rejects(files.read('p', 'escape/secret.txt'), /outside/);
  await assert.rejects(files.read('p', '.env.production'), /credential/i);
  await assert.rejects(files.read('p', '.ssh/config'), /credential/i);
});
test('attachment rejects SVG, spoofed MIME and huge dimensions', async () => {
  const store = await fixtureAttachments();
  await assert.rejects(store.save({dataUrl: 'data:image/svg+xml;base64,PHN2Zz4='}), /type/);
  await assert.rejects(store.save(spoofedPng()), /signature/);
  await assert.rejects(store.save(hugePngHeader()), /dimensions/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/attachments.test.cjs tests/files.test.cjs`
预期：FAIL，模块不存在。

- [ ] **步骤 3：实现严格校验**

附件只接受 PNG/JPEG data URL；最大编码请求 12 MiB，解码文件 8 MiB，最大像素边 12,000，使用 magic bytes 和头部尺寸解析；文件名由 `crypto.randomUUID()` 生成，元数据单独原子写入。

文件模块必须 `realpath` 根和目标，验证 `path.relative` 不逃逸；拒绝符号链接目录列表；过滤 `.git`、`node_modules`、`.env*`、`auth.json`、`credentials`、`.ssh`；文本预览上限 512 KiB，含 NUL 则拒绝。

- [ ] **步骤 4：运行安全测试**

运行：`node --test tests/attachments.test.cjs tests/files.test.cjs`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add workbench/attachments.cjs workbench/files.cjs tests/attachments.test.cjs tests/files.test.cjs
git commit -m "feat: secure project files and image attachments"
```

### 任务 5：构建核心工作台 Renderer 和端到端路径

**文件：** 创建 `renderer/workbench/index.html`、`workbench.css`、`app.js`、`conversation.js`、`approvals.js`、`files.js`、`tests/e2e/core-workbench.test.cjs`，修改 `renderer/boot/boot.js`

- [ ] **步骤 1：编写失败的 Electron 端到端测试**

```js
test('user can add a project, create a read-only task and approve a command', async () => {
  const {app, page} = await launchFixture();
  await completeBoot(page);
  await page.getByRole('button', {name: '添加项目'}).click();
  await page.getByRole('button', {name: '新建任务'}).click();
  await page.getByPlaceholder('向 PROJECT ZERO 输入任务…').fill('检查项目');
  await page.getByRole('button', {name: '发送'}).click();
  await expect(page.getByText('需要执行命令')).toBeVisible();
  await page.getByRole('button', {name: '允许本次'}).click();
  await expect(page.getByText('检查完成')).toBeVisible();
  await app.close();
});
```

- [ ] **步骤 2：运行测试并确认工作台 UI 缺失失败**

运行：`npm run test:e2e -- --test-name-pattern="user can add"`
预期：FAIL，找不到“添加项目”。

- [ ] **步骤 3：实现批准视觉下的工作台**

布局固定为：左栏项目/会话；中栏消息与输入；右栏执行、文件、Diff、系统状态。功能文本中文，日文仅作小型氛围标签。所有用户文本用 `textContent`，禁止拼接 `innerHTML`。Markdown 渲染在本阶段只支持纯文本和代码块，链接必须经允许协议过滤。

`app.js` 建立一个 SSE 连接并用最新 snapshot 渲染；网络断开显示“本地服务已断开”且禁用写操作；重连使用指数退避并避免重复 SSE。

- [ ] **步骤 4：运行完整核心验证**

运行：`npm run verify && npm run test:e2e`
预期：全部 PASS；正常对话、拒绝审批、接受审批、中断、归档、文件预览和 Diff 均可操作。

- [ ] **步骤 5：Commit**

```bash
git add renderer/workbench renderer/boot/boot.js tests/e2e/core-workbench.test.cjs
git commit -m "feat: deliver core PROJECT ZERO Codex workbench"
```

## 阶段 2 完成检查

```bash
npm ci
npm run verify
npm run test:e2e
```

预期：所有核心工作流测试通过；真实 Codex 登录下可创建只读任务、流式收取结果、审批工具请求并查看 Diff；无终端、Git、插件或私人主题依赖。完成代码审查后进入阶段 3。
