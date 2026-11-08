# PROJECT ZERO 公开 PILOT 与私人本地主题实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将公开发行版改为原创 `PILOT-00 / VOIDGLASS` 匿名驾驶员主题，同时把现有 Rei 灵感素材隔离到 Git 忽略的本地目录，并提供不污染公开源码的私人主题打包流程。

**架构：** 公共 `pack` 继续只构建仓库内的 PILOT 主题。私人主题使用严格 manifest 合同验证后复制到隔离 staging 树，再由固定的本地 Electron Builder 生成 `dist-private/`；整个过程不修改 tracked 公共素材。最终公开 `main` 从安全工作树创建单一干净提交，避免把功能分支中曾出现的私人图片历史推送到 GitHub。

**技术栈：** Electron 45、Node.js 26 CommonJS、electron-builder 26、Node test runner、Playwright、内置 image generation、macOS `sips`、cwebp 1.3.2+、SHA-256。

---

## 文件结构

**新增：**

- `scripts/theme-contract.cjs`：解析并 fail-closed 验证本地主题 manifest、固定文件、普通文件边界和 SHA-256。
- `scripts/pack-private-theme.cjs`：创建隔离 staging、叠加已验证主题、生成独立私人产物并清理 staging。
- `scripts/render-theme-webp.sh`：使用固定 cwebp 版本下限和编码参数复现公共 WebP 运行时素材。
- `tests/theme-contract.test.cjs`：纯函数与文件系统边界测试。
- `tests/private-pack.test.cjs`：staging、输出隔离、清理和 builder 调用测试。
- `tests/fixtures/private-theme-valid/`：只含合成测试素材，不含 Rei 或私人图片。
- `docs/private-themes.md`：用户可复现的私人主题目录、校验、构建和未签名说明。
- `README.md`：公开 PILOT 产品说明、安装/开发/验证和非官方边界。

**修改：**

- `.gitignore`：忽略 `private-themes/`、`.private-build/` 和 `dist-private/`。
- `package.json`、`package-lock.json`：PILOT 包名/产品名、`pack:private` 脚本和公开构建文件边界。
- `workbench/bridge.cjs`：官方 app-server 客户端身份改为 PILOT 产品名。
- `renderer/boot/index.html`：公开标题、壳标题和辅助文本去 REI 化。
- `renderer/boot/assets/*.webp`：替换为三个 VOIDGLASS 公共运行时场景。
- `assets/themes/project-zero/source/*.png`：替换为三个 VOIDGLASS 公共 16:9 master。
- `assets/themes/project-zero/assets.json`：新 hash、尺寸、prompt、匿名驾驶员 provenance。
- `assets/themes/project-zero/ASSET-LICENSE.md`：只描述原创匿名航天驾驶员和权利边界。
- `NOTICE.md`：公开 PILOT 身份、非官方与无第三方视觉素材说明。
- `tests/foundation.test.cjs`、`tests/renderer-assets.test.cjs`、`tests/package-scripts.test.cjs`、`tests/e2e/*.test.cjs`：更新身份与公共/私人隔离断言。
- 删除已被新规格取代的 `docs/superpowers/specs/2026-11-07-project-zero-rei-codex-workbench-design.md`、`docs/superpowers/plans/2026-11-07-rei-mark-core-silhouette.md` 和 `docs/superpowers/plans/2026-11-07-three-scene-rei-art.md`；更新 Phase 1/3/4 计划中的当前产品名和公共主题边界。

**仅本地、绝不提交：**

- `private-themes/rei/source/*.png`：当前三张 PNG master。
- `private-themes/rei/package/theme.json`、三个 WebP、`assets.json`、`ASSET-LICENSE.md`：私人本地打包输入。

---

### 任务 1：先保存私人主题并锁定 Git 隔离边界

**文件：**
- 修改：`.gitignore`
- 修改：`tests/foundation.test.cjs`
- 本地创建（ignored）：`private-themes/rei/source/*`
- 本地创建（ignored）：`private-themes/rei/package/*`

- [ ] **步骤 1：编写失败测试**

在 `tests/foundation.test.cjs` 增加：

