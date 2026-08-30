# HomeSense 项目进度总览与并行加速方案

> 日期：2026-04-08
> 目标：用一份文档说明 HomeSense 当前真实进度、已完成与未完成项、主风险点，以及如何拆成并行工作流加快推进。

---

## 1. 一句话结论

HomeSense 已经**从“规则直返字符串的早期原型”推进到“具备统一 graph 主链路、统一中间协议、前后端基本对齐、经验写回与 workflow 草稿能力的可运行骨架”**。

现在项目已经不再是“从 0 到 1”的问题，而是进入了：

1. **把主链路做稳**
2. **把能力层做厚**
3. **把经验层做真**
4. **把 workflow / 可视化编排做成产品面**
5. **把测试与观测补齐，避免后续速度反噬**

也就是说，当前最适合的策略不再是单线推进，而是**围绕稳定 contract 做并行开发**。

---

## 2. 当前项目所处阶段

可以把 HomeSense 当前阶段定义为：

### 阶段定位：P0 主链路已打通，正在进入 P1 扩展与提速阶段

当前已经具备：

- 后端 `/api/chat` 真实走 graph，而不是 handler 里直返规则匹配结果
- graph 已形成完整主链路：
  - `context_builder`
  - `rule_engine`
  - `local_intent`
  - `success_paths`
  - `llm_agent`
  - `tool_executor`
  - `write_back`
- 前端聊天页已能消费 richer response，包括：
  - `reply`
  - `trace`
  - `intent`
  - `registryDebug`
  - `workflowDraft`
  - `writeBackResults`
- 工具配置、skills 查看、rules、success-paths 管理页已具备初步运营面
- workflow 已不是纯文档概念，而是已经有：
  - schema
  - draft 生成
  - candidate 持久化
  - registry 合并
  - 前端预览

因此，项目状态不是“想法阶段”，而是已经进入**可以拆分多人并行建设的工程阶段**。

---

## 3. 已完成的关键成果

## 3.1 后端主链路已经成型

### 3.1.1 统一状态与中间协议已存在

后端已经具备一套相对明确的共享协议层，核心定义在：

- `agent/src/state.ts:3`
- `agent/src/state.ts:107`
- `agent/src/state.ts:148`
- `agent/src/state.ts:184`

已落地的关键对象包括：

- `ToolAction`
- `CapabilityCommandV0`
- `WorkflowV0`
- `IntentSchema`
- `StageResult`
- `StageTraceEntry`
- `AgentState`

这意味着：

- graph、tool、HTTP handler、frontend debug 展示，已经不再完全各说各话
- 后续新增 retrieval / planner / workflow runtime 时，可以继续围绕这套中间语言扩展

### 3.1.2 graph 已经是实际执行主入口

核心逻辑已在：

- `agent/src/graph.ts:245`
- `agent/src/graph.ts:266`
- `agent/src/graph.ts:329`
- `agent/src/graph.ts:400`
- `agent/src/graph.ts:501`
- `agent/src/graph.ts:600`
- `agent/src/graph.ts:684`

当前 graph 已具备以下特征：

- `context_builder` 提取最近设备提及权重
- `rule_engine` 先做快路径命中
- `local_intent` 做轻量意图识别，并带阈值控制
- `success_paths` 做经验复用与失败经验提示
- `llm_agent` 作为 deep layer 兜底
- `tool_executor` 真正执行工具动作
- `write_back` 负责经验回写与跳过策略

这条链已经不再是 demo 级“if-else handler”，而是一个可继续演进的 runtime 主骨架。

### 3.1.3 `/api/chat` 已接入 graph，并返回富调试信息

接口主入口在：

- `agent/src/index.ts:312`

当前 `/api/chat` 已经做到：

- 写入用户消息
- 调用 `graph.invoke(...)`
- 写入 assistant 消息
- 返回统一响应结构
- 同时附带调试/解释信息，包括：
  - `matched`
  - `confidence`
  - `outcomeType`
  - `terminalSummary`
  - `resolutionMeta`
  - `registryDebug`
  - `workflowDraft`
  - `intent`
  - `trace`
  - `toolResults`
  - `writeBackResults`
  - `llm`

这说明 HomeSense 已经具备“不是只返回一句话，而是返回执行解释层”的能力。

---

## 3.2 工具层和 skills/registry 层已有基础骨架

### 3.2.1 工具注册中心已存在

工具总入口在：

- `agent/src/tools/index.ts:11`

当前已接入工具：

