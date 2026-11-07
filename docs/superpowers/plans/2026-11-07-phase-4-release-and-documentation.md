# 阶段 4：安全、发行与开源交付实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将工作台变成可重复构建、可验证、可安装的 macOS 开源项目，并为用户和贡献者提供完整中文/英文文档。

**架构：** 安全回归、许可证检查、打包和文档检查均由仓库脚本驱动；GitHub Actions 在 Apple Silicon 与 Intel runner 上分别构建。发布物使用 ad-hoc 签名、SHA-256 校验和与明确的 Gatekeeper 说明，不声称 Apple 公证。

**技术栈：** Electron 45.2.3、electron-builder 26.18.0、Node.js 24、GitHub Actions、macOS `codesign`/`spctl`/`hdiutil`。

---

## 文件结构

- `scripts/security-check.cjs`：静态安全不变量检查。
- `scripts/verify-macos-artifact.sh`：挂载 DMG、检查架构、签名与启动文件。
- `scripts/adhoc-sign.sh`：对 `.app` 做 ad-hoc 深度签名。
- `scripts/after-pack.cjs`：在 DMG/ZIP 封装前调用签名脚本。
- `tests/security-regression.test.cjs`：HTTP、CSP、路径与日志安全回归。
- `electron-builder.yml`：arm64/x64 macOS 打包配置。
- `.github/workflows/ci.yml`：测试与双架构构建。
- `.github/workflows/release.yml`：标签触发的草稿发行。
- `README.md`、`README.en.md`：安装、使用、架构、限制与法律边界。
- `SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`：开源治理。
- `docs/workflow.md`、`docs/troubleshooting.md`、`docs/uninstall.md`、`docs/release-checklist.md`：完整工作流和运维说明。

### 任务 1：锁定安全回归和生产构建策略

**文件：** 创建 `scripts/security-check.cjs`、`tests/security-regression.test.cjs`，修改 `package.json`

- [ ] **步骤 1：编写失败测试**

```js
test('production renderer has no remote code or unsafe Electron flags', async () => {
  const source = await readProductionSources();
  assert.doesNotMatch(source, /nodeIntegration\s*:\s*true/);
  assert.doesNotMatch(source, /contextIsolation\s*:\s*false/);
  assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1|localhost)/);
  assert.match(source, /default-src 'self'/);
});

test('loopback mutations require the per-run bearer token', async () => {
  const service = await fixtureService();
  assert.equal((await request(service, 'POST', '/api/projects', {})).status, 401);
  assert.equal((await request(service, 'POST', '/api/projects', {}, service.token)).status, 201);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test tests/security-regression.test.cjs`
预期：FAIL，扫描器或生产 CSP 尚未完成。

- [ ] **步骤 3：实现安全检查脚本**

扫描生产文件并在发现以下内容时退出码 1：远程脚本/样式、`eval`、`new Function`、Electron 不安全开关、监听非 loopback 地址、未登记的 `shell:true`、日志中的 bearer token/Authorization/chat 正文。允许列表使用精确文件和行规则，不接受通配跳过。

在 `package.json` 增加：

```json
{
  "scripts": {
    "security:check": "node scripts/security-check.cjs",
    "verify": "npm run lint && npm test && npm run test:e2e && npm run licenses:check && npm run security:check"
  }
}
```

- [ ] **步骤 4：运行安全验证**

运行：`node --test tests/security-regression.test.cjs && npm run security:check`
预期：PASS，扫描报告显示 0 个未批准发现。

- [ ] **步骤 5：Commit**

```bash
git add package.json scripts/security-check.cjs tests/security-regression.test.cjs
git commit -m "test: lock production security invariants"
```

### 任务 2：实现可重复的 macOS 双架构打包

**文件：** 创建 `electron-builder.yml`、`scripts/adhoc-sign.sh`、`scripts/after-pack.cjs`、`scripts/verify-macos-artifact.sh`，修改 `package.json`

