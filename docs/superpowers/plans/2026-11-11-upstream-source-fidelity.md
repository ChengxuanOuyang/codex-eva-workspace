# 作者源码结构精确移植与双渲染器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 以作者公开仓库的结构、坐标算法和动作规则，加上参考视频逐帧视觉与完整音轨，构建默认启用的浅蓝 `EVANGELION-00 / REI` 参考 DOM 模式，同时保留现有 Canvas 版作为公开版和故障 fallback。

**架构：** 现有 `createBootController` 继续独占时间轴、音频、READY、确认、跳过和完成状态；`reference-renderer` 与 `boot-canvas` 只实现同一冻结快照的两种显示适配器。完整私有主题启用参考 DOM，任何素材或渲染失败在同一帧切换 Canvas；公开构建永远只启用 Canvas。

**技术栈：** Electron 45、Node.js CommonJS、浏览器 UMD、HTML/CSS/SVG、Canvas 2D、Playwright Electron E2E、node:test、macOS `afconvert`/AVFoundation、electron-builder ASAR。

**预计总工时：** 6–9 小时自动执行与复核，外加 10–20 分钟用户最终视觉确认。任何安全或实机回归会增加修复与复审时间，不以跳过验证换取速度。

---

## 文件职责

- `renderer/boot/reference-timing.js`：固定作者时间点、播报 cue、显示文字和参考色，不读取 DOM。
- `renderer/boot/reference-layout.js`：把时间轴快照转换成确定性的参考 DOM view-model。
- `renderer/boot/reference-renderer.js`：只负责 DOM/SVG 更新、resize、真实 render record 和销毁。
- `renderer/boot/reference.css`：浅蓝 `EVANGELION-00` 的精确层级、坐标、字体、节点、扫描、圆环和转场。
- `renderer/boot/renderer-director.js`：选择 reference/canvas、同帧 fallback、统一 resize/destroy。
- `renderer/fonts/*`：OFL 字体、来源与许可证。
- `tests/fixtures/reference-video-manifest.json`：只含归一化时间、坐标、颜色、文字和状态，不含截图、音轨或本地路径。
- `scripts/verify-reference-frames.cjs`：显式给出本地视频时才运行的私有视觉验收入口，不把视频或帧写入 Git。

---

### 任务 0：整理当前工作树并固定作者来源

**文件：**
- 修改：`docs/code-origins.md`
- 修改：`docs/reference-analysis.md`
- 修改：`THIRD_PARTY_NOTICES.md`
- 修改：`tests/upstream-attribution.test.cjs`
- 保留并审查：`README.md`
- 保留并审查：`docs/workflow.md`
- 保留并审查：`tests/e2e/core-workbench.test.cjs`
- 保留并审查：`tests/e2e/tools.test.cjs`

- [ ] **步骤 1：先记录现有未提交改动，不覆盖它们**

运行：

```bash
git status --short
git diff -- README.md docs/workflow.md tests/e2e/core-workbench.test.cjs tests/e2e/tools.test.cjs
```

预期：只看到先前 Task 10 的文档与 E2E 超时诊断改动；逐段判断保留、修正或回退，不使用 `git checkout`/`reset`。

- [ ] **步骤 2：编写失败的当前来源测试**

```js
test('upstream engineering baseline is pinned to the inspected public source', () => {
  assert.match(origins, /9733eb192e8ef97d3e7469ede544cad2a6186519/);
  assert.match(origins, /unified-sequence\.js/);
  assert.match(origins, /sequence-timing\.js/);
  assert.match(origins, /public history.*red.*Asuka/i);
  assert.match(origins, /private.*EVANGELION-00.*not published/i);
});
```

运行：`node --test tests/upstream-attribution.test.cjs`  
预期：FAIL，因为文档仍固定旧提交 `b12753e...`。

- [ ] **步骤 3：更新来源与许可边界**

文档必须区分：

```text
MIT: structure, timing algorithms, motion code
OFL: unit02-mincho-black.woff2
private-only: NERV, Rei, reference soundtrack
not available upstream: light-blue EVANGELION-00 private source
```

运行：`node --test tests/upstream-attribution.test.cjs tests/asset-licenses.test.cjs`  
预期：PASS。