- `rule_engine`
- `memory`
- `adb`
- `hami`
- `success_paths`
- `web_search`
- `local_intent`
- `llm_agent`

并且已具备：

- tool name -> invoke 的分发机制
- `ToolAction` <-> `CapabilityCommandV0` 的双向转换
- 工具执行统一封装 `executeToolAction(...)`

这非常关键，因为后续并行开发设备能力、workflow 执行、planner 输出时，都可以直接挂到这层。

### 3.2.2 capability registry + skills registry 已落地 v0

关键代码在：

- `agent/src/tools/skillsRegistry.ts:56`
- `agent/src/tools/skillsRegistry.ts:82`
- `agent/src/tools/skillsRegistry.ts:162`
- `agent/src/tools/skillsRegistry.ts:181`

当前已经有：

- capability 注册表
- capability 风险级别
- required inputs 校验
- tool action 到 capability 的映射
- skill frontmatter 解析
- 按 capability 选择 skill section
- registry preview/runtime preview
- precondition 校验能力

已经登记的 capability 例子包括：

- `device.tv.navigate.back`
- `device.tv.navigate.home`
- `device.tv.ui.inspect.tree`
- `device.tv.ui.inspect.screenshot`
- `device.tv.ui.find_text`
- `device.tv.ui.click_element`
- `device.tv.app.open`
- `home.voice.execute`
- `home.voice.speak`
- `device.tv.remote.send`

这说明“CLI + skills + capability contract”已经不是纯架构草案，而是已进入代码层。

---

## 3.3 经验层（success_paths / 规则候选 / 写回）已有真实闭环

### 3.3.1 success_paths 已是运行中间层，不再只是存档

当前 success paths 已进入 graph 主链路：

- `agent/src/graph.ts:400`

它已经承担：

- 相似路径搜索
- 可复用动作路径复用
- 失败经验提示
- 非可执行路径触发 deep escalation
- 输出 matchedPath / matchedPathCandidates / score / historicalSkillRefs

这意味着经验层已经开始参与决策，而不是仅在离线管理页里展示。

### 3.3.2 write_back 已存在基本治理逻辑

关键实现位于：

- `agent/src/graph.ts:684`

当前 write_back 已具备：

- 区分 success / failure / non_executable / plan_only
- probe input 跳过写回
- deep actionable 默认不直接固化，避免污染经验层
- 写回 meta 与用户可见 reflection
- skillsHint / llmSummary / executionSummary 等持久化上下文

这已经接近“经验闭环”的雏形，而不是单纯日志。

### 3.3.3 规则候选与规则管理已具备运营接口

关键接口在：

- `agent/src/index.ts:678`
- `agent/src/index.ts:685`
- `agent/src/index.ts:787`
- `agent/src/index.ts:791`
- `agent/src/index.ts:803`

当前支持：

- 从 success paths 推导 rule candidates
- promote rule candidate
- rule enable / disable
- rollback rule
- rule enabled 状态更新
- rule 删除

这意味着“经验 -> 规则”的链路已经基本具备人工治理入口。

---

## 3.4 workflow 方向已经落下第一批真实资产

### 3.4.1 workflow schema 已存在

核心结构定义在：

- `agent/src/state.ts:43`
- `agent/src/state.ts:55`
- `agent/src/state.ts:75`
- `agent/src/state.ts:86`

已定义：

- `WorkflowNodeV0`
- `WorkflowEdgeV0`
- `WorkflowV0`
- 节点类型：start / capability / condition / approval / fallback / parallel / merge / observe / reflect / end

这给未来 visual orchestration 留出了稳定 contract。

### 3.4.2 chat 已可自动产出 workflow 草稿

关键逻辑：

- `agent/src/index.ts:429`
- `agent/src/workflowRegistry.ts:52`

当前已经支持：

- 从 capability commands 自动生成最小 workflow 草稿
- 在 chat response 中回传 workflowDraft
- 前端进行 workflow preview

### 3.4.3 workflow candidate / registry 已可持久化与合并

关键实现：

- `agent/src/tools/memory/workflowCandidateDb.ts:7`
- `agent/src/workflowRegistry.ts:6`
- `agent/src/index.ts:198`
- `agent/src/index.ts:223`
- `agent/src/index.ts:260`

当前已经支持：

- 保存 workflow draft 为 pending candidate
- 分析 upgrade target
- 接受 upgrade 时 merge into existing / promote as new
- workflow registry 持久化
- workflow candidate DB 持久化

这说明 workflow 已经不是纯前端占位，而是已开始形成“草稿 -> 候选 -> 注册”的真实链路。

