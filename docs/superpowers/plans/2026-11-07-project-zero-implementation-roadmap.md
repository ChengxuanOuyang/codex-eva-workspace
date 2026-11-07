# PROJECT ZERO 实现路线图

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现各阶段计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 按四个可独立验收的阶段，把已批准的设计转化为可安装、可测试、可公开发布的 macOS Codex 工作台。

**架构：** Electron 提供 macOS 应用外壳，受保护的回环 HTTP 服务承载现有 Node 工作台能力，官方 `codex app-server` 通过 stdio 提供代理循环。每个阶段都在前一阶段的可运行版本上增加一组边界清晰的能力。

**技术栈：** Electron 45.2.3、Node.js 24 LTS、CommonJS、原生 `node:test`、ESLint 10.14.0、Playwright 1.65.0、electron-builder 26.18.0、node-pty 1.1.0、xterm 6.0.0。

---

## 阶段顺序

1. [阶段 1：Electron 与 Codex 基础](./2026-11-07-phase-1-electron-codex-foundation.md)
   产物：可启动的 `.app` 开发版本，具备原创启动序列、Codex 自动发现、账号/模型健康检查和 99.2% 驾驶员确认。

2. [阶段 2：核心工作台](./2026-11-07-phase-2-core-workbench.md)
   产物：项目、对话、流式响应、审批、历史、附件、文件与 Diff 完整可用。

3. [阶段 3：开发工具与主题](./2026-11-07-phase-3-tools-and-themes.md)
   产物：终端、Git、插件、私人主题包、原创声音、设置和诊断完整可用。

4. [阶段 4：安全、构建与发布](./2026-11-07-phase-4-release-and-documentation.md)
   产物：安全回归、双架构构建、GitHub Actions、完整文档和 `v0.1.0-preview.0` Release。

## 共同执行规则

- 每个任务严格遵循测试驱动：先写失败测试，确认失败，再做最小实现。
- 每个任务单独 commit；不把多个阶段压成一个大提交。
- 每个阶段结束时运行 `npm run verify` 和对应的 Electron 端到端测试。
- 所有新依赖使用精确版本并提交 `package-lock.json`。
- 不把参考视频、官方 EVA 素材、私人主题或账号凭据复制进仓库。
- 不修改 ChatGPT.app；只启动其公开提供的 Codex 二进制。
- 不允许“测试以后再补”“错误以后再处理”或未标明预期结果的验证步骤。
- 每阶段完成后推送 `main` 前进行独立代码审查。

## 阶段门禁

| 阶段 | 进入条件 | 完成条件 |
|---|---|---|
| 1 | 规格与本路线图已批准 | Electron 启动、Codex 健康检查、启动动画与确认流程通过 |
| 2 | 阶段 1 全部测试通过 | 核心 Codex 工作流通过单元与端到端测试 |
| 3 | 阶段 2 全部测试通过 | 工具、主题、声音和诊断通过测试且许可证齐全 |
| 4 | 阶段 3 全部测试通过 | CI 绿色、安装包可复现、本机验收、Release 草稿完整 |

## 最终验收命令

```bash
npm ci
npm run lint
npm test
npm run test:e2e
npm audit --audit-level=high
npm run licenses:check
npm run build:mac:arm64
npm run verify:artifact -- "$(find dist -name '*-arm64.dmg' -print -quit)" arm64
```

预期结果：所有命令退出码为 `0`；生成 Apple Silicon `.dmg`、`.zip` 和对应 SHA-256 文件；构建日志不包含账号令牌、用户聊天、私人主题或受保护素材。