- [ ] **步骤 4：提交来源锁定**

```bash
git add docs/code-origins.md docs/reference-analysis.md THIRD_PARTY_NOTICES.md tests/upstream-attribution.test.cjs
git commit -m "docs: pin the inspected upstream presentation source"
```

**预算：** 20–30 分钟。

---

### 任务 1：导入 OFL 字体与精确静态资源边界

**文件：**
- 创建：`renderer/fonts/unit02-mincho-black.woff2`
- 创建：`renderer/fonts/mincho.css`
- 创建：`renderer/fonts/OFL-NotoSerifCJK.txt`
- 创建：`renderer/fonts/SOURCES.md`
- 修改：`workbench/service.cjs`
- 修改：`renderer/boot/index.html`
- 修改：`tests/renderer-assets.test.cjs`
- 修改：`tests/asset-licenses.test.cjs`

- [ ] **步骤 1：编写失败的字体与路由测试**

```js
test('reference font is exact-allowlisted with its OFL notice', async () => {
  assert.equal((await request('/fonts/mincho.css')).status, 200);
  assert.equal((await request('/fonts/unit02-mincho-black.woff2')).status, 200);
  assert.match(readFile('renderer/fonts/OFL-NotoSerifCJK.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
});
```

并断言 `/fonts/../package.json`、query、反斜杠和未知字体均为 404。

运行：`node --test tests/renderer-assets.test.cjs tests/asset-licenses.test.cjs`  
预期：FAIL，资源尚不存在。

- [ ] **步骤 2：从固定提交复制并验证字体**

```bash
git -C ../../../../work/eva-codex-workbench show 9733eb192e8ef97d3e7469ede544cad2a6186519:workbench/public/fonts/unit02-mincho-black.woff2 > /tmp/unit02-mincho-black.woff2
shasum -a 256 /tmp/unit02-mincho-black.woff2
```

使用二进制复制把该文件放入 `renderer/fonts/`；`mincho.css` 只声明固定 same-origin URL：

```css
@font-face {
  font-family: "Unit02 Mincho";
  src: url("/fonts/unit02-mincho-black.woff2") format("woff2");
  font-display: swap;
  font-weight: 900;
}
```

- [ ] **步骤 3：加入精确白名单并验证 CSP**

在 `workbench/service.cjs` 只加入两个字体路由；CSP 保持 `default-src 'self'`、`font-src 'self'`，不增加远端域名。

运行：`node --test tests/renderer-assets.test.cjs tests/service-security.test.cjs tests/asset-licenses.test.cjs`  
预期：PASS。

- [ ] **步骤 4：提交字体**

```bash
git add renderer/fonts workbench/service.cjs renderer/boot/index.html tests/renderer-assets.test.cjs tests/asset-licenses.test.cjs
git commit -m "feat: add the licensed EVA-style title font"
```

**预算：** 30–45 分钟。

---

### 任务 2：把时间轴校准到作者的 13.3 秒认证门

**文件：**
- 创建：`renderer/boot/reference-timing.js`
- 修改：`renderer/boot/timeline.js`
- 修改：`renderer/boot/boot.js`
- 修改：`tests/boot-timeline.test.cjs`
- 修改：`tests/boot-runtime.test.cjs`
- 修改：`tests/audio-clock.test.cjs`

- [ ] **步骤 1：编写失败的精确时间测试**

```js
test('reference timing matches the author sequence and recorded absolute clock', () => {
  assert.equal(REFERENCE_TIMING.holdMs, 13_300);
  assert.equal(REFERENCE_TIMING.videoStartMs, 2_000);
  assert.equal(REFERENCE_TIMING.videoHoldMs, 15_300);
  assert.equal(sampleTimeline(13_299).progress < 99.2, true);
  assert.equal(sampleTimeline(13_300).stage, 'authorize');
  assert.equal(sampleTimeline(13_300).progress, 99.2);
});
```

运行：`node --test tests/boot-timeline.test.cjs tests/boot-runtime.test.cjs`  
预期：FAIL，因为当前门是 15,500 ms。

- [ ] **步骤 2：实现不可变作者时间表**

