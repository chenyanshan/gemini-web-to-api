# 使用 Release 安装

下载地址：https://github.com/chenyanshan/gemini-web-to-api/releases

需要 Node.js 22.13+（推荐 24 LTS）、npm、主 Chrome 和可用的 Gemini 登录。
Release 不包含 Node.js 或 node_modules，首次安装运行依赖需要联网。

## 选择附件

- `gemini-web-to-api-X.Y.Z-runtime.tar.gz`：本地 HTTP 服务、STDIO MCP 和 Chrome 扩展的已构建代码。完整安装选择这个包。
- `gemini-web-to-api-X.Y.Z-extension.zip`：仅 Chrome 扩展。已有同版本本地服务时可单独使用。
- `SHA256SUMS.txt`：以上两个附件的 SHA-256 校验值。
- GitHub 自动提供的 `Source code`：源码，需要按 README 的源码流程构建。

## AI 执行

解压 runtime 包，进入 `gemini-web-to-api-X.Y.Z` 目录：

```sh
npm ci --omit=dev
npm start
```

保持服务运行。在另一终端的同一目录查看配对信息：

```sh
node dist/cli.js info
```

Release 包已经构建，无需 `npm run build`。`npm run info` 依赖源码开发工具 tsx，Release 生产依赖安装请使用上面的 `node dist/cli.js info`。

获取实际路径：

```sh
node -p "process.execPath"
node -p "require('node:path').resolve('dist/mcp.js')"
node -p "require('node:path').resolve('dist/extension')"
```

将前两行路径用于注册 MCP（保留引号），已有正确配置则复用：

```sh
codex mcp add gemini-web -- "/absolute/path/to/node" "/absolute/path/gemini-web-to-api-X.Y.Z/dist/mcp.js"
```

HTTP 服务和 MCP 分开运行；注册 MCP 不会启动 HTTP 服务。
不要使用 `--url http://127.0.0.1:43123`，这不是 MCP HTTP 端点。

## 人配合

1. 用日常 Chrome 配置文件登录 https://gemini.google.com/app ，不需要无痕。
2. 在同一 Chrome 中打开 `chrome://extensions`，开启开发者模式，点“加载已解压的扩展程序”。
3. 选择 AI 提供的 `dist/extension` 绝对目录。若只下载了扩展 ZIP，先解压，选择直接包含 `manifest.json` 的目录；不能直接加载 ZIP。
4. 打开 Gemini Local Bridge，填入本地 info 命令显示的地址和令牌，点“保存并连接”。
5. 首次安装后刷新 Gemini 页，在该页打开插件点“读取模型”。
6. 新开 Codex 会话，让 AI 调用 `gemini_status` 和 `gemini_models_list` 验收。

模型限制、使用范围、附件和恢复规则见包内 README。

## 校验文件

macOS：

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Linux：

```sh
sha256sum -c SHA256SUMS.txt
```

该命令假定两个附件都已下载并与校验文件放在同一目录。只下载一个附件时，可对该文件计算 SHA-256，再与 SHA256SUMS.txt 中对应的一行比较。校验用于发现下载损坏，不是发布者签名。

## 更新

推荐首次安装时就选定固定的安装路径。更新前先处理完未完成或状态不明的任务，停止旧服务并备份整个安装目录。
将新包部署到同一路径的空目录，再还原原 `.data`，安装生产依赖并启动服务。
若使用自定义 BRIDGE_DATA_DIR，继续让新服务和 MCP 使用同一目录即可。
在 Chrome 中点击扩展的“重新加载”，新开 Codex 会话，并重新验证连接。

不要同时运行新旧服务，不要将新旧 `dist` 文件混合覆盖，也不要删除仍被 Chrome 加载的目录。
如果必须更换路径，需要更新 Codex MCP 的脚本路径；Chrome 重新加载不同路径的扩展可能产生不同的浏览器标识，已有会话可能无法继续恢复。

当前发布流程只接受稳定的 `vX.Y.Z` 标签，不自动安装更新，也不提供 Chrome Web Store / CRX 更新服务。
