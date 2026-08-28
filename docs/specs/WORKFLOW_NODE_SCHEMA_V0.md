# HomeSense Workflow / Node Schema v0

## 1. 目标

这份文档定义 HomeSense 未来 visual orchestration / self-orchestration 的最小中间表示。

目标不是立刻做完整画布，而是先回答：

- workflow 里的节点长什么样
- 节点怎样映射到 capability / command / registry
- 条件、审批、fallback、反思怎样表示
- graph 在线调度与 visual workflow 如何共存

这份 schema 应该同时服务于：
- 人工拖拽式 visual orchestration
- AI-assisted workflow drafting
- AI self-orchestration

---

## 2. 设计原则

### 2.1 node 不直接绑定底层 tool

节点不应直接表达：
- `adb.back`
- `hami.xiaoai_execute`

而应优先表达：
- capability
- policy
- condition
- approval

底层 tool 由 registry / adapter 决定。

### 2.2 workflow 是上层编排，不替代 graph

- graph 负责在线动态流转
- workflow 负责显式结构化编排
- 二者应共享同一套 capability / command / registry

### 2.3 同一套 schema 服务 human 和 AI

这套 schema 不应只适合人看，也不应只适合模型生成。

它必须：
- 人类可理解
- AI 可生成
- runtime 可执行
- debug 可追踪

---

## 3. Workflow Schema v0

```ts
export interface WorkflowV0 {
  schemaVersion: 'workflow_v0'
  workflowId: string
  name: string
  description?: string
  goal?: string

  inputs?: Array<{
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array'
    required?: boolean
    description?: string
  }>

  nodes: WorkflowNodeV0[]
  edges: WorkflowEdgeV0[]

  metadata?: {
    source?: 'human_authored' | 'ai_drafted' | 'self_orchestrated'
    tags?: string[]
    createdBy?: string
  }
}
```

---

## 4. Node Schema v0

```ts
export interface WorkflowNodeV0 {
  nodeId: string
  type: WorkflowNodeTypeV0
  label: string
  description?: string

  capability?: string
  command?: Partial<CapabilityCommandV0>

  config?: Record<string, unknown>

  policy?: {
    riskLevel?: 'low' | 'medium' | 'high'
    requiresApproval?: boolean
    allowFallback?: boolean
    timeoutMs?: number
  }

  debug?: {
    showInTrace?: boolean
    collapseByDefault?: boolean
  }
}
```

### 4.1 Node 类型

```ts
export type WorkflowNodeTypeV0 =
  | 'start'
  | 'capability'
  | 'condition'
  | 'approval'
  | 'fallback'
  | 'parallel'
  | 'merge'
  | 'observe'
  | 'reflect'
  | 'end'
```

---

## 5. Edge Schema v0

```ts
export interface WorkflowEdgeV0 {
  edgeId: string
  from: string
  to: string

  when?: {
    result?: 'success' | 'failure' | 'timeout' | 'blocked'
    expression?: string
  }

  label?: string
}
```

---

## 6. 各节点类型含义

### 6.1 `start`

入口节点。

职责：
- 声明 workflow 开始
- 绑定输入参数

### 6.2 `capability`

最核心节点。

职责：
- 引用某个 capability
- 可附带 partial command override
- 最终由 registry -> adapter -> tool 执行

示例：

```json
{
  "nodeId": "node_open_tv",
  "type": "capability",
  "label": "打开电视",
  "capability": "home.voice.execute",
  "command": {
    "input": {
      "command": "打开电视"
    }
  },
  "policy": {
    "riskLevel": "medium"
  }
}
```

### 6.3 `condition`

职责：
- 根据 trace / runtime result / context 决定分支
- 不直接执行 tool

示例：
- 如果 `ui_context_available` 为真，走 targeting
- 否则走 perception

### 6.4 `approval`

职责：
- 人工确认节点
- 适用于高风险 capability
- 适用于 Deep 建议但不应直接执行的场景

### 6.5 `fallback`

职责：
- 明确声明 fallback 路线
- 比如：
  - `ui.inspect.tree` 失败 → `ui.inspect.screenshot`
  - `home.voice.execute` 失败 → `device.tv.remote.send`

### 6.6 `parallel`

职责：
- 表示多个 capability 可并发执行
- 例如同时拉 UI tree 和截图

### 6.7 `merge`

职责：
- 对 parallel / multi-branch 结果进行汇合

### 6.8 `observe`

职责：
- 只观察，不执行破坏性动作
- 适用于截图、状态读取、日志采样、设备检测

### 6.9 `reflect`

