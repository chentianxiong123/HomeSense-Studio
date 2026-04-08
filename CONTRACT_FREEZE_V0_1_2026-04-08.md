# HomeSense v0.1 Contract Freeze 清单

> 日期：2026-04-08  
> 目的：冻结当前并行开发必须共享的核心 contract，减少多人并行时的接口漂移、返工和联调成本。  
> 适用周期：即日起至 v0.1 第一轮并行开发结束前。  
> 原则：**新增字段可以，破坏性修改不可以。**

---

## 0. Freeze 规则

本清单中的对象一旦冻结，默认遵守以下规则：

1. **字段名不随意修改**
2. **字段语义不随意漂移**
3. **允许增加可选字段，不允许删除已有字段**
4. **若必须做破坏性修改，必须先更新 freeze 文档并同步所有 owner**
5. **前后端、workflow、experience、QA 都以本清单为联调依据**

---

## 1. Freeze 对象总表

| 对象 | 级别 | 用途 | 当前 owner |
|---|---|---|---|
| `IntentSchema` | P0 | Fast/Deep/shared intent language | Runtime Lead |
| `StageResult` | P0 | graph stage 统一输出协议 | Runtime Lead |
| `StageTraceEntry` | P0 | trace/debug 展示与验收 | Runtime Lead |
| `CapabilityCommandV0` | P0 | capability 中间命令协议 | Runtime Lead + Tooling |
| `WorkflowV0` | P1 | workflow draft/registry/executor 协议 | Workflow Engineer |
| `/api/chat` response shape | P0 | 前端聊天主路径 | Runtime Lead |
| `/api/success-paths/*` response shape | P0 | 治理页/经验层/统计 | Experience Layer Engineer |
| capability naming | P0 | tooling/workflow/deep/frontend 共同依赖 | Tool & Capability Engineer |
| write_back record type | P0 | experience 治理、统计、前端展示 | Runtime Lead + Experience |

---

## 2. `IntentSchema` 冻结

## 2.1 角色定义

`IntentSchema` 是 HomeSense Fast Layer 与 Deep Layer 的共享语言。

它不是某个单一工具的入参，也不是 UI 专用对象，而是：

- rule_engine 可产出
- local_intent 可产出
- success_paths 可补充候选信息
- llm_agent 可读取/扩展
- frontend debug 可展示
- workflow draft 可参考

## 2.2 v0.1 冻结结构