```js
const REFERENCE_TIMING = Object.freeze({
  durationMs: 20_500,
  lclStartMs: 3_000,
  lclEndMs: 6_400,
  lclClearStartMs: 6_800,
  lclClearEndMs: 9_200,
  syncStartMs: 8_800,
  holdMs: 13_300,
  syncFullMs: 14_100,
  transferStartMs: 14_350,
  transferEndMs: 15_450,
  handoffStartMs: 18_600,
  handoffEndMs: 19_850,
  videoStartMs: 2_000,
  videoEndMs: 22_500
});
```

六条 cue 从固定上游 `timeline.json` 转为冻结数组；文字逐字保持，不引入明日香/二号机。

- [ ] **步骤 3：统一暂停、跳过和断连恢复到 13,300 ms**

修改所有 `15_500` 认证门使用 `REFERENCE_TIMING.holdMs`。断连恢复严格执行：

```js
await audioClock.pause();
audioClock.seek(REFERENCE_TIMING.holdMs);
render(sampleTimeline(REFERENCE_TIMING.holdMs));
```

运行：

```bash
node --test tests/boot-timeline.test.cjs tests/boot-runtime.test.cjs tests/audio-clock.test.cjs
```

预期：所有测试 PASS，pause/seek/resume 调用次数不变。

- [ ] **步骤 4：提交时间校准**

```bash
git add renderer/boot/reference-timing.js renderer/boot/timeline.js renderer/boot/boot.js tests/boot-timeline.test.cjs tests/boot-runtime.test.cjs tests/audio-clock.test.cjs
git commit -m "fix: align the boot gate with the author timeline"
```

**预算：** 45–60 分钟。

---

### 任务 3：实现浅蓝参考 DOM 渲染器

**文件：**
- 创建：`renderer/boot/reference-layout.js`
- 创建：`renderer/boot/reference-renderer.js`
- 创建：`renderer/boot/reference.css`
- 创建：`tests/reference-layout.test.cjs`
- 创建：`tests/reference-renderer.test.cjs`
- 修改：`renderer/boot/index.html`
- 修改：`workbench/service.cjs`
- 修改：`tests/renderer-assets.test.cjs`

- [ ] **步骤 1：编写失败的 view-model 测试**

```js
test('hold frame reproduces the EVANGELION-00 reference inventory', () => {
  const frame = referenceFrame({elapsedMs: 13_300, stage: 'authorize', progress: 99.2, activeNodes: 12});
  assert.equal(frame.header.unit, 'EVANGELION-00');
  assert.equal(frame.header.pilot, '零号机');
  assert.equal(frame.center.metric, '99.2%');
  assert.deepEqual(frame.nodes.map(node => node.label), [
    'WARNING','EMERGENCY','WARNING','EMERGENCY','WARNING','EMERGENCY',
    'WARNING','EMERGENCY','WARNING','EMERGENCY','WARNING','EMERGENCY'
  ]);
  assert.equal(frame.palette.background, '#edf6fa');
});
```

运行：`node --test tests/reference-layout.test.cjs`  
预期：FAIL，模块不存在。

- [ ] **步骤 2：实现纯 reference view-model**

`referenceFrame(snapshot)` 只依赖冻结快照与 `REFERENCE_TIMING`，返回深冻结对象。它必须从真实阶段分支决定标题、cue、扫描高度、圆环角度、节点激活和闪屏，不接受调用者注入任意 HTML、URL 或文本。

- [ ] **步骤 3：编写失败的 DOM 渲染记录测试**

```js
test('render record comes from computed DOM styles and visible nodes', () => {
  renderer.render(referenceFrame(authorizeSnapshot));
  const record = renderer.lastRenderRecord();
  assert.equal(record.visibleNodeCount, 12);
  assert.equal(record.metricText, '99.2%');
  assert.equal(record.scanVisible, false);
  assert.equal(record.computed.backgroundColor, 'rgb(237, 246, 250)');
});
```

伪造 `snapshot.headingKey` 或 `snapshot.iconStates` 不得改变记录。

- [ ] **步骤 4：实现 DOM/SVG 层和 CSS**

`index.html` 加入但默认隐藏：