职责：
- workflow 内置反思点
- 用于在某个阶段整理经验、输出 note、写回 strategy memory

### 6.10 `end`

职责：
- workflow 结束
- 输出 summary / final response

---

## 7. 与 capability / command / registry 的关系

### 7.1 capability 是 workflow 的基础动作单元

workflow 中真正执行动作的节点应优先使用：
- `capability`

而不是直接使用 tool / action。

### 7.2 command 是 capability 的具体化

节点里的 `command` 字段用于覆盖：
- input
- target
- execution policy

但仍不应直接跳过 capability。

### 7.3 registry 是 workflow 的事实来源

workflow designer / AI drafter / runtime 都应从 registry 里获得：
- capability 是否存在
- 默认 tool 是什么
- risk level 是什么
- required inputs 是什么
- 哪些 skills 暴露它
- preconditions 是什么

---

## 8. 示例工作流

### 8.1 示例：回到主界面

```json
{
  "schemaVersion": "workflow_v0",
  "workflowId": "wf_go_home",
  "name": "回到主界面",
  "nodes": [
    {
      "nodeId": "start_1",
      "type": "start",
      "label": "开始"
    },
    {
      "nodeId": "go_home",
      "type": "capability",
      "label": "返回主页",
      "capability": "device.tv.navigate.home",
      "policy": { "riskLevel": "low" }
    },
    {
      "nodeId": "end_1",
      "type": "end",
      "label": "结束"
    }
  ],
  "edges": [
    { "edgeId": "e1", "from": "start_1", "to": "go_home" },
    { "edgeId": "e2", "from": "go_home", "to": "end_1", "when": { "result": "success" } }
  ]
}
```

### 8.2 示例：查找按钮并点击

```json
{
  "schemaVersion": "workflow_v0",
  "workflowId": "wf_find_and_click",
  "name": "查找并点击按钮",
  "nodes": [
    {
      "nodeId": "start_1",
      "type": "start",
      "label": "开始"
    },
    {
      "nodeId": "observe_tree",
      "type": "observe",
      "label": "读取 UI Tree",
      "capability": "device.tv.ui.inspect.tree"
    },
    {
      "nodeId": "check_ui",
      "type": "condition",
      "label": "是否有足够 UI 信息"
    },
    {
      "nodeId": "find_text",
      "type": "capability",
      "label": "查找文本",
      "capability": "device.tv.ui.find_text"
    },
    {
      "nodeId": "click_text",
      "type": "capability",
      "label": "点击元素",
      "capability": "device.tv.ui.click_element"
    },
    {
      "nodeId": "fallback_shot",
      "type": "fallback",
      "label": "截图兜底",
      "capability": "device.tv.ui.inspect.screenshot"
    },
    {
      "nodeId": "end_1",
      "type": "end",
      "label": "结束"
    }
  ],
  "edges": [
    { "edgeId": "e1", "from": "start_1", "to": "observe_tree" },
    { "edgeId": "e2", "from": "observe_tree", "to": "check_ui" },
    { "edgeId": "e3", "from": "check_ui", "to": "find_text", "when": { "expression": "ui_context_available == true" } },
    { "edgeId": "e4", "from": "check_ui", "to": "fallback_shot", "when": { "expression": "ui_context_available == false" } },
    { "edgeId": "e5", "from": "find_text", "to": "click_text", "when": { "result": "success" } },
    { "edgeId": "e6", "from": "click_text", "to": "end_1" },
    { "edgeId": "e7", "from": "fallback_shot", "to": "end_1" }
  ]
}
```

---

## 9. 这套 schema 的近期作用

### 当前就可以用于
- visual orchestration 的节点模型设计
- capability browser / node picker
- AI 辅助生成 workflow 草图
- 将来的 debug trace 折叠展示

### 当前还不该立刻做的
- 完整拖拽 UI
- 复杂调度引擎替换 graph
- 大规模工作流持久化系统

---

## 10. 下一步落地建议

### P1
- 做 `WorkflowNodeTypeV0` + `WorkflowV0` 的 TypeScript 类型文件
- 做一个本地 workflow registry / example store

### P2
- 用现有 registry 给前端提供 capability-based node picker
- 先做静态 workflow preview，不做执行

### P3
- 让 AI 能输出 `workflow_v0` 草图
- 再把草图映射到 capability / command / registry

---

## 11. 一句话总结

> HomeSense 的 visual orchestration 不应该直接拖 tool action，而应该拖 capability 节点；workflow 不是替代 graph，而是建立在 capability / command / registry 之上的上层编排表示。 
