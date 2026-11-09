# 参考视频高保真启动演出实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将现有启动页重制为与用户参考视频同结构、由视频原声驱动、可跳过且受真实 Codex `READY` 状态门控的全屏 EVA / 绫波丽启动演出，并安全发布本机私人版和无版权素材的公开版。

**架构：** 新的声明式时间轴模块负责在任意音频时间点生成唯一画面快照，高 DPI Canvas 2D 舞台绘制参考视频中的 mark、图标、六边形节点、扫描层、同步环、文字和交接动画；DOM 仅承载无障碍控制。`AudioClock` 以一次性解码的本地私人音轨为主时钟并在失败时切换单调静音时钟，现有 readiness reducer 保留 99.2% 安全门。Electron 主进程通过一个专用 `WindowDirector` 管理全屏进入与普通窗口恢复；私人包扩展现有严格主题合约，只在隔离打包阶段注入 NERV、绫波丽与参考音轨。Canvas、运动、布局和本地音轨解码结构借鉴用户指定的 MIT Windows 仓库提交 `b12753e`，保留逐文件来源说明且不复制其另行授权的媒体。

**技术栈：** Electron 45、原生 HTML/CSS/SVG、浏览器 `HTMLAudioElement`、Node.js 24、`node:test`、Playwright Electron、electron-builder、macOS `afconvert`（仅用于本机私人音轨准备）。

---

## 文件结构与职责

### 新建文件

- `renderer/boot/timeline.js`：浏览器/CommonJS 双环境的只读启动时间轴、采样和校验逻辑。
- `renderer/boot/motion.js`：改编自 Windows 参考仓库 `motion-v12.js` 的确定性 easing、ping-pong 和 scan-position 纯函数。
- `renderer/boot/stage-layout.js`：改编自 Windows 参考仓库的响应式中央锚点与环形布局。
- `renderer/boot/boot-canvas.js`：按参考视频逐项绘制 mark、图标、节点、扫描层、同步环、标签和连接帧。
- `renderer/boot/sequence-audio.js`：改编自 Windows 参考仓库的一次性 Web Audio 解码与本地播放对象。
- `renderer/boot/audio-clock.js`：以媒体时间或单调时间驱动时间轴，负责播放、静音回退和 150 ms 跳过淡出。
- `app/window-director.cjs`：Electron 全屏启动、退出全屏、恢复安全窗口尺寸和超时回退。
- `tests/boot-timeline.test.cjs`：时间轴顺序、关键帧、进度、99.2% 门和 reduced-motion 采样测试。
- `tests/boot-canvas.test.cjs`：完整图标/标签清单、确定性几何、高清 backing store 和关键画面绘制测试。
- `tests/audio-clock.test.cjs`：媒体主时钟、播放失败回退、跳过淡出和销毁测试。
- `tests/upstream-attribution.test.cjs`：锁定借鉴仓库、提交、适用许可证和未复用媒体边界。
- `tests/window-director.test.cjs`：Electron 窗口模式变化、事件确认和失败回退测试。
- `tests/e2e/boot-visual.test.cjs`：关键时间点截图、全屏到普通窗口、完整播放和跳过流程。
- `scripts/prepare-private-audio.cjs`：用参数数组调用 `/usr/bin/afconvert`，生成私人 AAC 音轨并打印摘要，不打印源路径。

### 修改文件

- `renderer/boot/index.html`：替换启动 DOM 为高 DPI sequence canvas、驾驶员确认、诊断、跳过和过渡遮罩。
- `renderer/boot/boot.css`：实现全屏 Canvas/DOM 合成、驾驶员确认、过渡遮罩和 reduced-motion 规则。
- `renderer/boot/boot.js`：改为消费 `timeline.js` 与 `audio-clock.js`，保留 readiness 轮询、重试和 reducer 门控。
- `renderer/shared/api.js`：新增同源认证的 `completePresentation()` POST。
- `workbench/service.cjs`：安全提供新增脚本和私人固定资源；处理演出完成回调。
- `app/lifecycle.cjs`：创建并调用 `WindowDirector`，把演出完成回调注入 loopback service。
- `app/window-options.cjs`：启动时隐藏窗口，保持普通窗口安全尺寸和背景色。
- `scripts/theme-contract.cjs`：扩展私人包合约以验证 mark、portrait、soundtrack、起止时间和摘要。
- `scripts/pack-private-theme.cjs`：仅在隔离 staging 中写入私人启动资源和配置，并在清理时覆盖所有新增私人 inode。
- `tests/private-pack.test.cjs`、`tests/theme-contract.test.cjs`：覆盖扩展后的严格私人合约和清理边界。
- `tests/boot-runtime.test.cjs`、`tests/window-options.test.cjs`、`tests/service-security.test.cjs`、`tests/renderer-assets.test.cjs`：覆盖新的控制器、窗口和静态资源安全行为。
- `tests/e2e/boot.test.cjs`、`tests/e2e/private-packaged-smoke.test.cjs`：覆盖新正常/私人启动路径。
- `package.json`：将新 renderer 文件纳入现有打包树，并增加私人音轨准备命令。
- `docs/private-themes.md`、`docs/testing-and-packaging.md`、`docs/workflow.md`：记录素材准备、私人构建、视觉验收、安装与恢复。
- `THIRD_PARTY_NOTICES.md`、`docs/code-origins.md`：记录 Windows 参考仓库的 MIT 代码来源、固定提交、改编文件和排除媒体。
- `docs/reference-analysis.md`：记录主 EVA 视频与次要假面骑士视频各自可借鉴、必须排除和冲突时的优先级，不嵌入任何视频帧。

### 私人且不跟踪的文件

