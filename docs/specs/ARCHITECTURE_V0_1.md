# HomeSense Architecture v0.1

## 1. 目标

HomeSense 的目标不是单纯做一个智能家居聊天界面，而是逐步演化为一个：

1. 智能家居控制产品
2. 本地运行的 Agent / Tool Routing Framework
3. 可扩展、可开源、可插件化的工具生态

核心原则：

- 本地优先
- 一切皆工具
- Graph 保持薄，主要负责流转
- Graph 允许简单 if-else 路由与阈值判断，但不承载复杂业务逻辑
- Fast 层优先过滤，Deep 层负责首次复杂问题求解
- 成功经验必须可写回并复用
- 工具能力不一次性全暴露给模型，采用 skills 渐进式披露

---

## 2. 总体分层

```text
用户输入
  ↓
Context Builder
  ↓
Fast Layer
  ├─ memory/context
  ├─ rule_engine
  ├─ local_intent
  ├─ retrieval (vector/sqlite)
  └─ success_paths
  ↓ 未解决 / 置信度不足
Deep Layer
  └─ llm_agent
       ├─ 读上下文
       ├─ 读 success_paths
       ├─ 读 skills
       ├─ 规划
       ├─ 调工具
       └─ 反思总结
  ↓
Tool Execution Layer
  ├─ adb
  ├─ hami / 米家 / HA
  ├─ memory
  └─ future tools
  ↓
Write-back Layer
  ├─ success_path
  ├─ execution_summary
  ├─ rule_candidate
  ├─ failure_avoidance_note
  └─ user_visible_reflection
```

---

## 3. Fast / Deep 定义

### 3.1 Fast Layer

Fast Layer 是多级缓存过滤层，不是单个模块。

建议顺序：

```text
Context Builder
  ↓
rule_engine（精准匹配）
  ↓ 未命中
local_intent + retrieval（语义理解 + 检索辅助）
  ↓ 低置信度 / 未解决
success_paths（经验检索）
  ↓ 未解决
Deep Layer
```

组成：

- `memory/context`: 提供最近对话、设备权重、场景上下文
- `rule_engine`: 完全匹配、扰乱语序后的精准匹配
- `local_intent`: 不完全精准匹配的轻语义归一 / 分类
- `retrieval`: 基于 SQLite 的普通检索 + 向量语义检索
- `success_paths`: 复杂流程经验检索

职责：

- 尽量用低成本层解决问题
- 把模糊输入转成更稳定的中间表达
- 在进入 Deep Layer 前做足过滤和上下文准备
- 不能解决时，把结果和上下文传给 Deep Layer

### 3.2 Deep Layer

Deep Layer 目前核心是 `llm_agent`。

职责：

- 处理首次遇到的复杂问题
- 进行深度思考、规划、工具调用和动态调整
- 在需要时读取 success_paths、上下文、skills
- 成功后输出多个结构化产物，写回经验层

说明：

- LLM 不是 graph 外的系统，而是 graph 中的一环
- 只是进入这一环后，主导权更多交给 LLM

---

## 4. intent schema：Fast 与 Deep 的统一语言

`intent schema` 是 HomeSense 的统一中间表达，用于连接：

- rule_engine
- local_intent
- retrieval
- success_paths
- llm_agent
- tool executor

### 4.1 v0 结构

```ts
export interface IntentSchema {
  schemaVersion: 'v0'

  intent: string
  target?: {
    domain?: string
    device?: string
    room?: string
    app?: string
    element?: string
  }

  operation?: {
    action?: string
    value?: string | number | boolean
    mode?: string
  }

  context?: {
    recentMentionedDevices?: Array<{ device: string; score: number }>
    scene?: string
    platform?: 'tv' | 'phone' | 'speaker' | 'home' | 'unknown'
  }

  constraints?: {
    requiresVision?: boolean
    requiresConfirmation?: boolean
    latencySensitive?: boolean
  }

  candidates?: Array<{
    source: string
    score: number
    note?: string
  }>

  rawInput: string
}
```

### 4.2 设计原则

- `intent` 是核心，不要求一开始就非常完整
- `target` / `operation` / `context` 允许逐步补齐
- Fast 层可以输出部分 schema
- Deep 层可以补全 schema
- 最终动作生成应尽量基于 schema 而不是原始文本

### 4.3 示例

#### 示例 1：完全命中

```json
{
  "schemaVersion": "v0",
  "intent": "open_device",
  "target": {
    "domain": "tv",
    "device": "tv_letv",
    "room": "living_room"
  },
  "operation": {
    "action": "open"
  },
  "rawInput": "打开乐视电视"
}
```

#### 示例 2：模糊归一后

```json
{
  "schemaVersion": "v0",
  "intent": "navigate_ui",
  "target": {
    "domain": "tv",
    "app": "iqiyi",
    "element": "搜索"
  },
  "operation": {
    "action": "click"
  },
  "constraints": {
    "requiresVision": true
  },
  "rawInput": "帮我找一下爱奇艺里面搜索在哪"
}
```

