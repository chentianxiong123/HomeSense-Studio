# HomeSense Studio Plus 基础设施阶段实施方案

> 文档定位：这是 `ultimate-architecture-zh.md` 的下一层实施方案。
> 目标不是立刻做完产品，而是先搭出一个可运行、可测试、可演示、可扩展的基础设施骨架。
> 截止信息日期：2026-04-29。
> 当前模型接入已收敛为用户指定的 Pie-Xian OpenAI-compatible endpoint。真实 API key 只进入本地 `.env`，不写入文档、README 或示例文件。

## 1. 基础设施阶段目标

基础设施阶段要回答四个问题：

1. 系统能不能稳定启动、构建、运行。
2. 模型能不能通过统一接口接入、替换、降级。
3. 设备能不能先通过虚拟家庭跑完整闭环。
4. 知识、经验、Trace 能不能沉淀为后续 L2 编译知识层。

这一阶段的核心不是“多做几个功能”，而是把未来所有能力都要经过的通道先打通。

最终验收标准：

```text
Frontend -> Backend -> AgentRuntime / WorkflowRuntime
-> ServiceRegistry -> CLIBridge -> mi-cli
-> Virtual Home Backend -> StateMachine
-> EventBus -> Trace -> Experience / KnowledgeCompiler
```

只要这条链路跑通，后面接真实米家、红外、小爱、蓝牙、电脑脚本，都只是替换 device backend。

## 2. 阶段边界

### 必须做

- 修复工程启动与构建。
- 建立模型接入商抽象。
- 建立模型能力槽。
- 建立虚拟设备世界。
- 建立 mi-cli 虚拟后端。
- 建立设备 capability 注册。
- 建立状态机与事件回流。
- 建立 Trace 记录。
- 建立基础测试场景。
- 建立第一版知识索引与经验写回。

### 暂不做

- 不急着接全部真实设备。
- 不急着做完整视觉理解。
- 不急着做语音输入输出。
- 不急着做复杂权限系统。
- 不急着做完整商业规则平台。
- 不急着做大规模向量库。
- 不急着做本地大模型主力推理。

基础设施阶段的关键策略是：真实复杂性后置，架构通道前置。

## 3. 第一优先级修复

在进入新能力前，先让项目可以稳定跑：

1. 修前端构建问题。
   当前已知问题是 Vue Flow background CSS 路径不匹配，需要改成现有依赖实际存在的 CSS 导入。

2. 修数据库初始化问题。
   当前默认 DB 存在旧 schema 漂移风险。需要明确 dev DB、demo DB、test DB 分离。

3. 修 Skill parser 与现有 SKILL.md 格式不一致的问题。
   当前实现期待 `### action + 描述:`，但技能文档更像 Markdown 表格，需要统一格式。

4. 修 CLIBridge 协议文档与实现不一致。
   文档中是 `{ action, params }`，现实现可能是 `{ action, ...params }`。基础设施阶段必须统一。

5. 给 backend/frontend/mi-cli 建立最小 smoke test。

这一步的目标不是完美重构，而是保证后面做虚拟设备时不会被基础工程问题打断。

## 4. 模型接入总体方案

模型接入不要按供应商写死，要按能力槽接入。

```ts
type ModelSlots = {
  planner_llm: ModelRef
  fast_llm: ModelRef
  embedding_model: ModelRef
  rerank_model?: ModelRef
  vision_model?: ModelRef
  local_llm?: ModelRef
}
```

### 能力槽职责

`planner_llm`：

- L3 复杂规划。
- 失败反思。
- 经验总结。
- Skill/Rule/Workflow 候选生成。
- 结构化 JSON 输出。

`fast_llm`：

- 意图归一化。
- 候选计划选择。
- 简短上下文判断。
- 经验压缩。
- 第一阶段可以复用 `planner_llm`。

`embedding_model`：

- Wiki 页面向量化。
- Experience 向量化。
- Skill 摘要向量化。
- 设备 capability 向量化。
- 第一阶段必须有。

`rerank_model`：