- `private-themes/rei/package/boot-mark.webp`
- `private-themes/rei/package/rei-portrait.webp`
- `private-themes/rei/package/startup-reference.m4a`
- 扩展后的 `private-themes/rei/package/theme.json`、`assets.json` 与 `ASSET-LICENSE.md`

## 任务 0：固定 Windows 参考来源与复用边界

**文件：**
- 创建：`docs/code-origins.md`
- 创建：`tests/upstream-attribution.test.cjs`
- 修改：`THIRD_PARTY_NOTICES.md`

- [ ] **步骤 1：编写失败的来源锁定测试**

```js
test('the Windows reference is pinned and media is excluded from its MIT-code notice', () => {
  const notice = fs.readFileSync('docs/code-origins.md', 'utf8');
  assert.match(notice, /Iris-change\/eva-codex-workbench/);
  assert.match(notice, /b12753e063d6b8752b4e0994e851d5cc0950f85b/);
  for (const file of ['motion-v12.js', 'stage-layout.js', 'sequence-audio.js', 'unified-sequence.js', 'boot-atmosphere.js']) {
    assert.match(notice, new RegExp(file.replace('.', '\\.')));
  }
  assert.match(notice, /NERV.*not.*MIT|NERV.*不.*MIT/i);
  assert.match(notice, /voice.*not copied|语音.*不复制/i);
});
```

- [ ] **步骤 2：运行测试确认来源文档缺失**

运行：`node --test tests/upstream-attribution.test.cjs`  
预期：FAIL，`docs/code-origins.md` 不存在。

- [ ] **步骤 3：写入精确来源与许可证说明**

`docs/code-origins.md` 固定仓库 URL、完整 commit、读取日期和五个参考模块；说明只改编 MIT 代码结构/算法。明确排除上游 `nerv-mark.svg`、`voice.wav`、角色图、字体和其他媒体，除非它们在本项目自己的私人素材清单中另行声明。`THIRD_PARTY_NOTICES.md` 增加 Iris-change MIT 代码项和仓库链接。

- [ ] **步骤 4：验证并提交来源记录**

运行：`node --test tests/upstream-attribution.test.cjs`  
预期：PASS。

```bash
git add docs/code-origins.md THIRD_PARTY_NOTICES.md tests/upstream-attribution.test.cjs
git commit -m "docs: record Windows workbench code origins"
```

## 任务 1：声明式启动时间轴

**文件：**
- 创建：`renderer/boot/timeline.js`
- 创建：`renderer/boot/motion.js`
- 创建：`renderer/boot/stage-layout.js`
- 创建：`tests/boot-timeline.test.cjs`
- 修改：`workbench/service.cjs`
- 修改：`tests/renderer-assets.test.cjs`

- [ ] **步骤 1：编写失败的时间轴契约测试**

```js
const {BOOT_TIMELINE, sampleTimeline, validateTimeline} = require('../renderer/boot/timeline.js');

test('reference timeline exposes the five approved stages', () => {
  assert.deepEqual(BOOT_TIMELINE.map(cue => cue.stage), [
    'wake', 'scan', 'synchronize', 'authorize', 'connect'
  ]);
  assert.equal(validateTimeline(BOOT_TIMELINE), true);
});

test('timeline reaches but never crosses 99.2 before authorization', () => {
  assert.equal(sampleTimeline(15_499).progress < 99.2, true);
  assert.equal(sampleTimeline(15_500).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: false}).progress, 99.2);
  assert.equal(sampleTimeline(20_500, {authorized: true}).progress, 100);
});

test('motion and layout are deterministic at reference sizes', () => {
  assert.equal(scanPosition(5.5, 900, 5), scanPosition(5.5, 900, 5));
  assert.deepEqual(stageLayout(1440, 900), {
    cx: 720, cy: 405, ringRadius: 171, nodeSize: 58, markSize: 270
  });
});
```

- [ ] **步骤 2：运行测试并确认缺少模块**

运行：`node --test tests/boot-timeline.test.cjs`  
预期：FAIL，错误包含 `Cannot find module '../renderer/boot/timeline.js'`。

- [ ] **步骤 3：实现最小、纯函数时间轴模块**

```js
const BOOT_TIMELINE = Object.freeze([
  Object.freeze({stage: 'wake', startMs: 0, endMs: 3500, from: 0, to: 0}),
  Object.freeze({stage: 'scan', startMs: 3500, endMs: 8500, from: 0, to: 0}),
  Object.freeze({stage: 'synchronize', startMs: 8500, endMs: 15500, from: 0, to: 99.2}),
  Object.freeze({stage: 'authorize', startMs: 15500, endMs: 15500, from: 99.2, to: 99.2}),
  Object.freeze({stage: 'connect', startMs: 15500, endMs: 20500, from: 99.2, to: 100})
]);

function sampleTimeline(elapsedMs, {authorized = false, reducedMotion = false} = {}) {
  const safeMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const logicalMs = authorized ? Math.min(safeMs, 20500) : Math.min(safeMs, 15500);
  const stage = !authorized && logicalMs >= 15500 ? 'authorize'
    : logicalMs < 3500 ? 'wake'
      : logicalMs < 8500 ? 'scan'
        : logicalMs < 15500 ? 'synchronize' : 'connect';
  const sync = Math.max(0, Math.min(1, (logicalMs - 8500) / 7000));
  const connect = authorized ? Math.max(0, Math.min(1, (logicalMs - 15500) / 5000)) : 0;
  const progress = authorized && stage === 'connect'
    ? 99.2 + 0.8 * connect
    : 99.2 * sync;
  const scanPhase = stage === 'scan' ? (logicalMs - 3500) / 5000 : 0;
  return Object.freeze({
    elapsedMs: logicalMs,
    stage,
    progress: Math.min(authorized ? 100 : 99.2, progress),
    scan: reducedMotion ? (scanPhase > 0 ? 1 : 0) : Math.sin(Math.PI * scanPhase),
    activeNodes: Math.min(12, Math.floor((progress / 99.2) * 12)),
    headingKey: `boot.${stage}.heading`,
    captionKey: `boot.${stage}.caption`,
    reducedMotion
  });
}
```