```html
<section id="reference-sequence" class="reference-sequence" hidden aria-hidden="true">
  <header class="reference-header"></header>
  <div class="reference-grid"></div>
  <div class="reference-node-column reference-node-column--left"></div>
  <div class="reference-node-column reference-node-column--right"></div>
  <div class="reference-center"></div>
  <div class="reference-scan-field"></div>
  <footer class="reference-footer"></footer>
</section>
```

CSS 使用 1920×1080 逻辑层，通过 `--reference-scale` 居中缩放；颜色、字体、边线、角标和节点尺寸全部来自 `tests/fixtures/reference-video-manifest.json`，不复制公开红黑 CSS。

- [ ] **步骤 5：加入 UMD 脚本精确路由**

脚本顺序：`reference-timing.js` → `reference-layout.js` → `reference-renderer.js` → `boot.js`。未知、query、遍历和反斜杠路由仍为 404。

运行：

```bash
node --test tests/reference-layout.test.cjs tests/reference-renderer.test.cjs tests/renderer-assets.test.cjs tests/service-security.test.cjs
```

预期：PASS。

- [ ] **步骤 6：提交参考渲染器**

```bash
git add renderer/boot/reference-layout.js renderer/boot/reference-renderer.js renderer/boot/reference.css renderer/boot/index.html workbench/service.cjs tests/reference-layout.test.cjs tests/reference-renderer.test.cjs tests/renderer-assets.test.cjs
git commit -m "feat: add the EVANGELION-00 reference renderer"
```

**预算：** 90–120 分钟。

---

### 任务 4：双渲染器选择、无闪屏 fallback 与无障碍

**文件：**
- 创建：`renderer/boot/renderer-director.js`
- 创建：`tests/renderer-director.test.cjs`
- 修改：`renderer/boot/boot.js`
- 修改：`renderer/boot/index.html`
- 修改：`renderer/boot/boot.css`
- 修改：`tests/boot-runtime.test.cjs`

- [ ] **步骤 1：编写失败的选择与 fallback 测试**

```js
test('complete private theme selects reference and a render failure falls back in the same snapshot', () => {
  director.render(snapshot);
  assert.equal(director.mode(), 'reference');
  reference.failNextRender();
  director.render(nextSnapshot);
  assert.equal(director.mode(), 'canvas');
  assert.deepEqual(canvas.lastSnapshot(), nextSnapshot);
});
```

并覆盖 public、private 404、mark decode 失败、reference resize 失败、destroy 期间失败与重复 fallback。

运行：`node --test tests/renderer-director.test.cjs tests/boot-runtime.test.cjs`  
预期：FAIL，director 不存在。

- [ ] **步骤 2：实现统一 director**

```js
createRendererDirector({reference, canvas, preferReference})
// => {render, resize, destroy, mode, lastRenderRecord}
```

切换规则：reference 失败时先让 Canvas 用同一 snapshot 完成首帧，再隐藏 reference；不得重置音频、时间轴、READY 或 live region。

- [ ] **步骤 3：保持无障碍控制层唯一**

DOM renderer 和 Canvas 都不得复制按钮、progressbar 或 live region。`#pilot-authorization`、skip、retry 和 curtain 继续由 `boot.js` 唯一管理；renderer layer 均 `aria-hidden="true"`。

- [ ] **步骤 4：验证 reduced motion 和 resize**

两模式都在 reduced motion 下使用静态关键帧和不超过 180 ms 的 opacity；resize 不改变 `elapsedMs` 或 active node 数。

运行：

```bash
node --test tests/renderer-director.test.cjs tests/boot-runtime.test.cjs tests/boot-canvas.test.cjs tests/reference-renderer.test.cjs
```

预期：PASS。

- [ ] **步骤 5：提交双渲染器**

```bash
git add renderer/boot/renderer-director.js renderer/boot/boot.js renderer/boot/index.html renderer/boot/boot.css tests/renderer-director.test.cjs tests/boot-runtime.test.cjs
git commit -m "feat: select the reference renderer with canvas fallback"
```

**预算：** 60–90 分钟。

---

### 任务 5：按视频还原 Rei 工作台布局

**文件：**
- 修改：`renderer/workbench/themes.js`
- 修改：`renderer/workbench/workbench.css`
- 修改：`renderer/boot/index.html`
- 创建：`tests/workbench-ui.test.cjs`
- 修改：`tests/renderer-assets.test.cjs`

