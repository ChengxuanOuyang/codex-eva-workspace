# 私人本地主题工作流

私人主题用于把使用者自己有权使用的本地素材注入一个**独立**的 macOS 目录包。公开打包路径
不会读取它们；`private-themes/`、`.private-build/` 和 `dist-private/` 均被 Git 忽略。请不要把
私人角色素材提交到 Git、上传到 GitHub、附在 issue 或公开 release 中。

## 固定目录结构

每个主题包必须恰好包含以下六个普通文件；不接受额外文件、子目录或符号链接：

```text
private-themes/my-theme/package/
├── theme.json
├── assets.json
├── ASSET-LICENSE.md
├── scene-a-sync.webp
├── scene-b-awakening.webp
└── scene-c-online.webp
```

公开仓库内的 `tests/fixtures/private-theme-valid/` 只是无版权合成字节 fixture，用于自动化测试，
不是可发布的视觉主题。

## `theme.json`

对象只允许以下字段：

```json
{
  "schemaVersion": 1,
  "id": "my-private-theme",
  "displayName": "PROJECT ZERO // MY PRIVATE THEME",
  "scenes": {
    "awakening": "scene-b-awakening.webp",
    "synchronization": "scene-a-sync.webp",
    "online": "scene-c-online.webp"
  },
  "assetManifest": "assets.json",
  "artNotice": "ASSET-LICENSE.md"
}
```

`displayName` 最长 96 个字符且不能包含换行或 NUL。三个 `scenes` 值必须是三个 WebP 文件的
basename，不能包含目录、绝对路径或重复选择。`assetManifest` 与 `artNotice` 必须使用上面的
固定文件名。

## `assets.json` 与 hash

`assets.json` 必须精确覆盖三个 WebP，每项只有 `file` 和小写 SHA-256 `sha256`：

```json
{
  "schemaVersion": 1,
  "assets": [
    {"file": "scene-a-sync.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "scene-b-awakening.webp", "sha256": "<64 位小写十六进制>"},
    {"file": "scene-c-online.webp", "sha256": "<64 位小写十六进制>"}
  ]
}
```

在主题目录内生成 hash：

```bash
shasum -a 256 scene-a-sync.webp scene-b-awakening.webp scene-c-online.webp
```

把输出逐项抄入 manifest。`ASSET-LICENSE.md` 应准确记录素材来源、授权范围、改编过程及不能
保证的第三方权利；它不是自动获得版权许可的手段。

## 校验与打包

先安装依赖并验证仓库，再显式传入主题目录：

```bash
npm ci
npm run verify
npm run pack:private -- --theme private-themes/my-theme/package
```

成功产物位于 `dist-private/mac-arm64/`（Apple Silicon）或 `dist-private/mac/`（Intel），不会覆盖
公开的 `dist/`。命令不接受环境变量暗中指定主题，也不会把 manifest 内容或本机绝对路径输出到
稳定错误信息中。

这个目录包仍然未签名、未公证。发送给另一位使用者后，对方仍会遇到 macOS Gatekeeper；应使用
Finder 的“打开”或“系统设置 → 隐私与安全性 → 仍要打开”，不要建议关闭 Gatekeeper。

同一 Codex 账号不会自动同步应用文件、`dist-private` 产物或私人主题。要在另一台 Mac 使用，必须
通过双方认可的私密方式单独传输应用或主题，并确认接收方也拥有相应素材使用权。

## 真实安全边界

校验器要求固定文件集合、普通文件、大小上限和 SHA-256 一致，并使用 `O_NOFOLLOW` 文件句柄读取
叶子文件。staging 只复制固定的公开项目入口，使用已校验字节替换主题文件；公开源码文件不会被
原地修改。

staging 和旧 `dist-private` 的清理均冻结 dev/inode inventory，再逐项 `unlink` 或 `rmdir`；
**不使用 recursive delete（无递归删除）**，遇到未知文件、符号链接替换或身份漂移时会 fail
closed。私人派生文件的句柄保持到 `finally`，会先同步、截断为零，再关闭并按 inventory 清理。

这些措施降低误删外部目录和遗留明文的风险，但不是沙箱或数字取证级安全删除：

- 同一 UID（same-UID）的本地进程在构建期间仍可能读取或复制它有权限访问的字节。
- Node.js 没有可移植的 `unlinkat`/`rmdirat` 边界，最终系统调用仍存在同权限竞态限制。
- APFS 的 copy-on-write、快照和存储层行为意味着截断**不保证取证安全擦除**。

因此应把 Mac 本身、主题来源目录和接收渠道都视为信任边界；完成分享后按自己的保留策略处理
`dist-private`，不要把它上传到公开发布渠道。