```ts
interface IntentSchema {
  schemaVersion: "v0"
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
    platform?: "tv" | "phone" | "speaker" | "home" | "unknown"
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

## 2.3 冻结要求

### 必填字段
- `schemaVersion`
- `intent`
- `rawInput`

### 可选字段
- `target`
- `operation`
- `context`
- `constraints`
- `candidates`

### 约束
- `schemaVersion` 当前固定为 `"v0"`
- `intent` 必须是稳定、可消费的意图名，不要混入自然语言整句
- `rawInput` 必须保留原始用户输入，方便回放和调试
- `candidates` 用于表达候选判断，不用于替代主 `intent`

### 当前禁止
- 不把 tool-specific 原始参数直接塞进顶层
- 不把 prompt 文本、长解释、思考链写进 `IntentSchema`
- 不把 workflow 节点状态写进 intent

---

## 3. `StageResult` 冻结

## 3.1 角色定义

`StageResult` 是 graph 每个 stage 的标准输出。

所有 stage 都应尽量用同一结构返回：

- 是否成功处理
- 当前阶段名
- 下一跳
- 置信度
- intent
- commands/actions
- data/meta

## 3.2 v0.1 冻结结构

```ts
interface StageResult {
  schemaVersion: "v0"
  ok: boolean
  stage: string
  next: string
  message?: string
  reason?: string
  confidence?: number
  intent?: IntentSchema
  commands?: CapabilityCommandV0[]
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

## 3.3 冻结要求

### 必填字段
- `schemaVersion`
- `ok`
- `stage`
- `next`

### 推荐字段
- `reason`
- `confidence`
- `intent`
- `data`
- `meta`

### 语义约束
- `ok` 表示本 stage 是否成功完成当前职责，不等于整个任务最终成功
- `stage` 必须是稳定 stage 名，如：
  - `context_builder`
  - `rule_engine`
  - `local_intent`
  - `success_paths`
  - `llm_agent`
  - `tool_executor`
  - `write_back`
- `next` 必须明确给出路由意图，如：
  - `local_intent`
  - `tool_executor`
  - `llm_agent`
  - `write_back`
  - `end`
- `message` 是用户可见回复候选，不等于一定是最终 reply
- `data` 放扩展载荷
- `meta` 放执行元信息，不放业务主字段

### 当前禁止
- 每个 stage 自定义完全不同返回结构
- 把 `data` 当作无边界垃圾桶塞关键主字段
- 用 `message` 代替结构化结果

---

## 4. `StageTraceEntry` 冻结

## 4.1 v0.1 冻结结构

```ts
interface StageTraceEntry {
  stage: string
  ok: boolean
  next: string
  message?: string
  reason?: string
  confidence?: number
}
```

## 4.2 冻结要求

- trace 面向前端 debug、日志审阅、测试断言
- trace 保持轻量，不直接复制全部 `StageResult.data`
- 每次 stage 推进都应写入一条 trace

---

## 5. `CapabilityCommandV0` 冻结

## 5.1 角色定义

`CapabilityCommandV0` 是 tool action 之上的统一能力命令层。

它是：
- rule_engine / local_intent / llm_agent / workflow 的共同输出语言
- capability registry / workflow executor / deep planner 的桥接协议

## 5.2 v0.1 冻结结构

```ts
interface CapabilityCommandV0 {
  schemaVersion: "command_v0"
  commandId: string
  capability: string
  target?: {
    domain?: "tv" | "speaker" | "home" | "phone" | "agent" | "memory" | "unknown"
    device?: string
    room?: string
    app?: string
    element?: string
  }
  operation?: {
    name?: string
    value?: string | number | boolean
    mode?: string
  }
  input?: Record<string, unknown>
  execution?: {
    preferredTool?: string
    fallbackTools?: string[]
    timeoutMs?: number
    requiresVision?: boolean
    requiresConfirmation?: boolean
    riskLevel?: "low" | "medium" | "high"
  }
  context?: {
    sourceStage?: string
    sourceIntent?: string
    sourceSkillRefs?: string[]
    sourceTraceId?: string
  }
  metadata?: Record<string, unknown>
}
```

## 5.3 冻结要求

### 必填字段
- `schemaVersion`
- `commandId`
- `capability`

### 强约束
- `schemaVersion` 固定为 `"command_v0"`
- `capability` 必须使用 registry 中稳定命名
- `input` 用于 capability 所需具体参数
- `execution` 用于执行偏好与风险
- `context` 用于溯源，不用于业务主参数

### 当前禁止
- 直接让前端或 workflow 依赖 tool action 细节而绕过 capability
- capability 名和 tool action 名混用
- 在 `metadata` 中藏主执行参数

---

## 6. capability naming 冻结

## 6.1 命名原则

统一使用：

```txt
domain.object.verb.detail
```

例如：
- `device.tv.navigate.home`
- `device.tv.navigate.back`
- `device.tv.ui.inspect.tree`
- `device.tv.ui.inspect.screenshot`
- `device.tv.ui.find_text`
- `device.tv.ui.click_element`
- `device.tv.app.open`
- `device.tv.remote.send`
- `home.voice.execute`
- `home.voice.speak`

## 6.2 v0.1 已冻结 capability 名单

```txt
device.tv.navigate.back
device.tv.navigate.home
device.tv.ui.inspect.tree
device.tv.ui.inspect.screenshot
device.tv.ui.find_text
device.tv.ui.click_element
device.tv.app.open
device.tv.remote.send
home.voice.execute
home.voice.speak
```

## 6.3 冻结要求

- workflow、llm_agent、success_paths、frontend preview 都只认 capability 名，不认 tool action 名
- 新增 capability 可以加，但已冻结名字不要改
- 若某 capability 语义变化过大，新增一个名字，不要直接改旧名字语义

---

## 7. `WorkflowV0` 冻结

## 7.1 角色定义

`WorkflowV0` 是 workflow draft、candidate、registry、executor 的共同协议。

当前阶段目标不是做完整 BPMN，而是给 HomeSense 最小可执行编排稳定结构。

## 7.2 v0.1 冻结对象

### 节点类型
```txt
start
capability
condition
approval
fallback
parallel
merge
observe
reflect
end
```

### 核心结构
- `WorkflowNodeV0`
- `WorkflowEdgeV0`
- `WorkflowV0`

## 7.3 冻结要求

### WorkflowNodeV0
必须至少支持：
- `nodeId`
- `type`
- `label`
- 可选 `capability`
- 可选 `command`
- 可选 `policy`

### WorkflowEdgeV0
必须至少支持：
- `edgeId`
- `from`
- `to`
- 可选 `when`
- 可选 `label`

### WorkflowV0
必须至少支持：
- `workflowId`
- `name`
- 可选 `description`
- 可选 `goal`
- 可选 `inputs`
- `nodes`
- `edges`
- 可选 `metadata`

### 当前约束
- `start` / `end` 语义固定
- `capability` 节点是 v0 执行主节点
- `approval` / `parallel` / `merge` / `reflect` 当前可以先是结构层冻结，执行层逐步补
- draft/candidate/registry/executor 都不能各自发明不同 workflow shape

---

## 8. `/api/chat` response shape 冻结

## 8.1 角色定义

这是当前前端聊天页、debug 面板、workflow draft 展示、registry preview 的核心响应结构。

## 8.2 v0.1 响应结构

```ts
{
  status: "Success",
  data: {
    reply: string,
    matched?: boolean,
    confidence?: number,
    outcomeType?: string,
    terminalSummary?: string,
    stage?: string,
    resolutionSource?: string,
    resolutionMeta?: Record<string, unknown>,
    registryDebug?: Record<string, unknown> | null,
    workflowDraft?: Record<string, unknown> | null,
    intent?: IntentSchema,
    trace?: StageTraceEntry[],
    toolResults?: Array<Record<string, unknown>>,
    writeBackResults?: Array<Record<string, unknown>>,
    llm?: Record<string, unknown> | null,
    skillsHint?: string[],
    reason?: string,
  }
}
```

## 8.3 必填字段

### 顶层
- `status`
- `data`

### `data` 中至少保证
- `reply`

## 8.4 推荐稳定字段

- `matched`
- `confidence`
- `stage`
- `intent`
- `trace`
- `workflowDraft`
- `registryDebug`
- `writeBackResults`
- `llm`
- `skillsHint`
- `reason`

## 8.5 冻结要求

- `reply` 始终是前端主展示字段
- `trace` 默认允许为空数组，但字段语义稳定
- `intent` 若存在，必须符合 `IntentSchema`
- `workflowDraft` 若存在，必须符合 `WorkflowV0` 基本结构
- `registryDebug` 为 debug/运营面板服务，不应替代主业务字段
- 前端可忽略不关心字段，但后端不要随意删字段

### 当前禁止
- 今天返回 `reply`，明天改成 `message`
- 把 debug 字段混成无结构自由文本
- workflowDraft 有时返回对象，有时返回完全不同格式数组

---

## 9. `/api/success-paths/*` response shape 冻结

## 9.1 范围

至少冻结以下接口的基础返回语义：

- `GET /api/success-paths`
- `POST /api/success-paths/repair-skills`
- `POST /api/success-paths/normalize-data`
- `GET /api/success-paths/clusters`
- `POST /api/success-paths/merge-cluster`
- `GET /api/success-paths/merge-strong-clusters/preview`
- `GET /api/success-paths/merge-weak-clusters/preview`
- `POST /api/success-paths/merge-strong-clusters`
- `POST /api/success-paths/merge-weak-clusters`
- `GET /api/success-paths/merge-audit`
- `POST /api/success-paths/merge-audit/clear`

## 9.2 顶层原则

统一保持：

```ts
{
  status: "Success" | "Error",
  data?: unknown,
  message?: string
}
```

## 9.3 基础冻结要求

### `/api/success-paths`
- `data` 返回数组列表
- 每条记录至少应具备稳定 id / trigger / intent / actions 或等价可治理字段

### `/api/success-paths/clusters`
- `data` 返回聚类数组
- 每个 cluster 至少有 cluster 标识、成员列表、可合并依据摘要

### `/api/success-paths/merge-audit`
- `data` 至少支持：
  - `current`
  - `history`

### 所有 mutation 接口
- 成功时返回 `status: "Success"`
- 可带 `message`
- 若返回 `data`，应保持对象结构稳定，不随意变成纯字符串

---

## 10. write_back record type 冻结

## 10.1 v0.1 已冻结 record type

```txt
success
failure
non_executable
plan_only
skipped
```

## 10.2 语义定义

### `success`
- 有执行动作
- 动作执行成功
- 可作为成功经验候选

### `failure`
- 有执行动作
- 执行失败或部分失败
- 作为失败经验/修复参考

### `non_executable`
- 当前有判断、有计划或有解释
- 但没有形成可执行动作

### `plan_only`
- deep/planner 给出了结构化方案
- 但未真正执行

### `skipped`
- 本次明确不写回
- 如 probe input、低价值样本、deep actionable 默认延迟审阅等

## 10.3 冻结要求

- 所有经验层、前端治理、统计面都用这 5 类，不要自造平行类型
- 若需要更细分类，放到 `meta.reason`，不要新增顶层 record type

---

## 11. graph stage naming 冻结

当前 graph 统一 stage 名冻结为：

```txt
context_builder
rule_engine
local_intent
success_paths
llm_agent
tool_executor
write_back
end
```

要求：
- trace、metrics、tests、frontend debug 全部使用同一套名字
- 若内部重构函数名，不要影响 stage 名

---

## 12. timeout / risk / approval 的 v0.1 约束

## 12.1 timeout
- 默认执行超时建议：`5000ms`
- 允许 capability command 按需覆盖 `execution.timeoutMs`

## 12.2 riskLevel
当前冻结枚举：
```txt
low
medium
high
```

## 12.3 requiresConfirmation
- 若 capability 或 command 带 `requiresConfirmation: true`
- 则 deep/workflow/frontend 不应默默自动放行
- 后续是否前端弹确认，可在 UI 层扩展，但字段语义先冻结

---

## 13. 并行开发期间允许扩展的地方

以下内容允许继续新增，但必须保持向后兼容：

1. `StageResult.data` 的扩展字段
2. `StageResult.meta` 的扩展字段
3. `IntentSchema.context` / `constraints` 内的新增可选字段
4. `CapabilityCommandV0.metadata` 的新增可选字段
5. `WorkflowV0.metadata` 的新增可选字段
6. `/api/chat.data` 下新增 debug 字段
7. `/api/success-paths/*` 的可选统计/审计字段

原则：
- **新增可选字段可以**
- **替换/删除旧字段不可以**

---

## 14. 当前明确不冻结的内容

这些内容本轮可以继续演进，不纳入强 freeze：

1. llm prompt 具体文本
2. llm summary/debug payload 内部细节
3. retrieval 的独立 service contract
4. workflow executor 内部实现细节
5. metrics dashboard 的最终口径细节
6. success path 聚类算法细节

也就是说：
- 对外共享结构先稳
- 内部实现细节允许继续快速迭代

---

## 15. 落地动作

这份 freeze 清单落下后，建议立即执行：

1. Runtime Lead 把 `IntentSchema` / `StageResult` / `/api/chat` 对照代码逐项校验
2. Tool & Capability Engineer 把 capability registry 对照冻结命名表清理一遍
3. Experience Layer Engineer 把 write_back 类型与 success-path API 口径统一
4. Workflow Engineer 把 `WorkflowV0` 节点/边结构对齐冻结清单
5. Frontend / QA 按本清单补 contract tests / smoke / TS types

---

## 16. 我的建议

HomeSense 现在最怕的不是“功能不够多”，而是：

- 接口漂移
- 多人并行互相打断
- 前后端/治理/workflow 各说各话

所以 v0.1 阶段最关键的不是再堆一层能力，而是先把这批共享 contract 冻住。

只要这份文档被真正执行，接下来的并行速度会明显更快，而且返工会少很多。