- L2 召回结果重排序。
- 提升“看电视”“打开那个”等模糊查询命中质量。
- 第一阶段可选，早期可用规则分数代替。

`vision_model`：

- 电视画面理解。
- 电脑截图理解。
- ADB/OCR 后续增强。
- 当前家庭影音/电脑控制切片可后置。

## 5. ModelProviderService 设计

推荐在 backend 建一个统一服务：

```text
packages/backend/src/modules/model-provider/
  index.ts
  types.ts
  registry.ts
  adapters/
    openai-compatible.ts
    pie-xian.ts
    mock.ts
  routes.ts
```

核心接口：

```ts
type ChatRequest = {
  slot: "planner_llm" | "fast_llm" | "vision_model"
  messages: ChatMessage[]
  temperature?: number
  responseFormat?: "text" | "json"
  schemaName?: string
  timeoutMs?: number
}

type ChatResult = {
  text: string
  json?: unknown
  model: string
  provider: string
  usage?: TokenUsage
  latencyMs: number
}

type EmbeddingRequest = {
  texts: string[]
  purpose: "wiki" | "experience" | "skill" | "device" | "query"
}

type EmbeddingResult = {
  vectors: number[][]
  model: string
  provider: string
  dimensions: number
}

type RerankRequest = {
  query: string
  documents: string[]
  topN?: number
}
```

基础能力：

- Provider 健康检查。
- 模型调用日志。
- 超时控制。
- 重试策略。
- fallback chain。
- 结构化输出校验。
- API key 不入库明文。
- 错误类型标准化。

## 6. API 接入商方案

当前阶段不再比较多家供应商，统一使用用户指定的 Pie-Xian OpenAI-compatible endpoint：

```text
base_url: https://api.pie-xian.com/v1
```

模型能力槽映射：

| Slot | Model | Key Scope | 用途 |
| --- | --- | --- | --- |
| `planner_llm` | `deepseek-v4-flash` | chat key | L3 推理、规划、失败反思、结构化输出 |
| `fast_llm` | `deepseek-v4-flash` | chat key | L2 轻判断、意图归一化；第一阶段复用 planner |
| `vision_model` | `qwen3.5-4b` | chat key | 后续 ADB/无障碍/截图理解兜底 |
| `embedding_model` | `qwen3-embedding-4b` | embedding key | Wiki、Experience、Skill、Device capability 向量化 |
| `rerank_model` | `qwen3-reranker-4b` | embedding key | L2 召回结果重排序 |

基础设施阶段只实现接入与配置，不主动调用真实 API 做验证。真实连通性由用户用其他方式测试。

保留 `mock` provider 很重要：

- 没有 API key 时也能跑单元测试。
- CI 不依赖外部服务。
- 虚拟设备阶段可以稳定回放。
- 真实模型异常时可以定位问题是模型层还是设备/状态层。

## 7. 配置方案

使用能力槽配置，不把 provider 写进业务代码。

`.env.example` 建议：

```env
# model profile
MODEL_PROFILE=demo-piexian

# shared endpoint
PIEXIAN_BASE_URL=https://api.pie-xian.com/v1

# API keys: put real values in local .env only
PIEXIAN_CHAT_API_KEY=
PIEXIAN_EMBEDDING_API_KEY=

# planner llm / fast llm
PLANNER_PROVIDER=pie-xian
PLANNER_BASE_URL=${PIEXIAN_BASE_URL}
PLANNER_API_KEY=${PIEXIAN_CHAT_API_KEY}
PLANNER_MODEL=deepseek-v4-flash

FAST_PROVIDER=pie-xian
FAST_BASE_URL=${PIEXIAN_BASE_URL}
FAST_API_KEY=${PIEXIAN_CHAT_API_KEY}
FAST_MODEL=deepseek-v4-flash

# embedding
EMBEDDING_PROVIDER=pie-xian
EMBEDDING_BASE_URL=${PIEXIAN_BASE_URL}
EMBEDDING_API_KEY=${PIEXIAN_EMBEDDING_API_KEY}
EMBEDDING_MODEL=qwen3-embedding-4b
EMBEDDING_DIMENSIONS=

# rerank
RERANK_PROVIDER=pie-xian
RERANK_BASE_URL=${PIEXIAN_BASE_URL}
RERANK_API_KEY=${PIEXIAN_EMBEDDING_API_KEY}
RERANK_MODEL=qwen3-reranker-4b

# vision
VISION_PROVIDER=pie-xian
VISION_BASE_URL=${PIEXIAN_BASE_URL}
VISION_API_KEY=${PIEXIAN_CHAT_API_KEY}
VISION_MODEL=qwen3.5-4b

# local fallback
LOCAL_LLM_PROVIDER=disabled
LOCAL_LLM_BASE_URL=
LOCAL_LLM_MODEL=
```

