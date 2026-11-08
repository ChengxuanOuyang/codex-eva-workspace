# 阶段 1 最终整分支修复计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复最终整分支审查确认的就绪恢复、模型门禁、Skip、工作台壳、HTTP 中止边界及发布验证问题，使阶段 1 真正可恢复、可进入工作台且可安全打包。

**架构：** loopback 服务和窗口先启动并持有可变的脱敏 readiness store；Codex 发现、连接、账户和模型校验在后台更新状态，断线立即撤销 ready。Renderer 保留三场景启动叙事，但 Skip 直接到 99.2%，确认完成后卸载启动控件并进入本地空工作台壳。HTTP 监听器同步捕获异步错误并在超限/中止时及时终止读取。

**技术栈：** Electron 45、Node.js HTTP/EventEmitter、Codex app-server v2 JSON Schema、原生 HTML/CSS/JS、Node `node:test`、Playwright Electron E2E。

---

### 任务 10：加固 HTTP 中止与超限请求边界

**文件：** 修改 `workbench/service.cjs`、`tests/service-security.test.cjs`

- [ ] **步骤 1：编写失败测试**

新增两个测试：客户端发送部分 JSON 后 `destroy()` 不产生 `unhandledRejection` 且服务仍能回答 `/health`；无 `Content-Length` 的 chunked body 超过 64 KiB 后，服务立即终止请求并返回或关闭为 413，而不是继续读取后续无限数据。

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/service-security.test.cjs`。预期：中止流触发未捕获拒绝或超限流未及时结束，新增测试 FAIL。

- [ ] **步骤 3：实现同步监听器边界**

使用同步 `http.createServer((req, res) => { void handleRequest(req, res).catch(...) })`。终端 catch 仅返回稳定 400/连接关闭，不输出异常原文。`validateRequestBody` 一旦超过上限就停止累积、标记 413，并销毁/停止请求；处理中止错误不得逃逸。

- [ ] **步骤 4：验证并提交**

运行：`node --test tests/service-security.test.cjs && npm run verify`。提交：`fix: contain aborted HTTP requests`。

### 任务 11：收紧官方账户/模型 Schema 与错误脱敏

**文件：** 修改 `app/lifecycle.cjs`、`workbench/bridge.cjs`、`tests/window-options.test.cjs`、`tests/bridge.test.cjs`、`tests/support/fake-codex.cjs`

- [ ] **步骤 1：编写失败测试**

模型测试分别拒绝：`data: []`、全部 `hidden:true`、空 `id/model/displayName`、空 `supportedReasoningEfforts`、`defaultReasoningEffort` 不在支持列表。账户测试接受官方 Schema 的 `{account:null, requiresOpenaiAuth:true}` 为有效但非 ready。Bridge 测试要求 RPC error 与 `disconnected` 事件只暴露稳定代码，不含测试注入的 token/绝对路径。

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/window-options.test.cjs tests/bridge.test.cjs`。预期：上述目录和原始 message 当前被接受/暴露，新增断言 FAIL。

- [ ] **步骤 3：实现规范化门禁**

从本机 `codex app-server generate-json-schema` 的 v2 `GetAccountResponse`/`ModelListResponse` 对齐结构；只有至少一个非隐藏、非空、reasoning coherent 的模型才可 launch。`account:null` + `requiresOpenaiAuth:true` 映射为脱敏 `SIGNED_OUT` 状态而非 schema error。`CodexRpcError.message` 与断线事件改为稳定消息/代码，原始 message 不进入 UI 或日志。

- [ ] **步骤 4：验证并提交**

运行：`node --test tests/window-options.test.cjs tests/bridge.test.cjs tests/fake-codex.test.cjs && npm run verify`。提交：`fix: validate launchable Codex readiness`。

### 任务 12：实现动态可恢复 readiness 生命周期

**文件：** 修改 `app/lifecycle.cjs`、`workbench/service.cjs`、`renderer/boot/index.html`、`renderer/boot/boot.js`、`tests/window-options.test.cjs`、`tests/boot-runtime.test.cjs`、`tests/e2e/boot.test.cjs`

- [ ] **步骤 1：编写失败测试**

