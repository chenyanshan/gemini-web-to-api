# Gemini Local Bridge

## 复制给 AI：安装并使用

点击下面代码块右上角的复制按钮，直接粘贴给能操作本机终端的 Codex 或其他 AI 助手。AI 会完成本地安装，并在需要时提示你操作 Chrome。

```text
请帮我在本机安装并使用 Gemini Local Bridge：
https://github.com/chenyanshan/gemini-web-to-api

先阅读仓库 README 和安装指南，检查环境及已有安装，保留原 .data 和其他 MCP 配置。
默认安装最新稳定 Release 的 runtime 包，校验 SHA-256，安装生产依赖；
如果已有源码目录或我明确要求源码安装，就按 README 安装依赖、验证并构建。
启动并确认本地 HTTP 服务持续运行，用实际的 Node 和脚本绝对路径配置 STDIO MCP。
不要只给我安装教程，请完成你能独立执行的步骤，再一次性列出需要我配合的操作。

使用我日常 Chrome 的登录环境，不要改用无痕或自动化浏览器。
Google 登录、验证码、首次加载扩展和填写配对信息由我完成。
请给我扩展目录的实际绝对路径、服务地址、本地查看令牌的方法，以及 Chrome 的点击步骤。
不要索取密码、验证码或导出 Cookie，也不要把配对令牌发到公开位置。
我完成操作后，继续检查服务连接、网页模型和 MCP 工具；必要时提示我新开 Codex 会话。
交付时说明安装路径、日常启动方法、实际验证结果及未完成步骤，不要把构建成功当作安装完成。

安装后，将 skills/gemini-ui-design 安装到本机的技能目录。前端或 UI 设计可交给 Gemini，
支持上传现有界面截图与代码，要求它提供改造方案、完整代码或 HTML 示例，再由你实现和验证。
正常请求使用 3.1 pro、high；困难任务、全局设计/重构，或多次重构仍不满意时使用 4 argon、high。
4 argon、high 等待 3～5 分钟属正常，持续查询原任务，不因这段等待刷新或重发。
需要截图、设计说明或代码参考时，用 gemini_files_upload 上传明确选定的文件，
再通过 gemini_submit 的 attachment_ids 随提问发送，不上传无关文件。
支持新建会话或绑定已有 Gemini 对话 URL；后续追问复用 session_id，并读取最新 revision。
同一请求重试复用 request_id 和原附件，提交后保存 job_id 并查询到 completed。
遇到卡顿或 unknown，按 recovery 建议恢复原任务；上传失败或页面卡顿可用 resume(refresh=true)。
刷新后先核对原轮，发送前可重建附件，发送后只读取原回复；每任务最多刷新两次。
只有已授权重试且确认网页缺失的轮次才显式重发一次，不用新会话冒充恢复。
```

把主 Chrome 中已登录的 Gemini 网页接入本地 HTTP API 和 Codex MCP。

使用范围：**前端与 UI 设计、实现、改造和视觉优化**。可把现有界面截图和代码交给 Gemini，要求设计方案、组件代码或完整 HTML 示例，再在本地实现并验证。正常请求默认用 `3.1 pro + high`；困难任务、全局设计/重构，或多次重构仍不满意时使用 `4 argon + high`。由调用助手按此策略在原会话空闲时升级；连接或上传故障仍走原任务恢复。后端、API 和一般调试由 Codex 自己处理。

## 下载与安装方式