演示时可以准备几个 profile：

```text
demo-piexian
test-mock
```

`test-mock` 很重要。它允许 CI 和本地测试不依赖真实 API key。

## 8. 本地模型方案

当前阶段不需要本地模型。

本地模型只保留为未来可选项，不进入基础设施阶段主线：

- 不作为主 planner。
- 不作为主 embedding。
- 不作为主 rerank。
- 不作为主 vision。

原因：

- 用户已提供完整的云端推理、视觉、嵌入、重排序模型。
- 基础设施阶段的重点是统一接入、虚拟设备闭环和真实测试回归。
- 本地模型会引入硬件、量化、速度、上下文稳定性等额外变量。

当前只需要实现两类 provider：

1. `pie-xian`：真实 OpenAI-compatible provider。
2. `mock`：测试 provider。

未来如果要做离线演示，再单独评估本地 provider adapter。

## 9. 虚拟设备测试方案

虚拟设备不是前端假数据，也不是 backend mock。它是一个真实走完整链路的虚拟家庭后端。

### 运行模式

```env
HOMESENSE_DEVICE_BACKEND=virtual
```

可选值：

```text
virtual：全部设备走虚拟后端
real：全部设备走真实后端
hybrid：部分虚拟，部分真实
```

基础设施阶段只要求 `virtual` 完整。

### 虚拟后端位置

推荐放在 `mi-cli` 内：

```text
packages/mi-cli/src/mi_cli/backends/
  virtual/
    __init__.py
    world.py
    devices.py
    transitions.py
    failures.py
```

原因：

- 保持 TS backend 到 Python CLI 的真实调用链。
- 将来从 virtual 切 real，不影响上层。
- 可以复用现有 `mi-cli run JSON` 协议。

### 虚拟设备清单

第一阶段固定 9 个实体：

```text
tv.toshiba_living
tv.letv_bedroom
set_top_box.living_1
set_top_box.bedroom_1
hub.xiaoai_ir_bluetooth
speaker.redmi_xiaoai
wake_adapter.desktop_bluetooth_card
computer.desktop
computer.laptop
```

小爱音箱红外版不要建模成普通音箱。它是蓝牙 + 红外中枢，建议作为 `hub.xiaoai_ir_bluetooth`：

- `speaker.say`
- `speaker.execute`
- `ir.remote`
- `ir.macro`
- `bluetooth.gateway`

红米小爱音箱则先作为普通语音/播报设备建模。

蓝牙开机卡和台式机也要拆成两个实体：一个是执行器，一个是被唤醒对象。

### 设备状态示例

```json
{
  "id": "tv.toshiba_living",
  "name": "东芝电视",
  "domain": "tv",
  "room": "living_room",
  "state": {
    "power": "off",
    "input": "hdmi1",
    "volume": 18,
    "muted": false
  },
  "capabilities": [
    "power.on",
    "power.off",
    "input.select",
    "volume.up",
    "volume.down",
    "remote.press_key"
  ]
}
```

### 虚拟动作

所有动作都应该转成统一 ToolAction：

```ts
type ToolAction = {
  service: string
  entityId: string
  params: Record<string, unknown>
  idempotencyKey?: string
}
```

例子：