实现使用 UMD 风格导出：CommonJS 设置 `module.exports`，浏览器分别设置 `globalThis.ProjectZeroMotion`、`ProjectZeroStageLayout` 和 `ProjectZeroTimeline`。运动函数从上游 `motion-v12.js` 改编并保持纯函数；布局从 `stage-layout.js` 改编为视频的浅色 NERV 构图。两个改编文件的头部注释必须包含上游仓库 URL、完整 commit、原文件名和 MIT 代码范围，并明确未复制上游媒体。`validateTimeline()` 拒绝非有限时间、非单调边界、重复 stage、负区间和 `connect` 之前超过 99.2 的数据。

- [ ] **步骤 4：把脚本加入严格静态资源白名单并验证**

在 `workbench/service.cjs` 增加：

```js
['/motion.js', {root: bootRoot, fileName: 'motion.js', contentType: 'text/javascript; charset=utf-8'}],
['/stage-layout.js', {root: bootRoot, fileName: 'stage-layout.js', contentType: 'text/javascript; charset=utf-8'}],
['/timeline.js', {root: bootRoot, fileName: 'timeline.js', contentType: 'text/javascript; charset=utf-8'}]
```

运行：`node --test tests/boot-timeline.test.cjs tests/renderer-assets.test.cjs tests/service-security.test.cjs`  
预期：全部 PASS，且任意未列出的 `renderer/boot` 文件仍返回 404。

- [ ] **步骤 5：提交时间轴**

```bash
git add renderer/boot/motion.js renderer/boot/stage-layout.js renderer/boot/timeline.js tests/boot-timeline.test.cjs workbench/service.cjs tests/renderer-assets.test.cjs
git commit -m "feat: add deterministic boot timeline"
```

## 任务 2：音频主时钟与静音回退

**文件：**
- 创建：`renderer/boot/sequence-audio.js`
- 创建：`renderer/boot/audio-clock.js`
- 创建：`tests/audio-clock.test.cjs`
- 修改：`workbench/service.cjs`
- 修改：`tests/renderer-assets.test.cjs`

- [ ] **步骤 1：编写失败的媒体时钟测试**

```js
test('audio currentTime is the authoritative presentation clock', async () => {
  const audio = fakeAudio({currentTime: 2});
  const ticks = [];
  const clock = createAudioClock({audio, startSeconds: 2, endSeconds: 22.5, onTick: ms => ticks.push(ms), raf});
  await clock.start();
  audio.currentTime = 3.25;
  raf.fire();
  assert.equal(ticks.at(-1), 1250);
});

test('a rejected play switches once to the monotonic clock', async () => {
  const audio = fakeAudio({playError: Error('blocked')});
  const clock = createAudioClock({audio, now: () => 4100, onTick() {}, raf});
  await clock.start();
  assert.equal(clock.mode(), 'silent');
});

test('the sequence decoder fetches and decodes one complete local track', async () => {
  const track = await loadSequenceAudio('/private/startup-reference.m4a', {fetch, AudioContext});
  assert.equal(fetchCalls, 1);
  assert.equal(decodeCalls, 1);
  await track.close();
  assert.equal(contextClosed, true);
});
```

- [ ] **步骤 2：运行测试并确认模块缺失**

运行：`node --test tests/audio-clock.test.cjs`  
预期：FAIL，错误包含缺少 `sequence-audio.js` 或 `audio-clock.js`。

- [ ] **步骤 3：实现 `createAudioClock`**

先把上游 `sequence-audio.js` 改编为依赖注入的 UMD 模块：一次 fetch 完整本地文件、一次 `decodeAudioData`、通过 `AudioBufferSourceNode` 支持播放/暂停/seek/close，不依赖 HTTP Range。文件头部注释必须包含上游仓库 URL、完整 commit、原文件名和 MIT 代码范围，并明确上游 voice/audio 未复制。然后实现固定接口：

```js
createAudioClock({
  audio, startSeconds, endSeconds, now,
  requestAnimationFrame, cancelAnimationFrame,
  setTimeout, clearTimeout, onTick, onEnd, onMode
})
```

返回 `{start, pause, resume, seek, fadeOut, destroy, mode}`。`start()` 把 decoded track 的 `currentTime` 设为 `startSeconds`，成功播放时用 `(currentTime - startSeconds) * 1000`；失败时记录单调起点且只触发一次 `onMode('silent')`。时间到 15500 ms 时 `pause()` 固定媒体和静音时钟，驾驶员确认后 `resume()` 从同一位置继续，避免等待时间造成音画漂移。`seek(elapsedMs)` 同时更新媒体和静音位置。`fadeOut(150)` 通过 Web Audio gain ramp 或测试注入的 25 ms 线性步进降到 0，结束后 pause 并复原初始 gain。`destroy()` 取消 RAF、淡出 timer、关闭 decoded track/AudioContext，且重复调用幂等。

- [ ] **步骤 4：加入静态脚本白名单并验证清理**

运行：`node --test tests/audio-clock.test.cjs tests/renderer-assets.test.cjs tests/service-security.test.cjs`  
预期：全部 PASS；销毁后推进 fake RAF/timer 不再产生 tick。