- [ ] **步骤 1：编写先失败的验证脚本测试**

在 `tests/package-scripts.test.cjs` 中加入：

```js
test('artifact verification rejects an unsigned or wrong-architecture app', async () => {
  const result = await runVerifier(fixtureUnsignedApp(), 'arm64');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /signature|architecture/i);
});
```

运行：`node --test tests/package-scripts.test.cjs`
预期：FAIL，验证脚本不存在。

- [ ] **步骤 2：添加 electron-builder 配置**

```yaml
appId: io.github.chengxuanouyang.project-zero
productName: Project Zero Rei Codex Workbench
asar: true
afterPack: scripts/after-pack.cjs
files:
  - app/**
  - app-server/**
  - workbench/**
  - renderer/**
  - assets/**
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  identity: null
artifactName: '${productName}-${version}-${arch}.${ext}'
```

在 `package.json` 增加 `build:mac:arm64`、`build:mac:x64` 和 `verify:artifact`；两条构建命令都设置 `CSC_IDENTITY_AUTO_DISCOVERY=false`。`scripts/after-pack.cjs` 只在 `context.electronPlatformName === 'darwin'` 时用 `execFile` 调用 `scripts/adhoc-sign.sh`，目标严格取自 electron-builder 提供的 `context.appOutDir` 与 `context.packager.appInfo.productFilename`，确保 `.app` 在生成 DMG/ZIP 之前已签名。

`adhoc-sign.sh` 要求一个已存在且后缀为 `.app` 的显式路径，拒绝 `/`、用户目录或通配路径，然后执行 `codesign --force --deep --sign - "$1"`。不得从环境变量或 `find` 推断待签名目标。

- [ ] **步骤 3：实现产物验证**

`verify-macos-artifact.sh <dmg> <arm64|x86_64>` 必须：

1. 使用 `mktemp -d` 创建挂载点并用 trap 卸载；
2. `hdiutil attach -readonly -nobrowse`；
3. `codesign --verify --deep --strict`；
4. `codesign -dv` 确认 `Signature=adhoc`；
5. `lipo -archs` 确认目标架构；
6. 检查 `Contents/MacOS` 主程序、`Info.plist` 的 bundle id 和版本；
7. 计算并打印 SHA-256。

- [ ] **步骤 4：本机打包和验证 Apple Silicon**

运行：

```bash
npm run build:mac:arm64
npm run verify:artifact -- "dist/Project Zero Rei Codex Workbench-0.1.0-arm64.dmg" arm64
```

预期：DMG 验证 PASS；`codesign` 显示 ad-hoc；架构包含 `arm64`。`spctl --assess` 可能因未公证而拒绝，此结果必须记录为预期限制，不能改写为通过。

- [ ] **步骤 5：Commit**

```bash
git add package.json electron-builder.yml scripts/adhoc-sign.sh scripts/after-pack.cjs scripts/verify-macos-artifact.sh tests/package-scripts.test.cjs
git commit -m "build: package ad-hoc signed macOS artifacts"
```

### 任务 3：建立测试与双架构构建 CI

**文件：** 创建 `.github/workflows/ci.yml`

- [ ] **步骤 1：先加入 workflow 结构测试**

```js
test('CI pins Node 24 and builds both supported Mac architectures', async () => {
  const workflow = await readWorkflow('.github/workflows/ci.yml');
  assert.match(workflow, /node-version:\s*24/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /npm ci/);
});
```

运行：`node --test tests/workflows.test.cjs`
预期：FAIL，workflow 不存在。