```json
{
  "service": "power.on",
  "entityId": "tv.toshiba_living",
  "params": {}
}
```

### 状态转移

虚拟设备必须有真实状态转移，不允许只返回 success。

```text
power.off + power.on -> power.on
input.hdmi1 + input.select(hdmi2) -> input.hdmi2
volume.18 + volume.up -> volume.19
desktop.off + wake_adapter.press -> desktop.booting -> desktop.on
```

状态转移要能产生事件：

```ts
type StateChangedEvent = {
  entityId: string
  from: unknown
  to: unknown
  source: "virtual"
  actionId: string
  observedAt: string
}
```

## 10. 失败注入

演示系统不能只展示成功，也要展示失败恢复能力。

虚拟设备需要支持失败策略：

```json
{
  "failurePolicy": {
    "mode": "none",
    "dropRate": 0,
    "latencyMs": [100, 500],
    "offline": false
  }
}
```

基础失败类型：

- `device_offline`：设备离线。
- `ir_drop`：红外按键丢失。
- `state_delay`：状态延迟更新。
- `wrong_input`：电视当前信号源不符合预期。
- `wake_timeout`：台式机唤醒超时。
- `ambiguous_entity`：用户说“电视”但有两个电视。

失败不是为了折磨系统，而是为了验证补偿闭环：

```text
动作失败
-> Trace 记录失败
-> CompensationService 判断是否重试
-> 重试或替代动作
-> 仍失败则写入 Experience
-> SelfEnhancement 分析原因
-> KnowledgeCompiler 更新计划置信度
```

## 11. 测试分层

基础设施阶段应该建立测试金字塔。

### Unit Test

测试纯逻辑：

- capability 匹配。
- 状态转移。
- preview 风险判断。
- L1 规则匹配。
- CandidatePlan schema 校验。

### Contract Test

测试 TS 和 Python 的边界：

```text
CLIBridge -> mi-cli -> JSON stdout
```

必须校验：

- action 名称。
- params 结构。
- success/error 结构。
- stderr 不污染 stdout JSON。
- timeout 行为。

### Scenario Test

测试家庭场景：

```text
Given 东芝电视关闭，机顶盒关闭
When 用户说“打开东芝电视看机顶盒”
Then 东芝电视开启，机顶盒开启，输入源为 hdmi1，Trace 有完整事件
```

### Golden Trace Test

不要比较时间戳，比较事件序列：

```text
agent.message.received
agent.route.l2
knowledge.plan.selected
preview.passed
tool.call.started
state.changed
tool.call.completed
experience.written
```

这对求职展示很有价值，因为它证明系统不是“最后返回一句成功”，而是真的有过程可观测。

## 12. 第一批场景测试

### 场景 1：打开东芝电视看机顶盒

初始状态：

```text
tv.toshiba_living.power = off
set_top_box.living_1.power = off
tv.toshiba_living.input = hdmi1
```

期望：

```text
tv.toshiba_living.power = on
set_top_box.living_1.power = on
tv.toshiba_living.input = hdmi1
```

### 场景 2：调大音量

初始状态：

```text
tv.toshiba_living.volume = 18
```

期望：

```text
volume = 20 或至少 > 18
```

### 场景 3：切到乐视电视

测试多电视上下文与实体消歧。

### 场景 4：打开台式机

路径：

```text
computer.desktop.off
-> wake_adapter.desktop_bluetooth_card.press
-> computer.desktop.booting
-> computer.desktop.on
```

### 场景 5：红外失败重试

故意设置：

```text
speaker.xiaoai_ir.failurePolicy.mode = ir_drop_once
```

期望：

```text
第一次按键失败
-> CompensationService 重试
-> 第二次成功
-> Trace 中保留失败与重试事件
```

### 场景 6：保存为 Workflow

用户说：

```text
把刚才看电视的流程保存下来
```

期望：

```text
Experience -> Workflow candidate -> Workflow saved
```

## 13. 知识基础设施

基础设施阶段不需要完整 LLM Wiki，但要先把骨架立起来。

推荐目录：