- [ ] **步骤 5：提交音频时钟**

```bash
git add renderer/boot/sequence-audio.js renderer/boot/audio-clock.js tests/audio-clock.test.cjs workbench/service.cjs tests/renderer-assets.test.cjs
git commit -m "feat: synchronize boot animation to local audio"
```

## 任务 3：扩展私人启动包合约

**文件：**
- 修改：`scripts/theme-contract.cjs`
- 修改：`scripts/pack-private-theme.cjs`
- 修改：`tests/theme-contract.test.cjs`
- 修改：`tests/private-pack.test.cjs`
- 修改：`tests/fixtures/private-theme-valid/theme.json`
- 修改：`tests/fixtures/private-theme-valid/assets.json`
- 创建：`tests/fixtures/private-theme-valid/boot-mark.webp`
- 创建：`tests/fixtures/private-theme-valid/rei-portrait.webp`
- 创建：`tests/fixtures/private-theme-valid/startup-reference.wav`

- [ ] **步骤 1：先把测试夹具声明为扩展合约并确认旧校验失败**

`theme.json` 的固定结构改为：

```json
{
  "schemaVersion": 2,
  "id": "test-private",
  "displayName": "PROJECT ZERO // TEST PRIVATE THEME",
  "scenes": {
    "awakening": "scene-b-awakening.webp",
    "synchronization": "scene-a-sync.webp",
    "online": "scene-c-online.webp"
  },
  "boot": {
    "mark": "boot-mark.webp",
    "portrait": "rei-portrait.webp",
    "soundtrack": "startup-reference.wav",
    "audioStartMs": 0,
    "audioEndMs": 20500
  },
  "assetManifest": "assets.json",
  "artNotice": "ASSET-LICENSE.md"
}
```

`assets.json` 必须恰好覆盖六个二进制文件及各自 SHA-256。运行：

`node --test tests/theme-contract.test.cjs tests/private-pack.test.cjs`  
预期：FAIL，错误为 `THEME_FILE_SET` 或 `THEME_SCHEMA`。

- [ ] **步骤 2：为扩展合约编写拒绝测试**

逐项验证：缺少 mark、portrait 或 soundtrack；扩展名不在 `.webp/.wav/.m4a`；`audioStartMs < 0`；`audioEndMs <= audioStartMs`；播放区间超过 30 秒；声音超过 32 MiB；图像超过 12 MiB；摘要不匹配；额外文件；符号链接和根目录替换。所有错误只暴露稳定 `THEME_*` 代码。

- [ ] **步骤 3：实现 schema v2 和类型化大小限制**

在 `scripts/theme-contract.cjs` 中固定：

```js
const IMAGE_FILES = ['scene-a-sync.webp', 'scene-b-awakening.webp', 'scene-c-online.webp', 'boot-mark.webp', 'rei-portrait.webp'];
const SOUNDTRACK_EXTENSIONS = new Set(['.wav', '.m4a']);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOUNDTRACK_BYTES = 32 * 1024 * 1024;
const MAX_AUDIO_SEGMENT_MS = 30_000;
```

保持 `O_NOFOLLOW`、根目录 inode 复核和内容快照语义。返回对象新增冻结的 `boot` 字段，`contents` 包含全部九个合约文件。

- [ ] **步骤 4：在隔离 staging 注入固定私人路径**

`pack-private-theme.cjs` 将私人资源写到：

```text
renderer/boot/private/boot-mark.webp
renderer/boot/private/rei-portrait.webp
renderer/boot/private/startup-reference.wav 或 startup-reference.m4a
renderer/boot/private/theme.json
```

`private/theme.json` 仅含固定相对 URL、起止毫秒和显示名，不含源路径。新增文件必须进入现有 held-handle 清理列表；builder 成功、失败和受害文件替换三条路径都必须截断并关闭 inode。

- [ ] **步骤 5：运行私人合约测试**

运行：`node --test tests/theme-contract.test.cjs tests/private-pack.test.cjs`  
预期：全部 PASS，扩展后的每个私有文件均通过清理竞态测试。

- [ ] **步骤 6：提交私人合约**

```bash
git add scripts/theme-contract.cjs scripts/pack-private-theme.cjs tests/theme-contract.test.cjs tests/private-pack.test.cjs tests/fixtures/private-theme-valid
git commit -m "feat: validate private boot identity and soundtrack"
```

## 任务 4：安全提供私人启动配置和演出完成 API

**文件：**
- 修改：`workbench/service.cjs`
- 修改：`renderer/shared/api.js`
- 修改：`tests/service-security.test.cjs`
- 修改：`tests/routes.test.cjs`

- [ ] **步骤 1：编写失败的服务安全测试**

```js
test('private boot assets are exact allowlisted files and may be absent', async () => {
  assert.equal((await request('/private/theme.json')).status, 404);
  assert.equal((await request('/private/../theme.json')).status, 404);
});

test('presentation completion requires session cookie and exact origin', async () => {
  assert.equal((await post('/api/presentation/complete', {cookie: false})).status, 403);
  assert.equal((await post('/api/presentation/complete', {origin: 'https://example.com'})).status, 403);
  assert.equal((await post('/api/presentation/complete')).status, 204);
  assert.equal(completionCalls, 1);
});
```

- [ ] **步骤 2：运行测试确认新路由不存在**

运行：`node --test tests/service-security.test.cjs tests/routes.test.cjs`  
预期：FAIL，认证请求仍返回 404。

- [ ] **步骤 3：实现固定私人资源白名单**

`createWorkbenchService` 新增 `privateBootRoot = path.join(bootRoot, 'private')` 和 `onPresentationComplete = async () => {}`。只允许：

