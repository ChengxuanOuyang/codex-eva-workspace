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
