# B → A → C 原创三场景美术实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 以三张一致角色设定的原创高精度侧脸半身插画替换 CSS 人物占位，并按 B（唤醒/LCL）→ A（同步/99.2%）→ C（SYSTEM ONLINE）集成到启动序列。

**架构：** 每个场景使用独立的本地 WebP 运行时资产，原始 PNG 主文件与生成记录放入公开资产源目录。loopback 服务只通过精确白名单提供三张图；Renderer 使用纯 CSS 图层、`data-scene` 状态和短交叉淡入，不引入远程资源或动态图像脚本。Reduced Motion 禁用视差和遮罩，只保留短淡入。

**技术栈：** built-in image generation、PNG/WebP、Electron 45、原生 HTML/CSS/JS、Node.js `node:test`、Playwright Electron E2E。

---

## 文件结构

- 创建 `assets/themes/project-zero/source/scene-{a,b,c}-*.png`：公开可维护的无损主文件。
- 创建 `assets/themes/project-zero/ASSET-LICENSE.md`：原创资产许可与生成边界。
- 创建 `assets/themes/project-zero/assets.json`：场景、提示词摘要、生成方式、主文件和运行时文件 SHA-256。
- 创建 `renderer/boot/assets/scene-{a,b,c}-*.webp`：打包运行时资产。
- 修改 `renderer/boot/index.html`：三场景背景层与语义说明。
- 修改 `renderer/boot/boot.css`：场景淡入、遮罩、LCL 层、控件可读性与响应式降级。
- 修改 `renderer/boot/boot.js`：将启动阶段映射到 B/A/C，不改变认证与确认门禁。
- 修改 `workbench/service.cjs`：把三张图片加入精确静态白名单并设置 `image/webp`。
- 修改 `tests/renderer-assets.test.cjs`、`tests/boot-runtime.test.cjs`、`tests/service-security.test.cjs`、`tests/e2e/boot.test.cjs`：资产边界、状态映射、服务 MIME、真实窗口与无远程资源覆盖。

### 任务 8：生成、优化并登记三张原创资产

**文件：**
- 创建：`assets/themes/project-zero/source/scene-a-sync.png`
- 创建：`assets/themes/project-zero/source/scene-b-awakening.png`
- 创建：`assets/themes/project-zero/source/scene-c-online.png`
- 创建：`renderer/boot/assets/scene-a-sync.webp`
- 创建：`renderer/boot/assets/scene-b-awakening.webp`
- 创建：`renderer/boot/assets/scene-c-online.webp`
- 创建：`assets/themes/project-zero/ASSET-LICENSE.md`
- 创建：`assets/themes/project-zero/assets.json`

- [ ] **步骤 1：生成三张独立主文件**

以已批准的三联构图为一致性参考，分别生成：B 的暖橙液体近景、A 的右侧人物/左侧同步空间、C 的右下驾驶舱人物/中央系统空间。三张图必须使用同一原创成年人物、同一非官方服装设计，不包含文字、标志、水印或远程内容。

- [ ] **步骤 2：检查原创边界与构图**

人工检查人物没有官方发饰、官方服装分区、NERV/EVA 字标或临摹镜头；A 的同步环和确认区、B 的系统标题区、C 的 `SYSTEM ONLINE` 区均保留可读负空间。

- [ ] **步骤 3：生成运行时 WebP**

将每张主文件输出为不超过 2048px 长边的高质量 WebP；保留 PNG 主文件，禁止覆盖。运行：`file renderer/boot/assets/*.webp && du -h renderer/boot/assets/*.webp`。预期：三个文件均为 WebP，尺寸一致且适合本地打包。

- [ ] **步骤 4：登记许可与校验值**

`ASSET-LICENSE.md` 说明 built-in image generation、原创提示约束、无官方输入资产及 CC BY 4.0 公共授权。`assets.json` 对每个 PNG/WebP 记录场景、文件、SHA-256、生成方式和提示词摘要。运行：`shasum -a 256`，预期与 JSON 完全一致。

- [ ] **步骤 5：Commit**

```bash
git add assets/themes/project-zero renderer/boot/assets docs/superpowers/plans/2026-11-07-three-scene-rei-art.md
git commit -m "feat: add original three-scene Rei art"
```

### 任务 9：测试并集成 B → A → C 启动场景

**文件：**
- 修改：`renderer/boot/index.html`
- 修改：`renderer/boot/boot.css`
- 修改：`renderer/boot/boot.js`
- 修改：`workbench/service.cjs`
- 修改：`tests/renderer-assets.test.cjs`
- 修改：`tests/boot-runtime.test.cjs`
- 修改：`tests/service-security.test.cjs`
- 修改：`tests/e2e/boot.test.cjs`

- [ ] **步骤 1：编写失败测试**

静态测试要求三条本地 `/assets/scene-*.webp` 引用、禁止 data/remote URL、旧 `.pilot-silhouette` 不再存在、运行时状态按 `syncing/waiting` 映射 A、开场映射 B、完成映射 C。服务测试要求三个精确 GET 路由返回 `image/webp`，相邻猜测路径返回 404。E2E 要求 B、A、C 依次可见且确认按钮始终可达。

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test tests/renderer-assets.test.cjs tests/boot-runtime.test.cjs tests/service-security.test.cjs tests/e2e/boot.test.cjs`

预期：因场景 DOM、状态映射和服务路由尚不存在而 FAIL；原有门禁测试保持通过。

- [ ] **步骤 3：实现最少场景集成**

使用三个 `aria-hidden` 背景层和稳定 `data-scene="awakening|sync|online"`。B 只覆盖开场短阶段；A 覆盖同步、后端等待和 99.2% 确认；C 只在确认完成后出现。图片不承载功能文本，所有读数、诊断和按钮保留独立 DOM 与更高层级。

- [ ] **步骤 4：实现服务白名单与响应式行为**

服务仅允许三个精确文件名，设置 `image/webp`，继续沿用 Host/Cookie/Origin、`O_NOFOLLOW` 和 `fstat`。窄屏和 200% zoom 下背景允许裁切但控件必须滚动可达；Reduced Motion 停止视差并缩短交叉淡入。

- [ ] **步骤 5：运行完整验证**

运行：`npm run verify && npm run test:e2e && npm run pack`

预期：全部退出码为 `0`；打包产物包含三个 WebP，不包含 `.superpowers`、生成临时文件、官方素材或远程依赖。

- [ ] **步骤 6：Commit**

```bash
git add renderer/boot workbench/service.cjs tests
git commit -m "feat: stage three-scene boot artwork"
```
