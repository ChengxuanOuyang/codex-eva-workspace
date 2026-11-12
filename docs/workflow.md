# PROJECT ZERO 核心工作台流程

## 1. 安装与启动

```bash
npm ci
npm run verify
npm start
```

应用只监听随机的 `127.0.0.1` 端口。启动动画到达 99.2% 后，只有 Codex 账号和模型检查均通过，
“确认并完成同步”按钮才会启用。动画可以跳过，但后端就绪检查不会被跳过。

目录包可用 `npm run pack` 生成。当前构建未签名、未公证；首次打开请在 Finder 中按住 Control
点击应用并选择“打开”，不要全局关闭 Gatekeeper。

### 私人构建、可恢复安装与回退

公开仓库只包含工作台引擎和原创、自由授权的占位素材。私人主题所需的角色、标志、声音和场景
必须由使用者自行提供，并确认自己有权使用和分享；构建和摘要校验不会授予任何素材权利。

完整私有主题默认使用 reference DOM/SVG；公开版默认使用 Canvas，私有媒体或 reference 失败时
也由 Canvas 接管。两者共享真实 READY 门和音频时钟。作者代码负责结构与动作基准，参考视频
内部桌面画面负责颜色、文字、图标和节奏；具体来源和许可边界见
[私人主题工作流](private-themes.md#双渲染器作者源码与视频优先级)。

把素材放入 Git ignored 的 `private-themes/my-theme/package/`，按
[私人主题工作流](private-themes.md) 完成固定文件集合和 SHA-256 清单后，运行完整验证与构建：

```bash
npm run verify
npm run licenses:check
npm audit --audit-level=high
npm run test:e2e
npm run pack:private -- --theme private-themes/my-theme/package
```

Apple Silicon 的新目录包位于
`dist-private/mac-arm64/PROJECT ZERO — PILOT CODEX WORKBENCH.app`；Intel 使用 `dist-private/mac/`。
安装前先正常退出应用，再确认产品进程已经结束。以下示例使用不含私人标识的本机安装名，并把旧安装
移入废纸篓中的时间戳备份；请按架构修改 `build_app`，并记下命令输出的 `backup_app` 路径：

以下命令应在同一 shell 会话执行。先正常退出产品，再核对产品可执行文件进程；不要终止其他
Electron 或 Codex 进程。安装路径和备份路径必须是明确的非符号链接路径；目标已存在时不覆盖：

```bash
if pgrep -fl '/Contents/MacOS/PROJECT ZERO — PILOT CODEX WORKBENCH($| )'; then
  echo '应用仍在运行；请先退出再安装' >&2
  exit 1
fi

build_app="$PWD/dist-private/mac-arm64/PROJECT ZERO — PILOT CODEX WORKBENCH.app"
install_app="$HOME/Applications/PROJECT ZERO — PRIVATE THEME.app"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_app="$HOME/.Trash/PROJECT ZERO — PRIVATE THEME.app.backup-$timestamp"
if [ ! -d "$build_app" ] || [ -L "$build_app" ] || [ -L "$install_app" ]; then
  echo '待安装目录包不存在或路径为符号链接；停止安装' >&2
  exit 1
fi
# 仅为本地私人副本重建资源封印，不提供开发者身份或 Apple 信任。
/usr/bin/codesign --force --deep --sign - --timestamp=none "$build_app" || exit 1
/usr/bin/codesign --verify --deep --strict "$build_app" || exit 1
mkdir -p "$HOME/Applications" "$HOME/.Trash"
if [ -e "$backup_app" ] || [ -L "$backup_app" ]; then
  echo '备份路径已存在；停止安装' >&2
  exit 1
fi
if [ -e "$install_app" ]; then
  mv "$install_app" "$backup_app" || exit 1
fi
printf 'backup_app=%s\n' "$backup_app"
if ! /usr/bin/ditto "$build_app" "$install_app"; then
  failed_app="$HOME/.Trash/PROJECT ZERO — PRIVATE THEME.app.failed-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -e "$failed_app" ] || [ -L "$failed_app" ]; then exit 1; fi
  if [ -e "$install_app" ]; then mv "$install_app" "$failed_app" || exit 1; fi
  if [ -d "$backup_app" ]; then /usr/bin/ditto "$backup_app" "$install_app"; fi
  echo '复制失败；检查恢复结果，旧备份仍保留' >&2
  exit 1
fi
```

重打包可能使 Electron 原有资源封印失效，因此上面的命令只对明确的本地私人目录包执行
ad-hoc 签名，验证通过后才移动旧安装。它没有开发者身份、没有公证，也不是 Apple 信任或
分发签名。安装后再次校验结构、签名和摘要，再启动实机验收：

```bash
verification_failed() {
  echo '安装验证失败；不要启动应用，请按下面的恢复步骤恢复旧版。' >&2
  exit 1
}
if [ -z "${build_app:-}" ] || [ -z "${install_app:-}" ]; then
  verification_failed
fi
plutil -lint "$install_app/Contents/Info.plist" || verification_failed
codesign --verify --deep --strict "$install_app" || verification_failed
build_asar_summary="$(shasum -a 256 "$build_app/Contents/Resources/app.asar")" || verification_failed
installed_asar_summary="$(shasum -a 256 "$install_app/Contents/Resources/app.asar")" || verification_failed
build_asar_digest="${build_asar_summary%% *}"
installed_asar_digest="${installed_asar_summary%% *}"
if [ "${#build_asar_digest}" -ne 64 ] || [ "${#installed_asar_digest}" -ne 64 ]; then
  verification_failed
fi
case "$build_asar_digest$installed_asar_digest" in
  *[!0123456789abcdef]*) verification_failed ;;
esac
if [ "$build_asar_digest" != "$installed_asar_digest" ]; then
  verification_failed
fi
open "$install_app"
```

上述代码块会在 plist、strict codesign 或 ASAR 读取与摘要比较失败时非零退出，不启动应用；
它只提示按下面的恢复步骤处理，不自动移动或删除文件。通过后可另行运行下面的非阻塞只读检查。
ad-hoc 且未公证的包预期可能被 Gatekeeper 拒绝，不能把这种拒绝报告为 Apple 信任：

```bash
if ! spctl --assess --type execute --verbose "$install_app"; then
  echo 'Gatekeeper 未接受此包；本地 ad-hoc、未公证的包预期可能被拒绝。' >&2
fi
```

如需首次打开，使用本节开头的 Finder 或系统设置流程。分别用重新启动的应用验收完整播放和 Escape：音轨从 2,000 ms 播放，
13,300 ms 逻辑时间到 99.2% 并暂停；Escape 通过 150 ms 淡出跳到该认证门，不得伪造就绪。
必须等待实际 Codex READY，确认后恢复演出，至 22,500 ms 音轨终点完成 100% 和工作台交接。
同时试听实际音频设备；不要注入 fake bridge、伪造 READY 或以测试快进替代实机验收。

若复制、结构校验、启动、完整演出、跳过、就绪门或工作台任一验收失败，先退出新版，确认上述
产品进程检查无结果，再执行恢复。以下命令依赖刚才记录的 `backup_app`，不会删除旧备份：

```bash
if pgrep -fl '/Contents/MacOS/PROJECT ZERO — PILOT CODEX WORKBENCH($| )'; then
  echo '应用仍在运行；请先退出再恢复' >&2
  exit 1
fi
if [ ! -d "$backup_app" ] || [ -L "$backup_app" ] || [ -L "$install_app" ]; then
  echo '未找到安全的旧安装备份；停止恢复' >&2
  exit 1
fi
failed_app="$HOME/.Trash/PROJECT ZERO — PRIVATE THEME.app.failed-$(date -u +%Y%m%dT%H%M%SZ)"
if [ -e "$failed_app" ] || [ -L "$failed_app" ]; then exit 1; fi
if [ -e "$install_app" ]; then mv "$install_app" "$failed_app" || exit 1; fi
/usr/bin/ditto "$backup_app" "$install_app"
```

不要删除 `backup_app`；完成恢复后再次运行 `plutil`、`codesign` 并启动旧版本确认。没有旧安装时
应保留失败版本、停止使用并排查，不声称已恢复。私人目录包和备份都不应上传到 GitHub、公开
release、issue 或其他公开渠道。

## 2. 添加项目

在左栏“项目路径”输入现有目录的绝对路径，然后点击“添加项目”。后端会 canonicalize 该路径并
确认它是目录。相同 canonical 路径不会重复添加。

项目文件面板只显示普通文件和目录，并过滤 `.git`、`node_modules`、`.env*`、`auth.json`、
`credentials` 和 `.ssh`。预览拒绝路径穿越、符号链接、二进制文件及超过 512 KiB 的文件。

## 3. 创建和运行任务

1. 选中项目。
2. 点击“新建任务”。
3. 在中栏选择模型和该模型实际支持的推理强度。
4. 输入任务并点击“发送”。

线程通过官方 `codex app-server` 创建，默认参数为 `sandbox: read-only`、
`approvalPolicy: on-request`、`approvalsReviewer: user`。应用支持恢复本地保存的线程、流式拼接
Codex 回复、中断活动 turn，以及保留完成、失败和中断状态。

## 4. 图片附件

点击“添加图片”选择 PNG 或 JPEG。附件必须小于编码 12 MiB、解码 8 MiB，单边不超过
12,000 像素，并通过 MIME 和 magic bytes 检查。浏览器只收到不透明附件 ID；真实本地路径只在
主进程中解析并传给 Codex。模型未声明 image input 时，图片入口会禁用。

## 5. 审批

应用只接受以下四类 app-server 请求：

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`

未知请求自动返回拒绝错误，不会进入界面。命令和文件审批仅支持“允许本次”或“拒绝”；权限审批
只返回原请求中的权限且 scope 固定为当前 turn。turn 结束时，所有未回答审批自动拒绝并清除。

## 6. 执行记录、Diff 与历史

右栏按 item ID 汇总命令输出和文件变更。文件变更保留 app-server 提供的 Diff 文本并限制最大
长度。会话、消息、工具记录、项目和归档状态保存在：

```text
~/Library/Application Support/Project Zero/state/state.json
```

应用不会把账号令牌写入状态，也不会把私人主题或聊天记录同步到另一台 Mac。

## 7. 断线与恢复

Codex 或本地 SSE 断开后，界面会禁用写操作并显示离线状态。点击“重新检查 Codex”会启动新的
app-server 连接；成功后工作台重新绑定新桥并从本地状态恢复线程。退出应用会关闭 loopback
监听器和 owned Codex 子进程。

## 8. 验证

```bash
npm run verify
npm run test:e2e
```

`verify` 运行 lint 与 Node 测试；`test:e2e` 先生成干净目录包，再验证启动、恢复、核心工作流、
公开 ASAR 边界、生产测试门禁和私人主题隔离打包。