```text
/private/theme.json
/private/boot-mark.webp
/private/rei-portrait.webp
/private/startup-reference.wav
/private/startup-reference.m4a
```

继续使用 `readRegularFile()` 的 realpath、`O_NOFOLLOW` 和 regular-file 检查。缺少资源返回 404，不把磁盘路径写入响应。

- [ ] **步骤 4：实现完成 API 与浏览器客户端**

在服务中为 `POST /api/presentation/complete` 调用一次序列化的 `onPresentationComplete()`，成功返回 204；重复调用返回 204 且不重复改变窗口。`renderer/shared/api.js` 新增：

```js
completePresentation: ({signal} = {}) => request('/api/presentation/complete', {method: 'POST', signal})
```

- [ ] **步骤 5：验证路由与 CSP**

运行：`node --test tests/service-security.test.cjs tests/routes.test.cjs tests/renderer-assets.test.cjs`  
预期：全部 PASS；CSP 仍为 `default-src 'self'`，不存在远程媒体源。

- [ ] **步骤 6：提交服务边界**

```bash
git add workbench/service.cjs renderer/shared/api.js tests/service-security.test.cjs tests/routes.test.cjs tests/renderer-assets.test.cjs
git commit -m "feat: serve private boot media through exact routes"
```

## 任务 5：Electron 全屏窗口控制器

**文件：**
- 创建：`app/window-director.cjs`
- 创建：`tests/window-director.test.cjs`
- 修改：`app/window-options.cjs`
- 修改：`app/lifecycle.cjs`
- 修改：`tests/window-options.test.cjs`

- [ ] **步骤 1：编写失败的窗口状态测试**

```js
test('boot enters fullscreen before the hidden window is shown', async () => {
  await director.showBoot();
  assert.deepEqual(calls, ['setFullScreen:true', 'show']);
});

test('completion waits for leave-full-screen and restores safe bounds', async () => {
  const operation = director.revealWorkbench();
  assert.deepEqual(calls, ['setFullScreen:false']);
  window.emit('leave-full-screen');
  await operation;
  assert.deepEqual(calls, ['setFullScreen:false', 'setBounds:1500x950', 'center']);
});
```

- [ ] **步骤 2：运行测试确认模块缺失**

运行：`node --test tests/window-director.test.cjs tests/window-options.test.cjs`  
预期：FAIL，`app/window-director.cjs` 不存在。

- [ ] **步骤 3：实现幂等 `WindowDirector`**

```js
class WindowDirector {
  constructor(window, {timeoutMs = 1500, normalBounds = {width: 1500, height: 950}} = {}) {}
  async showBoot() {}
  async revealWorkbench() {}
  destroy() {}
}
```

`showBoot()` 先 `setFullScreen(true)` 后 `show()`。`revealWorkbench()` 复用同一个 promise，调用 `setFullScreen(false)`，等待 `leave-full-screen` 或 1500 ms 超时，然后恢复 1500×950、`center()` 并 resolve；Electron 方法抛错时仍保留当前可用窗口并以稳定结果 `{mode: 'fallback'}` 返回。

- [ ] **步骤 4：接入生命周期和服务回调**

`windowOptions()` 增加 `show: false`。`startWorkbench()` 在 `loadURL()` 后调用 `director.showBoot()`；向 service 传入：

```js
onPresentationComplete: () => windowDirector.revealWorkbench()
```

关闭应用时先 `windowDirector.destroy()`，再执行现有 runtime、service 和 bridge 清理。

- [ ] **步骤 5：验证启动顺序和异常回退**

运行：`node --test tests/window-director.test.cjs tests/window-options.test.cjs`  
预期：全部 PASS；现有启动顺序断言新增 `window:fullscreen:true` 与 `window:show`，且导航限制不变。

- [ ] **步骤 6：提交窗口控制器**

```bash
git add app/window-director.cjs app/window-options.cjs app/lifecycle.cjs tests/window-director.test.cjs tests/window-options.test.cjs
git commit -m "feat: transition boot from fullscreen to workbench"
```

## 任务 6：重制参考视频 Canvas 舞台与 DOM 控制层

**文件：**
- 创建：`renderer/boot/boot-canvas.js`
- 创建：`tests/boot-canvas.test.cjs`
- 修改：`renderer/boot/index.html`
- 修改：`renderer/boot/boot.css`
- 修改：`tests/renderer-assets.test.cjs`
- 创建：`docs/reference-analysis.md`

- [ ] **步骤 1：把视觉结构写成失败的静态测试**

```js
assert.match(html, /id="boot-sequence"/);
assert.match(html, /id="pilot-authorization"/);
assert.match(html, /id="transition-curtain"/);
assert.doesNotMatch(html, /pilot-silhouette|cockpit|helmet/i);
```

`tests/boot-canvas.test.cjs` 使用 recording context 断言每个关键帧的完整绘制清单：中央 NERV mark、左右各六个 hex node、细网格、系统图标、中文/日文技术标签、橙色 scan field、同步圆环、99.2%、认证闪屏、100%、连接标题和完成交接。任何清单项缺失都失败。

- [ ] **步骤 2：运行测试确认旧 DOM 不满足契约**

运行：`node --test tests/boot-canvas.test.cjs tests/renderer-assets.test.cjs`  
预期：FAIL，缺少 `boot-canvas.js` 或 `boot-sequence`。

- [ ] **步骤 3：替换启动 DOM，保留工作台 DOM**

加载脚本顺序固定为：