---

## 3.5 前端基础面板已经比较完整

### 3.5.1 聊天页已消费 richer runtime payload

关键文件：

- `homesense-frontend/src/views/chat/index.vue:20`
- `homesense-frontend/src/views/chat/index.vue:116`

当前 chat 页已经具备：

- 基础消息流
- trace 数据模型
- llm/debug 数据模型
- registry preview 面板
- workflow preview 面板
- pending workflow candidate 预览
- latest draft / registered workflows 分区展示

这意味着前端已经不再只是一个输入框 + 回复气泡，而是开始承担 agent 可观测与 workflow 审阅功能。

### 3.5.2 配置页已成为运营控制台雏形

关键文件：

- `homesense-frontend/src/views/config/index.vue:1`

当前 config 页已覆盖：

- tools 列表
- tool config 读取/保存
- success paths 列表
- repair skills
- normalize data
- cluster 查看
- merge preview
- merge audit
- rule candidates
- persisted rules
- tool skills / skill sections / skills policy 预览

这说明运营/治理面的基础 UI 也已经具备。

### 3.5.3 前后端 API 主路径已基本对齐

接口文件：

- `homesense-frontend/src/api/index.ts:4`
- `homesense-frontend/src/api/index.ts:115`
- `agent/src/index.ts:505`
- `agent/src/index.ts:538`
- `agent/src/index.ts:608`
- `agent/src/index.ts:666`

已完成的对齐包括：

- `/api/chat`
- `/api/messages`
- `/api/tools`
- `/api/tools/:name/config`（PUT 已支持）
- `/api/devices`
- `/api/success-paths/*`

同时后端保留了 `/api/experience-paths/*` 兼容别名，降低迁移风险。

---

## 4. 当前还没完成的核心工作

虽然骨架已经起来，但距离“能快速稳定扩展”的状态，还有几块明显短板。

## 4.1 retrieval 还没有真正独立成层

当前 success_paths 里已经有类似 retrieval 的搜索行为，但严格说：

- 还不是明确的 retrieval service
- 还没有独立检索 contract
- 还没有可替换的检索后端
- 还没有向量/embedding 方案
- 还没有统一召回/排序/过滤指标

所以目前是“已有经验搜索能力”，但还不是完整 retrieval layer。

## 4.2 llm_agent 还是可用骨架，不是成熟 deep runtime

当前 llm_agent 已经接入 graph，并能：

- 读取上下文
- 读取 selected skills
- 产出 suggested actions
- 经过 policy gating
- 输出 plan-only / actionable / invalid-actions 等状态

但它还缺：

- 稳定 prompt 策略与系统能力边界
- 多轮 self-reflection / retry 机制
- 更强的 tool failure recovery
- 可配置模型策略
- 稳定离线评估集
- 真正可控的 deep execution guardrail

所以 deep layer 目前可演示、可跑通，但还未达到放心放量的程度。

## 4.3 workflow 还处于“草稿/注册/预览”阶段，未进入执行期

当前 workflow 的强项是：

- schema 已有
- 草稿已可生成
- merge/persist 已可做
- 前端可预览

但尚未完成：

- workflow runtime executor
- workflow 到 graph/runtime 的统一执行桥
- 节点级回放/调试
- 节点审批/中断恢复
- visual canvas 真正编辑能力

所以 workflow 目前是“表达层已出现，执行层未闭环”。

## 4.4 测试和验收体系明显偏弱

当前从工程加速角度看，最大的瓶颈之一不是功能，而是：

- 端到端回归测试不足
- route smoke test 不足
- graph stage contract 缺少系统化测试
- skill/capability contract 缺少校验集
- 真实设备 smoke 依赖人工临时验证

这会导致一旦团队并行人数增加，回归成本会迅速上升。

## 4.5 观测能力已有 debug payload，但还缺系统级 dashboard

虽然 `/api/chat` 已回传 trace / terminalSummary / registryDebug / resolutionMeta，
但还缺：

- stage 命中率统计
- escalation rate
- tool failure attribution dashboard
- success path reuse 质量指标
- write_back 污染率 / 跳过率统计
- rule promotion 漏斗

没有这些指标，后面很容易“做了很多，但不知道哪块最值钱”。

---

## 5. 当前最关键的判断：现在完全适合并行开发

答案是：**适合，而且应该尽快开始。**

原因不是因为所有东西都稳定了，而是因为：