- **使用已构建版本**：从 [GitHub Releases](https://github.com/chenyanshan/gemini-web-to-api/releases) 下载 `gemini-web-to-api-X.Y.Z-runtime.tar.gz`，包含本地服务、MCP 和扩展。解压后按包内 `INSTALL.md` 安装生产依赖，无需构建。完整说明见 [Release 安装指南](https://github.com/chenyanshan/gemini-web-to-api/blob/main/docs/release-install.md)。
- **只更新扩展**：下载同一 Release 的 `gemini-web-to-api-X.Y.Z-extension.zip`，先解压再在 Chrome 中加载；仍需运行同版本本地服务。
- **开发或让 AI 从源码安装**：克隆本仓库，按下文执行。GitHub 自动提供的 `Source code` 压缩包也属于源码，需要构建。

Release 提供 `SHA256SUMS.txt` 校验文件。安装包不包含 Node.js、运行依赖或任何登录信息，首次安装依赖需要联网。顶部提示词默认选择最新稳定 Release；也可以明确要求源码安装。不要对 Release 包执行源码构建步骤。

## 安装前须知

这是本地运行的 Chrome 扩展 + HTTP 服务 + STDIO MCP 工具，使用浏览器中已登录的 Gemini 网页，不需要 Gemini API Key。它依赖网页控件，不能保证不同账号或网页版本都可用。目前模型选项固定为 `3.1 pro` 和 `4 argon`，需你的账号实际可选；插件里的“网页模型名称”只用于匹配网页标签，不能解锁模型。

准备以下环境：

| 条件 | 要求 |
| --- | --- |
| Node.js / npm | Node.js 22.13+，推荐 Node.js 24 LTS；需安装开发依赖才能构建 |
| Chrome | Chrome 116+，允许开启开发者模式和加载已解压扩展 |
| Gemini 账号 | 能在你的日常 Chrome 配置文件中登录并使用 Gemini |
| AI 工具 | 本地 Codex 或其他支持 STDIO MCP 的客户端；Codex 命令安装方式需要 `codex` 在 PATH 中 |
| 运行位置 | Chrome、HTTP 服务和 MCP 进程默认在同一台电脑、同一主机环境运行 |

已在 macOS + 主 Chrome 上实测。Windows / Linux 尚未实测；路径和启动方式需按系统调整。远程服务器、容器、WSL 中的 `127.0.0.1` 可能不是桌面 Chrome 所在的主机，不属于这份默认安装流程。

## 交给 AI 安装

复制本文顶部的完整提示词即可开始。下面说明 AI 应执行的步骤、需要人配合的操作，以及安装成功的判定标准。

### AI 与人的分工

| 阶段 | AI 执行 | 人需要配合 |
| --- | --- | --- |
| 准备环境 | 检查 Node/npm、项目目录、端口、已有服务和 MCP 配置 | 缺少 Node/Chrome 或系统限制安装时，完成相应安装或系统操作 |
| 本地安装 | 获取源码、安装依赖、验证并构建、启动 HTTP 服务、注册 MCP | 确保有一个能持续运行本地服务的终端或进程 |
| 浏览器接入 | 提供真实路径、地址和逐步操作说明 | 用主 Chrome 登录、首次加载扩展、填写配对信息 |
| 验收 | 检查连接、读取模型、验证 MCP，报告实际结果 | 新开 Codex 会话；需要真实生成验证时保持执行窗口可见 |
| 后续使用 | 按会话和任务 ID 查询、恢复，附上明确选定的参考文件 | 登录过期时重新登录；决定是否放弃卡住的任务或重发缺失消息 |

### 第一步：AI 完成本地安装

选择源码安装时，已有本项目目录就直接使用，不要重复克隆。否则执行：

```sh
git clone https://github.com/chenyanshan/gemini-web-to-api.git
cd gemini-web-to-api
node --version
npm --version
npm ci
npm run typecheck
npm test
npm run build
```

自动化测试不需要登录 Gemini，也不会发送真实 Gemini 提问。构建后应存在 `dist/cli.js`、`dist/mcp.js` 和 `dist/extension/manifest.json`。

在项目目录启动 HTTP 服务，并保持进程运行：

```sh
npm start
```

默认地址为 `http://127.0.0.1:43123`。AI 应确认进程仍在运行，并说明它由哪个终端或进程维持；AI 执行环境退出时可能会回收后台进程。当前项目没有自动配置开机启动，电脑重启后需要重新启动服务。已有正常运行的服务时复用，不要重复启动或随意结束占用端口的其他进程。

在另一终端、同一项目目录查看配对信息：

```sh
npm run info
```

该命令显示服务地址、插件配对令牌和数据目录，但**不代表服务已启动**。地址和令牌来自本机生成的 `.data/connection.json`，不需要从作者那里获取。让人在本地终端复制令牌，不要把它贴进公开 Issue、README 或截图。

AI 接着按下文“配置 Codex MCP”注册工具；注册不需要等待 Chrome 登录。交接给人时必须提供 `dist/extension` 的实际绝对路径，不能只给 `/absolute/path/...` 占位符。在项目根目录运行 `node -p "require('node:path').resolve('dist/extension')"` 即可取得该路径。若使用自定义数据目录或端口，服务、MCP、插件必须使用同一套配置信息。

### 第二步：人在主 Chrome 中配合

1. 用你日常使用的 Chrome 配置文件打开 [Gemini](https://gemini.google.com/app)，完成 Google 登录和必要验证。无需无痕；AI 的自动化浏览器通常是另一份配置文件，不能复用你的登录。
2. 在**同一份 Chrome 配置文件**中打开 `chrome://extensions`，打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择 AI 给出的 `dist/extension` 目录。不要选择项目根目录、`extension` 源码目录或 ZIP 文件。
4. 点击 Chrome 工具栏的扩展图标，打开 **Gemini Local Bridge**；可先将它固定到工具栏。
5. 填入 `npm run info` 显示的**服务地址**和**插件配对令牌**，点击“保存并连接”。等到状态显示“已连接本地服务”。
6. 回到 Gemini 标签页。如果这页在安装扩展前已经打开，刷新一次；保持 Gemini 为当前标签页，再打开插件并点“读取模型”。确认能看到网页实际的模型列表。若尚未登录或读不到模型，把插件错误文字告诉 AI。
7. 告诉 AI“已连接、已读取模型”，让它继续验收；新开一个 Codex 会话加载新增的 MCP 工具。

首次安装完成后无需每次重复加载扩展或填写令牌。账号登录操作由人直接在 Google 页面完成；插件不导出 Cookie。

### 第三步：AI 验收并交付

先做不消耗 Gemini 生成额度的检查。新 Codex 会话可以调用 `gemini_status`、`gemini_models_list`；尚未加载工具的安装会话可从本地配置读取令牌，调用 `GET /api/health`、`GET /api/models`。不要在诊断输出中打印令牌。

| 检查 | 成功条件 |
| --- | --- |
| HTTP 服务 | 携带本机令牌访问 `/api/health`，返回 `ok: true` |
| Chrome 配对 | 同一响应中 `browserConnected: true`，且能读取扩展版本 |
| 网页控件 | `/api/models` 或 `gemini_models_list` 的 `verified: true`，列表包含账号可用的目标模型；服务/插件重连后可能需重新读取 |
| MCP 注册 | `codex mcp get gemini-web` 指向当前构建的 `dist/mcp.js`，运行程序是可用的 Node |
| MCP 实际加载 | 新 Codex 会话能调用 `gemini_status` 并得到服务状态，而不只是配置文件里有一条记录 |

上述检查证明接入可用；真实发送与回复读取需生成测试验证。若安装任务已包含真实验证，继续做一次小型 UI 提问；否则在交付中注明“未消耗额度测试生成”，由使用者决定何时执行。验证脚本见“验证记录”，默认用 Pro，不用额度较少的 Argon 做安装测试。任务必须到 `completed` 才能算生成成功；超时后查询同一个 job_id，不新建请求重复测试。

AI 最后应交付：项目路径、服务启动方法、扩展连接状态、MCP 注册和实际加载情况、是否做过真实生成，以及尚需人完成的具体步骤。若当前 AI 会话无法加载刚新增的 MCP 工具，明确注明“已注册，待新会话验证”。

## 配置 Codex MCP

这部分由 AI 在构建完成后执行；手动安装也可照做。先检查已有配置：

```sh
codex mcp list
```

如果已经存在 `gemini-web`，用 `codex mcp get gemini-web` 核对路径和环境；正确则复用，路径过期时只更新这一项，保留其他 MCP 配置。

在项目根目录运行以下命令，获取当前 Node 与 MCP 脚本的绝对路径：

```sh
node -p "process.execPath"
node -p "require('node:path').resolve('dist/mcp.js')"
```

将两行输出分别替换到以下命令中，路径含空格时也保留引号：

```sh
codex mcp add gemini-web -- "/absolute/path/to/node" "/absolute/path/gemini-web-to-api/dist/mcp.js"
codex mcp get gemini-web
```

使用 Node 的绝对路径可以避免图形界面启动的 Codex 找不到版本管理器中的 Node。更新或删除 Node 安装、移动项目目录后，需要同步更新 MCP 配置。

如果没有 `codex` 命令，但已安装的 Codex 客户端允许编辑 MCP 配置，可在其 `config.toml` 中添加对应段落（通常为 `~/.codex/config.toml`），不要覆盖整个文件。已有同名段落时修改原段落，不要重复添加：

```toml
[mcp_servers.gemini-web]
command = "/absolute/path/to/node"
args = ["/absolute/path/gemini-web-to-api/dist/mcp.js"]
```

Windows 上使用实际的 `node.exe` 路径，TOML 路径可用正斜杠，例如 `C:/Program Files/nodejs/node.exe`。

**MCP 进程与 HTTP 服务是两个进程。** Codex 启动 `dist/mcp.js`，它通过 STDIO 接入 Codex，再访问由 `npm start` 启动的本地 HTTP 服务。注册 MCP 不会自动启动 HTTP 服务。不要用 `codex mcp add ... --url http://127.0.0.1:43123`，这个地址是普通 HTTP API，不是 Streamable HTTP MCP 端点。

默认二者都读取本项目 `.data/connection.json`，与 Codex 打开的工作目录无关。如果服务使用自定义 `BRIDGE_DATA_DIR`，注册 MCP 时传入同一绝对目录：

```sh
codex mcp add gemini-web --env "BRIDGE_DATA_DIR=/absolute/path/bridge-data" -- "/absolute/path/to/node" "/absolute/path/gemini-web-to-api/dist/mcp.js"
```

其他支持 STDIO MCP 的本地 AI 客户端也可使用相同的 command、args 和环境变量；其配置文件格式以对应客户端为准。配置后新开 Codex 会话，验证工具实际可用。

Codex 配置语法参考：[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

## MCP 工具与使用

| 工具 | 用途 |
| --- | --- |
| `gemini_status` | 连接状态及阻塞任务 |
| `gemini_models_list` | 最近从网页读取的模型；没有读取时 verified=false |
| `gemini_sessions_list` | 查找已经保存的 session_id |
| `gemini_session_create` | 创建新会话或绑定已有对话 URL |
| `gemini_session_get` | 获取会话模型、思考等级和 revision |
| `gemini_session_update` | 在同一空闲会话切模型/思考等级，返回新 revision |
| `gemini_job_inspect` | 读取原任务页状态与 DOM，诊断恢复失败 |
| `gemini_files_upload` | 暂存指定路径的参考图片、文档或代码，返回附件 ID |
| `gemini_submit` | 幂等提交，立即返回 job_id |
| `gemini_job_get` | 查询同一任务，可等待最多 20 秒 |
| `gemini_job_cancel` | 放弃卡住的任务，关闭专用标签页并释放队列 |
| `gemini_job_resume` | 恢复 unknown / blocked_login 原任务；refresh=true 刷新原页再对账 |
| `gemini_job_retry_missing` | 已获重试授权后，重发已确认在网页缺失的那一轮 |

典型调用：

```jsonc
// gemini_session_create：省略 model 默认 3.1 pro；思考等级默认 high
{"label":"设置页设计","model":"3.1 pro","thinking_level":"high"}

// 也可导入已有网页对话，再使用返回的 id 继续
{"label":"继续原设计","model":"4 argon","thinking_level":"high","conversation_url":"https://gemini.google.com/app/你的对话ID"}

// gemini_submit：session_id 为创建结果中的 id
{"session_id":"...","request_id":"settings-layout-001","expected_revision":0,"prompt":"请给出设置页分组与留白建议。当前页面结构是……"}

// gemini_job_get：重复查询，直到 completed 或需要处理的错误
{"job_id":"...","wait_ms":20000}
```

思考等级可选 `low / medium / high`，对应低、中、高。使用 `gemini_session_update`，传入 `session_id`、最新 `expected_revision` 以及 `model` / `thinking_level`，可在同一空闲会话切换并保留上下文。配置改变时 revision 增加 1；下一轮使用返回的新 revision。执行中或状态未明时拒绝切换。每轮保存模型/强度快照，旧请求重放不受后来切换影响；网页选中状态在发送前核验。

Gemini 不会自动读取工作区或继承 Codex 的全部历史。调用方在 prompt 中说明设计目标，并可显式选择本地图片、文档或代码文件作为附件。

### 图片和文件参考

先暂存文件，再把返回的 ID 加入提问；同一轮可以混合图片和文档：

```jsonc
// gemini_files_upload：本地绝对路径；只暂存，不会立即发给 Gemini
{"paths":["/absolute/path/screenshot.png","/absolute/path/design-brief.md"]}

// gemini_submit：attachment_ids 使用上传结果中的值
{"session_id":"...","request_id":"ui-reference-001","expected_revision":0,"prompt":"结合截图和设计说明，优化布局与按钮层级。","attachment_ids":["<图片ID>","<文档ID>"]}
```

每轮最多 **10 个附件**，单个 **20 MiB**，总计 **40 MiB**，文件名不能重复。这些是本地桥接限制；Gemini 网页仍决定实际接受的格式、大小与额度。支持通过网页入口上传 PNG/JPEG/WebP 等图片，以及 TXT/Markdown/PDF、代码等文件；具体格式需网页支持。图片预览数据无法与原始快照核对时暂停发送，不把未经核对的附件当成功。

文件以不可变快照保存在本地 SQLite，内容、文件名和 MIME 相同的上传会去重。提交后修改原文件不会改变正在执行的任务；若要发送新版，重新上传并使用新的 request_id。重试原请求须复用原附件 ID、顺序和其余参数。

插件逐个读取并校验附件 SHA-256，通过网页上传，等待预览就绪后才发送文字。断线恢复先检查原草稿；不会对已经记录上传意图的附件盲目再添加。若预览丢失或上传失败，先自动刷新一次原页；历史不变、仍处于发送前且刷新后附件为空时，重建原附件。仍失败可用 `gemini_job_resume(refresh=true)` 再核对，每任务最多刷新两次。已发送的原任务只核对网页消息，不重新上传。Gemini 可能转换已发送的图片，恢复核对以图片数量、文档名称、原提问及轮次为依据。

继续同一 session 时通常无需重新附上旧文件；需要新增参考时，在新一轮附上新的 attachment_ids。新会话需重新提供需要的参考，可复用已暂存 ID。

## 前端设计 skill

仓库和 runtime 包提供 [`skills/gemini-ui-design/SKILL.md`](skills/gemini-ui-design/SKILL.md)。将整个 `gemini-ui-design` 目录复制到本机技能目录（Codex 默认 `~/.codex/skills/`），新会话即可发现。它覆盖从零设计、上传现有截图与代码后改造、索取 HTML/组件示例、连续追问与故障恢复。MCP 的使用说明保持相同范围。

## HTTP API

所有 API 请求均带 `Authorization: Bearer <token>`；JSON 请求带 `Content-Type: application/json`。

| 方法与路径 | 请求参数 |
| --- | --- |
| `POST /api/files` | 原始二进制 body；`X-File-Name` 为 encodeURIComponent 编码的文件名，`Content-Type` 为 MIME |
| `GET /api/files/:id` | 附件元数据 |
| `GET /api/files/:id/content` | 已鉴权的附件二进制内容 |
| `GET /api/health` | 连接状态与阻塞任务 |
| `GET /api/models` | 已观测模型列表 |
| `GET /api/sessions` | 已保存的会话 |
| `POST /api/sessions` | `model?`, `thinking_level?`, `label?`, `conversation_url?` |
| `GET /api/sessions/:id` | 当前会话与 revision |
| `PATCH /api/sessions/:id` | `expected_revision`, `model?`, `thinking_level?` |
| `POST /api/sessions/:id/jobs` | `request_id`, `prompt`, `expected_revision`, `timeout_ms?`, `attachment_ids?` |
| `GET /api/jobs/:id?wait_ms=20000` | 查询任务 |
| `POST /api/jobs/:id/cancel` | 放弃任务并关闭专用标签页 |
| `POST /api/jobs/:id/resume` | `refresh?`，对账并继续等待原任务 |
| `GET /api/jobs/:id/browser-state` | 原页状态及 DOM 诊断 |
| `POST /api/jobs/:id/retry-missing` | `request_id`, `acknowledge_duplicate_risk: true` |

例如上传图片（令牌通过环境变量提供）：

```sh
curl --fail-with-body http://127.0.0.1:43123/api/files \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "X-File-Name: screenshot.png" \
  -H "Content-Type: image/png" \
  --data-binary @/absolute/path/screenshot.png
```

返回的 `id` 放入提交任务的 `attachment_ids` 数组。上传端点不使用 multipart/form-data；非 ASCII 文件名先做 URI 编码。

`Idempotency-Key` 请求头可代替 `request_id`；两者同时出现时必须相同。相同 ID 和内容返回同一个任务，即使结果已完成；相同 ID 配不同内容返回 409。

每次成功完成后 revision 增加 1，下一次提问使用新 revision。同一会话一次只接受一个任务，多个会话按全局队列串行执行。

## 断线、卡顿和重试

- SQLite 保存提问、会话 URL、发送意图、状态和完整结果；扩展同时保存发送检查点及回复缓存。
- 发送前，本地服务必须确认检查点已经落库；未确认则不点击发送。
- WebSocket 断线后有界指数退避重连；原任务进入 reconciling，恢复原标签页或原对话。
- 已有本轮用户消息则继续读取本轮回复，不能重新发送。完整结果可以反复获取。
- 上传失败、控件暂时不可用或页面持续无回复进展时（`4 argon + high` 为 6 分钟，其他配置 90 秒），最多自动刷新一次原页；发送前重建草稿，发送后仅核对原轮。`resume(refresh=true)` 可再刷新一次，总上限两次，跨重启保留。`4 argon + high` 默认总期限 20 分钟，其他配置 10 分钟，可显式配置 10 秒至 30 分钟；不会自动降级模型。
- 任务查询和 status 的阻塞项返回 `recovery`，明确建议继续查询、刷新恢复、检查原页或处理登录；达到恢复上限后报告具体错误，不无限轮询。
- MCP 工具调用超时不取消任务。重试查询同一 job_id；提交请求丢响应时复用完全相同的 request_id 和参数。

针对 4 argon 刷新后本轮消息消失的情况：

1. 调用 `gemini_job_resume` 核对原对话。
2. 若原对话只剩发送前历史，返回 `unknown` + `turn_missing`，并保留原始提问与发送记录。
3. 用户已授权刷新重试或明确同意重发后，调用 `gemini_job_retry_missing`，使用一个新的重试 request_id，并传 `acknowledge_duplicate_risk: true`。替代任务仍使用原会话、原模型、原提问和原附件快照。
4. 如果此重试调用本身超时，重复调用时复用同一个重试 request_id。旧任务的 replacementJobId 指向唯一替代任务。

网页没有本轮消息，不能证明远端从未接收，也不能证明额度没有消耗，因此不自动重发。其他无法确认的任务保持 unknown，队列暂停，避免多个未完成生成互相干扰。若决定放弃，可用 `gemini_job_cancel` 关闭任务页并释放队列，再新建会话。取消后原会话暂停，因为其上游状态仍可能不确定。刷新次数耗尽、登录失效或历史冲突时仍需处理具体原因；上游异常无法保证全部自动恢复。

不要手工操作插件创建的专用会话标签页。历史变化、额外消息或模型切换会触发冲突，而不是静默使用另一份上下文。原对话被删除、浏览器登录失效或网页结构变化时需要恢复环境后再查询。

## 常见安装问题

| 现象 | 处理 |
| --- | --- |
| `npm ci` / 构建报错 | 检查 Node 版本，确认下载了完整源码和 lockfile，且安装时没有省略 devDependencies。将具体错误交给 AI，不跳过构建直接加载扩展 |
| Chrome 提示找不到 manifest | 先完成 `npm run build`，加载 `dist/extension`，确认其中有 `manifest.json` |
| 插件提示“本地连接凭证无效” / API 返回 `unauthorized` | 确认服务已启动，用同一项目和数据目录运行 `npm run info`，重新复制地址和完整令牌到插件并保存。不要删除 `.data` 来重置 |
| 地址栏打开 API 显示 `unauthorized` | 地址栏不会携带 Bearer 令牌。浏览器说明页请访问 `/`；API 由 MCP 或带鉴权的客户端调用 |
| 插件一直“连接中断” | 检查 `npm start` 是否还在运行，地址是否为 `http://127.0.0.1:端口`，以及服务是否误跑在远程/容器环境 |
| `EADDRINUSE` | 端口已占用。先确认是否是本项目已有服务；正确则复用，其他程序则选新端口。不要直接杀死未知进程 |
| 读不到网页模型 / 页面脚本未就绪 | 在安装扩展的同一 Chrome 配置文件登录 Gemini，首次安装后刷新 Gemini 页，再切换到该页点击“读取模型”。有已发送的未完成任务时先恢复核对，不盲目刷新 |
| 找不到 3.1 Pro / 4 Argon 或思考等级 | 先确认网页是否真的提供该选项。名称变化可调整标签匹配；账号无权限或网页结构变化需另行处理，不能用其他模型冒充 |
| `codex` 命令不存在 / MCP 无法启动 | 使用上面的配置文件方式，核对 Node 和 `dist/mcp.js` 的绝对路径；新开 Codex 会话再验证 |
| MCP 工具可见，但提示本地服务不可用 | 工具注册成功不代表 HTTP 服务正在运行；启动 `npm start`，核对 MCP 与服务的数据目录 |
| 回复正文出现但任务一直等待 | 保持插件的独立执行窗口在前台，不要最小化；继续查询同一 job_id，按恢复流程处理 |
| SQLite `ExperimentalWarning` | 部分 Node 版本的提示，不等于服务失败；以服务启动输出和健康检查为准 |

## 日常启动与更新

日常使用时保持 Chrome 已登录，启动本地服务，再使用 Codex。插件面板关闭不影响任务。任务在同一 Chrome 配置文件的独立窗口中执行，插件会将其激活以避免后台页面暂停渲染；不要最小化执行窗口。服务、Chrome 和电脑需要保持运行，休眠或断线时任务等待恢复。

更新前先处理完运行中或状态不明的任务。保留 `.data` 和 Chrome 中的扩展配置，在原项目目录更新源码后执行：

```sh
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run build
```

有本地修改或更新冲突时先处理差异，不使用强制重置。停止旧服务并重新运行 `npm start`，在 `chrome://extensions` 点击本扩展的“重新加载”，或由 AI 使用项目提供的重载接口；随后重新检查连接和模型。新开 Codex 会话以加载新增或修改的工具。路径未变化时无需重复注册 MCP；不要移动或删除 Chrome 正在使用的 `dist/extension` 目录。

## 验证记录

2026-10-31 已通过 65 项自动化测试、六种模型/强度控件组合，以及同一真实对话五轮截图＋HTML/CSS 上传与生成（包含 Argon）。上传卡住的原任务经刷新恢复后完成；最终页面恰有五轮，没有重复发送。详细证据与边界见 [可靠性验证记录](docs/reliability-validation.md)。

已在 macOS 的日常 Chrome 配置文件中读取到 3.1 Pro、4 Argon 以及低/中/高选项。3.1 pro + medium 已完成两轮真实 UI 问答，验证原会话上下文、代码块、同一请求结果重放，并在扩展重载和服务重启后恢复了原任务，没有重复发送第一轮提问。图片 + TXT 混合附件已用 3.1 pro 完成同一会话两轮实测，正确读出文件校验码、按钮圆角及图片配色；上传准备中断和发送后检查中断均恢复了同一任务，没有重复发送。

后台窗口可能暂停 Gemini 的回复动画，使正文已经出现而完成标记迟迟不更新。实际联调确认，将执行窗口置于前台可以恢复完成状态，因此插件在执行时会激活独立窗口。

`node scripts/smoke-live.mjs --confirm-live` 会实际发送两轮 3.1 pro UI 提问；仅在明确需要时执行。中断后用 `--confirm-live --resume` 查询/恢复同一批任务，避免重复提问。

`node scripts/smoke-reliability.mjs --confirm-live` 验证同一对话五轮 PNG + HTML/CSS 混合附件（包括同主名代码文件）、Pro → Argon → Pro 切换、三档思考强度、上下文校验码及 HTML/CSS 输出；包含一轮 Argon 生成。中断后加 `--resume` 继续原任务；`--retry-missing` 表示允许对核实缺失的轮次重发一次。

`node scripts/smoke-attachments.mjs --confirm-live` 会上传自生成的 PNG 和 TXT 并实际发一轮 UI 验证提问。中断后加 `--resume` 查询原任务；若任务为 unknown，先使用 resume API 恢复。加 `--resume --followup` 可再验证同一会话的新一轮附件上传。

## 数据和开发

- `.data/connection.json`：服务地址、随机令牌；不提交 Git。
- `.data/bridge.sqlite`：会话、提问、结果及附件原始字节；不提交 Git。附件暂不自动清理，以保证旧任务能够恢复，长期使用需关注磁盘占用。
- 扩展 `chrome.storage.local`：配对信息、标签页映射、发送记录及回复缓存。
- 登录凭据留在 Chrome，不导出 Cookie。服务仅监听 127.0.0.1，校验 Host、Origin 和令牌。

首次运行 `npm run info`、`npm start` 或 MCP 前可用 `BRIDGE_PORT` 选择端口；`BRIDGE_DATA_DIR` 可指定数据目录。MCP 和服务必须使用相同的目录。已有 connection.json 后端口以该文件为准。

```sh
npm run typecheck
npm test
npm run build
```

`node scripts/inspect.mjs` 会使用临时 Gemini 标签页读取模型、思考等级和上传入口控件，不上传文件或发送提问。`--exercise` 验证 Pro/Argon × low/medium/high 六种切换，再恢复原设置。`--reload` 可在没有未完成任务时先重新加载开发版扩展。诊断 HTML 保存在 `.data/controls.json`，不包括聊天正文。

网页 DOM 不是稳定接口。适配器识别不到控件时明确报错，不能据此宣称上游始终可用。网页选中项的验证也不代表能独立核实 Google 未公开的底层模型路由。

## 发布与许可证

仓库使用 GitHub Actions：推送 `main` 或提交 PR 时运行 Node.js 22 / 24 的版本检查、类型检查、测试和构建。推送稳定版本标签 `vX.Y.Z` 时触发 [Release 工作流](https://github.com/chenyanshan/gemini-web-to-api/actions/workflows/release.yml)，检查通过后自动发布 GitHub Release，并附上：

| 附件 | 内容 |
| --- | --- |
| `gemini-web-to-api-X.Y.Z-extension.zip` | 可解压加载的 Chrome 扩展，manifest 位于压缩包根目录 |
| `gemini-web-to-api-X.Y.Z-runtime.tar.gz` | 已构建的本地服务、MCP、扩展、安装说明和依赖锁文件 |
| `SHA256SUMS.txt` | 两个安装包的 SHA-256 校验值 |

打包采用明确的文件清单，并在临时目录中执行仅生产依赖的干净安装，验证 HTTP 健康检查和 MCP 工具。整个 CI/Release 流程不登录 Gemini，也不消耗生成额度。

维护者发布新版本（下面以 `0.2.1` 为例，首次发布当前版本可直接使用 `v0.2.0`）：

```sh
npm version 0.2.1 --no-git-tag-version
npm ci
npm run typecheck
npm test
npm run release:package
node scripts/verify-release.mjs
git add package.json package-lock.json extension/manifest.json
git commit -m "chore: release v0.2.1"
git tag -a v0.2.1 -m "Release v0.2.1"
git push origin main
git push origin v0.2.1
```

`npm version` 会自动同步扩展 manifest；MCP 从 package.json 读取版本。发布流程要求标签、package.json、lockfile 和 manifest 一致，否则失败。当前只支持稳定的 `X.Y.Z`，不支持 prerelease 后缀。发布前将所有功能改动一并提交，确认工作区干净；已发布标签不移动，修复使用新版本。

Actions 使用仓库自带的 `GITHUB_TOKEN`，发布 job 声明 `contents: write`，无需单独保存个人 Token。仓库或组织必须允许运行 GitHub Actions 及该写入权限。推送标签后在 Actions 页面确认成功；发布失败时修复原因并重跑对应工作流，不能仅凭标签存在判断已发布。

本地 `npm run release:package` 使用 `zip` 和 `tar`，输出到已被 Git 忽略的 `release/`；官方工作流在 Ubuntu 上打包。Release 不是 Chrome Web Store 发布，不提供 CRX 或自动更新；更新方式见安装指南。

发布源码时保留 `package-lock.json`；不要上传本机 `.data/`（包含令牌、对话和附件）、`node_modules/`、`dist/` 或诊断日志，仓库的 `.gitignore` 已包含这些主要路径。`.gitignore` 不会移除已经被 Git 跟踪的文件，发布前需检查实际待提交内容。

当前仓库尚未提供 `LICENSE`。公开发布前，维护者应选定许可证并添加对应文件，明确他人使用、修改和分发代码的条件。
