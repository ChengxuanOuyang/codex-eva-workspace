# 私人本地主题工作流

私人主题把使用者自己有权使用的本地素材注入一个**独立**的 macOS 目录包。公开打包路径不会读取它们；`private-themes/`、`.private-build/` 和 `dist-private/` 均被 Git 忽略。请不要把私人角色素材提交到 Git、上传到 GitHub、附在 issue 或公开 release 中。

公开仓库内的 `tests/fixtures/private-theme-valid/` 只有无版权合成测试字节，不是可发布主题，也不能替代使用者对真实素材的授权确认。

## 双渲染器、作者源码与视频优先级

公开版始终以 Canvas 为默认渲染器。完整私有包通过固定文件集合和摘要校验后，运行时还需成功
解码私有音轨与标志，才会启用 reference DOM/SVG 渲染器。私有配置、媒体解码或 reference
初始化失败时使用 Canvas；reference 的 render/resize 抛错时，Canvas 从当前展示快照接管，
不重启时间轴，也不绕过 READY 门。

作者公开源码提供结构、坐标和动作算法，固定提交及逐文件改编范围见
[代码来源](code-origins.md)。`reference-timing.js` 负责参考时间点，`reference-layout.js`
生成 view-model，`reference-renderer.js` 和 `reference.css` 更新 DOM/SVG；
`renderer-director.js` 选择渲染器并负责 fallback。已有 `boot-canvas.js` 保留为公开默认和
私有故障回退。启动控制器继续独占音频时钟、99.2% 暂停、fresh READY 校验、用户确认、100%
及工作台交接；渲染器只消费冻结快照。

作者公开历史提供红黑主题，未发布浅蓝私人版本的源码。参考视频内部桌面画面的颜色、文字、
图标和时间优先于公开主题；结构和动作规则参考作者代码，真实 Codex READY 与安全边界始终
保留。手机外框、播放器和社交界面不进入产品。MIT 代码改编和 OFL 字体许可不会覆盖私有角色、
标志或参考音轨的权利。使用者必须自行确认这些素材的合法来源和使用范围。

## 固定目录结构

schema v2 主题包必须恰好包含以下九个普通文件；不接受额外文件、子目录或符号链接：

```text
private-themes/my-theme/package/
├── theme.json
├── assets.json
├── ASSET-LICENSE.md
├── scene-a-sync.webp
├── scene-b-awakening.webp
├── scene-c-online.webp
├── boot-mark.webp
├── rei-portrait.webp
└── startup-reference.m4a
```

声音也可使用固定 basename `startup-reference.wav`。图像只能是上述 WebP；声音只能是 WAV 或 M4A。每张图最大 12 MiB，声音最大 32 MiB，所选播放区间最长 30 秒。

## `theme.json`

对象只允许以下字段：

```json
{
  "schemaVersion": 2,
  "id": "my-private-theme",
  "displayName": "PROJECT ZERO // MY PRIVATE THEME",
  "scenes": {
    "awakening": "scene-b-awakening.webp",
    "synchronization": "scene-a-sync.webp",
    "online": "scene-c-online.webp"
  },
  "boot": {
    "mark": "boot-mark.webp",
    "portrait": "rei-portrait.webp",
    "soundtrack": "startup-reference.m4a",
    "audioStartMs": 2000,
    "audioEndMs": 22500
  },
  "assetManifest": "assets.json",
  "artNotice": "ASSET-LICENSE.md"
}
```

`displayName` 最长 96 个字符且不能包含换行或 NUL。三个 `scenes` 值必须各自选择一个固定 scene basename。`boot` 的 mark、portrait 和 soundtrack 也只能使用固定 basename；不能写 URL、目录或绝对路径。`audioStartMs` 和 `audioEndMs` 是声音文件内的播放边界，必须是非负安全整数，且结束时间严格大于开始时间。
本参考演出固定使用 2,000–22,500 ms（逻辑时长 20,500 ms），不可再次裁掉文件前 2 秒后仍沿用
这个偏移。逻辑时间 13,300 ms 到达 99.2% 认证门；音轨和动画共同暂停，真实 READY 与确认通过后
从同一位置恢复。参考音轨已含 BGM、系统声音和播报，不再叠加作者的独立声音文件。

构建生成的运行时配置只包含固定同源 URL：`/private/boot-mark.webp`、`/private/rei-portrait.webp` 和 `/private/startup-reference.{wav,m4a}`。Rei portrait 只有在这个完整配置成功验证后才启用；公开模式不显示 portrait，任意 URL 不能覆盖该固定值。

## `assets.json` 与 hash

`assets.json` 必须精确覆盖五张 WebP 和一条声音，每项只有 `file` 和小写 SHA-256 `sha256`：

```json
{
  "schemaVersion": 1,
  "assets": [
    {"file": "scene-a-sync.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "scene-b-awakening.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "scene-c-online.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "boot-mark.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "rei-portrait.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "startup-reference.m4a", "sha256": "<64 位小写十六进制>"}
  ]
}
```

在主题目录内生成摘要：

```bash
shasum -a 256 scene-a-sync.webp scene-b-awakening.webp scene-c-online.webp \
  boot-mark.webp rei-portrait.webp startup-reference.m4a
```

`ASSET-LICENSE.md` 应准确记录素材来源、授权范围、改编过程及不能保证的第三方权利；它不是自动获得版权许可的手段。

