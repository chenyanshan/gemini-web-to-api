# Gemini 网页转本地工具：实现方案

目标：Codex 仅在 UI 和前端设计问题上咨询 Gemini，获取建议后继续本地开发。默认 3.1 pro，复杂视觉优化可用 4 argon；其他开发问题不调用 Gemini。已实现代码和自动化测试，实际使用说明见 README.md，网页链路仍需持续验证。

## 1. 架构

```text
Codex ── STDIO MCP 适配器 ── HTTP 本地 Node.js 服务 ── WebSocket ── Chrome MV3 扩展
                                      │                              │
                                    SQLite                     content script
                                                                     │
                                                            Gemini 专用会话标签页
```

- 本地服务：HTTP API、MCP 工具、任务队列、会话映射、幂等记录、重试调度和结果持久化。
- 扩展 service worker：连接本地服务、管理标签页、转发任务、报告页面状态。不能作为唯一任务状态存储。
- content script：识别当前会话、填写提示词、提交、观察新回复、提取 Markdown/代码块、检测页面错误。
- 扩展 popup：显示连接、登录和任务状态，提供配对和恢复操作；关闭 popup 不应影响任务。
- 使用现有 Chrome profile 的 Gemini 登录状态，无需导出 Cookie 到 Node.js。

第一版建议 TypeScript + Node.js + SQLite + MCP SDK + MV3。已支持文本、代码块及图片／文件附件；保持全局串行执行。

## 2. 接入 Codex

官方文档确认本地 Codex 支持 STDIO 和 Streamable HTTP MCP。实现选择 STDIO MCP 适配器连接常驻本地 HTTP 服务，二者共用同一个任务系统。

建议工具：

```text
gemini_models_list() -> 可验证的网页模型及其可用状态
gemini_session_create(label, model, thinking_level?, conversation_url?) -> session_id
gemini_files_upload(paths) -> files, attachment_ids
gemini_submit(session_id, request_id, prompt, expected_revision, attachment_ids?) -> job_id
gemini_job_get(job_id, wait_ms?) -> state, result?, error?, session_revision
gemini_session_get(session_id) -> state, revision, conversation_url
```

`submit` 快速返回持久化任务 ID；`get` 可以有上限地等待，例如最多 20 秒。MCP 工具调用超时不取消后台任务。客户端先查询已有任务，不重新生成一个请求 ID提交。需要便利接口时，可以在这些原语之上增加有界等待的 `gemini_ask`。

MCP instructions 应说明：复用 session_id；同一逻辑提问的重试复用 request_id；提交前保存 request_id；提交后保存 job_id；返回等待状态时继续查询；将 Gemini 输出作为外部建议验证。应明确把本轮所需代码和错误信息放入 prompt，Gemini 不会自动读取 Codex 工作区或获得 Codex 全部上下文。

普通 HTTP API 可对应为：

```text
POST /api/sessions
POST /api/sessions/:session_id/jobs
GET  /api/jobs/:job_id
GET  /api/sessions/:session_id
```

提交用 `Idempotency-Key` 携带 request_id，成功返回 202 和 job_id。保留这些会话语义比第一版模拟无状态聊天接口更直接。

来源：https://learn.chatgpt.com/docs/extend/mcp?surface=cli

## 3. 会话如何保持

需要区分登录会话、Gemini 对话和 API 请求。

| 对象 | 标识 | 恢复方式 |
| --- | --- | --- |
| Chrome 登录环境 | browser_instance_id + 已绑定的登录身份 | 复用原 profile；登录过期则等待重新登录 |
| Gemini 对话 | conversation_url / 可验证的 conversation_id | 打开原对话并验证可访问性与对话内容 |
| 本地业务会话 | session_id | SQLite 映射到 Gemini 对话 |
| 一次逻辑提问 | request_id / job_id | 查询任务和缓存结果，禁止盲目重发 |

会话表保存 session_id、browser_instance_id、account_binding、conversation_url、model、revision、status。tab_id 仅是运行期定位信息，重启后重新发现，不能当作永久会话 ID。账号身份的具体读取方式需要实测；无法可靠读取时采用明确的人工绑定，页面状态不符合绑定时暂停。

第一轮可能要等实际发送后才取得永久对话 URL。此阶段会话标记为 initializing，绑定专用标签页并禁止其他请求进入；取得可验证的对话 URL 后再持久化绑定。

- 一个 session 固定一条 Gemini 对话；同一 session 的任务串行执行。
- 第一版整个扩展只执行一个生成任务，其他会话排队；后续才考虑多个标签页的有限并发。
- 重启后根据 conversation_url 恢复页面，核对身份、对话和最后已知轮次，再接续任务。
- revision 在任务成功并保存结果后递增；客户端提交时携带 expected_revision，防止并发客户端基于旧上下文提交。需在入队及实际执行前核验。
- 检测到手工新增消息、切换账号或无法匹配对话时，标记 session_conflict 并暂停。不要悄悄采用已经变化的上下文。
- 使用可保存的对话；临时聊天或无法持久化的对话不能承诺跨重启恢复。
- 原对话被删除或不可访问时返回 session_lost。允许显式创建带摘要的新会话，但它不是原会话的恢复。