```html
<script src="/shared/api.js" defer></script>
<script src="/motion.js" defer></script>
<script src="/stage-layout.js" defer></script>
<script src="/timeline.js" defer></script>
<script src="/boot-canvas.js" defer></script>
<script src="/sequence-audio.js" defer></script>
<script src="/audio-clock.js" defer></script>
<script src="/boot.js" defer></script>
```

启动区域只包含：高 DPI `#boot-sequence` canvas、语义化但视觉隐藏的 progress/live status、`#pilot-authorization`、诊断与重试、右上角 `#skip-button`、全屏 `#transition-curtain`。`#workbench-shell` 及其功能节点保持原 ID。

- [ ] **步骤 4：实现连续 Canvas 舞台**

`boot-canvas.js` 改编上游 `unified-sequence.js`、`boot-atmosphere.js` 和 `stage-layout.js` 的连续舞台结构，但逐项重画为主 EVA 视频：浅冰蓝/白色底、视频同位置 NERV mark、左右六个淡蓝节点、橙色液体/扫描层、蓝色同步圆环和原视频标签。固定逻辑设计空间 1920×1080；backing store 使用 `min(devicePixelRatio, 2)`；resize 只改几何，不重置时间。

次要假面骑士参考只贡献四个动作规则：节点级联、认证前信息检查、短促全场认证闪屏、完成后主题连续进入工作台。禁止出现其 HIDDEN 标志、骑士人物、荧光绿、日文认证字样或声音。若其动作与 EVA 主视频冲突，主视频优先。

`drawBootFrame(context, snapshot, assets, viewport)` 必须是同输入同绘制命令的确定性函数。私人 mark 通过已验证 ImageBitmap/HTMLImageElement 注入；加载失败时使用公开原创 mark，而不是空白。

`boot-canvas.js` 的来源注释必须点名上游仓库、完整 commit 和被改编的 `unified-sequence.js`、`boot-atmosphere.js`、`stage-layout.js`；它不得声称上游 NERV/人物/音频媒体适用 MIT。

- [ ] **步骤 5：实现 Canvas/DOM 合成视觉系统**

CSS 使用已有 `--ice/--cyan/--orange` 变量，增加：

```css
.boot-presentation { position: fixed; inset: 0; overflow: hidden; background: #edf6f8; }
#boot-sequence { position: absolute; inset: 0; width: 100%; height: 100%; }
.transition-curtain { opacity: 0; background: #061014; pointer-events: none; }
body[data-transition="closing"] .transition-curtain { opacity: 1; transition: opacity 180ms linear; }
```

全屏布局在 1440×900 与 2560×1600 等效视口无滚动条；小视口保留可达的跳过、确认和重试。`prefers-reduced-motion` 和 `data-motion="reduced"` 将扫描、旋转改为不超过 180 ms 的交叉淡化。

- [ ] **步骤 6：记录两段参考的优先级与排除项**

`docs/reference-analysis.md` 以文字列出：EVA 视频是图标/布局/色彩/文字/节奏/声音的唯一主基准；Windows 仓库是 MIT 工程结构参考；假面骑士视频只提供节点级联、认证闪屏、进度联动与连续交接。文档不得嵌入视频截图、音轨、绝对本地路径或社交账号信息。

- [ ] **步骤 7：验证静态资源、Canvas 清单与可访问性**

运行：`node --test tests/boot-canvas.test.cjs tests/renderer-assets.test.cjs tests/asset-licenses.test.cjs`  
预期：全部 PASS；隐藏语义层仍有 `role="progressbar"`，状态消息仍有 live region，所有按钮有可读名称；EVA 清单完整，假面骑士排除词不出现在 renderer。

- [ ] **步骤 8：提交视觉重制**

```bash
git add renderer/boot/boot-canvas.js renderer/boot/index.html renderer/boot/boot.css tests/boot-canvas.test.cjs tests/renderer-assets.test.cjs docs/reference-analysis.md
git commit -m "feat: recreate the NERV boot presentation"
```

## 任务 7：把控制器接到时间轴、音频和真实 READY 门

**文件：**
- 修改：`renderer/boot/boot.js`
- 修改：`tests/boot-runtime.test.cjs`
- 修改：`tests/boot-state.test.cjs`

- [ ] **步骤 1：扩展 fake DOM、fake audio 和失败测试**

覆盖以下精确行为：

```js
assert.equal(view.document.body.dataset.stage, 'authorize');
assert.equal(view.elements['#progress-value'].textContent, '99.2');
assert.equal(view.elements['#confirm-button'].disabled, true);
assert.deepEqual(view.canvas.lastSnapshot, sampleTimeline(15_500));
```

再验证 READY 后确认、150 ms 音频淡出、`Escape` 不调用 `preventDefault()`、完成时先 `data-transition=closing`，再调用一次 `api.completePresentation()`，最后才隐藏 boot 并显示 workbench。

- [ ] **步骤 2：运行测试确认旧 interval 控制器失败**

运行：`node --test tests/boot-runtime.test.cjs tests/boot-state.test.cjs`  
预期：FAIL，旧控制器没有 `data-stage`、CSS scan 变量或 `completePresentation()`。

- [ ] **步骤 3：重构 `createBootController` 的展示部分**

保留现有 `normalizeReadiness`、串行 health polling、retry generation、completion revalidation 和 `nextBootState`。删除 80 ms 增量 ticker、旧 scene cue 播放与三个 scene 背景切换；新增：

```js
const audioClock = createAudioClock({
  audio: decodedTrack,
  startSeconds: privateTheme.audioStartMs / 1000,
  endSeconds: privateTheme.audioEndMs / 1000,
  onTick: elapsedMs => {
    const snapshot = sampleTimeline(elapsedMs, {authorized: state.confirmed, reducedMotion});
    document.body.dataset.stage = snapshot.stage;
    bootCanvas.render(snapshot);
    renderAccessibleState(snapshot);
  }
});
```

