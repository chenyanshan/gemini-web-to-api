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

先检查环境和已有安装，保留原 `.data` 和其他 MCP 配置。默认下载最新稳定 Release 的 runtime 包，按下文校验 SHA-256 后安装；已有源码目录或用户明确要求源码安装时，按 [README](https://github.com/chenyanshan/gemini-web-to-api/blob/main/README.md#交给-ai-安装) 的源码流程执行。

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

## AI 必须安装配套 skill

注册 MCP 后，AI 必须把本次安装包内的 `skills/gemini-ui-design/` 完整安装到当前助手实际使用的技能目录。此步骤属于安装交付的一部分，不能只提示用户自行复制，也不能因 MCP 已注册就跳过。

- Codex 默认目标为 `~/.codex/skills/gemini-ui-design/`；若设置了 `CODEX_HOME`，使用该目录下的 `skills/gemini-ui-design/`。其他助手使用其实际支持的技能目录。
- 先检查已有同名 skill：内容一致则复用；存在差异时先备份到技能扫描目录之外，再安装本次版本，保留用户定制内容供合并。不要改动其他 skills。
- 复制整个目录，确认目标 `SKILL.md` 存在且可读，并核对其内容与本次安装包一致。该 skill 包含前端/UI 设计、截图和代码附件、模型与思考等级选择以及任务恢复规则。
- 交付时报告实际安装绝对路径。新开助手会话后，确认技能列表中可见 `gemini-ui-design`，并确认 MCP 工具可调用。当前会话无法重新加载时，注明“skill 已安装，待新会话验证”；未复制或助手不支持 skills 时，明确报告此项未完成，不能宣称完整安装成功。

`npm ci` 不会自动安装 skill；以上步骤由执行安装的 AI 完成。更新版本时也必须同步检查和更新配套 skill。

## 人配合

1. 用日常 Chrome 配置文件登录 https://gemini.google.com/app ，不需要无痕。
2. 在同一 Chrome 中打开 `chrome://extensions`，开启开发者模式，点“加载已解压的扩展程序”。
3. 选择 AI 提供的 `dist/extension` 绝对目录。若只下载了扩展 ZIP，先解压，选择直接包含 `manifest.json` 的目录；不能直接加载 ZIP。
4. 打开 Gemini Local Bridge，填入本地 info 命令显示的地址和令牌，点“保存并连接”。
5. 首次安装后刷新 Gemini 页，在该页打开插件点“读取模型”。
6. 新开 Codex 会话，确认已加载 `gemini-ui-design` skill，让 AI 调用 `gemini_status` 和 `gemini_models_list` 验收。

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
