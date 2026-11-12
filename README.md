# PROJECT ZERO // PILOT CODEX WORKBENCH

这是一个面向 macOS 的**非官方**、本地优先 Codex 启动工作台预览。公开版本采用原创的
PILOT-00 / VOIDGLASS 视觉，不代表 OpenAI、EVA 或任何其他权利方，也不包含官方角色素材。

![PILOT-00 真实启动界面预览](docs/images/pilot-00-preview.png)

上图由当前仓库实际启动界面截取；公开构建会显示同步动画、Codex 本地就绪状态和确认门禁，
随后进入可用的三栏核心工作台。

当前核心工作区支持：添加本地项目、创建和恢复 Codex 会话、选择模型与推理强度、流式显示
回复、逐次处理命令/文件/权限审批、上传本地图片、浏览安全过滤后的项目文件，以及查看命令输出
和文件 Diff。终端、Git 面板、插件管理和自动更新仍属于后续阶段。

## 前置条件

- macOS（Apple Silicon 或 Intel）；构建命令只生成当前 Mac 架构的目录包。
- Node.js 24 或更高版本，以及随 Node.js 安装的 npm。
- 本机已安装可用的 Codex/ChatGPT 桌面运行时，并已登录 Codex 账号。

Codex 账号只提供账号与模型状态；应用文件、主题文件和本地构建产物不会因为另一台 Mac 登录
同一账号而自动同步。

## 本地运行与验证

```bash
npm ci
npm run verify
npm start
```

进入工作台后，在左栏输入项目的绝对路径并点击“添加项目”，再点击“新建任务”。中栏用于发送
任务、选择模型/推理强度和添加图片；右栏显示审批、执行记录、Diff 与项目文件。线程默认使用
`read-only` 沙箱，任何扩展权限都必须由用户在右栏明确确认。

`npm run verify` 运行 ESLint 和不启动 Electron 的 Node 测试。完整源码与打包应用检查可运行：

```bash
npm run test:e2e
```

## 构建 macOS 目录包

```bash
npm run pack
```

Apple Silicon 输出在 `dist/mac-arm64/`，Intel 输出在 `dist/mac/`。当前预览包**未签名、未公证**，
首次打开可能被 macOS Gatekeeper 拦截。请在 Finder 中按住 Control 点击应用并选择“打开”，
或在“系统设置 → 隐私与安全性”中确认“仍要打开”。不要全局关闭 Gatekeeper。

如需只在本机制作不进入公开 Git 历史的私人主题，请阅读
[私人主题工作流](docs/private-themes.md)。公开仓库只提供工作台引擎和原创、自由授权的占位素材；
私人构建所需的角色、标志、声音和场景素材必须由使用者自行提供，并确认自己有权使用和分享。

私人目录包在本机的完整验证链为：

```bash
npm run verify
npm run licenses:check
npm audit --audit-level=high
npm run test:e2e
npm run pack:private -- --theme private-themes/my-theme/package
```

构建不会把素材许可自动授予使用者，也不能替代人工核对来源与授权。安装前保留旧应用的时间戳备份、
安装后验证目录包、以及验收失败时恢复备份的命令见 [完整工作流](docs/workflow.md#私人构建可恢复安装与回退)。

## 双渲染器与参考基准

公开版默认使用 Canvas；完整私有主题通过清单、摘要和媒体解码验证后，默认启用 reference
DOM/SVG 渲染器。两者共享同一个启动控制器、音频时钟和 READY 门；私有素材加载或 reference
渲染失败时，由 Canvas 在当前时间点接管。

reference 的结构、坐标算法和动作规则改编自固定提交的作者源码，见
[代码来源](docs/code-origins.md)。颜色、文字、图标状态、音画节奏以使用者提供的参考视频内部
桌面画面为准，优先于作者公开版的红黑主题；手机边框、播放器和社交界面不属于产品。
参考音轨只播放 2,000–22,500 ms 区间，不叠加上游声音。公开代码、OFL 字体与私人素材分别适用
各自许可；浅蓝私人主题源文件未公开于作者仓库。具体目录、配置和回退行为见
[私人主题工作流](docs/private-themes.md)。

## 本地安全边界

- Electron 主进程只监听随机的 IPv4 loopback 地址 `127.0.0.1`，并校验精确 Host、Origin 和会话。
- 渲染器不启用 Node.js；界面仅加载打包 allowlist 中的本地文件，不加载远程素材。
- Codex 凭据不会进入渲染进程；诊断界面只显示稳定、脱敏的状态码。
- `npm run pack` 的公开路径不读取私人主题，测试 bridge 环境变量也会在生产打包时移除。

更完整的测试与产物边界见 [docs/testing-and-packaging.md](docs/testing-and-packaging.md)。
从安装到会话、审批、文件和故障恢复的完整操作说明见 [docs/workflow.md](docs/workflow.md)。

## 许可与素材说明

项目代码采用 [MIT License](LICENSE)。公开 VOIDGLASS 图像是独立授权的原创表达，具体按
[CC BY 4.0 与素材说明](assets/themes/project-zero/ASSET-LICENSE.md) 使用；该许可不替任何第三方
角色、商标或设计提供权利清理，也不是商业使用保证。

公开 GitHub 仓库只包含工作台引擎和原创、自由授权的占位素材，不包含任何私人角色素材、标志或参考音轨。
私人素材必须由使用者自行合法取得、保存在 ignored 本地目录，并自行承担分享或使用时的授权责任。