1. **核心 contract 已经出现**
   - `IntentSchema`
   - `StageResult`
   - `CapabilityCommandV0`
   - `WorkflowV0`
   - `/api/chat` rich response
   - `/api/success-paths/*` / `/api/rules/*` / `/api/workflows/*`

2. **主链路已经真实运行**
   - 后续很多工作可以基于现有主链路扩展，而不是从零重建

3. **多个方向之间已经能通过 contract 解耦**
   - workflow 团队不必等设备能力团队全部完成
   - 前端调试面板不必等 retrieval 完成
   - success_paths 治理不必等 visual canvas 完成
   - tool/capability 团队不必等深度 planner 成熟

所以现在最应该做的是：**从“一个人串行把所有事情做一点”切换成“多个工作流围绕稳定接口并行推进”**。

---

## 6. 推荐的并行开发拆分

下面是最适合当前阶段的拆分方式。

## 工作流 A：主链路稳定性与质量保障

### 目标
把当前 graph 主链路做稳，避免并行开发时基础不稳。

### 范围
- `agent/src/graph.ts`
- `agent/src/state.ts`
- `agent/src/index.ts`
- graph stage contract tests
- `/api/chat` smoke / integration tests

### 关键任务
1. 给每个 stage 补 contract test
2. 给 `/api/chat` 补命中/未命中/deep/失败路径回归用例
3. 把 response schema 固化
4. 给 write_back skip / success / failure 建测试样例
5. 补统一 runtime smoke 脚本

### 价值
这是所有并行开发的地基。

### 是否阻塞其他组
**低阻塞，但优先级最高。**

---

## 工作流 B：Capability / CLI / Skills 扩展

### 目标
把“统一能力面”做厚，让后续 planner/workflow/frontend 都有东西可用。

### 范围
- `agent/src/tools/skillsRegistry.ts`
- `agent/src/tools/index.ts`
- `agent/src/tools/adb/*`
- `agent/src/tools/hami/*`
- 各 tool 的 `skills/*.md`

### 关键任务
1. 扩充 capability registry
2. 明确各 capability 的 requiredInputs / riskLevel / preconditions
3. 补齐 ADB progressive skills
4. 补齐 Hami/Home capabilities
5. 做 tool action 到 capability 的覆盖清单
6. 建 capability contract 检查脚本

### 当前很适合继续加的方向
- TV UI 感知能力
- TV 导航/点击能力
- Home voice / remote commands
- 未来 web / memory / workflow execution capabilities

### 是否阻塞其他组
**中低阻塞。**
只要 capability contract 稳定，就可以持续并行推进。

---

## 工作流 C：Success Paths / 经验层治理

### 目标
把经验层从“能记录”推进到“可治理、可复用、可统计”。

### 范围
- `success_paths` tool
- `/api/success-paths/*`
- rule candidate promotion
- merge/cluster/audit 流程
- write_back 质量治理

### 关键任务
1. 明确 success path record schema
2. 把 failure path / non executable / plan only 的治理策略固定下来
3. 优化 cluster/merge 质量
4. 做经验污染控制
5. 建立 promotion funnel 指标
6. 做 success path 审核规则与 UI 交互优化

### 价值
这是 HomeSense 的长期竞争力来源。

### 是否阻塞其他组
**低阻塞。**
只依赖主链路能持续产出数据。

---

## 工作流 D：Deep Layer / LLM Agent 强化

### 目标
把当前 deep fallback 从“可跑通”提升到“可依赖”。

### 范围
- `agent/src/tools/llm_agent/tool.ts`
- `agent/src/graph.ts` 中 llm_agent 分支
- prompt/guardrail/policy
- deep action validation
- failure recovery

### 关键任务
1. 固化 deep 输入上下文 contract
2. 优化 structured plan 输出格式
3. 提高 invalid_actions 检测与修复能力
4. 补 planner-only / actionable / blocked 的测试集
5. 明确 deep layer 不可做的事情
6. 建立离线评估集

### 是否阻塞其他组
**不阻塞前端和 success_paths，也不阻塞 workflow 表达层。**
但会影响高复杂任务的真实成功率。

---

## 工作流 E：Workflow Runtime + Visual Orchestration

### 目标
把 workflow 从“草稿与预览”推进到“可执行、可审阅、可编辑”。

### 范围
- `agent/src/workflowRegistry.ts`
- workflow runtime executor（尚需新增）
- workflow candidate 审核流
- frontend workflow preview / editor / canvas