## 准备私人 M4A 音轨

macOS 可用系统自带的 `afconvert` 生成固定 AAC 输出。输入必须是不存在符号链接的绝对 `.mp4` 普通文件，输出必须是一个尚不存在的绝对 `.m4a` 路径，且输出父目录必须已经存在、是非符号链接目录。命令只接受这一种参数顺序，不接受额外转换参数：

```bash
npm run prepare:private-audio -- \
  --input "/absolute/path/to/source.mp4" \
  --output "/absolute/path/to/private-theme/startup-reference.m4a"
```

脚本以固定参数数组调用 `/usr/bin/afconvert`，不会经过 shell。输入和转换输出都以 `O_NOFOLLOW | O_NONBLOCK` 打开并在读取前用 `fstat` 要求为普通文件，因此 FIFO、socket 和 device 不会让验证阻塞。输出的主验证句柄使用只读模式，要求文件最大 32 MiB，解析 M4A movie header 验证非零时长并计算 SHA-256；因此合法的只读 M4A（例如 restrictive umask 产生的 `0444` 文件）也能通过。成功日志只有以下无路径摘要：

```text
PRIVATE_AUDIO_READY bytes=<整数> duration_ms=<整数> sha256=<64 位摘要>
```

任何参数、文件、转换或验证失败都只向 CLI 输出 `PRIVATE_AUDIO_PREP_FAILED`；不会转发底层 stderr，也不会打印输入或输出路径。把摘要写入 `assets.json` 前仍应确认你有权使用这条声音。

如果转换已产生文件但随后的大小、容器、时长或身份验证失败，脚本以 held 只读输出句柄的 dev/inode 为 authority，并通过另一个以 `O_NONBLOCK` 打开且身份匹配的可写句柄尽力截断该 inode。即使文件本身不可写，只要输出父目录身份仍匹配、当前路径是非符号链接普通文件且 dev/inode 仍与 authority 一致，也会依靠父目录权限安全 unlink。若同权限进程已把路径替换成新文件，脚本不会删除替换文件；若替换前已安全取得原 inode 的可写句柄，仍会尽力清空并关闭它。清理自身失败也不会把底层错误或路径写入 CLI。

## 校验与打包

先安装依赖并验证仓库，再显式传入主题目录：

```bash
npm ci
npm run verify
npm run licenses:check
npm audit --audit-level=high
npm run test:e2e
npm run pack:private -- --theme private-themes/my-theme/package
```

成功产物位于 `dist-private/mac-arm64/`（Apple Silicon）或 `dist-private/mac/`（Intel），不会覆盖公开的 `dist/`。命令不接受环境变量暗中指定主题，也不会把 manifest 内容或本机绝对路径输出到稳定错误信息中。自动化打包烟测会比较私人 ASAR 中 mark、portrait、soundtrack 的 fixture 摘要，同时证明公开 ASAR 不含这些路径，运行时配置也不含来源目录。
真实私有包还应核对五张图和声音共六项源摘要与最终 ASAR 字节，并检查运行时配置的音频边界。
通过 Node/E2E 不等于已完成实际声卡试听；安装后仍需完整播放和 Escape 跳过各验收一次，确认音画、
99.2% READY 门、确认、100% 和工作台交接。可恢复安装与失败恢复见
[完整工作流](workflow.md#私人构建可恢复安装与回退)。

构建产物没有开发者身份签名、未公证。安装流程可对明确的本地私人副本执行 ad-hoc 签名，
以重建重打包后失效的资源封印；这不授予 Apple 信任，也不是分发签名。发送给另一位使用者后，
对方仍会遇到 macOS Gatekeeper；应使用 Finder 的“打开”或“系统设置 → 隐私与安全性 → 仍要打开”，
不要建议关闭 Gatekeeper。

同一 Codex 账号不会自动同步应用文件、`dist-private` 产物或私人主题。要在另一台 Mac 使用，必须通过双方认可的私密方式单独传输应用或主题，并确认接收方也拥有相应素材使用权。

## 真实安全边界

校验器要求固定文件集合、普通文件、大小上限和 SHA-256 一致，并使用 `O_NOFOLLOW` 文件句柄读取叶子文件。staging 只复制固定的公开项目入口，使用已校验字节替换主题文件；公开源码文件不会被原地修改。

staging 和旧 `dist-private` 的清理均冻结 dev/inode inventory，再逐项 `unlink` 或 `rmdir`；**不使用 recursive delete（无递归删除）**，遇到未知文件、符号链接替换或身份漂移时会 fail closed。私人派生文件的句柄保持到 `finally`，会先同步、截断为零，再关闭并按 inventory 清理。

这些措施降低误删外部目录和遗留明文的风险，但不是沙箱或数字取证级安全删除：

- 同一 UID（same-UID）的本地进程在构建期间仍可能读取或复制它有权限访问的字节。
- Node.js 没有可移植的 `unlinkat`/`rmdirat` 边界，最终系统调用仍存在同权限竞态限制。
- APFS 的 copy-on-write、快照和存储层行为意味着截断**不保证取证安全擦除**。

因此应把 Mac 本身、主题来源目录和接收渠道都视为信任边界；完成分享后按自己的保留策略处理 `dist-private`，不要把它上传到公开发布渠道。
