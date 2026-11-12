# 测试与打包边界

## 自动化验证

`npm run verify` 运行 ESLint 和不启动 Electron 的 Node 测试。`npm run test:e2e`
先执行一次干净的目录打包，然后运行两类 Electron 检查：

- 源码 E2E 从当前 checkout 启动未打包的 Electron。它只在
  `NODE_ENV=test`、`app.isPackaged === false` 且显式传入
  `PROJECT_ZERO_TEST_BRIDGE_MODULE` 时加载仓库外置的确定性 fake bridge。该路径用于验证
  启动状态机、断线恢复、项目/会话创建、图片附件、审批、流式结果和进程清理，不证明真实账户可登录。
- packaged smoke 启动刚刚生成的 `.app`，即使测试进程传入同名 bridge 变量，打包应用也必须
  忽略它并使用正式 Codex 发现路径。该检查依赖 owner machine 已安装官方 Codex/ChatGPT 且账户
  当前可用，因此不是无账户 CI 的确定性替代品。

两类检查必须同时保留：源码 E2E 提供稳定回归覆盖，owner-machine smoke 证明生产门禁没有被
测试后门绕过。

### 启动演出视觉与窗口验收

`tests/fixtures/reference-video-manifest.json` 是不含媒体的数字验收清单。它记录原视频 SHA256、
592×333 内容裁剪、1920×1080 逻辑坐标，以及 `0、1500、3000、5500、8800、10500、12500、
13300、14100、15450、18600、19850、20500 ms` 的阶段、文字、进度、扫描高度/透明度、颜色和
每个节点的 visible/opacity/active。12 个兼容节点中，第六行明确 hidden，画面每侧显示 5 个裸横向
六边形，只显示交替 WARNING/EMERGENCY。250 ms 的数字采样控制左右交错的点亮和熄灭。

reference 是有效私人音轨和徽记加载后的默认验收目标，Canvas 是公开配置或资源不可用时的 fallback。
reference 的进度遵循视频实测曲线（10500 ms 为 29.0%，12500 ms 为 95.5%）；无障碍数值随所选
画面派生。控制器仍在逻辑 13300 ms 锁定 99.2%，只有 fresh exact READY 和用户确认才能继续。
原视频含人类确认等待，清单将 authorized/held 与 videoMs 单独记录，确认后帧不假定统一的 2000 ms 偏移。

源码视觉 E2E 在 reference 和 Canvas 两模式、1440×900 和 1280×800 两视口读取真实绘制记录和
DOM computed style，并截图到系统临时目录。reference 额外核对中文标题、逐节点明暗、裸六边形标签、
字体加载、私人 mark、液面扰动前沿、扫描高度/透明度、圆环角度和完成标题。14100 ms 同时核对 100% 圆环、淡入 EVANGELION-00/正在连接工作台与访问字幕，
清单包含各中央层文字/opacity/cue，CLI 另做中央标题、字幕、数字、圆环区域的独立像素对比；实际 DOM opacity 偏差必须
使验收断言失败。reduced motion 保持信息，抑制波动和闪光。音频检查覆盖 99.2% 暂停与确认后恢复。新增两模式自然播放测试不调用 presentation seek，
从真实解码 WebAudio currentTime 的推进、13.3 s 冻结到确认后自然完成 20.5 s 及 windowed/workbench；
合成静音验收使用 --disable-audio-output 避免本机 CoreAudio 输出后端阻滞，不注入 currentTime 或 context.resume。
完整播放、按钮跳过、Escape、断线恢复和 fullscreen→windowed 均覆盖两模式，关闭后检查 listener 与子进程。

运行指定串行验收：

```bash
npm run pack
npm run pack:private -- --theme private-themes/rei/package
node --test --test-concurrency=1 tests/e2e/boot-visual.test.cjs tests/e2e/boot.test.cjs tests/e2e/packaged-smoke.test.cjs tests/e2e/private-packaged-smoke.test.cjs
```

本地视频比较可先创建一个系统临时目录，将其绝对路径设置为 `PROJECT_ZERO_REFERENCE_SCREENSHOTS`，
运行 `tests/e2e/boot-visual.test.cjs`。该选项额外保存 1920×1080 的 `reference-<logicalMs>.png` 与
computed-DOM JSON（不含媒体来源或本机路径），并保留目录供检查。然后运行：

```text
node scripts/verify-reference-frames.cjs --video <absolute mp4> --screenshots <absolute temp dir>
```

脚本只接受普通 MP4 和非 symlink 临时目录/普通截图文件，读取原文件而不复制视频，不写入仓库；输出
稳定的逐项 PASS/FAIL、SHA 和总结果，不打印本地路径。它在 mode 0700 的受控临时目录中建立与已持有 inode 一致的 hardlink，AVFoundation 只读取该链接；
解码前后通过同一个 held fd 重算 SHA 并比较 size/mtime/ctime/dev/ino，最后清理链接和目录。链接创建/删除
会改变 inode 的 link count/ctime，媒体字节和 mtime 不变；跨文件系统无法 hardlink 时 fail closed。脚本用 macOS AVFoundation 逐帧读取原视频，
核对 DOM 数值、截图尺寸、背景/液面与逐节点 RGB 采样。源视频确认时的短暂缩放通过显式 videoMs 映射到稳定帧，全部 12 帧均检查逐节点颜色与几何；
20500 ms 验证工作台交接，不与启动层做错误的整图比较。截图目录使用后自行删除。
该脚本要求本地 macOS Swift/AVFoundation 和 owner 视频；缺少视频时 manifest、单测及合成素材 E2E 仍可运行。

测试桥仅在 `NODE_ENV=test`、应用未打包且显式加载外置 fake bridge 时安装，只提供“设置 presentation
elapsed ms”和“读取 window mode”。production 不暴露 renderer record 或测试桥，private packaged smoke
也验证这点。合成 E2E 使用即时生成的 20.5 秒静音 WAV，只证明音频时钟/画面同步与生命周期；实际声线、
响度和听感仍需 owner 对私人包试听。参考媒体、裁剪、截图和本地绝对路径不进入仓库。

## 确定性目录包

`npm run pack` 在调用 electron-builder 前删除整个 `dist/`，并从构建环境移除所有测试 bridge、
trace 和断线信号变量。packaged smoke 不扫描或排序 `dist/mac*`；它只接受当前架构对应的本次
输出：Apple Silicon 为 `dist/mac-arm64`，Intel 为 `dist/mac`。因此旧产物无法被误当成本次构建。

开发目录包是未签名、未公证的预览产物。签名、公证和发行安装包属于后续发布阶段。

## 本地数据目录

主进程在启动生命周期前把 Electron `userData` 显式设置为
`~/Library/Application Support/Project Zero/`。状态、日志和本地主题继续派生在该目录下；它们
不会因同一 Codex 账号登录另一台 Mac 而自动同步。

工作区状态使用版本化 JSON 原子写入；损坏的状态文件会被保留为 `state.corrupt-*.json` 后重新
建立空状态。图片附件只接受经过 MIME、magic bytes、大小和像素尺寸检查的 PNG/JPEG。文件预览
限制在已添加项目的 canonical 根目录内，并拒绝路径穿越、符号链接逃逸、凭据文件、二进制文件
和超过 512 KiB 的文本。