### 关键任务
1. 定义 workflow executor contract
2. capability node -> runtime action 的桥接
3. 节点状态机（pending/running/success/failure/blocked）
4. workflow replay/debug 模型
5. 前端从 preview 升级到最小 editor
6. 审批节点与人工接管点设计

### 为什么现在能并行做
因为 schema 已经有了，前后端都已经有 draft/candidate/registry 基础。

### 是否阻塞其他组
**低到中阻塞。**
不阻塞主链路，但要依赖 capability contract 稳定。

---

## 工作流 F：Frontend 运营面与 Debug 面板增强

### 目标
让前端真正成为 agent 可观测与治理面板，而不仅仅是聊天 UI。

### 范围
- `homesense-frontend/src/views/chat/index.vue`
- `homesense-frontend/src/views/config/index.vue`
- workflow/debug/rule/success-path 相关组件

### 关键任务
1. 折叠式 trace/debug 展示继续优化
2. terminalSummary / resolutionMeta 可视化
3. workflow draft/candidate/registry 的交互收口
4. success-path merge / audit 的操作反馈增强
5. rule promotion/rollback 的治理 UX 优化
6. 形成“普通视图 / debug 视图”双模式

### 是否阻塞其他组
**基本不阻塞。**
非常适合独立并行推进。

---

## 工作流 G：测试、验收与观测体系

### 目标
建立工程加速所需的“护栏”。

### 范围
- backend tests
- frontend smoke tests
- API contract checks
- e2e flows
- runtime metrics

### 关键任务
1. route smoke test
2. stage-level snapshot / contract test
3. capability registry validation
4. workflow schema validation
5. 关键用户路径 e2e
6. stage metrics / success funnel / tool failure dashboard

### 是否阻塞其他组
**短期不阻塞，长期极其关键。**
如果不尽快补，这一项会反过来拖慢所有组。

---

## 7. 推荐的团队并行编制

如果现在要明显提速，推荐最少按下面拆法并行。

## 方案一：3 人并行

### 人员 1：Runtime / Backend 主链路
负责：
- graph
- `/api/chat`
- write_back
- tests
- success_paths 接口稳定

### 人员 2：Capabilities / Tooling
负责：
- adb
- hami
- skills
- capability registry
- tool contract

### 人员 3：Frontend / Workflow / 运营面
负责：
- chat debug 面板
- config/rules/success-paths/workflow 面板
- workflow draft/candidate UX

这是最小可行提速方案。

---

## 方案二：5 人并行

### A. Runtime Lead
- graph
- `/api/chat`
- API contracts
- write_back
- overall integration

### B. Tool & Capability Engineer
- adb / hami / tool wrappers
- capability registry
- preconditions / risk policy

### C. Experience Layer Engineer
- success_paths
- clusters / merge / audit
- rule candidate promotion funnel

### D. Workflow Engineer
- workflow draft
- workflow registry
- workflow executor
- visual orchestration model

### E. Frontend / Ops UI Engineer
- chat debug
- config console
- workflow UI
- governance interactions

这是当前阶段最合理的高效拆法。

---

## 方案三：7 人并行（冲速度）

在 5 人方案基础上，再拆出：

### F. Deep Agent / Prompt Engineer
专门负责：
- llm_agent
- prompt/policy/structured output
- evaluation set
- failure recovery

### G. QA / Observability Engineer
专门负责：
- e2e
- smoke tests
- metrics
- runtime dashboard
- regression pipeline

如果目标是明显提速并降低返工，这其实是最优解。

---

## 8. 并行开发时的依赖关系

不是所有方向都能完全自由并行，下面是依赖关系。

## 8.1 强依赖项

### 依赖 1：共享 contract 必须先冻结一个 v0.1
必须冻结的对象：

- `IntentSchema`
- `StageResult`
- `CapabilityCommandV0`
- `WorkflowV0`
- `/api/chat` response shape
- `/api/success-paths/*` 基础返回 shape

如果这些对象天天变，所有并行组都会互相打断。

### 依赖 2：capability naming 需要尽快稳定
例如：

- `device.tv.navigate.home`
- `device.tv.ui.find_text`
- `home.voice.execute`

这些名字一旦稳定，workflow、planner、frontend、success_paths 才能同时推进。

### 依赖 3：write_back record type 要稳定
至少要固定：

- success
- failure
- non_executable
- plan_only
- skipped

这样经验层、运营面、统计面才能同步开发。

---

## 8.2 弱依赖项

这些可以先并行，不必等全部完成：

- frontend debug 面板 与 deep agent 优化
- success path cluster/merge 与 workflow editor
- adb skills 扩展 与 config 页优化
- workflow registry 持久化 与 rule governance UX

