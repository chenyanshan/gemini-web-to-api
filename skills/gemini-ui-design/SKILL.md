---
name: gemini-ui-design
description: 用 Gemini 协作完成前端与 UI 设计、页面或组件实现、视觉优化和改版；可上传现有界面截图及 HTML/CSS/JS、React/Vue 等代码，请它提出改造方案并生成代码或 HTML 示例，再在本地实现和验证。适用于从零设计或基于现有实现迭代。通过 gemini-web MCP 调用，包含连续附件、模型与思考等级切换、卡顿恢复。
---

# Gemini 前端设计协作

前端或 UI 设计任务可以交给 Gemini：布局、视觉层级、组件、响应式、交互状态，以及可运行的 HTML/CSS/JS 或框架代码。可以让它直接产出设计和代码，不限于口头点评。与设计无关的后端、API 或一般排错在本地处理。

## 从现有实现改造

- 查看用户目标与现有页面，选择相关截图、组件代码和样式。需要时先运行页面并截图，再将这些明确选定的文件用 `gemini_files_upload(paths=[绝对路径…])` 暂存。不扫描或上传整个仓库、凭据、无关资料。
- 用 `gemini_submit` 的 `attachment_ids` 随提问发送。说明设计目标、技术栈、需要保留的行为、当前问题与所需交付物，例如“先指出布局问题，再给出完整 React/CSS 实现”或“输出可直接打开的单文件 HTML 示例”。
- 从零设计时，直接提供需求、内容结构、风格和技术约束；有参考图也可一并上传。
- 阅读 Gemini 输出，结合工程约束实现并运行验证。必要时将新版截图和改动代码再传给同一个会话，要求它继续优化。最终交付本地实际完成的结果。

提示词示例：

> 附件是当前设置页截图和 Settings.tsx、settings.css。请保留现有事件和数据接口，重新设计分组、留白、字体层级、移动端布局及加载/错误状态。先简述方案，再给出可替换的组件与 CSS；如果提供原型，请给完整单文件 HTML。不要假设未提供的业务接口。

## 会话、配置与附件

1. 先用 `gemini_status` 确认连接及阻塞任务，并在新一轮 Gemini 工作开始前用 `gemini_models_list` 检查可用模型；只有当前 Lite 标签不足以判定限流，还需确认目标模型不可选。已知限流时直接遵循下方停止规则，不重复探测。新任务用 `gemini_session_create`，继续已有讨论用原 `session_id`；也可绑定已有 Gemini 对话 URL。
2. 正常请求使用 `model="3.1 pro"`、`thinking_level="high"`。困难任务、全局设计/重构，或多次重构仍不满意时，使用 `model="4 argon"`、`thinking_level="high"`。此升级策略已经获得授权，简要说明选择后直接执行；已有讨论在原会话空闲时切换。用户另有明确指定时遵从。不要因为连接或上传错误而换模型。
3. 空闲时，用 `gemini_session_get` 读取 revision，再用 `gemini_session_update(session_id, expected_revision, model?, thinking_level?)` 在同一上下文切模型或 `low/medium/high` 思考等级。保存返回的新 revision。网页选中状态在下一轮发送前核验；更新配置本身不发送消息。
4. 暂存返回不可变附件 ID；每轮最多 10 个、单个 20 MiB、合计 40 MiB，同轮文件名不重复。新版代码或截图重新暂存；旧文件在后续讨论里通常不用再传。要测试或重新提供同一文件时可复用 ID。
5. 发送前记录唯一 `request_id`、完整参数和最新 revision；提交后保存 `job_id`。同一请求丢响应时复用原 request_id、附件顺序和全部参数，不能另起一次提问。
6. 用 `gemini_job_get(wait_ms=20000)` 等到 `completed`。完整结果保存于本地，重复读取不消耗生成额度。每轮完成或配置改变后重新获取 revision。

## 限流：只剩 Lite 时停止

当网页只剩 `Lite` / `Flash-Lite` 可用，且无法切换到 `3.1 pro` 或 `4 argon`（两者缺失、禁用或网页明确提示额度限制）时，按限流处理，立即停止 Gemini 相关工作。网页明确提示限流、额度耗尽，或用户已告知限流时，同样停止，不再通过反复切模型确认。

- 不降级到 Lite，不继续提交、上传、轮询等待或切模型；不刷新、重试、另建 session，也不取消任务或关闭原页。限流不能用卡顿恢复流程解决；工具返回的 `recovery` 建议不覆盖本停止规则。
- 保留现有页面、草稿、附件和 `session_id` / `job_id`，简要告诉用户“Gemini 已限流，已停止相关操作”。已有回复可保留，但当前模型标签不能证明该回复由请求的 Pro/Argon 生成，不标记模型验证成功。
- 等用户告知额度恢复或明确要求重新检查后，才检查目标模型是否恢复可选；恢复后先核对原任务状态，避免重复发送。不定时轮询或在后台自动恢复。
- 可以继续不依赖 Gemini 的本地实现、测试和 bug 修复；不要因此暂停整个项目。

## 卡顿与恢复

以下恢复流程仅适用于未触发上述限流停止条件的情况。若检查原页发现只剩 Lite 且目标模型不可用，立即转入停止规则。

`4 argon + high` 等待 3～5 分钟属于正常情况，持续查询同一 job_id，不因这段等待刷新、换模型或重发。桥接在该配置连续 6 分钟没有回复进展后才判定卡顿，默认总期限 20 分钟；其他配置分别为 90 秒、10 分钟。工具单次等待 20 秒结束并不是生成超时。

工具等待超时不代表任务取消。先查询同一个 job_id，读取 `error`、`checkpoint` 和 `recovery` 建议，采取对应操作，不要无限重复轮询。

- `queued/preparing/submitted/streaming/reconciling`：继续查询；用 status 看是否被另一个任务阻塞。插件对可恢复上传错误或页面无进展自动刷新一次。
- `unknown` 且上传失败、页面卡住：`gemini_job_resume(job_id, refresh=true)` 刷新原页并对账。发送前、历史不变且草稿附件消失时，桥接会重建原附件；已经发送则只读取原轮结果。每任务最多刷新两次，次数跨重启保留。
- `blocked_login`：说明需要恢复原 Chrome 的登录，随后 resume 原任务。
- `turn_missing`：刷新后原页确实缺少本轮。若用户已授权“刷新再重试”或重发，可以用 `gemini_job_retry_missing(job_id, request_id=新的重试ID, acknowledge_duplicate_risk=true)` 重发一次；否则说明可能重复消耗额度后取得授权。记录 replacementJobId，操作超时复用同一个重试 ID，不再创建另一份。
- `session_conflict/draft_conflict/attachment_conflict/model_mismatch`、达到刷新上限或重复同一错误：用 `gemini_job_inspect` 检查原页及 `gemini_job_get` 的检查点。保留用户草稿和原对话，不强行覆盖。说明具体错误、已做的恢复及下一步；不要宣称已成功或在后台反复重试。
- 确定放弃时用 `gemini_job_cancel` 关闭任务页并释放队列；不确定的原会话会暂停，不以另建会话冒充原上下文恢复。

此 skill 依赖已配置的 `gemini-web` MCP。如果工具不可用，明确说明连接缺失；可继续本地设计工作，不伪造 Gemini 反馈。安装与升级见本项目 README。