```text
data/knowledge/
  wiki/
    home.md
    devices.md
    tv.md
    computer.md
  experiences/
    success/
    failure/
  compiled/
    plans.json
    triples.json
```

推荐表：

```text
wiki_pages
compiled_plans
knowledge_chunks
embedding_records
experience_docs
skill_candidates
rule_candidates
```

### 第一阶段索引策略

不要一开始卡在 sqlite-vss 安装上。

推荐两级策略：

1. 默认使用 FTS5 + 小规模 JS cosine fallback。
2. sqlite-vss 可用时再启用向量扩展。

因为第一阶段数据量很小，几十到几百条知识，不需要先为大规模向量库牺牲开发速度。

### Embedding 版本管理

向量模型一旦变化，维度和向量空间都会变化，所以必须记录 profile：

```ts
type EmbeddingProfile = {
  id: string
  provider: string
  model: string
  dimensions: number
  createdAt: string
}
```

不同 embedding profile 的向量不能混用。

Embedding 与视觉模型的降级策略不同：

- 视觉模型可以降级：UI 树失败用 OCR，OCR 失败用模板匹配，模板失败再用多模态兜底。
- Rerank 可以相对安全地替换：它是查询时对文本对打分，不持久化向量空间。
- Embedding 不可以自动降级：它决定了持久化记忆、Wiki、Experience、Skill 的向量空间。

因此 embedding 模型不是“无法本地部署”，而是必须当作存储 schema 的一部分管理。

硬规则：

1. 查询向量与索引向量必须来自同一个 `embedding_profile`。
2. 不能把不同模型、不同维度、不同归一化策略的向量放进同一个索引。
3. 如果切换 embedding 模型，必须创建新 profile，并全量重建向量索引。
4. 旧 profile 可以保留用于回滚，但运行时只能激活一个主 profile。
5. embedding provider 异常时，可以降级为 FTS/关键词/规则检索，但不能临时换另一个 embedding 模型查询旧索引。

当前建议：

```text
canonical embedding profile:
provider = pie-xian
model = qwen3-embedding-4b
```

本地 embedding 未来可以做，但只能作为新的 profile 或 shadow index，不能无缝替换当前记忆索引。

## 14. API 与数据库建议

基础设施阶段建议补这些 API：

```text
GET  /api/system/health
GET  /api/model-providers
POST /api/model-providers/test
GET  /api/model-slots
PUT  /api/model-slots/:slot

GET  /api/virtual/devices
POST /api/virtual/reset
POST /api/virtual/failure-policy

GET  /api/traces
GET  /api/traces/:id

POST /api/knowledge/reindex
GET  /api/knowledge/search
```

数据库至少需要：

```text
model_providers
model_slots
model_call_logs
virtual_device_snapshots
trace_runs
trace_events
knowledge_sources
knowledge_chunks
embedding_profiles
embedding_records
compiled_plans
```

## 15. 开发顺序

推荐 6 个小阶段。

### F0：工程归零

- 修 build。
- 修 DB 初始化。
- 修 CLI 协议。
- 加 `.env.example`。
- 加 smoke test。

验收：

```text
npm run build
npm run dev
mi-cli run {"action":"config_get"}
```

### F1：ModelProviderService

- 实现 OpenAI-compatible adapter。
- 实现 mock provider。
- 实现 provider health check。
- 实现 model slots。
- 实现调用日志。

验收：

```text
POST /api/model-providers/test 能返回成功
planner_llm 可以输出结构化 JSON
embedding_model 可以返回固定维度向量
```

### F2：Virtual Home Backend

- mi-cli 增加 virtual backend。
- 支持 9 个虚拟实体。
- 支持状态转移。
- 支持失败注入。

验收：

```text
mi-cli discover 返回虚拟设备
mi-cli run_action 能改变虚拟状态
重复执行幂等动作不出错
```

### F3：Capability + State + Trace

- EntityRegistry 注册虚拟设备。
- ServiceRegistry 暴露 capability。
- StateMachine 接收虚拟状态。
- TraceService 记录完整事件。