---

## 9. 当前最值得优先加速的 5 个方向

如果你要“现在就加快进度”，我建议优先级按下面排。

## P1. 先稳主链路与 contract

目标：
- 避免多人并行时互相踩接口

具体做法：
- 冻结 v0.1 contract
- 给 `/api/chat` / `/api/success-paths/*` / workflow schema 补测试

这是第一优先级。

## P2. 同时推进 capability registry + tool skills

目标：
- 尽快把真正可编排的能力面铺开

原因：
- 这是 workflow、deep agent、success_paths 的共同底座

## P3. 把 success_paths 治理做成可运营体系

目标：
- 经验层别只会堆数据，要能 merge、审计、promotion、回滚

原因：
- 这是 HomeSense 形成长期优势的关键层

## P4. workflow 从“预览”推进到“执行”

目标：
- 让 workflow 不只是展示，而能成为真正的执行和审批面

原因：
- 这会显著提升产品感与未来扩展性

## P5. 建立测试/观测护栏

目标：
- 提速之后不被回归拖垮

原因：
- 并行人数一上来，没有 QA/observability 会立刻失速

---

## 10. 建议的 2 周加速排期

下面是一个现实可落地的两周加速方式。

## 第 1 周：冻结 contract + 主链路稳固 + 能力扩面

### 必做
- 冻结 v0.1 contracts
- 给 graph stages 建测试
- 给 `/api/chat` 建核心用例
- capability registry 补齐第一批命令
- ADB/Hami skills 扩一轮
- success path 记录 schema 固化
- workflow executor 设计稿定稿

### 交付物
- 一版稳定 contract 文档
- 一版 backend contract tests
- 一版 capability 清单
- 一版 workflow executor 设计

## 第 2 周：经验层治理 + workflow 执行 + frontend 收口

### 必做
- success paths merge/audit 质量提升
- rule promotion 漏斗完善
- workflow executor 最小版打通
- workflow 审核/接受流收口
- chat/config debug 面板增强
- route smoke + e2e 补齐

### 交付物
- 一版可执行 workflow runtime
- 一版经验层治理闭环
- 一版前端运营面增强
- 一版 smoke/e2e 验证集

---

## 11. 当前最大的风险点

## 风险 1：功能很多，但 contract 还可能漂移

解决：
- 立刻冻结 v0.1
- 之后新增字段只增不破

## 风险 2：成功路径越来越多，但治理质量不足

解决：
- 尽快把 merge/audit/promotion 当作主线，不是附属功能

## 风险 3：deep layer 能力增强后可能污染经验层

解决：
- 保留 deep actionable 默认人工审阅或延迟写回策略

## 风险 4：workflow 做成展示，不做成 runtime

解决：
- 尽快定义 workflow executor，而不是继续只做 preview

## 风险 5：并行加人后回归爆炸

解决：
- route smoke / stage tests / capability validation 立刻补

---

## 12. 我的总判断

如果只看“有没有做出东西”，HomeSense 已经明显超过概念验证阶段。

如果看“能不能提速并行”，答案也是明确的：**能，而且现在正是最该并行拆分的时候。**

### 当前最准确的项目判断是：

HomeSense 已完成：
- 主链路 graph 化
- 中间协议初步统一
- tool/capability/skills 基础层落地
- success_paths 经验层开始真实参与决策
- workflow 草稿/候选/注册链路出现
- 前端 debug/治理面初步形成

HomeSense 还未完成：
- retrieval 独立层
- 成熟 deep runtime
- workflow 执行层
- 系统化测试与观测
- 更大规模的真实能力覆盖

### 所以现在最正确的策略不是继续单线程补功能，而是：

1. **冻结 contract**
2. **按 5~7 个工作流并行推进**
3. **用测试和观测做护栏**
4. **让 workflow、experience、capability 三条线同时变厚**

如果这样推进，速度会比现在单线式推进快很多，而且返工会更少。

---

## 13. 建议立刻执行的动作

如果现在就要加速，我建议你下一步直接做这 6 件事：

1. 出一份 **v0.1 contract freeze 清单**
2. 把工作拆成 **A~G 七个并行工作流**
3. 给每个工作流指定 owner
4. 给 `/api/chat`、`/api/success-paths/*`、workflow schema 补 smoke/contract tests
5. 开始做 **workflow executor 最小版**
6. 开始做 **success path 治理与指标化**

这 6 件事一落下去，整个项目节奏会明显提速。
