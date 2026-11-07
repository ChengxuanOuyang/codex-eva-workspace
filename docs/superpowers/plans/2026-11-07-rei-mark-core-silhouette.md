# 原创绫波丽徽记与核心侧影实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将已批准的「徽记 + 核心侧影」加入公开启动页，使 `PROJECT ZERO / 00` 与绫波丽视觉编码清楚可见，同时不包含官方 NERV/EVA 素材。

**架构：** 只修改现有静态启动页面，不增加网络、脚本或二进制资产。徽记和侧影由语义化 HTML 与本地 CSS 几何图层组成；同步读数保持在最上层，装饰图层 `aria-hidden` 且不接收指针事件。现有 CSP、静态白名单和打包文件列表无需扩大。

**技术栈：** Electron 45、原生 HTML/CSS、Node.js `node:test`、Playwright Electron E2E。

---

## 文件结构

- 修改 `renderer/boot/index.html`：加入原创徽记标签与核心侧影的无障碍隐藏结构。
- 修改 `renderer/boot/boot.css`：绘制徽记、冰蓝短发、红瞳信号和白色驾驶服抽象层；保证读数层级与 Reduced Motion。
- 修改 `tests/renderer-assets.test.cjs`：锁定原创结构、本地资源边界、禁止官方字标及装饰层行为。
- 修改 `tests/e2e/boot.test.cjs`：确认实际 Electron 窗口可见侧影且同步操作不被遮挡。

### 任务 7：测试并实现公开主题视觉

**文件：**
- 修改：`tests/renderer-assets.test.cjs`
- 修改：`tests/e2e/boot.test.cjs`

- [x] **步骤 1：编写失败的静态结构测试**

在 `tests/renderer-assets.test.cjs` 增加：

```js
test('public boot theme exposes the original PROJECT ZERO 00 mark and Rei-coded core silhouette', async () => {
  const html = await read('boot/index.html');
  const css = await read('boot/boot.css');

  assert.match(html, /class="project-mark"[^>]*aria-label="PROJECT ZERO 00 原创系统徽记"/);
  assert.match(html, /class="pilot-silhouette"[^>]*aria-hidden="true"/);
  for (const part of ['pilot-hair', 'pilot-face', 'pilot-eye pilot-eye-left', 'pilot-eye pilot-eye-right', 'pilot-suit']) {
    assert.match(html, new RegExp(`class="${part}"`));
  }
  assert.match(css, /\.pilot-silhouette[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.sync-readout[^}]*z-index:\s*[4-9]/s);
  assert.doesNotMatch(`${html}\n${css}`, /\bNERV\b|EVANGELION/i);
});
```

- [x] **步骤 2：编写失败的窗口测试**

在 `tests/e2e/boot.test.cjs` 的确认按钮启用后、点击前增加：

```js
const silhouette = page.locator('.pilot-silhouette');
await assert.doesNotReject(silhouette.waitFor({state: 'visible'}));
assert.equal(await silhouette.getAttribute('aria-hidden'), 'true');
assert.equal(await page.locator('.project-mark[aria-label="PROJECT ZERO 00 原创系统徽记"]').count(), 1);
```

- [x] **步骤 3：运行测试并验证正确失败**

运行：`node --test tests/renderer-assets.test.cjs`

预期：新增测试因缺少徽记 `aria-label` 与 `.pilot-silhouette` 结构而 FAIL；原有测试继续 PASS。

**文件：**
- 修改：`renderer/boot/index.html`
- 修改：`renderer/boot/boot.css`

- [x] **步骤 1：实现最少 HTML 结构**

将徽记改为：

```html
<div class="project-mark" role="img" aria-label="PROJECT ZERO 00 原创系统徽记">
  <strong>PZ</strong><small>00</small>
</div>
```

在 `.fluid-window` 内、流体层之前加入：

```html
<div class="pilot-silhouette" aria-hidden="true">
  <div class="pilot-hair"></div>
  <div class="pilot-face"></div>
  <i class="pilot-eye pilot-eye-left"></i>
  <i class="pilot-eye pilot-eye-right"></i>
  <div class="pilot-suit"></div>
</div>
```

- [x] **步骤 2：实现最少 CSS 几何图层**

为 `.pilot-silhouette` 设置绝对定位、`pointer-events: none`、不高于同步读数的层级；使用 `clip-path: polygon(...)` 和本地渐变绘制头发、面部、红瞳与白色驾驶服。`.sync-readout` 保持 `z-index: 4` 以上。禁止 `url(...)`、远程资源、人物姓名字标和官方标志。

在 Reduced Motion 媒体查询中加入：

```css
.pilot-silhouette { animation: none !important; transform: none !important; }
```

- [x] **步骤 3：运行窄测试验证通过**

运行：`node --test tests/renderer-assets.test.cjs tests/e2e/boot.test.cjs`

预期：静态测试与 Electron 启动测试全部 PASS；确认按钮仍可点击并到达 `SYSTEM ONLINE`。

- [x] **步骤 4：运行完整验证与打包**

运行：`npm run verify && npm run test:e2e && npm run pack`

预期：全部命令退出码为 `0`；打包后的 `app.asar` 只包含现有产品文件，不新增官方或远程素材。

- [x] **步骤 5：Commit**

```bash
git add renderer/boot/index.html renderer/boot/boot.css tests/renderer-assets.test.cjs tests/e2e/boot.test.cjs docs/superpowers/plans/2026-11-07-rei-mark-core-silhouette.md
git commit -m "feat: add original Rei core silhouette"
```
