# HomeSense Studio · 当前状态
> 更新: 2026-05-31

## 当前主线
Chat 运行时框架：LLM 主体 + 轻意图提示 + 短期上下文窗口 + 设备清单感知 + 渐进式设备 skill + 沙箱演练 + trace 展示。

当前目标不是一次性做完整 L2/L3，而是把链路边界梳理清楚，确保后续每个模块都能独立推进。

Chat 这条线已经基本收口，当前开始攻坚 workflow runtime / preview / node 语义对齐。

全图框架见 `docs/design/system-frame-v1.md`。
Workflow 目标压缩版见 `docs/design/workflow-target-v1.md`。

## 正在做
- Chat runtime 链路收敛：见 `docs/design/runtime-chain-v1.md`
- 记忆 / skill / 经验路径存储边界：见 `docs/design/memory-storage-v1.md`
- 设备类型 skills 作为资产管理的一部分：`skills/device-*/SKILL.md`
- 上下文窗口：TTL、窗口大小、轻量检索、前端 usage 展示
- 设备管理作为锚点：设备卡片投影、房间、在线状态、绑定能力
- 设备运行清单：统一输出 `device card + capability schema + sample_arguments`，供 Chat awareness 和 Workflow 运行输入复用
- Chat 上下文由后端从 `chat.db` 自己组装，前端只提交本轮用户输入，避免旧历史污染模型提示词
- Workflow runtime 首刀：新增统一 `device_capability` 节点，走设备能力注册层 + 沙箱演练 + 真实执行
- Workflow 旧 `executor_call` 降级为兼容入口；设备动作优先走统一设备能力节点
- Studio 默认示例新增 `Device Capability Rehearsal Demo`，把设备能力、沙箱演练、真实执行串成可见路径
- Studio 节点编辑器新增 `device_capability` 专用配置面板，可直接选择真实设备和能力，仍保留模板变量输入
- Workflow preview 会基于设备管理校验设备是否存在、MI/ADB 绑定、能力 ID 和必填参数
- Workflow Runner 增强设备能力运行卡片：展示沙箱演练、真实执行、设备状态、影响摘要和变更字段
- Workflow Preview / Inspector 统一设备能力过程卡：预览和节点 trace 都能直接看到设备、能力、参数、演练/执行阶段
- Chat -> Workflow 桥接：LLM 可通过工具发现 workflow、预演 workflow、在预演通过后运行 workflow
- Chat workflow 工具卡：`list_workflows` / `preview_workflow` / `run_workflow` 在前端显示候选、预演和执行过程，而不是裸 JSON
- 成功的 `run_workflow` 也会进入经验路径抽取，便于后续沉淀为可复用路径
- Chat trace 面板也能识别 workflow 工具的结构化过程数据，和设备执行、沙箱演练、L2 候选并列展示
- Workflow 失败节点现在会沉淀成补偿观察任务，trace / websocket 会带上 `compensation_task_id`，但还不是完整回滚系统
- Workflow 成功/失败运行会写入记忆经验路径计数：成功增加 `success_count`，失败增加 `failure_count`，供后续 L2 多路召回使用
- L2 候选召回会读取经验路径的 `success_count / failure_count`：成功路径提权，失败路径降权，Workflow 来源候选会带 `workflow_id`
- Chat 系统提示词会注入结构化 Runtime candidate paths；遇到 `workflow_candidate` 会明确引导模型优先 `preview_workflow -> run_workflow`
- Workflow Chat 工具支持经验输入兜底：模型只给 `workflow_id` 时，会优先复用该 workflow 最近成功经验里的 `workflow_inputs`
- Workflow 预演/执行结果在前端卡片和历史回放里都会显示 `input_source`，可以看出是显式输入、记忆兜底还是空输入
- Workflow run history 会持久化 `trace_json`，Runs 页可以回看历史节点、错误、重试、补偿任务和子流程摘要
- Chat workflow 工具只暴露已发布 workflow；Studio 提供发布/收回入口，草稿不再直接进入 Chat 候选
- Chat workflow 候选会带成功次数、失败次数和最近运行状态，避免 LLM 只看到名字就盲选
- Workflow Overview 会展示运行质量证据：成功/失败次数、最近运行、最近成功和发布建议
- Studio 顶部摘要会显示运行证据：成功/失败次数和最近运行状态
- Workflow Overview 会展示最近一次成功运行的输入 JSON 和输入键，作为发布/复用证据
- Chat workflow 工具输入兜底新增最近成功运行：显式输入 > 记忆经验 > 最近成功运行 > 空输入
- Studio 发布入口会直接展示运行证据状态：未运行、最近成功、运行中、最近失败但曾成功、最近失败
- Chat workflow 候选现在按运行证据排序，并带复用分 / 证据状态，优先推荐更可信流程
- L2 候选融合会把 workflow 运行证据转成 `reuse_score / evidence_status`，并透传到 Chat system prompt 和 trace
- Chat SSE smoke：新增真实 Fastify 路由注入测试，覆盖 workflow trace、tool_start/tool_end、path_candidate 和历史消息入库
- Chat 前端 SSE 消费已有回归测试：覆盖 trace、tool_start/tool_end、path_candidate、隐藏 `<think>` 文本剥离和最终消息状态
- Chat 路径沉淀规则统一：前端按钮判断和保存 payload 共用同一套工具转换规则，`run_workflow` 可兜底沉淀为经验路径步骤
- Chat 路径沉淀 payload 已从 `ChatView.vue` 抽成纯 helper，覆盖 path_candidate 直通和工具调用兜底两条路径
- Chat 经验路径沉淀会优先记录 `run_workflow` 的有效 inputs（`result.inputs` / `preview.inputs`），避免模型漏传参数时把空参数写进记忆
- Chat 历史消息和发送统一走前端 API 基址，不再依赖同源直连 `/api/chat/messages`
- Chat 前端旧 `send/history` API 入口已清理，只保留 `chat.streamUrl()` 与 `chat.messages()` 两个真实接口
- L2 evidence 收口：经验路径命中会明确标记为 `memory`，不再混进通用 search 来源
- Workflow `device_capability` 运行结果会写入 runtime observation，设备能力主路径不再落后于旧 executor observation
- Workflow preview 设备能力校验补强：缺 MI/ADB 绑定、缺 `mi.ir_key` 按键、MI 属性缺 `value` 都会阻塞预演
- Chat -> Studio 提升入口：成功执行路径可直接保存为 Workflow 草稿，生成 start / device_capability 或 subflow / answer 节点链
- Chat -> Studio 提升后可一键打开 Workflow 编辑器，直接进入对应 workflow_id 的编排页