同一对话可以保留服务端上下文，但无法保证网页模型无限保留全部历史。长会话可显式做摘要并创建后继会话，保留迁移关系。

### 登录环境与指定模型

用户确认模型为 `3.1 pro` 和 `4 argon`。已从主 Chrome 实际读到 `3.1 Pro 高级推理`、`4 Argon 复杂任务` 和思考等级入口。思考等级独立支持 low / medium / high，默认 medium。顶部缩写可能显示 Pro / Argon，模型身份以菜单完整选项的选中标记核验。

- 推荐普通 Chrome 的专用 profile，安装扩展后在这个 profile 中手动登录 Gemini。无需无痕；无痕会增加登录持久化和扩展启用的配置成本。
- 模型别名映射到网页上已验证的具体选项，记录 alias、UI label、模式和最近验证时间。不得凭名称推断未公开模型 ID。
- `gemini_models_list` 读取当前账号能实际选择的项目；无法读取时返回无法确认，不虚构静态可用列表。
- 创建 session 时指定 model 并固定。每轮发送前验证当前选中项；必要时在发送前切换并确认成功。模型和思考模式如果是两个控件，需要分别核验。
- 若页面模型选择属于全局状态，第一版全局串行队列覆盖“选择模型到生成完成”的整个区间，避免不同会话互相干扰。
- 模型不存在、账号无权限或额度限制时返回 `model_unavailable`。网页提示自动降级时停止或标记模型不匹配，不静默接受降级结果。
- 返回结果包含 requested_model、observed_model_label 和 model_verified；网页可验证的通常是 UI 选项，不能据此保证未公开的底层模型版本。
- 第一版会话内不切换模型；使用另一模型时显式创建另一 session，必要时携带用户认可的上下文摘要。

## 4. 请求状态与幂等

```text
queued → preparing → dispatching → submitted → streaming → completed
                       │             │            │
                       └─────────────┴────────────┴→ reconciling

其他状态：retry_wait、blocked_login、session_conflict、failed、unknown
```

- queued：任务已持久化，等待执行。
- preparing：已确认页面和会话，尚未执行发送动作。
- dispatching：发送意图已写入数据库，页面可能已经发送；崩溃后必须对账。
- submitted：已观察到本次新用户消息，保存定位信息。
- streaming：观察到与本轮对应的新回复。
- completed：完成信号成立且最终结果已提交到数据库，然后才通知调用方。
- reconciling：恢复后读取原页面，核对发送和生成进度。
- unknown：在恢复期限内无法确认是否发送/完成，需要显式处理，不能自动重发。

幂等唯一键为 `(session_id, request_id)`，并保存完整请求语义的 hash，包括 prompt、模型选项和 expected_revision。相同 key、相同内容返回同一个任务或已缓存结果；相同 key、不同内容返回冲突。先检查幂等记录，再做 revision 校验，已完成请求的重放不因 revision 已递增而失败。

任务表保存 prompt、状态、attempt、deadline、发送前最后轮次、发送意图、可用的用户消息/回复定位信息、结果和结构化错误。不要只比较 prompt 文本：相同文本可能是用户有意重复的提问。网页若不提供稳定消息 ID，需要综合发送前后的轮次、内容和页面结构判断；证据不足就返回 unknown。

服务与扩展的命令带 job_id、command_id、attempt 和执行代次。扩展维护去重记录，重连后先报告未完成任务再恢复派发。代次检查可拦截陈旧命令，但不能撤销已经发生的页面点击；旧执行器未确认停止时，不允许把同一任务派给另一个页面。执行锁过期不等于可以重新发送。

网页发送和本地数据库写入无法成为一个事务，因此无法保证 Gemini 上游严格的 exactly-once。可保证本地请求幂等、完成结果可重取，并在上游状态不明时停止自动发送。

## 5. 故障和重试

| 场景 | 处理 |
| --- | --- |
| 提交前发现扩展离线、页面尚未加载 | 有界重连/等待，再执行原任务 |
| 已进入 dispatching，确认回执丢失 | 进入 reconciling，先查原对话 |
| 用户消息已存在，Gemini 仍在生成 | 继续观察原回复，不再次提交 |
| 原回复已完成，客户端或连接断开 | 持久化并返回原结果 |
| 明确限流或临时故障，且确认没有接受本轮提问 | 遵循可用的重试提示；否则指数退避加随机抖动 |
| 本轮已被接受，但生成显示失败 | 保存失败状态；重新生成是一次显式的新尝试 |
| 登录过期、验证页面、需要人工交互 | blocked_login，完成登录后重新对账 |
| 页面结构不再可识别 | adapter_incompatible，停止点击并保留诊断信息 |
| 只有部分回复且完成状态不明 | 返回明确的 partial/unknown 状态，不标记成功 |
| 服务或浏览器崩溃 | 从 SQLite 找到未完成任务，恢复对应对话并对账 |
| 找不到原对话或无法确认是否已经发送 | session_lost / unknown，不创建新对话冒充恢复 |

