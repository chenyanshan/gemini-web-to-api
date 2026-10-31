# 可靠性验证记录（2026-10-31）

环境：macOS、用户日常 Chrome 的已登录 Gemini、本地 Node.js 24.12.0。所有真实生成仅上传脚本生成的 UI 图片和代码文件。

## 修复与证据

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| 缺少可安装 skill，前端设计范围不够清楚 | 增加 `gemini-ui-design`，覆盖设计、截图＋源码改造、完整 HTML/组件示例、本地实现与验证；同步 MCP 指令 | skill 校验通过，已安装到本机技能目录，runtime 包包含该 skill |
| 会话创建后无法切模型/强度 | `gemini_session_update` / PATCH 支持空闲时更新，保留 URL，推进 revision；任务保存配置快照，旧请求仍可重放 | API/MCP 测试；真实对话 Pro → Argon → Pro 切换，原上下文保留 |
| 隐藏思考子菜单、菜单异步关闭造成切换异常 | 展开后点击，等待选中与关闭；避免 Escape 尚未生效时再点击重开；不把上传菜单识别成模型菜单 | 真实网页 Pro/Argon × low/medium/high 六种组合全部通过并恢复原设置；有对应控件回归测试 |
| 代码附件已上传却长期处于准备中 | 兼容省略扩展名的代码卡片；逐个上传时关联新增卡片与附件 ID，支持同主名 HTML/CSS；重置 file input 防止同文件连续上传不触发 | 真实复现 HTML 卡片缺少扩展名后修复；连续五轮图片＋源码上传通过，第五轮含同主名 HTML/CSS |
| 上传/生成卡住后没有恢复路径 | 一次自动刷新、总计最多两次；持久化刷新意图，核对原会话，重建未发送附件，已发送仅对账；返回恢复建议与原页诊断 | 第一轮实测上传失败 → 自动刷新 → 有界停止 → 更新后恢复同一任务并完成；测试覆盖发送后刷新、丢响应、冲突、刷新上限与不重复发送 |
| 服务退出竞态 | 等待 WebSocket 关闭，停止后不再访问已关闭数据库 | 集成测试不再出现 database is not open 异步异常 |

## 自动化与安装验证

- `npm run typecheck`：通过。
- `npm test`：9 个测试文件、62 项测试全部通过，无未处理异步错误。
- `npm run build`：通过。
- skill-creator `quick_validate.py skills/gemini-ui-design`：通过；本机安装副本与仓库一致。
- `npm run release:package` 与 `node scripts/verify-release.mjs`：通过。校验压缩包、SHA-256、skill 文件、新增 MCP 工具、干净环境的生产依赖安装、HTTP 和 STDIO MCP；未发布到远端。

自动化覆盖幂等请求、revision 冲突、配置切换、附件哈希与就绪状态、同主名文件关联、历史延迟加载、发送前持久化 ACK、上传中断、发送后恢复、页面无进展、连接拒绝、缓存结果、刷新上限、WebSocket 恢复及服务关闭。

## 真实浏览器生成

使用 `node scripts/smoke-reliability.mjs --confirm-live --retry-missing`；中断后使用 `--resume`，复用原请求和任务。

| 轮次 | 模型 | 思考等级 | 附件及检查 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 3.1 Pro | low | PNG＋HTML；原任务刷新恢复，校验上下文码、文件码、图像颜色、14px 圆角及代码块 | completed |
| 2 | 4 Argon | low | 同一图片再次上传＋新版 HTML；保留上下文、识别新版文件与 18px 圆角 | completed |
| 3 | 3.1 Pro | medium | 新版图片＋HTML；识别颜色变化、新版文件与 22px 圆角 | completed |
| 4 | 3.1 Pro | high | PNG＋HTML；保留上下文、识别新版文件与 26px 圆角 | completed |
| 5 | 3.1 Pro | medium | PNG＋component.html＋component.css；分别读出 HTML/CSS 校验码与 30px 圆角 | completed |

完成时间：2026-10-31 10:25:39（Asia/Shanghai）。五轮 URL 相同，最终页面恰有 5 条用户消息和 5 条回复；每轮结果重放保持原 job_id。第一轮实际使用两次刷新，后续四轮无需刷新；没有重发缺失轮次或生成替代任务。

最终通过新启动的 STDIO MCP 进程验证：13 个工具可加载，浏览器已连接，阻塞任务为 0，会话 ready、revision=9，最后一轮结果可读取。服务和扩展已加载本次修复；新开助手会话可发现新 skill 和新增工具。

原始诊断和任务记录保存在本机被 Git 忽略的 `.data/controls.json`、`.data/smoke-reliability.json` 等文件，不打入发布包。

## 验证边界

真实生成覆盖 Pro 三档强度、Argon low；Argon medium/high 完成控件选择与读回验证，未额外消耗额度生成。登录失效、历史冲突等通过自动化测试验证处理分支，没有主动修改用户登录或真实业务对话。其他账号、网页版本及长对话的历史虚拟化仍可能需要新的 DOM 适配；恢复耗尽会给出具体错误，不无限刷新。


## 默认策略与长等待补充验证

按用户要求，正常任务默认 `3.1 pro + high`；困难任务、全局设计/重构、多次重构不满意时，由调用助手选择 `4 argon + high`。API、MCP、Store 的新会话默认强度均为 high；既有任务的配置和幂等记录保留。

Argon high 的无进展阈值改为 6 分钟，默认总期限及恢复等待为 20 分钟，避免将 3～5 分钟思考误判为卡死；其他配置仍为 90 秒和 10 分钟。调用方显式提供的任务期限仍生效。

补充测试后，65 项自动化测试、类型检查与构建全部通过。新增浏览器适配器测试使用虚拟时钟，验证五分钟无回复后正常完成、接近六分钟仍等待、超过六分钟进入恢复；API/MCP/Store 测试验证默认 high、Argon high 二十分钟期限、显式期限及请求重放。此补充没有额外消耗 Argon high 额度做真实生成。