## 短期功能（已确定要做）
- [x] Chat runtime 表层清理：降低 L1/L2/L3 等内部术语在用户可见 trace 中的存在感
- [x] 统一设备能力注册层，减少各处重复写能力定义
- [x] 沙箱 trace 卡片：展示演练摘要，不持久化 trace
- [x] 沙箱家庭状态投影框架：返回演练前后状态、变更字段和影响摘要
- [x] Chat 工具栏展示上下文窗口用量
- [x] 设备 Skill 加载在 Chat 中用卡片摘要展示，不直接铺满原始 Markdown
- [x] Chat 多工具调用队列：同一轮多个 tool call 会顺序执行完再回到模型
- [x] Chat 真实设备执行自动沙箱预检：模型直接请求真实执行时也会先演练，失败则阻断
- [x] Chat 历史回放：工具结果不再作为 JSON 消息气泡展示，会合并回工具卡片
- [x] Chat 历史回放：assistant 工具气泡和最终回答可合并回同一轮展示
- [x] Chat SSE 错误展示：`error + done` 事件优先显示错误，不被 done 吞掉
- [x] Chat SSE 增量过程流：graph 新增 assistant/tool message 时立即输出工具卡片事件
- [x] Chat 停止流式响应：用户主动停止不再显示为错误
- [x] Chat 上下文收口：后端统一裁剪历史，按 TTL/窗口构造模型输入
- [x] Chat 不展示模型内部 `<think>` 推理文本；流式解析和最终入库都会剥离内部推理
- [x] Chat 上下文过期点：TTL 过期后旧的上下文设备不会在下一轮自动复活，必须由用户重新选择
- [x] Chat smoke：临时端口 3132 验证 `你好` 不带过期旧历史，`返回` 输出 trace、沙箱演练和 tool_start/tool_end
- [ ] L2 暂缓深挖，只保留候选计划/检索接口，等 LLM 主体链路稳定后再推进
- [x] Workflow runtime 首刀：新增统一设备能力节点，直接接到设备能力注册层和沙箱预演
- [x] Workflow 默认示例：新增设备能力演练 demo，Studio 可直接查看推荐链路
- [x] Workflow 运行输入助手：Studio 可从真实设备能力清单选择设备/能力并写入 JSON 输入
- [x] Workflow 节点编辑器：`device_capability` 节点支持真实设备/能力选择和 sample arguments
- [x] Workflow preview：设备能力节点接入真实设备管理校验，缺设备、缺绑定、缺参数会阻塞预演
- [x] Workflow Runner：设备能力节点不再只显示 JSON 摘要，改为过程卡片展示 rehearsal/execution
- [x] Workflow Preview / Inspector：设备能力节点以过程卡展示目标设备、能力参数、沙箱演练和真实执行阶段
- [x] Workflow Runner：子流程节点会展开显示嵌套 trace，而不是只显示 trace_count
- [x] Workflow runtime retry：节点可通过 `retry.max_attempts` / `max_attempts` 做轻量重试，trace 会展示 attempts 和 retry_errors
- [x] Workflow failure repair：失败 trace 直接展示 compensation task，可在 Runner 内预览修复任务；不可直接重试的失败观察会明确说明
- [x] Workflow repair loop：失败修复卡可直接触发现有 Workflow 重新预演 / 重新运行，回到 Studio 当前输入与运行链路
- [x] Workflow run history：运行记录保存 inputs_json，Studio 可查看最近 runs 并一键复用历史输入
- [x] Workflow run memory：可把某次运行显式沉淀成经验路径，供 Assets / L2 复用
- [x] Workflow run presets：Studio 可从 Memory Assets 经验路径提取 `workflow_inputs`，作为运行模板一键填入
- [x] Memory Assets / Run Presets：经验路径列表暴露成功/失败次数，运行模板按路径质量辅助排序
- [x] Memory Asset detail：经验路径可进入详情页查看步骤、输入、召回引用，并回流打开关联 Workflow 编辑器 / Runs
- [x] Workflow Runs -> Memory：Runs 页可把单次运行沉淀成记忆，已沉淀的 run 可直接打开对应 Memory Asset 详情
- [x] Chat -> Workflow：新增 `list_workflows` / `preview_workflow` / `run_workflow` 工具，`run_workflow` 会先预演再执行
- [x] Chat Workflow 卡片：workflow 工具结果在 Chat 里显示为候选/预演/执行过程卡
- [x] Chat Workflow 阻塞预演：`run_workflow` 预演失败时返回结构化 preview，不再只给错误字符串；阻塞路径不会被保存为成功经验
- [x] Path candidate 抽取：成功 `run_workflow` 会进入经验路径候选抽取
- [x] Chat Trace：workflow 工具执行会带结构化结果进入 trace 面板，不再只显示通用原始数据
- [x] Chat SSE smoke：`/api/chat/stream` 注入式测试覆盖 workflow 工具流、路径候选和 DB 回放基础
- [x] Chat 前端 SSE 回归：`useChat` 会把 trace、工具卡、路径候选和最终回答合并到同一轮消息
- [x] Chat 路径沉淀前端兜底：`run_workflow` 与设备工具共用经验路径 step 转换 helper
- [x] Chat 路径沉淀 helper：保存 payload 构造从 Vue 组件抽离，并用单元测试覆盖 workflow fallback
- [x] Chat 历史回放 API：历史消息加载统一走 API_BASE，避免部署时同源假设
- [x] Chat API 收口：旧的 `api.chat.send/history` 入口已移除，只保留 stream/messages 当前接口
- [x] L2 经验路径证据来源：intent-router 会把 memory experience path evidence 标成 `memory`
- [x] Workflow observation：`device_capability` 成功/失败会记录为 `device_agent.execute_device_capability`
- [x] Workflow preview 参数边界：MI 属性类能力默认要求 `value`，避免有参设备能力被误判为无参
- [x] Chat -> Workflow 提升：Chat 成功路径可生成 Workflow 草稿并写入工作流表
- [x] Chat -> Workflow 打开：工作流创建成功后可直接跳转到 `/studio/workflows/:id/editor`
- [x] Workflow subflow runtime：子流程节点使用当前 WorkflowRuntime 依赖，父子流程可在同一个运行上下文和测试 DB 中闭环
- [x] Workflow subflow preview：预演阶段会校验子工作流存在性和直接自调用，运行阶段有子流程深度上限，避免 Studio 预演通过但运行时递归失败
- [x] Workflow subflow preview UI：Studio / Chat 预演卡片会展示子流程目标、输入键、输出键和节点数，不再只显示一条泛 summary
- [x] Workflow 失败沉淀：节点失败会生成补偿观察任务，前端可看到失败结尾和相关 task id
- [x] Workflow 经验路径沉淀：成功/失败 run 自动更新 `memory_experience_paths` 的成功/失败计数
- [x] L2 经验评分：候选计划会使用经验路径成功/失败次数调整置信度，并在 Chat trace 暴露 workflow_id 与计数
- [x] L2 -> Workflow 工具引导：workflow_candidate 会进入 Chat prompt，并携带 workflow_id / workflow_inputs / 成功失败计数
- [x] Workflow 工具输入兜底：`preview_workflow` / `run_workflow` 在缺少显式 inputs 时可使用记忆中的 workflow_inputs，并在卡片显示 input_source
- [x] Workflow 输入来源可视化：前端 workflow 卡片与历史回放会显示 `input_source`
- [x] Workflow run history trace：`workflow_runs` 持久化 `trace_json`，Runs 页可回看历史节点、错误、重试、补偿任务和子流程摘要
- [x] Workflow 发布边界：Chat 只列出已发布 workflow，Studio 提供发布/收回入口，草稿不再直接进入 Chat 候选
- [x] Workflow 候选运行证据：`list_workflows` 返回成功/失败次数和最近运行状态，前端候选卡同步展示
- [x] Workflow 运行质量证据：Workflow Overview 显示成功/失败次数、最近运行、最近成功和发布建议
- [x] Studio 运行证据摘要：顶部摘要显示成功/失败次数和最近运行状态
- [x] Workflow 最近成功输入证据：Overview 展示最近成功运行 inputs JSON 和输入键
- [x] Workflow 工具输入兜底：Chat 缺少显式 inputs 且无记忆经验时，会复用最近成功运行 inputs
- [x] Studio 发布证据联动：发布按钮旁展示运行证据状态，并按成功/警告/失败调整入口视觉
- [x] Workflow 候选排序：`list_workflows` 按运行证据计算复用分并排序，Chat 候选优先展示更可信 workflow
- [x] L2 workflow 证据融合：`candidate-plan` 使用 `reuse_score / evidence_status` 调整 workflow_candidate 置信度，并在 Chat prompt / trace 中透传