- [ ] **步骤 1：编写失败的工作台结构测试**

```js
test('private workbench keeps the author hierarchy with Rei below functional panels', () => {
  assert.equal(theme.unit, 'EVANGELION-00');
  assert.equal(theme.pilot, 'REI / 绫波丽');
  assert.equal(theme.portraitUrl, '/private/rei-portrait.webp');
  assert.ok(zIndex.chat > zIndex.portrait);
  assert.ok(zIndex.terminal > zIndex.portrait);
  assert.ok(zIndex.settings > zIndex.portrait);
});
```

公共模式不得请求 private portrait。

- [ ] **步骤 2：移植作者信息架构而非红黑皮肤**

保留作者侧栏比例、顶部标题、卡片层次和入口位置；颜色、标题和人物层改为视频的浅蓝 Rei 版。人物最大宽度 `min(34vw, 520px)`、`opacity <= .38`、`pointer-events:none`，窄屏隐藏。

- [ ] **步骤 3：验证全部现有工作台功能 ID**

运行：

```bash
node --test tests/workbench-ui.test.cjs tests/renderer-assets.test.cjs tests/e2e/core-workbench.test.cjs tests/e2e/tools.test.cjs
```

预期：聊天、终端、设置、权限、项目和重试节点均保留，Task 10 先前的 E2E 超时诊断得到明确保留或修复。

- [ ] **步骤 4：提交工作台布局**

```bash
git add renderer/workbench/themes.js renderer/workbench/workbench.css renderer/boot/index.html tests/workbench-ui.test.cjs tests/renderer-assets.test.cjs tests/e2e/core-workbench.test.cjs tests/e2e/tools.test.cjs
git commit -m "feat: align the private Rei workbench with the reference"
```

**预算：** 45–75 分钟。

---

### 任务 6：参考清单、双模式视觉 E2E 与音画验收

**文件：**
- 创建：`tests/fixtures/reference-video-manifest.json`
- 创建：`scripts/verify-reference-frames.cjs`
- 修改：`tests/e2e/boot-visual.test.cjs`
- 修改：`tests/e2e/boot.test.cjs`
- 修改：`tests/e2e/private-packaged-smoke.test.cjs`
- 修改：`docs/testing-and-packaging.md`

- [ ] **步骤 1：建立不含媒体的参考 manifest**

manifest 只记录：

```json
{
  "videoSha256": "7f54d68cf6642c8e7c0c4e4a0bb79170bec992b60ebe4a0127b0c5d498f54654",
  "crop": {"contentX": 0, "contentY": 373, "contentWidth": 592, "contentHeight": 333},
  "logicalSize": {"width": 1920, "height": 1080},
  "holdMs": 13300,
  "frames": []
}
```

`frames` 填入 0、1500、3000、5500、8800、10500、12500、13300、14100、15450、18600、19850、20500 的 stage、文字、节点数、进度、扫描比例和采样色。

- [ ] **步骤 2：编写失败的 reference E2E**

测试在 `reference` 与 `canvas` 两模式分别读取真实 render record/DOM computed style，断言 manifest。reference 模式额外断言：全部固定文字、12 节点、字体加载、mark 显示、扫描高度、圆环角度和完成标题。

运行：

```bash
node --test --test-concurrency=1 tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs
```

预期：在新 reference 断言完成前至少一个 FAIL。

- [ ] **步骤 3：实现本地视频验收脚本**

接口严格为：

```text
node scripts/verify-reference-frames.cjs --video <absolute mp4> --screenshots <absolute temp dir>
```

只接受普通 MP4 和非 symlink 临时目录；输出稳定摘要、逐项 pass/fail 和 SHA，不打印绝对路径，不复制视频到仓库。缺少本地视频时自动化 manifest 测试仍可运行。

- [ ] **步骤 4：运行双模式完整 E2E**

```bash
npm run pack
npm run pack:private -- --theme private-themes/rei/package
node --test --test-concurrency=1 tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs tests/e2e/packaged-smoke.test.cjs tests/e2e/private-packaged-smoke.test.cjs
```