---

## 5. 统一 StageResult 协议

每一层输出都使用统一外壳，内部允许扩展。

### 5.1 v0 结构

```ts
export interface ToolAction {
  tool: string
  action: string
  params?: Record<string, unknown>
}

export interface StageResult {
  schemaVersion: 'v0'

  ok: boolean
  stage: string
  next: string

  message?: string
  reason?: string
  confidence?: number

  intent?: IntentSchema
  actions?: ToolAction[]

  data?: Record<string, unknown>
  meta?: {
    source?: string
    latencyMs?: number
    version?: string
    trace?: Record<string, unknown>
    skillsHint?: string[]
  }
}
```

### 5.2 Graph 主要依赖的字段

Graph 只优先依赖：

- `ok`
- `stage`
- `next`
- `intent`
- `actions`
- `message`

其他字段由工具和后续层自由扩展。

### 5.3 next 建议值

```text
context_builder
rule_engine
local_intent
retrieval
success_paths
llm_agent
tool_executor
write_back
end
```

说明：

- Graph 尽量不写重业务逻辑
- 但允许少量编排逻辑，例如：
  - 阈值判断
  - 错误转向
  - 执行后进入写回层

---

## 6. Fast Layer 内部关系

### 6.1 rule_engine

职责：

- 完全匹配
- 扰乱语序后仍保持精准匹配
- 适合稳定、高确定性的规则

特点：

- 命中后可直接输出标准 `intent`
- 也可直接输出 `actions`
- 不负责未命中语义理解

### 6.2 local_intent

职责：

- 对不完全精准匹配输入做轻量归一
- 输出接近标准 `intent schema`
- 可被 retrieval 的结果增强

建议定位：

- 逻辑上属于 Fast Layer 的一部分
- 实现上仍与 `rule_engine` 分模块，避免耦合过死

### 6.3 retrieval

职责：

- SQLite 普通检索
- SQLite 语义 / 向量检索
- 为 local_intent 和 llm_agent 提供候选

定位：

- retrieval 是底层检索能力
- 可统一检索设备信息、历史对话、说明文本、经验记录

用途：

- 非完全命中语句归一
- 查找相似上下文
- 为 success_paths 和后续经验层提供底层检索能力

### 6.4 success_paths

职责：

- 检索复杂流程经验
- 被 Fast Layer 使用
- 也可以被 Deep Layer 直接读取共享

定位：

- success_paths 是经验库语义层
- 内部可以复用 retrieval 的检索能力
- 不是简单缓存表
- 是经验复用层
- 同时允许存储成功经验与失败经验

---

## 7. success_path 与写回策略

### 7.1 success_path 的三层表示

#### A. 底层存储：具体步骤

用于可执行复用。

```ts
interface SuccessPathRecord {
  id: string
  summary: string
  abstractSummary?: string
  rawInput: string
  intent?: IntentSchema
  contextSnapshot?: Record<string, unknown>
  actions: ToolAction[]
  executionTrace?: Array<Record<string, unknown>>
  successCount: number
  failCount: number
  createdAt: string
  updatedAt: string
}
```

#### B. 对外展示：半抽象摘要

例如：
- “打开视频应用并进入搜索”
- “在电视主页定位搜索入口并点击”

#### C. 以后归纳：高阶模式

例如：
- “完成电视端内容搜索流程”
- “完成跨设备媒体播放链路”

### 7.2 写回产物

一次成功执行后，LLM / 系统应尽量产出多个结构化产物，而不是一个大对象：

1. `success_path`
2. `execution_summary`
3. `rule_candidate`
4. `failure_avoidance_note`
5. `user_visible_reflection`

### 7.3 规则提升策略

新经验的默认流程：

```text
成功执行
  ↓
先写入 success_paths
  ↓
复用次数达到阈值（v0 默认 3 次）
  ↓
提示用户：是否提升为规则
  ↓
用户确认后再进入规则库
```

规则：

- 默认每次都弹确认
- 用户可以关闭该提示
- 即使关闭，配置页中也必须能看到这些候选
- 系统不直接自动写规则

---

## 8. Context Builder 与设备权重

### 8.1 职责

在进入 Fast Layer 前构建轻量上下文：

- 最近对话
- 最近提到的设备
- 基于提及次数的设备权重
- 场景上下文

### 8.2 v0 设备权重策略

先采用最简单的规则：

- 从最近对话中提取设备名
- 按提到次数计分
- 分数最高者作为补全候选

说明：

- 先不做长期持久化权重
- 先不做复杂个性化画像
- 权重是实时计算结果，不是强持久状态

---

## 9. Tool Execution Layer

## 9.1 tool_executor

职责：

- 按 `actions` 顺序执行工具调用
- 收集执行结果
- 将结果写入 trace
- 决定是否进入 write_back 或重试

建议：

- v0 先做串行执行
- 后续再考虑多设备并发与协调

### 9.2 延迟问题

未来要考虑：