当 tick 首次到达 15500 ms 且尚未授权时，控制器必须立即调用一次 `audioClock.pause()`；重复 health poll 和 render 不得重复 pause。确认成功后调用一次 `audioClock.resume()`。这条暂停/恢复行为分别由 fake clock 的调用次数断言覆盖。

如果 `/private/theme.json` 返回 404，使用公共模式 `{audio: null, audioStartMs: 0, audioEndMs: 20500}`，由静音时钟驱动。私人 mark 和 portrait URL 只从固定 private config 字段选择，不接受任意 URL。

- [ ] **步骤 4：实现跳过和完成顺序**

`skipPresentation()` 依次调用 `audioClock.fadeOut(150)`、`audioClock.seek(15500)` 并 dispatch `skip`，但不中止 health polling。确认后 `audioClock.resume()` 从 connect 音频段继续时间轴；完成 revalidation 通过后：

1. 设置 `data-transition="closing"`。
2. 等待 180 ms。
3. `await api.completePresentation()`。
4. 隐藏 boot、显示 workbench、设置 `phase=complete`。
5. 清除 curtain，继续 shell health polling。

- [ ] **步骤 5：验证控制器回归**

运行：`node --test tests/boot-runtime.test.cjs tests/boot-state.test.cjs`  
预期：全部 PASS；既有断连、重试、stale poll、destroy 和 live-region 测试仍通过。

- [ ] **步骤 6：提交控制器接线**

```bash
git add renderer/boot/boot.js tests/boot-runtime.test.cjs tests/boot-state.test.cjs
git commit -m "feat: drive boot presentation from audio timeline"
```

## 任务 8：私人音轨准备、绫波丽工作台和构建验证

**文件：**
- 创建：`scripts/prepare-private-audio.cjs`
- 修改：`package.json`
- 修改：`renderer/workbench/themes.js`
- 修改：`renderer/workbench/workbench.css`
- 修改：`tests/private-pack.test.cjs`
- 修改：`tests/e2e/private-packaged-smoke.test.cjs`
- 修改：`docs/private-themes.md`

- [ ] **步骤 1：编写音频准备脚本参数测试**

脚本只接受：

```text
node scripts/prepare-private-audio.cjs --input <absolute mp4> --output <absolute m4a>
```

测试注入 `execFile`，断言调用：

```js
execFile('/usr/bin/afconvert', [input, output, '-f', 'm4af', '-d', 'aac', '-b', '128000'])
```

输入/输出必须为绝对路径、输入为 regular file、输出父目录为非 symlink directory；日志只打印 `PRIVATE_AUDIO_READY`、字节数、时长和 SHA-256，不打印任一路径。

- [ ] **步骤 2：运行脚本测试确认缺少模块**

运行：`node --test tests/private-pack.test.cjs`  
预期：FAIL，无法加载 `prepare-private-audio.cjs`。

- [ ] **步骤 3：实现脚本并增加 npm 命令**

```json
"prepare:private-audio": "node scripts/prepare-private-audio.cjs"
```

脚本运行后重新以 `O_NOFOLLOW` 打开输出、限制 32 MiB、计算 SHA-256，并用稳定错误 `PRIVATE_AUDIO_PREP_FAILED` 失败。

- [ ] **步骤 4：让工作台使用私人 portrait 而不遮挡功能**

私人 config 存在时设置：

```css
--theme-workbench-portrait: url("/private/rei-portrait.webp");
```

`.workbench-portrait` 固定在主内容右侧底部，最大宽度 `min(34vw, 520px)`，透明度不高于 `.38`，`pointer-events:none`，对话、终端和设置面板始终在更高层。公共模式继续使用当前原创场景，不显示私人 portrait。

- [ ] **步骤 5：验证私人包包含且公开包排除素材**

`private-packaged-smoke` 必须断言 private ASAR 内三项资源摘要匹配 fixture，公开 ASAR 中对应路径不存在，私人标题存在，启动配置不含源路径。运行：

`node --test tests/private-pack.test.cjs tests/e2e/private-packaged-smoke.test.cjs`  
预期：全部 PASS。

- [ ] **步骤 6：提交私人构建支持**

```bash
git add scripts/prepare-private-audio.cjs package.json renderer/workbench/themes.js renderer/workbench/workbench.css tests/private-pack.test.cjs tests/e2e/private-packaged-smoke.test.cjs docs/private-themes.md
git commit -m "feat: package the private Rei boot experience"
```

## 任务 9：关键帧、完整播放和跳过 E2E

**文件：**
- 创建：`tests/e2e/boot-visual.test.cjs`
- 修改：`tests/e2e/boot.test.cjs`
- 修改：`tests/e2e/packaged-smoke.test.cjs`
- 修改：`docs/testing-and-packaging.md`

- [ ] **步骤 1：先写失败的视觉与窗口 E2E**

使用 Playwright `page.emulateMedia({reducedMotion:'reduce'})` 和测试时钟钩子，在以下时间采样：`0, 1500, 3500, 5500, 8500, 10500, 12500, 15500` ms。每个采样断言 stage、progress、active node 数、canvas 调试快照中的 scan position/icon states/heading key；对 1440×900 与 1280×800 视口截图到测试临时目录。

人工视觉验收同时打开主 EVA 参考的对应规范化裁剪，逐项核对图标、mark、节点、标签、颜色、圆环、扫描层、认证卡和音效点。次要假面骑士参考只核对节点级联、认证闪屏、进度联动和连续交接，不核对其品牌视觉。