- [ ] **步骤 2：创建 CI workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run licenses:check
      - run: npm run security:check
  package:
    strategy:
      fail-fast: false
      matrix:
        include:
          - runner: macos-15
            arch: arm64
            verify_arch: arm64
          - runner: macos-15-intel
            arch: x64
            verify_arch: x86_64
    runs-on: ${{ matrix.runner }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run test:e2e
      - run: npm run build:mac:${{ matrix.arch }}
      - run: npm run verify:artifact -- "$(find dist -name '*-${{ matrix.arch }}.dmg' -print -quit)" ${{ matrix.verify_arch }}
      - uses: actions/upload-artifact@v7
        with:
          name: project-zero-${{ matrix.arch }}
          path: dist/*-${{ matrix.arch }}.*
```

若 GitHub-hosted Intel runner 在开源仓库不可用，CI 必须明确失败并在 issue 中记录；不得静默交叉编译后称为 Intel 原生验证。

- [ ] **步骤 3：本地检查 workflow 并推送测试分支**

运行：`node --test tests/workflows.test.cjs && npm run lint`
预期：PASS。

推送后在 GitHub Actions 确认 `test`、`package (arm64)`、`package (x64)` 三个 job 全部成功，下载两个 artifact 并分别执行验证脚本。

- [ ] **步骤 4：Commit**

```bash
git add .github/workflows/ci.yml tests/workflows.test.cjs
git commit -m "ci: verify and package both Mac architectures"
```

### 任务 4：建立可审计的标签发行流程

**文件：** 创建 `.github/workflows/release.yml`，修改 `tests/workflows.test.cjs`

- [ ] **步骤 1：补充失败测试**

```js
test('release is tag-only, least-privilege and publishes checksums as a draft', async () => {
  const workflow = await readWorkflow('.github/workflows/release.yml');
  assert.match(workflow, /tags:\s*\['v\*'\]/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /draft:\s*true/);
  assert.match(workflow, /SHA256SUMS/);
});
```

运行：`node --test tests/workflows.test.cjs`
预期：FAIL，release workflow 不存在。

- [ ] **步骤 2：创建 release workflow**

仅 `v*` 标签触发。先复用 `npm run verify`，再以与 CI 相同的两个 macOS runner 构建、验证并上传临时 artifact。最终 `ubuntu-24.04` job 下载全部产物，执行 `sha256sum * > SHA256SUMS`，使用 `softprops/action-gh-release@v3` 创建 `draft: true` 的 GitHub Release。除最终 job 的 `contents: write` 外，其余 job 仅 `contents: read`。

Release body 模板必须包含：未公证说明、Gatekeeper 首次打开步骤、Apple Silicon/Intel 区分、Intel 真机验证状态、版权边界、账号不得共享提示和 SHA-256 验证命令。

- [ ] **步骤 3：运行 workflow 测试并用预发布标签演练**

运行：`node --test tests/workflows.test.cjs`
预期：PASS。

创建并推送 `v0.1.0-rc.1` 之前先确认工作树干净；等待 workflow 完成后保持 release 为 draft，下载并验证全部产物。只有检查清单全绿时才手动发布。

- [ ] **步骤 4：Commit**

```bash
git add .github/workflows/release.yml tests/workflows.test.cjs
git commit -m "ci: create auditable draft releases"
```

### 任务 5：完成中英文开源文档与完整工作流

**文件：** 创建/修改 `README.md`、`README.en.md`、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`docs/workflow.md`、`docs/troubleshooting.md`、`docs/uninstall.md`、`docs/release-checklist.md`、`tests/docs.test.cjs`

- [ ] **步骤 1：编写文档契约失败测试**

```js
test('public docs disclose install, privacy, copyright and support boundaries', async () => {
  const docs = await readPublicDocs();
  for (const phrase of [
    'ad-hoc', '未公证', '各自的 OpenAI 账号', '私人主题',
    'Apple Silicon', 'Intel', '卸载', '安全漏洞'
  ]) assert.match(docs.zh, new RegExp(phrase));
  assert.match(docs.en, /not notarized/i);
  assert.match(docs.workflow, /Codex app-server/);
});
```

运行：`node --test tests/docs.test.cjs`
预期：FAIL，文档不完整。

- [ ] **步骤 2：编写 README 与治理文件**

README 必须包含：原创项目定位、启动动画截图/GIF、功能表、系统要求、两架构下载、SHA-256 验证、首次打开步骤、Codex 登录方式、开发命令、架构图、上游归属、MIT 许可证、官方 EVA 资产不进入仓库的边界、私人主题包风险、已知限制。

`SECURITY.md` 明确私下报告渠道、支持版本和不应附带的敏感文件；`CONTRIBUTING.md` 要求 `npm run verify`、资产许可记录和 Conventional Commit；行为准则采用 Contributor Covenant 并记录版本/来源。

- [ ] **步骤 3：记录从克隆到发行的完整 workflow**

`docs/workflow.md` 逐步覆盖：环境检查、安装、开发服务器、Electron、测试、Codex app-server 协议、主题包、音频资产登记、双架构 CI、ad-hoc 签名、草稿发行、女朋友在另一台 Mac 使用自己的账号安装。`troubleshooting.md` 覆盖 Codex 找不到、端口占用、Gatekeeper、node-pty、白屏、主题导入与诊断导出。`uninstall.md` 精确列出应用和 Application Support 路径，先备份再删除。

- [ ] **步骤 4：验证链接和命令**

运行：`node --test tests/docs.test.cjs && npm run verify`
预期：PASS；README 中所有仓库内相对链接存在；命令在全新 clone 可执行。

- [ ] **步骤 5：Commit**

```bash
git add README.md README.en.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md docs tests/docs.test.cjs
git commit -m "docs: publish the complete open-source workflow"
```

### 任务 6：执行发行候选验收与真机安装

**文件：** 修改 `docs/release-checklist.md`，创建 `docs/validation/0.1.0-rc.1.md`

- [ ] **步骤 1：从干净 clone 执行完整验证**

运行：

```bash
npm ci
npm run verify
npm run build:mac:arm64
npm run verify:artifact -- "$(find dist -name '*-arm64.dmg' -print -quit)" arm64
```

预期：所有命令退出码 0；记录 Node/npm/macOS/Codex 版本与产物 SHA-256，不记录账号或聊天内容。

- [ ] **步骤 2：在当前 Apple Silicon Mac 做安装验收**

从 DMG 拖入 Applications，按 README 的 Gatekeeper 步骤首次打开。逐项验证：99.2% 驾驶员确认、Codex 连接、模型/推理强度、审批、聊天、附件、diff、终端、Git、插件、设置、私人主题、诊断导出、退出清理。重启应用确认历史和设置保留；确认未注册开机启动项。

- [ ] **步骤 3：验证分享流程**

在第二个 macOS 用户或另一台 Mac 上仅使用发行 DMG 安装，使用该使用者自己的 OpenAI/Codex 账号登录。确认仓库/DMG 不包含首台 Mac 的 token、历史、私人主题或本地绝对路径。

Intel 状态必须分开记录：CI 构建与产物检查通过后写“CI verified”；只有真实 Intel Mac 完整跑过相同清单后才能写“hardware verified”。没有 Intel 真机时不得阻塞 Apple Silicon 首发，但 Release 必须注明未真机验证。

- [ ] **步骤 4：记录验收证据并关闭清单**

`docs/validation/0.1.0-rc.1.md` 记录每项 PASS/FAIL、命令、版本、GitHub Actions run 链接、两个 SHA-256、已知问题。任何安全、数据隔离、启动或 Codex 连接失败都阻止发布；纯视觉小问题可建 issue 后接受。

- [ ] **步骤 5：Commit**

```bash
git add docs/release-checklist.md docs/validation/0.1.0-rc.1.md
git commit -m "docs: record release candidate validation"
```

---

## 阶段完成门槛

```bash
npm ci
npm run verify
npm run build:mac:arm64
npm run verify:artifact -- "$(find dist -name '*-arm64.dmg' -print -quit)" arm64
git status --short
```

预期：所有自动化验证通过；Apple Silicon DMG 可安装；双架构 GitHub Actions 成功；工作树为空；发行仍为 draft，等待人工核对后发布。Intel 只按实际证据标记验证级别。
