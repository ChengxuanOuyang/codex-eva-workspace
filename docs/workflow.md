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