验收：

```text
调用 power.on 后，StateMachine 有状态变化，Trace 有事件序列
```

### F4：Chat 基础闭环

- L1 规则直达。
- L2 CandidatePlan skeleton。
- L3 结构化 planner。
- Preview 检查。
- Experience 写回。

验收：

```text
输入“打开东芝电视看机顶盒”可以完成虚拟设备状态变化
```

### F5：Knowledge Compiler skeleton

- Wiki markdown 入库。
- Experience markdown 入库。
- FTS 搜索。
- Embedding 索引。
- compiled_plan 生成。

验收：

```text
“看电视”能从 compiled_plans 召回候选计划
```

### F6：Studio 最小闭环

- 保存 Workflow。
- 运行 Workflow。
- 节点调用 ServiceRegistry。
- Workflow Trace。
- Chat 可调用 Workflow。

验收：

```text
Chat 成功路径可以保存成 Workflow，Workflow 再次运行成功
```

## 16. 最小文件骨架

推荐新增或重点整理：

```text
docs/
  ultimate-architecture-zh.md
  foundation-phase-plan-zh.md

packages/backend/src/modules/model-provider/
packages/backend/src/modules/virtual-home/
packages/backend/src/modules/trace/
packages/backend/src/modules/knowledge-compiler/

packages/mi-cli/src/mi_cli/backends/virtual/

data/knowledge/wiki/
data/knowledge/experiences/
data/knowledge/compiled/
```

如果当前 backend 已经有部分模块，不要重建平行系统，应该在现有模块上收束命名和边界。

## 17. 推荐的第一套实际配置

当前不再保留多供应商推荐矩阵，统一使用用户指定配置：

```text
provider: pie-xian
base_url: https://api.pie-xian.com/v1

planner_llm: deepseek-v4-flash
fast_llm: deepseek-v4-flash
vision_model: qwen3.5-4b
embedding_model: qwen3-embedding-4b
rerank_model: qwen3-reranker-4b
local_llm: disabled
```

密钥分两组：

```text
chat key: planner_llm / fast_llm / vision_model
embedding key: embedding_model / rerank_model
```

真实 key 只放本地 `.env`，文档与 `.env.example` 只保留空占位。

## 18. 关键取舍

### 先虚拟设备，后真实设备

真实设备会引入网络、登录、红外、状态不可靠等干扰。先用虚拟设备证明系统架构，再接真实设备，风险最小。

### 先 provider gateway，后模型调优

不要先纠结哪个模型最好。先把可替换、可测试、可降级的接入层做好。

### 先 FTS + 小向量，后完整向量数据库

项目早期数据量很小，重点是证明知识闭环，而不是追求大规模检索性能。

### 先云 planner，后本地 planner

Demo 稳定性比“全本地”更重要。当前阶段不接本地模型，只保留未来 adapter 位置。

### 先 Trace，后复杂 UI

Trace 是这个项目的灵魂之一。只要 Trace 做好，即使 UI 朴素，系统也会显得真实、可信、可调试。

## 19. 基础设施阶段完成定义

当下面这些都完成，就可以进入“演示场景突破阶段”：

- 项目能一键启动。
- 模型 provider 可配置。
- mock provider 可跑测试。
- 至少一个真实 API provider 可用。
- 虚拟家庭设备可发现。
- 虚拟设备动作能改变状态。
- Chat 能控制虚拟设备。
- Trace 能展示完整过程。
- 失败注入能触发重试。
- Experience 能写回。
- Wiki/Experience 能被索引。
- “看电视”能形成 compiled plan。
- Studio 能运行一个最小 Workflow。

## 20. 参考资料

- 用户指定 Pie-Xian OpenAI-compatible endpoint：`https://api.pie-xian.com/v1`
- 本地架构母版：[ultimate-architecture-zh.md](./ultimate-architecture-zh.md)
- 后续识图与 UI 理解方案：[vision-ui-understanding-plan-zh.md](./vision-ui-understanding-plan-zh.md)