预期：reference 完整播放、按钮跳过、Escape、READY、fullscreen→windowed、Canvas fallback、生产桥拒绝全部 PASS；关闭后无 listener 或子进程。

- [ ] **步骤 5：提交视觉验收**

```bash
git add tests/fixtures/reference-video-manifest.json scripts/verify-reference-frames.cjs tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs tests/e2e/private-packaged-smoke.test.cjs docs/testing-and-packaging.md
git commit -m "test: verify reference and canvas presentations"
```

**预算：** 60–90 分钟。

---

### 任务 7：完成私有包、文档、验证与可恢复安装

**文件：**
- 修改（忽略）：`private-themes/rei/package/*`
- 修改：`README.md`
- 修改：`docs/workflow.md`
- 修改：`docs/private-themes.md`

- [ ] **步骤 1：重新生成私有摘要和包**

使用已经准备的 `startup-reference.m4a`，固定 `audioStartMs: 2000`、`audioEndMs: 22500`，重新计算六项摘要。确认：

```bash
git status --short --ignored private-themes dist-private
git ls-files private-themes dist-private
```

预期：前者为 `!!`，后者无输出。

- [ ] **步骤 2：运行完整验证**

```bash
npm run verify
npm run licenses:check
npm audit --audit-level=high
npm run test:e2e
npm run pack:private -- --theme private-themes/rei/package
```

预期：lint、全部测试、许可、公开/私有 E2E PASS；high/critical 为 0；private app 存在且摘要匹配。

- [ ] **步骤 3：公开树泄漏审计**

```bash
git ls-files | rg '^(private-themes|dist-private|\.private-build|\.superpowers)' && exit 1 || true
rg -n '/Users/harrisonrio|BF\.JUV|609_1794013039|REI PRIVATE' README.md docs renderer app scripts tests package.json
```

预期：tracked private 匹配为零；第二条只允许文档中通用示例，不允许真实路径或私人标识。

- [ ] **步骤 4：提交最终公开文档**

文档说明双渲染器、作者源结构、视频优先级、Canvas fallback、私有素材许可、自建、验证、安装和恢复。

```bash
git add README.md docs/workflow.md docs/private-themes.md
git commit -m "docs: publish the dual-renderer Rei workflow"
```

- [ ] **步骤 5：可恢复安装**

确认旧进程退出。将旧应用移动到带 UTC 时间戳的废纸篓备份，不删除：

```text
/Users/harrisonrio/.Trash/PROJECT ZERO — REI PRIVATE THEME.app.backup-YYYYMMDDTHHMMSSZ
```

复制新 app 到 `/Users/harrisonrio/Applications/PROJECT ZERO — REI PRIVATE THEME.app`。完整播放和 Escape 各验收一次；任一失败就退出新版并恢复备份。

**预算：** 60–90 分钟，含两轮实机验收。

---

### 任务 8：独立总审查与安全推送

**文件：**
- 审查范围：从 `0772d52` 到最终 HEAD 的全部提交
- 更新：`.superpowers/sdd/progress.md`（忽略，不提交）

- [ ] **步骤 1：请求独立代码审查**

使用 requesting-code-review 检查：13.3 秒门、音频终点、双渲染器同帧 fallback、固定资产 URL、路由认证、测试桥生产拒绝、窗口恢复、私有 staging 清理、公开泄漏。Critical/Important 必须为 0。

- [ ] **步骤 2：运行最终验证**

```bash
npm run verify
npm run test:e2e
npm run pack
npm run pack:private -- --theme private-themes/rei/package
git diff --check
git status --short
```

预期：全部 PASS，tracked 工作树干净。

- [ ] **步骤 3：安全推送公开快照**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git ls-files | rg '^(private-themes|dist-private|\.private-build|\.superpowers)' && exit 1 || true
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

若远端不是祖先则停止，不 force push；先审查远端新增提交并正常整合。推送后远端 main SHA 必须等于本地 HEAD。

- [ ] **步骤 4：完成分支收尾**

使用 finishing-a-development-branch 记录最终提交、安装路径、备份路径、验证计数、公开/私有边界和可恢复方式。

**预算：** 45–75 分钟；若远端有新提交则另计整合与复验时间。