完整播放用例必须断言窗口启动为 fullscreen，确认完成后退出 fullscreen；跳过用例分别点击按钮和按 `Escape`，验证到 99.2%、音频暂停、真实 READY 后可确认。

- [ ] **步骤 2：运行 E2E 并确认新验收失败**

运行：`node --test --test-concurrency=1 tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs`  
预期：至少一个 FAIL，指出缺少测试时钟钩子、关键帧属性或窗口状态。

- [ ] **步骤 3：只在显式测试桥中暴露确定性时钟**

沿用现有 `NODE_ENV=test` 且非 packaged production 的保护条件。测试桥只允许设置 presentation elapsed ms 和读取 window mode；生产包遇到同名环境变量仍拒绝注入。不得把任意执行函数或文件路径暴露给 renderer。

- [ ] **步骤 4：完成关键帧与 E2E 验收**

运行：

```bash
node --test --test-concurrency=1 tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs tests/e2e/packaged-smoke.test.cjs
```

预期：全部 PASS；截图尺寸精确，`scrollWidth === innerWidth`、`scrollHeight === innerHeight`，远程资源列表为空，关闭后 listener 与子进程均消失。

- [ ] **步骤 5：提交 E2E 验收**

```bash
git add tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs tests/e2e/packaged-smoke.test.cjs docs/testing-and-packaging.md
git commit -m "test: verify the reference boot experience end to end"
```

## 任务 10：实机私人素材、完整验证、安装和公开发布

**文件：**
- 修改（不跟踪）：`private-themes/rei/package/*`
- 修改：`docs/workflow.md`
- 修改：`README.md`

- [ ] **步骤 1：准备本机私人音轨**

运行：

```bash
npm run prepare:private-audio -- --input "/absolute/path/to/609_1794013039.mp4" --output "/absolute/path/to/private-themes/rei/package/startup-reference.m4a"
```

预期：只输出 `PRIVATE_AUDIO_READY`、媒体摘要和 SHA-256；随后用 `afinfo` 确认 AAC、44.1 kHz、单声道、约 28.055 秒。私人 `theme.json` 设置 `audioStartMs: 2000`、`audioEndMs: 22500`，播放段长度 20.5 秒。

- [ ] **步骤 2：更新私人摘要并确认 Git 不可见**

计算 mark、portrait、soundtrack 和三张 scene 的 SHA-256，更新私人 `assets.json`。运行：

```bash
git status --short --ignored private-themes dist-private
git ls-files private-themes dist-private
```

预期：私人目录显示 `!!`，`git ls-files` 无输出。

- [ ] **步骤 3：运行完整代码验证**

运行：

```bash
npm run verify
npm run licenses:check
npm audit --audit-level=high
```

预期：lint 0 errors，全部单元测试 PASS，资产许可检查 PASS，high/critical 漏洞为 0。

- [ ] **步骤 4：运行公开与私人完整打包 E2E**

运行：

```bash
npm run test:e2e
npm run pack:private -- --theme private-themes/rei/package
```

预期：全部公开/私人 E2E PASS，`dist-private/mac-arm64/PROJECT ZERO — PILOT CODEX WORKBENCH.app` 存在，public ASAR 不含私人资源，private ASAR 的三项新增摘要匹配。

- [ ] **步骤 5：可恢复安装并完成两次实机验收**

先确认旧应用进程已退出。把 `/Users/harrisonrio/Applications/PROJECT ZERO — REI PRIVATE THEME.app` 移到带时间戳的废纸篓备份，再复制新 app 到原路径。启动后完成：

1. 一次不跳过的完整 20.5 秒演出，检查声音、扫描、99.2%、确认、100%、退出全屏和工作台 READY。
2. 一次重新启动并按 `Escape` 跳过，检查 150 ms 淡出、99.2% 门和工作台 READY。

若任一失败，退出新版并恢复废纸篓备份；不删除备份。

- [ ] **步骤 6：更新公开文档并提交**

`README.md` 和 `docs/workflow.md` 明确：公开仓库只含引擎和自由占位素材；用户必须自行提供有权使用的私人素材；给出私人构建、验证、安装和恢复命令。

```bash
git add README.md docs/workflow.md
git commit -m "docs: publish the high-fidelity boot workflow"
```

- [ ] **步骤 7：独立代码复核**

使用 requesting-code-review 检查：时间轴门控、媒体清理、路由认证、全屏失败回退、私人 staging 清理和公开树泄漏。Critical/Important 必须为 0；修复后重新运行受影响测试与 `npm run verify`。

- [ ] **步骤 8：安全推送公开快照**

先 `git fetch origin main`，确认远端没有未合入更新。以当前已验证树创建一个以 `origin/main` 为父提交的公开快照并普通 fast-forward push；push 前运行：

```bash
git ls-files | rg '^(private-themes|dist-private|\.private-build|\.superpowers)' && exit 1 || true
```

预期：无匹配；推送后 `git ls-remote origin refs/heads/main` 等于新公开提交。

## 完成定义

- 五段启动时间轴、参考原声、全屏演出、跳过、99.2% 门、驾驶员确认和工作台切换全部通过自动化与实机验证。
- 完整播放和跳过后均返回 exact `{ready:true, code:"READY"}`，工作台可以发送 Codex turn 并打开终端。
- 应用关闭后不残留 loopback listener、音频、终端或 Codex 子进程，再次启动不出现 `startup failed`。
- 私人 mark、Rei portrait、参考 soundtrack、绝对源路径和私人主题标识不出现在 Git tracked tree、公开 ASAR、日志或 GitHub。
- 旧安装保留在废纸篓备份，出现验收失败时可恢复。