- 单设备操作等待
- 页面加载等待
- 跨设备协同延迟
- 超时重试
- 状态确认

v0 的简单策略：

- 单设备操作：串行执行，不并行
- 默认超时：5 秒，可配置
- 失败：重试 1 次，仍失败则交给 Deep Layer 或结束
- 跨设备操作：暂不支持并行，先顺序执行

同时在结构上预留：

- `latencySensitive`
- `timeoutMs`
- `waitForCondition`
- `retryPolicy`

---

## 10. ADB 工具设计

ADB 是一个能力域，不是简单函数集合。

### 10.1 对系统暴露：中粒度能力

v0 建议对上层暴露 6 个中粒度能力：

- `get_ui_tree`：获取界面元素树
- `screenshot`：截图
- `find_text`：查找文本位置（可由 UI Tree 或 OCR 支持）
- `click_element`：点击元素（通过文本、元素或坐标）
- `open_app`：打开应用
- `navigate_back`：返回上一页

### 10.2 工具内部细粒度能力

工具内部可以封装：

- `get_ui_tree`
- `screenshot`
- `ocr_local`
- `ocr_api`
- `multimodal_understand`
- `find_text_position`
- `find_icon_position`
- `infer_click_target`
- `recover_from_unknown_ui`

这些不应默认一次性暴露给 LLM。

### 10.3 感知策略

ADB 内部感知可按配置选择：

1. UI Tree
2. OCR（本地或 API）
3. 多模态理解 + UI Tree 联合

原则：

- UI Tree 默认开启
- OCR / 多模态为可选配置
- 手机与电视可采用不同默认策略
- 当 UI Tree 缺少 text 或 bounds 时，可进入视觉兜底

### 10.4 建议配置结构

```yaml
perception:
  ui_tree:
    enabled: true

  ocr:
    enabled: true
    provider: local
    local:
      endpoint: http://127.0.0.1:8001/ocr
    api:
      api_key_env: OCR_API_KEY

  multimodal:
    enabled: false
    provider: qwen_vl
    model: qwen-vl-max
    api_key_env: VLM_API_KEY

strategy:
  tv:
    text_target_order: [ui_tree, ocr, multimodal]
  phone:
    text_target_order: [ui_tree, ocr]
```

---

## 11. Skills 渐进式披露

HomeSense 采用“工具内能力封装 + skills 渐进披露”。

### 11.1 目标

- 不像 MCP 一样把所有细节一次性全暴露给模型
- 先暴露高层能力
- 需要时再展开更深层技能说明
- skills 允许调用 skills

### 11.2 建议目录

```text
tools/
  adb/
    wrapper.ts
    config.yaml
    skills/
      index.md
      targeting.md
      perception.md
      fallback.md
```

### 11.3 披露层级

#### index
告诉系统：这个工具能做什么

#### summary
告诉系统：什么时候用哪类能力

#### detail
告诉系统：细粒度策略、注意事项、输入输出要求

原则：

- 系统先看到中粒度能力
- 细粒度细节由 skills 按需展开

---

## 12. 前端：Normal / Debug 双视图

### 12.1 Normal View

面向普通用户，展示：

- 用户输入
- 最终结果
- 关键路径摘要
- 成功总结 / 反思

### 12.2 Debug View

面向开发和调试，展示：

- 每个 Stage 的输入输出
- 规则命中 / 未命中
- local_intent / retrieval 候选
- LLM 进入与否
- adb 使用的策略（UI Tree / OCR / 多模态）
- tool execution trace
- write-back 产物

### 12.3 折叠策略

每次执行完成后：

- 自动折叠完整过程
- 保留关键路径可见
- 可手动展开调试细节

---

## 13. v0 实施优先级

### P0

1. 修正前后端接口对齐
2. 建立统一 `StageResult` 类型
3. 建立 `IntentSchema` 初稿
4. 让 `/api/chat` 真正走 graph

### P1

1. 重构 Fast Layer 顺序
2. 加入 context builder
3. 统一 memory / chat storage 使用方式
4. success_paths 改造成结构化写回对象

### P2

1. 给 adb 增加中粒度能力抽象
2. 为 adb 增加 skills 分层目录
3. 把 OCR / 多模态配置接入 adb config

### P3

1. 加入前端 debug trace
2. 加入规则候选确认流
3. 加入 success_path 反思展示

### P4

1. 引入 SQLite 语义检索 / 向量检索
2. 优化跨设备与延迟控制
3. 进入更开放的插件与拖拽流程阶段

---

## 14. 当前版本的取舍

v0.1 不追求一次性把所有能力做完，重点是先把以下骨架立住：

- Fast / Deep 的职责边界
- Intent Schema 作为统一语言
- StageResult 作为统一外壳
- success_paths 先于规则提升
- ADB 中粒度能力 + skills 渐进式披露
- 前端 normal/debug 双视图

只要这几个骨架成立，后面加：

- 更强的本地意图模型
- 向量检索
- 多模态感知
- 插件生态
- 可拖拽流程

都会更顺。