重连与等待可用 full jitter：`random(0, min(cap, base * 2^attempt))`。例如 base=1 秒、cap=30 秒。发送重试次数、连接恢复次数分别记账，并设总 deadline。重试预算用于已确认可安全重试的动作，不允许绕过 unknown。

建议区分：排队期限、页面准备期限、首次响应期限、生成空闲期限和任务总期限。Gemini 思考期间可能长时间没有文本变化，空闲阈值仅触发状态检查，不能直接判定发送失败。实际阈值通过实测设置。

## 6. 页面适配和回复完成判断

将 Gemini DOM 操作封装成独立 adapter：

```text
inspectSession()
preparePrompt()
submitPrompt()
reconcileTurn()
observeReply()
extractReply()
```

第一版用真实页面交互，不依赖未公开的内部请求协议。具体选择器、输入事件、可用会话标识和完成信号必须在已登录页面上验证，不能在未检查 DOM 时写死为已知事实。

优先使用可验证的语义属性定位控件，适配失败时拒绝继续点击。利用 MutationObserver 跟踪本轮回复，并结合生成状态、完成控件、错误提示等多个信号判断完成；“文本几秒没有变化”只用于稳定性辅助。

提取时保留代码块、语言标记和换行，排除思考状态、按钮文字和旧轮回复。最终文本以完成时的完整提取结果为准。

第一版仅回传完整结果。若增加流式输出，要按网页展示进度发事件；这不是原生 token 流。DOM 可能重写已有文本，推荐可替换的全文快照加事件序号，或者明确区分 append 与 replace 事件。网络断开后从缓存重放事件，不重新提问。

## 7. Chrome 生命周期与本地连接

- MV3 service worker 可能终止；内存里的 WebSocket、计时器和 Map 不能承担恢复保证。
- 本地服务保存任务事实，chrome.storage 保存扩展配对信息和恢复所需的少量命令记录。
- 建立握手、心跳、断线重连和恢复协议，并通过浏览器支持的启动/唤醒机制触发重连。心跳不是永久运行保证。
- Chrome 退出、电脑睡眠、标签页丢弃时任务暂停；恢复后先对账再继续。不要承诺无人维护的全天候可用性。
- HTTP / WebSocket 只绑定 loopback；首次配对生成本地凭证，鉴权 API 与扩展连接并校验 Host/Origin。普通网页不能直接派发任务，浏览器登录凭据不进入服务日志。

## 8. 实现顺序和验收

1. 验证页面适配：发一轮提问、读完整回复、保留代码块；在原对话追问确认上下文保持。
2. 增加 SQLite、会话映射、任务状态机和幂等提交，再接入 HTTP / MCP。
3. 故障注入：发送前断线、点击发送后丢回执、生成中刷新、生成完成后丢响应、服务重启、worker 重启。
4. 验证队列与异常：同会话重复提交、相同幂等键不同内容、账号切换、手工修改对话、页面结构变化和登录过期。

核心验收：同一 request_id 重试不会派发第二次已确认的提问；原结果完成后可以反复查询；同一 session 追问保持原对话；状态不明时有明确错误和恢复路径，不伪造成功或静默新建会话。

网页适配器是整个系统的主要不确定性。先做一条完整的真实页面链路和故障恢复验证，再扩展功能。


## 9. 附件实现

- `POST /api/files` 接收有界原始二进制流，鉴权后保存 SQLite BLOB 和文件元数据。附件 ID 由名称、MIME 和内容 SHA-256 派生；幂等上传保留同一快照。
- MCP 只读取显式指定的绝对路径，限制为普通文件并限定实际读取字节数。工具返回附件 ID，提交任务才触发网页上传。
- Job 保存附件元数据快照；请求 hash 包含有序附件 ID。旧的无附件请求 hash 保持兼容。显式重试缺失消息时继承原附件。
- WebSocket 只传元数据。内容脚本按需请求 worker，worker 校验任务和所属标签页后从本地 HTTP 取单个文件，以 base64 传给内容脚本。字节不写入 chrome.storage；重连后仍可读取 SQLite 快照。
- Gemini 当前的图片与文档入口是两个 file input，按 MIME/扩展名匹配。用 File + DataTransfer 触发 change，无需操纵系统文件选择器。
- 每个文件添加前持久化 upload intent；逐个等待预览和发送控件就绪。开始过的附件在恢复时只检查，不重复添加。图片在发送前对 blob 预览进行 SHA-256 核对。
- 草稿使用 gem-attachment / gem-media-attachment；已发送轮次使用 user-query-file-preview。发送后核对文档全名、图片数量、原提问和轮次。图片可能被上游转换，不能对所有远端预览保证字节相等。
- 本地限制为 10 个文件、单个 20 MiB、总计 40 MiB；网页自身限制继续生效。未知上传结果阻塞任务，禁止退化为仅发送文字。
