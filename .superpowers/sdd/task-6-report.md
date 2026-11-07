# 阶段 1 / 任务 6 报告：Electron E2E 与开发构建

## 结果

- 将普通测试限定为 `node --test tests/*.test.cjs`，`verify` 不再递归发现或启动 Electron E2E。
- 增加仅在 `NODE_ENV === 'test'` 且 `PROJECT_ZERO_FAKE_CODEX === '1'` 时启用的内存 Codex bridge；任一条件单独存在时仍走真实发现与真实 bridge。
- 内存 bridge 不 spawn child，`connected` 生命周期与现有 bridge 一致，`stop()` 返回可复用 Promise，并提供固定的 signed-in account 与可用 model catalog。
- Electron E2E 使用当前 UI 文本，在 99.2% 且确认按钮 enabled 后点击，等待 100.0% 与 `SYSTEM ONLINE`；同时验证 `127.0.0.1`、无远程资源、无 Codex child、关闭后 loopback listener 和任务进程均消失。
- 生成 arm64 未签名目录开发包并检查 `.app` 元数据、主可执行文件、asar 内容与生产配置。

## TDD：RED

1. `node --test tests/package-scripts.test.cjs`
   - 退出码 `1`。
   - 预期失败：实际 `test` 为递归的 `node --test`，而期望为 `node --test tests/*.test.cjs`。
2. `NODE_ENV=test PROJECT_ZERO_FAKE_CODEX=1 npm run test:e2e`
   - 退出码 `1`。
   - E2E 到达等待确认后发现真实 `codex app-server` child，准确证明 fake 开关尚未实现。
3. `node --test tests/fake-codex.test.cjs tests/package-scripts.test.cjs`
   - 退出码 `1`。
   - 预期失败：`InMemoryCodexBridge` 与 `bridgeOptionsForEnvironment` 尚不存在，脚本边界也尚未修改。

## TDD：GREEN

- `node --test tests/fake-codex.test.cjs tests/package-scripts.test.cjs`：5/5 通过。
- `NODE_ENV=test PROJECT_ZERO_FAKE_CODEX=1 npm run test:e2e`：1/1 通过。
- `npm run verify`：lint 通过，普通测试 70/70 通过；没有隐式启动 GUI。

## Electron E2E

- 等待 heading `等待用户确认`。
- 等待精确进度 `99.2` 和按钮 `确认并完成同步` enabled。
- URL 协议/主机为 `http://127.0.0.1:<随机端口>`。
- DOM 中没有远程 script 或 stylesheet；Performance Resource Timing 中所有资源均与页面同源。
- fake 运行期间任务进程树中不存在 `codex app-server`。
- 点击确认后等待 `SYSTEM ONLINE` 与 `100.0`。
- `app.close()` 放在 `finally`；关闭后 `/health` 无法连接，启动时记录的任务进程均不存在。
- 测试自身超时 30 秒，外层最终命令使用 60 秒硬边界。

## 开发目录包验证

- 命令：`npm run pack`（外层 180 秒硬边界）。
- 实际应用：`dist/mac-arm64/PROJECT ZERO — REI CODEX WORKBENCH.app`。
- `CFBundleIdentifier`：`io.github.chengxuanouyang.codex-eva-workspace`。
- `CFBundleShortVersionString`：`0.1.0-preview.0`。
- `CFBundleVersion`：`0.1.0-preview.0`。
- `CFBundleExecutable`：`PROJECT ZERO — REI CODEX WORKBENCH`，文件存在且可执行。
- `app.asar` 共 21 个条目，仅包含 allowlisted app/workbench/renderer、元数据和许可证文件；没有 tests/reference/fixture 路径。
- `.app` 与 asar 列表中没有参考视频、`auth.json`、`private-themes` 或 `.env*`。
- asar 内生产 `package.json` 没有配置 `PROJECT_ZERO_FAKE_CODEX` 或 `NODE_ENV=test`。
- 本任务只验证未签名目录开发包；不声称已签名或公证。electron-builder 明确报告跳过签名，符合阶段划分。

## 修改文件

- `app/main.cjs`
- `app/lifecycle.cjs`
- `package.json`
- `tests/e2e/boot.test.cjs`
- `tests/fake-codex.test.cjs`
- `tests/package-scripts.test.cjs`
- `.superpowers/sdd/task-6-report.md`

`package-lock.json` 无需变化，因为没有依赖变化。

## 自审

- 双条件门控使用严格相等比较，未向 `start`、`dev`、`pack`、发行脚本或 build 配置注入测试环境。
- 非 fake 分支向 lifecycle 传空 options，保留既有真实 Codex 发现顺序与 bridge 实现。
- fake 仅实现启动门槛及后续阶段需要的 account/model 请求；未知请求显式拒绝，避免伪造成功。
- lifecycle 仍把 bridge cleanup 放入既有清理栈；内存与真实 bridge 都遵循 Promise stop 契约。
- E2E 使用当前可访问名称，没有使用过时的“驾驶员身份确认”定位器。
- 普通测试脚本边界有回归测试，`verify` 不会隐式打开 Electron。

## 疑虑与阶段边界

- electron-builder 提示缺少 author 且使用默认 Electron 图标；不影响本任务的目录开发包验证，可在品牌/发行阶段处理。
- 开发包按配置未签名，也未公证；签名与公证属于阶段 4。
- 本任务不重复真实 Codex 发现烟雾测试；依照简报沿用前序证据，E2E 只使用双门控 fake。