## 技术探索（不确定，可能做）
- [ ] Mimo Proxy 推理链修复（DeepSeek-V4 工具调用断裂）
- [ ] 多设备联动场景
- [ ] 记忆宫殿 / 轻量图结构
- [ ] 多模态视觉 + OpenCV 辅助电视、手机、桌面应用操作

## 已知问题
- Claude Code -p 模式在 Windows（git-bash + CcSwitch）上不稳定（429 限流 / npm install approval 超时）
- 历史测试和旧 runtime 设计可能与当前重构方向不完全一致，需要分批修正，不作为当前架构判断的唯一依据
- `docs/STATUS.md` 之前滞后于代码，现在以 runtime-chain 文档为当前判断锚点

## 关键决策
- 思考链不存 DB，也不作为 Chat UI 内容展示
- trace 不存 DB，SSE 实时展示
- Chat 是统一智能助手，不是单纯命令执行器
- LLM 恢复主体地位：闲聊和 agent 能力走同一个 LLM，只是工具是否开放由运行时控制
- 设备列表、当前位置、当前上下文设备是每轮轻量 awareness
- 设备 skill 是渐进式披露，不在首轮把完整说明书塞进 prompt
- Chat 过程卡片展示产品语言；内部 stage 名可以保留为程序字段
- 真实执行前可以走沙箱演练；沙箱必须使用真实设备能力模型
- 独立 chat.db（与 homesense.db 分离）
- 不分会话，消息平铺——单用户助手场景不需要会话概念
- 游标分页（基于 message id），不用 OFFSET
- 普通滚动，不用虚拟滚动

## 归档
- `archive/2026-05/25--design--chat-architecture.md`
- `archive/2026-05/25--feat--chat2-backend.md`
- `archive/2026-05/25--feat--chatview-frontend.md`
- `archive/2026-05/25--spike--cc-parallel.md`
- `archive/2026-05/26--feat--llm-management.md`
- `archive/2026-05/26--feat--chat-module-migration.md`
- `archive/2026-05/26--feat--llm-usage-stats.md`
- `archive/2026-05/26--feat--history-lazy-load.md`
- `archive/2026-05/26--feat--remove-conversation.md`