生命周期测试要求：服务与窗口在 Codex discovery/bridge/readiness 完成前即打开；snapshot 初始 `{ready:false, code:'INITIALIZING'}`；成功后变 ready；Codex `disconnected` 后立即变 `{ready:false, code:'DISCONNECTED'}`；缺失 binary 或 readiness 失败不退出窗口，而显示可重试诊断。E2E 在 ready 后模拟断线，确认按钮重新禁用且不会进入 online。

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/window-options.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs`。预期：现有 lifecycle 在服务前 await Codex 并持有不可变快照，新增测试 FAIL。

- [ ] **步骤 3：实现可变脱敏 store**

创建小型 readiness store（`get()`/`set()`/稳定 code），先启动 service/window，再异步发现并连接 Codex。只暴露 `INITIALIZING`、`CODEX_NOT_FOUND`、`SIGNED_OUT`、`NO_LAUNCHABLE_MODEL`、`DISCONNECTED`、`READY`。订阅 bridge `disconnected` 撤销 ready。Renderer 根据 code 显示恢复说明和重试按钮；重试只触发单个串行初始化尝试，不泄漏路径/message。

- [ ] **步骤 4：验证并提交**

运行：`node --test tests/window-options.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs && npm run verify`。提交：`feat: make Codex readiness recoverable`。

### 任务 13：让 Skip 真正跳过并进入空工作台壳

**文件：** 修改 `renderer/boot/boot-state.cjs`、`renderer/boot/boot.js`、`renderer/boot/index.html`、`renderer/boot/boot.css`、`tests/boot-state.test.cjs`、`tests/boot-runtime.test.cjs`、`tests/e2e/boot.test.cjs`

- [ ] **步骤 1：编写失败测试**

Reducer 测试要求 `skip` 原子设置 `progress:99.2, phase:'waiting'`，保持真实 `ready/confirmed`；runtime 测试要求停止 tick/开场计时器，后端未 ready 时按钮禁用，ready 后立即可确认。E2E 确认到 100% 后要求 boot grid/buttons 从可访问树移除，挂载 `#workbench-shell`，Scene C 作为壳过渡背景。

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs`。预期：Skip 仍等待约 16 秒，完成后启动 DOM 仍驻留，新增测试 FAIL。

- [ ] **步骤 3：实现状态与壳**

Skip 直接到 99.2 并终止演示 timers，但继续 health polling。确认完成后停止 boot controller、隐藏/卸载 boot 区域并显示只含本地导航占位、状态区和“核心工作台将在阶段 2 启用”的空壳；不伪造聊天功能。

- [ ] **步骤 4：验证并提交**

运行：`node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs && npm run verify`。提交：`feat: enter the workbench shell after boot`。

### 任务 14：固定数据路径、打包 smoke 和证据一致性

**文件：** 修改 `app/main.cjs`、`tests/package-scripts.test.cjs`、`tests/e2e/packaged-smoke.test.cjs`、相关文档/报告断言

- [ ] **步骤 1：编写失败测试**

测试要求 Electron 在首次 `userData` 使用前显式设置产品数据目录名 `Project Zero`；生产脚本断言真实 `PROJECT_ZERO_TEST_BRIDGE_MODULE` 不进入打包启用路径；packaged smoke 清理并选择本次精确输出，不按排序拾取旧 `dist/mac*`。

- [ ] **步骤 2：实现并验证**

设置 `app.setPath('userData', path.join(app.getPath('appData'), 'Project Zero'))`（测试依赖可注入）；更新 smoke/build 流程，清楚标注真实登录 Codex owner-machine smoke 与确定性源码 E2E 的边界；同步修正过时报告断言。

- [ ] **步骤 3：完整验证与提交**

运行：`npm run verify && npm run test:e2e && npm run pack`，检查 ASAR、数据路径和测试后门。提交：`test: make packaged verification deterministic`。

### 最终门禁

- [ ] 运行 `npm audit --json`，逐条记录 advisory 是否进入运行时包、仅构建时可达或不可达；不得仅因顶层依赖是 devDependency 就忽略。
- [ ] 保留 Windows installer 为当前 macOS 范围外的非阻塞项。
- [ ] 重新执行整分支代码审查；所有 Critical/Important 必须清零。
- [ ] 运行 `npm run verify && npm run test:e2e && npm run pack` 并从新构建的 `.app` 做 ASAR/资产/凭据检查。