```js
test('private themes and private build outputs are excluded from Git', async () => {
  const ignore = await fs.readFile(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(ignore, /^\/private-themes\/$/m);
  assert.match(ignore, /^\/\.private-build\/$/m);
  assert.match(ignore, /^\/dist-private\/$/m);
});
```

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/foundation.test.cjs`  
预期：FAIL，缺少三个精确 ignore 规则。

- [ ] **步骤 3：复制私人素材，禁止修改或删除原文件**

```bash
mkdir -p private-themes/rei/source private-themes/rei/package
cp assets/themes/project-zero/source/*.png private-themes/rei/source/
cp renderer/boot/assets/*.webp private-themes/rei/package/
cp assets/themes/project-zero/assets.json private-themes/rei/package/assets.json
cp assets/themes/project-zero/ASSET-LICENSE.md private-themes/rei/package/ASSET-LICENSE.md
```

用 `apply_patch` 创建 ignored `private-themes/rei/package/theme.json`：

```json
{
  "schemaVersion": 1,
  "id": "rei-private",
  "displayName": "PROJECT ZERO // REI PRIVATE THEME",
  "scenes": {
    "awakening": "scene-b-awakening.webp",
    "synchronization": "scene-a-sync.webp",
    "online": "scene-c-online.webp"
  },
  "assetManifest": "assets.json",
  "artNotice": "ASSET-LICENSE.md"
}
```

把 ignored `assets.json` 收敛为私人合同的精确 schema：顶层只允许
`schemaVersion: 1` 和 `assets`；`assets` 精确包含三个对象，每个对象只允许
`file` 与 `sha256`。先执行 `shasum -a 256 private-themes/rei/package/*.webp`，再用
`apply_patch` 把三个实际 lowercase SHA-256 和对应 basename 写入 JSON，不使用示例值。
把 ignored notice 标为“非官方、私人本地使用、不提供第三方角色/商标权利或商业使用保证”。

- [ ] **步骤 4：实现 ignore 并验证私人文件未被跟踪**

在 `.gitignore` 添加：

```gitignore
/private-themes/
/.private-build/
/dist-private/
```

运行：

```bash
node --test tests/foundation.test.cjs
git check-ignore -v private-themes/rei/package/theme.json
git status --short
shasum -a 256 private-themes/rei/package/*.webp
```

预期：测试 PASS；`git check-ignore` 命中；`git status` 不显示任何私人素材。

- [ ] **步骤 5：Commit**

```bash
git add .gitignore tests/foundation.test.cjs
git commit -m "chore: isolate private local themes"
```

---

### 任务 2：公开产品身份去 REI 化

**文件：**
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`workbench/bridge.cjs`
- 修改：`renderer/boot/index.html`
- 修改：`NOTICE.md`
- 修改：`tests/foundation.test.cjs`
- 修改：`tests/renderer-assets.test.cjs`
- 修改：`tests/fake-codex.test.cjs`
- 删除：`docs/superpowers/specs/2026-11-07-project-zero-rei-codex-workbench-design.md`
- 删除：`docs/superpowers/plans/2026-11-07-rei-mark-core-silhouette.md`
- 删除：`docs/superpowers/plans/2026-11-07-three-scene-rei-art.md`
- 修改：`docs/superpowers/plans/2026-11-07-phase-1-electron-codex-foundation.md`
- 修改：`docs/superpowers/plans/2026-11-07-phase-3-tools-and-themes.md`
- 修改：`docs/superpowers/plans/2026-11-07-phase-4-release-and-documentation.md`

- [ ] **步骤 1：编写身份红灯测试**

在 `tests/foundation.test.cjs` 增加：

```js
test('public product identity is PILOT and contains no REI product branding', async () => {
  assert.equal(pkg.name, 'project-zero-pilot-codex-workbench');
  assert.equal(pkg.build.productName, 'PROJECT ZERO — PILOT CODEX WORKBENCH');
  const publicRuntime = await Promise.all([
    'package.json', 'NOTICE.md', 'workbench/bridge.cjs', 'renderer/boot/index.html'
  ].map(file => fs.readFile(path.join(__dirname, '..', file), 'utf8')));
  assert.doesNotMatch(publicRuntime.join('\n'), /\bREI\b|绫波丽|EVANGELION|\bNERV\b/iu);
});
```

在 `tests/renderer-assets.test.cjs` 把标题断言改为：

```js
assert.match(html, /<title>PROJECT ZERO \/\/ PILOT CODEX WORKBENCH<\/title>/);
assert.match(html, /PROJECT ZERO <span>\/\/<\/span> PILOT CODEX WORKBENCH/);
```

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/foundation.test.cjs tests/renderer-assets.test.cjs tests/fake-codex.test.cjs`  
预期：FAIL，当前 package、HTML、NOTICE 和 bridge 仍含 REI 产品名。

- [ ] **步骤 3：做最小身份替换**

采用精确值：

```json
{
  "name": "project-zero-pilot-codex-workbench",
  "build": {
    "productName": "PROJECT ZERO — PILOT CODEX WORKBENCH"
  }
}
```

`workbench/bridge.cjs` initialize clientInfo 使用：

```js
name: 'project-zero-pilot-codex-workbench',
title: 'PROJECT ZERO — PILOT CODEX WORKBENCH'
```

`renderer/boot/index.html` 的 `<title>`、启动主标题和 shell 标题统一为 `PILOT CODEX WORKBENCH`。`NOTICE.md` 只描述非官方 PROJECT ZERO PILOT 工具，不把 REI/EVA/NERV 作为公开产品身份。

用 `npm install --package-lock-only --ignore-scripts` 同步 lockfile 顶层包名，不升级依赖。

- [ ] **步骤 4：处理过时文档**

删除文件清单中列出的三个已取代文档。Phase 1/3/4 计划首段标明公共主题和命名已被
`2026-11-08-public-pilot-private-rei-theme-design.md` 覆盖，并把当前产品名改成 PILOT；
Phase 3 可以说明私人本地主题机制，但不得把 REI 写成公开产品名。

- [ ] **步骤 5：运行绿灯与扫描**

```bash
node --test tests/foundation.test.cjs tests/renderer-assets.test.cjs tests/fake-codex.test.cjs
rg -n "PROJECT ZERO.*REI|project-zero-rei|REI CODEX" package.json package-lock.json app workbench renderer NOTICE.md tests
git diff --check
```

预期：测试 PASS；`rg` 无当前公开身份命中。

- [ ] **步骤 6：Commit**

```bash
git add package.json package-lock.json workbench/bridge.cjs renderer/boot/index.html NOTICE.md tests docs
git commit -m "refactor: publish the anonymous PILOT identity"
```

---

### 任务 3：生成并验收 VOIDGLASS 三场景公开艺术

**文件：**
- 修改：`assets/themes/project-zero/source/scene-a-sync.png`
- 修改：`assets/themes/project-zero/source/scene-b-awakening.png`
- 修改：`assets/themes/project-zero/source/scene-c-online.png`
- 修改：`renderer/boot/assets/scene-a-sync.webp`
- 修改：`renderer/boot/assets/scene-b-awakening.webp`
- 修改：`renderer/boot/assets/scene-c-online.webp`
- 修改：`assets/themes/project-zero/assets.json`
- 修改：`assets/themes/project-zero/ASSET-LICENSE.md`
- 修改：`tests/package-scripts.test.cjs`
- 修改：`tests/renderer-assets.test.cjs`

- [ ] **步骤 1：先写公共素材合同红灯**

把 `tests/package-scripts.test.cjs` 的 manifest 断言扩展为：

```js
assert.equal(manifest.themeId, 'voidglass-pilot');
assert.equal(manifest.subject, 'PILOT-00 / VOIDGLASS');
assert.doesNotMatch(JSON.stringify(manifest), /\bREI\b|绫波丽|EVANGELION|\bNERV\b/iu);
for (const asset of manifest.assets) {
  assert.match(asset.promptSummary, /sealed graphite helmet/i);
  assert.match(asset.promptSummary, /opaque black visor/i);
  assert.match(asset.promptSummary, /no visible face, hair, eyes, text, logo, or watermark/i);
}
```

运行：`node --test tests/package-scripts.test.cjs tests/renderer-assets.test.cjs`  
预期：FAIL，旧 manifest 仍描述现有角色视觉。

- [ ] **步骤 2：用内置 image generation 分别生成三张全新图**

不传任何现有图片作为 reference 或 edit target。每个场景独立调用一次，保持以下共享约束：

```text
Use case: stylized-concept
Asset type: 16:9 desktop boot-sequence background
Subject: the same anonymous adult aerospace pilot, side-profile half-body, fully sealed graphite helmet, completely opaque black visor, one narrow cyan life-status line, cold-grey segmented neck ring, layered graphite shoulder armour, restrained orange mechanical locks
Style: polished semi-realistic science-fiction concept illustration, credible industrial construction, cinematic restrained lighting, slightly animation-influenced proportions
Constraints: preserve generous negative space for UI; no visible face, hair, eyes, skin, white skin-tight suit, amber immersion liquid, text, letters, numbers, logos, insignia, watermark, EVA, NERV, or recognizable third-party character design
```

场景差异：

- B：冷白维护舱，驾驶员置右，青色状态线刚亮，左侧留标题区。
- A：冰蓝同步舱，驾驶员置右面向左，黑玻璃面罩只反射原创橙色圆环，中央/左侧留 99.2% 和按钮区。
- C：深色航天驾驶舱，驾驶员位于右下，青线稳定，中央/左侧留 SYSTEM ONLINE 区；不得出现液体舱。

- [ ] **步骤 3：逐张人工检查并让用户批准**

用 `view_image` 检查原图：同一头盔几何、同一肩甲、同一青线/橙锁扣、主体位置、负空间、无文字/水印/可见面部。把三张图展示给用户。未经用户明确“确认”不得替换 tracked master。

- [ ] **步骤 4：生成 16:9 master 和 WebP**

将批准的 1672×941 生成结果复制到安全临时文件，使用 `sips` 居中裁切到
1664×936（每边约 4 px、上下约 2–3 px），人工复查没有实质裁掉头盔或关键肩甲，
再正规化为 1536×864 master PNG：

```bash
sips --cropToHeightWidth 936 1664 approved-scene-a.png --out cropped-scene-a.png
sips --resampleHeightWidth 864 1536 cropped-scene-a.png --out assets/themes/project-zero/source/scene-a-sync.png
# 对 B/C 重复相同的安全裁切与正规化步骤。
```

WebP 不使用在当前 macOS 上写入失败的 `sips -s format webp` 路径。安装
cwebp 1.3.2 或更新版本（缺失时运行 `brew install webp`），再用仓库脚本固定
`-q 90 -metadata none` 和三个输入/输出 basename：

```bash
scripts/render-theme-webp.sh
```

- [ ] **步骤 5：更新 provenance、hash 和公开 notice**

`assets.json` 添加：

```json
{
  "schemaVersion": 1,
  "themeId": "voidglass-pilot",
  "subject": "PILOT-00 / VOIDGLASS",
  "license": "CC BY 4.0",
  "attribution": "PROJECT ZERO contributors"
}
```

每个 scene 记录实际尺寸、PNG/WebP SHA-256、完整 promptSummary、built-in generation method 和 PNG→WebP adaptation。`ASSET-LICENSE.md` 只描述原创匿名航天驾驶员；删除蓝发、红眼、白色驾驶服、琥珀液体和 fan-character 语言，同时保留“只许可贡献者实际拥有的表达、非第三方权利清理”的准确边界。

- [ ] **步骤 6：验证与 Commit**

```bash
node --test tests/package-scripts.test.cjs tests/renderer-assets.test.cjs
shasum -a 256 assets/themes/project-zero/source/*.png renderer/boot/assets/*.webp
git diff --check
git add assets/themes/project-zero renderer/boot/assets tests/package-scripts.test.cjs tests/renderer-assets.test.cjs
git commit -m "feat: add the original VOIDGLASS pilot scenes"
```

---

### 任务 4：实现严格本地主题合同

**文件：**
- 创建：`scripts/theme-contract.cjs`
- 创建：`tests/theme-contract.test.cjs`
- 创建：`tests/fixtures/private-theme-valid/*`

- [ ] **步骤 1：建立合成 fixture**

fixture 必须使用无版权含义的小型合成 WebP 或测试字节，不得复制私人素材。`theme.json` 固定 schema：

```json
{
  "schemaVersion": 1,
  "id": "test-private",
  "displayName": "PROJECT ZERO // TEST PRIVATE THEME",
  "scenes": {
    "awakening": "scene-b-awakening.webp",
    "synchronization": "scene-a-sync.webp",
    "online": "scene-c-online.webp"
  },
  "assetManifest": "assets.json",
  "artNotice": "ASSET-LICENSE.md"
}
```

- [ ] **步骤 2：编写失败测试**

`tests/theme-contract.test.cjs` 至少覆盖：有效目录；missing/extra 文件；任一 symlink；目录替代文件；manifest 额外字段；非法 displayName；basename/path escape；重复 scene 文件；超过尺寸上限；hash 不匹配；assets.json 未一一覆盖三个 WebP。

测试接口：

```js
const {validateThemeDirectory, ThemeValidationError} = require('../scripts/theme-contract.cjs');

await assert.rejects(
  validateThemeDirectory(themeRoot),
  error => error instanceof ThemeValidationError && error.code === 'THEME_SYMLINK'
);
```

- [ ] **步骤 3：运行红灯**

运行：`node --test tests/theme-contract.test.cjs`  
预期：FAIL，模块不存在。

- [ ] **步骤 4：实现最小合同**

`scripts/theme-contract.cjs` 导出：

```js
const crypto = require('node:crypto');
const defaultFs = require('node:fs/promises');
const path = require('node:path');

const SCENE_FILES = Object.freeze([
  'scene-a-sync.webp',
  'scene-b-awakening.webp',
  'scene-c-online.webp'
]);
const REQUIRED_FILES = Object.freeze([
  'ASSET-LICENSE.md', 'assets.json', ...SCENE_FILES, 'theme.json'
].sort());

class ThemeValidationError extends Error {
  constructor(code, file = null) {
    super(file ? `${code}: ${file}` : code);
    this.name = 'ThemeValidationError';
    this.code = code;
    this.file = file;
  }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function readBoundedRegularFile(root, file, limit, fsModule) {
  const target = path.join(root, file);
  const stat = await fsModule.lstat(target).catch(() => null);
  if (!stat) throw new ThemeValidationError('THEME_FILE_SET', file);
  if (stat.isSymbolicLink()) throw new ThemeValidationError('THEME_SYMLINK', file);
  if (!stat.isFile()) throw new ThemeValidationError('THEME_FILE_TYPE', file);
  if (stat.size > limit) throw new ThemeValidationError('THEME_SIZE', file);
  return fsModule.readFile(target);
}

async function validateThemeDirectory(themeRoot, {
  fsModule = defaultFs,
  maxWebpBytes = 12 * 1024 * 1024,
  maxTextBytes = 256 * 1024
} = {}) {
  const rootStat = await fsModule.lstat(themeRoot).catch(() => null);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ThemeValidationError('THEME_ROOT');
  }
  const root = await fsModule.realpath(themeRoot);
  const entries = (await fsModule.readdir(root)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(REQUIRED_FILES)) {
    throw new ThemeValidationError('THEME_FILE_SET');
  }

  const themeBytes = await readBoundedRegularFile(root, 'theme.json', maxTextBytes, fsModule);
  const assetBytes = await readBoundedRegularFile(root, 'assets.json', maxTextBytes, fsModule);
  const noticeBytes = await readBoundedRegularFile(root, 'ASSET-LICENSE.md', maxTextBytes, fsModule);
  let theme;
  let assetManifest;
  try {
    theme = JSON.parse(themeBytes);
    assetManifest = JSON.parse(assetBytes);
  } catch {
    throw new ThemeValidationError('THEME_JSON');
  }

  if (!exactKeys(theme, ['schemaVersion', 'id', 'displayName', 'scenes', 'assetManifest', 'artNotice']) ||
      theme.schemaVersion !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(theme.id) ||
      typeof theme.displayName !== 'string' || theme.displayName.length < 1 ||
      theme.displayName.length > 96 || /[\r\n\0]/.test(theme.displayName) ||
      theme.assetManifest !== 'assets.json' || theme.artNotice !== 'ASSET-LICENSE.md' ||
      !exactKeys(theme.scenes, ['awakening', 'synchronization', 'online'])) {
    throw new ThemeValidationError('THEME_SCHEMA');
  }
  const selected = Object.values(theme.scenes);
  if (new Set(selected).size !== 3 ||
      selected.some(file => path.basename(file) !== file || !SCENE_FILES.includes(file))) {
    throw new ThemeValidationError('THEME_PATH');
  }
  if (!exactKeys(assetManifest, ['schemaVersion', 'assets']) ||
      assetManifest.schemaVersion !== 1 || !Array.isArray(assetManifest.assets) ||
      assetManifest.assets.length !== 3) {
    throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
  }

  const hashes = new Map();
  const contents = new Map([
    ['theme.json', Buffer.from(themeBytes)],
    ['assets.json', Buffer.from(assetBytes)],
    ['ASSET-LICENSE.md', Buffer.from(noticeBytes)]
  ]);
  for (const file of SCENE_FILES) {
    const bytes = await readBoundedRegularFile(root, file, maxWebpBytes, fsModule);
    hashes.set(file, crypto.createHash('sha256').update(bytes).digest('hex'));
    contents.set(file, Buffer.from(bytes));
  }
  for (const asset of assetManifest.assets) {
    if (!exactKeys(asset, ['file', 'sha256']) || !SCENE_FILES.includes(asset.file) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
    }
    if (hashes.get(asset.file) !== asset.sha256) {
      throw new ThemeValidationError('THEME_HASH', asset.file);
    }
  }
  if (new Set(assetManifest.assets.map(asset => asset.file)).size !== 3) {
    throw new ThemeValidationError('THEME_SCHEMA', 'assets.json');
  }
  return Object.freeze({
    root,
    id: theme.id,
    displayName: theme.displayName,
    scenes: Object.freeze({...theme.scenes}),
    files: Object.freeze([...REQUIRED_FILES]),
    contents
  });
}

module.exports = {ThemeValidationError, validateThemeDirectory};
```

稳定错误码只允许：`THEME_ROOT`、`THEME_FILE_SET`、`THEME_SYMLINK`、`THEME_FILE_TYPE`、`THEME_SIZE`、`THEME_JSON`、`THEME_SCHEMA`、`THEME_PATH`、`THEME_HASH`。不得把绝对路径或 manifest payload 放入 error message。

- [ ] **步骤 5：运行绿灯与 Commit**

```bash
node --test tests/theme-contract.test.cjs
git diff --check
git add scripts/theme-contract.cjs tests/theme-contract.test.cjs tests/fixtures/private-theme-valid
git commit -m "feat: validate local theme packages"
```

---

### 任务 5：在隔离 staging 中打包私人主题

**文件：**
- 创建：`scripts/pack-private-theme.cjs`
- 创建：`tests/private-pack.test.cjs`
- 修改：`scripts/pack.cjs`
- 修改：`package.json`
- 修改：`tests/package-scripts.test.cjs`

- [ ] **步骤 1：编写失败测试**

覆盖：没有显式 `--theme` 时失败；先验证再建 staging；只复制固定项目入口；替换 staging 内三张 WebP、manifest、notice 和精确显示名；验证完成后即使源主题文件被替换也只写入 validator 返回的已校验 bytes；tracked 文件 hash 前后不变；清理旧 `dist-private`；builder 不经 shell；测试环境变量被剥离；成功/失败都删除 staging；public `pack` 完全不读取 theme；输出目录不等于 `dist`。

核心断言示例：

```js
assert.deepEqual(builderCall.arguments, ['--dir']);
assert.equal(builderCall.projectRoot.startsWith(path.join(projectRoot, '.private-build')), true);
assert.equal(builderCall.environment.PROJECT_ZERO_LOCAL_THEME_DIR, undefined);
assert.equal(await hashPublicAssets(projectRoot), publicHashesBefore);
```

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/private-pack.test.cjs tests/package-scripts.test.cjs`  
预期：FAIL，私人 packer 和脚本不存在。

- [ ] **步骤 3：把通用 builder runner 保持无 shell**

从 `scripts/pack.cjs` 导出 `runElectronBuilder`，维持：

```js
spawn(process.execPath, [cli, ...builderArguments], {
  cwd: projectRoot,
  env: productionEnvironment(environment),
  stdio: 'inherit'
});
```

不拼接 shell 字符串，不从 theme manifest 接受 builder 参数。

- [ ] **步骤 4：实现 staging packer**

`scripts/pack-private-theme.cjs` 导出：

```js
const defaultFs = require('node:fs/promises');
const path = require('node:path');
const {runElectronBuilder} = require('./pack.cjs');
const {validateThemeDirectory} = require('./theme-contract.cjs');

const PROJECT_ENTRIES = Object.freeze([
  'app', 'assets', 'LICENSE', 'NOTICE.md', 'package.json',
  'renderer', 'THIRD_PARTY_NOTICES.md', 'workbench'
]);
const PUBLIC_LABEL = 'PROJECT ZERO // PILOT CODEX WORKBENCH';

async function packPrivateTheme({
  projectRoot,
  themeRoot,
  environment = process.env,
  validateTheme = validateThemeDirectory,
  runBuilder = runElectronBuilder,
  fsModule = defaultFs
}) {
  const theme = await validateTheme(themeRoot);
  const stageParent = path.join(projectRoot, '.private-build');
  const privateOutput = path.join(projectRoot, 'dist-private');
  await fsModule.mkdir(stageParent, {recursive: true});
  const stageRoot = await fsModule.mkdtemp(path.join(stageParent, 'stage-'));
  try {
    for (const entry of PROJECT_ENTRIES) {
      await fsModule.cp(path.join(projectRoot, entry), path.join(stageRoot, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
        verbatimSymlinks: true
      });
    }
    const stagedRuntime = path.join(stageRoot, 'renderer', 'boot', 'assets');
    for (const file of Object.values(theme.scenes)) {
      await fsModule.writeFile(path.join(stagedRuntime, file), theme.contents.get(file));
    }
    await fsModule.writeFile(
      path.join(stageRoot, 'assets', 'themes', 'project-zero', 'assets.json'),
      theme.contents.get('assets.json')
    );
    await fsModule.writeFile(
      path.join(stageRoot, 'assets', 'themes', 'project-zero', 'ASSET-LICENSE.md'),
      theme.contents.get('ASSET-LICENSE.md')
    );
    const indexPath = path.join(stageRoot, 'renderer', 'boot', 'index.html');
    const index = await fsModule.readFile(indexPath, 'utf8');
    const occurrences = index.split(PUBLIC_LABEL).length - 1;
    if (occurrences < 1) throw Error('PRIVATE_THEME_PUBLIC_LABEL_MISSING');
    await fsModule.writeFile(indexPath, index.replaceAll(PUBLIC_LABEL, theme.displayName));

    const packagePath = path.join(stageRoot, 'package.json');
    const packageJson = JSON.parse(await fsModule.readFile(packagePath, 'utf8'));
    packageJson.build = {
      ...packageJson.build,
      directories: {...packageJson.build.directories, output: privateOutput}
    };
    await fsModule.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await fsModule.rm(privateOutput, {recursive: true, force: true});
    await runBuilder({
      projectRoot: stageRoot,
      environment,
      arguments: ['--dir']
    });
    return privateOutput;
  } finally {
    await fsModule.rm(stageRoot, {recursive: true, force: true});
  }
}

module.exports = {packPrivateTheme};
```

CLI 只接受：

```text
node scripts/pack-private-theme.cjs --theme /absolute/or/relative/package-dir
```

未知参数、重复 `--theme`、空路径一律使用稳定错误并退出 1。不要从隐式环境变量自动选择主题。

- [ ] **步骤 5：增加脚本**

`package.json`：

```json
"pack:private": "node scripts/pack-private-theme.cjs"
```

调用方式：`npm run pack:private -- --theme private-themes/rei/package`

- [ ] **步骤 6：运行绿灯与 Commit**

```bash
node --test tests/private-pack.test.cjs tests/package-scripts.test.cjs
npm run verify
git diff --check
git add scripts/pack.cjs scripts/pack-private-theme.cjs package.json tests/private-pack.test.cjs tests/package-scripts.test.cjs
git commit -m "feat: package validated private themes in isolation"
```

---

### 任务 6：文档、公共/私人 smoke 与产物扫描

**文件：**
- 创建：`README.md`
- 创建：`docs/private-themes.md`
- 修改：`tests/e2e/packaged-smoke.test.cjs`
- 创建：`tests/e2e/private-packaged-smoke.test.cjs`
- 修改：`tests/package-scripts.test.cjs`

- [ ] **步骤 1：编写产物红灯**

公共 smoke 要求：公开 ASAR 标题为 PILOT；只有 VOIDGLASS manifest/hash；无 `private-themes`、`REI PRIVATE THEME`、凭据、测试或用户绝对路径。

私人 smoke 使用合成 fixture 调用 staging packer，要求：单独输出目录；ASAR 包含 fixture 的精确三个 scene hash；应用内标题为 TEST PRIVATE THEME；公共 tracked asset hash 未改变；应用可启动并关闭。

- [ ] **步骤 2：运行红灯**

运行：`node --test tests/e2e/packaged-smoke.test.cjs tests/e2e/private-packaged-smoke.test.cjs`  
预期：FAIL，公共身份尚未全部更新或私人 smoke 尚不存在。

- [ ] **步骤 3：编写 README 与私人主题文档**

README 必须包含：非官方项目；PILOT-00 截图；macOS/Node/Codex 前置条件；`npm ci`、`npm run verify`、`npm run pack`；未签名/未公证首次打开说明；本地 loopback/无远程素材安全边界；代码 MIT、公共图独立许可；GitHub 不含私人角色素材。

`docs/private-themes.md` 必须包含固定目录树、manifest 字段、hash 生成命令、`pack:private` 命令、`dist-private` 输出、私人素材不应提交/上传、接收方仍会遇到 Gatekeeper、同一 Codex 账号不会自动同步应用文件。

- [ ] **步骤 4：实现 smoke 支持并运行全验证**

```bash
npm run verify
npm run test:e2e
npm run pack
npm run pack:private -- --theme tests/fixtures/private-theme-valid
git diff --check
```

预期：Node tests 全绿；public/source/private smoke 全绿；两个输出目录互不覆盖。

- [ ] **步骤 5：Commit**

```bash
git add README.md docs/private-themes.md tests/e2e tests/package-scripts.test.cjs
git commit -m "docs: publish the public and private theme workflow"
```

---

### 任务 7：私人 Rei 本机包、最终审查与干净公开历史

**文件：**
- 修改：`.superpowers/sdd/progress.md`（ignored ledger）
- 生成但不提交：`dist-private/PROJECT ZERO — PILOT CODEX WORKBENCH.app`
- GitHub：`origin/main`（仅在用户再次确认 force-with-lease 后）

- [ ] **步骤 1：构建实际私人主题**

```bash
npm run pack:private -- --theme private-themes/rei/package
```

检查私人 ASAR：三个 hash 与 ignored manifest 完全一致；显示名为 `PROJECT ZERO // REI PRIVATE THEME`；无 PNG master、凭据、测试、fixture 或绝对用户路径。启动后验证真实 Codex readiness、Skip、确认、shell 后断线恢复，再正常退出。

- [ ] **步骤 2：运行最终公共门禁**

```bash
npm run verify
npm run test:e2e
npm run pack
npm audit --json
npm audit --omit=dev --json
git diff --check
git status --short --branch
```

逐条记录 advisory 的运行时/构建时可达性。重新检查 public ASAR 文件清单、VOIDGLASS hash、凭据模式、测试后门、私人素材和产品名。

- [ ] **步骤 3：两阶段独立审查**

整分支审查只接受 0 Critical/Important。专项审查私人 packer 的路径越界、symlink、TOCTOU、staging 清理、builder 参数、错误脱敏和 tracked 文件不变性。发现 Important/Critical 时回到原任务实现者修复并复审。

- [ ] **步骤 4：请求公开历史替换确认**

远端 `origin/main` 当前是 `a225abf`，其中仍有旧 REI 设计文字；功能分支历史中还曾提交私人风格图片。不得直接 push 功能分支或普通 merge。向用户明确说明将使用 `--force-with-lease=main:a225abf...` 用单一安全快照替换远端 main，并在执行前取得明确确认。

- [ ] **步骤 5：创建干净发布仓库并验证**

```bash
release_dir=$(mktemp -d)
git archive HEAD | tar -x -C "$release_dir"
git -C "$release_dir" init -b main
git -C "$release_dir" add .
git -C "$release_dir" commit -m "feat: publish PROJECT ZERO PILOT preview"
git -C "$release_dir" remote add origin https://github.com/ChengxuanOuyang/codex-eva-workspace.git
```

在 `release_dir` 重新运行 `npm ci && npm run verify && npm run test:e2e && npm run pack`，确认 archive 没有 ignored 私人文件。记录新 commit hash。

- [ ] **步骤 6：经确认后 force-with-lease 推送**

先重新读取远端 main，必须仍等于执行确认时记录的旧 hash；不相等则停止并请求用户处理。相等时使用记录变量：

```bash
expected_remote=$(git ls-remote origin refs/heads/main | awk '{print $1}')
# 将 expected_remote 的具体值展示给用户并取得替换 main 的确认后，立即再次读取。
actual_remote=$(git ls-remote origin refs/heads/main | awk '{print $1}')
test "$actual_remote" = "$expected_remote"
git -C "$release_dir" push --force-with-lease="main:$expected_remote" origin main
```

不得推送 `feat/project-zero-workbench`，不得推送包含私人图片的 tag 或 release binary。

- [ ] **步骤 7：本机安装私人预览**

在用户确认安装目标后，把私人 `.app` 复制到 `~/Applications/PROJECT ZERO — REI PRIVATE THEME.app`，保留 `dist-private` 原件；启动一次验证。由于未签名/未公证，只提供本地首次打开指导，不修改 macOS Gatekeeper 或安全设置。

- [ ] **步骤 8：最终交付**

报告：公开 GitHub commit/URL、公开测试证据、私人本机 app 路径、私人主题备份路径、未签名限制、给女朋友复制/本机构建步骤、依赖 advisory 分类。保留功能 worktree，直到用户确认 GitHub 与本机预览均正常。
