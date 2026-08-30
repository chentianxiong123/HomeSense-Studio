# HomeSense v0.1 冻结文档

> 日期：2026-04-08  
> 目的：冻结当前阶段的 source of truth、核心 contract、命名规则、红区文件与变更规则，作为并行开发的统一约束。  
> 适用阶段：当前“主链路已通、适合并行推进”的收口阶段。

---

## 0. 结论先行

从现在开始，HomeSense 进入 **“冻结边界内并行开发”** 阶段，而不是继续并行讨论架构。

这份文档只做一件事：

- 规定什么是当前唯一事实来源
- 规定哪些对象和字段暂时不能乱改
- 规定哪些文件是红区
- 规定 Codex / Claude Code / 人工在并行开发时必须遵守的改动边界

只要这份文档未被替换，所有并行开发都默认遵守本文件。

---

## 1. Source of Truth 冻结

### 1.1 文档优先级（从高到低）

#### 一级：当前项目事实定义
1. `HomeSense 项目完整总结`
2. 本文档 `CONTRACT_FREEZE_V0_1_2026-04-08.md`

#### 二级：执行与组织文档
3. `PROJECT_ACCELERATION_PLAN_2026-04-08.md`
4. `PARALLEL_WORKSTREAM_ASSIGNMENT_2026-04-08.md`

#### 三级：历史设计文档
5. `HomeSense 项目完整演进总结`

### 1.2 解释规则

- **当前项目本质**、**当前目录结构**、**当前主链路**、**当前未完成项**，以《HomeSense 项目完整总结》为准。
- **并行推进方式**、**Owner 拆法**、**优先级**，以《PROJECT_ACCELERATION_PLAN_2026-04-08.md》与《PARALLEL_WORKSTREAM_ASSIGNMENT_2026-04-08.md》为准。
- **早期演进文档**只保留为设计史，不再作为当前实现边界依据。

### 1.3 一句话冻结

> HomeSense 当前被冻结定义为：**本地优先的通用 Agent 框架**。  
> 智能家居只是第一批工具集，不是项目本体。

---

## 2. 当前冻结的主链路

当前主链路冻结为以下阶段顺序：

1. `context_builder`
2. `rule_engine`
3. `local_intent`
4. `success_paths`
5. `llm_agent`
6. `tool_executor`
7. `write_back`

### 2.1 冻结规则

- 这条主链路在 v0.1 阶段视为**稳定骨架**。
- 可以补测试、补字段、补日志、补局部策略。
- 不允许在没有升级 freeze 文档前，直接把 graph 改成另一套调度模型。
- 不允许把大段业务逻辑重新塞回 handler，绕开 graph。
- 不允许把 `write_back` 从主链中移除。

### 2.2 允许的改动

- 局部条件判断增强
- 日志与 trace 增强
- contract 内字段补充（只增不破）
- stage 内部实现优化
- smoke / contract tests 补充

### 2.3 不允许的改动

- 改 stage 名称
- 改 stage 顺序并影响上下游协议
- 删除现有 rich payload 主字段
- 把 workflow executor 强耦合写进 graph 主逻辑
- 让某个 agent 在未同步 freeze 的前提下重命名协议字段

---

## 3. 核心 Contract 冻结

## 3.1 `IntentSchema` 冻结

### 冻结目标

`IntentSchema` 是当前统一意图语言，v0.1 阶段不允许频繁漂移。

### 最低稳定要求

以下字段名冻结：

- `schemaVersion`
- `intent`
- `target`
- `operation`
- `context`
- `rawInput`

### 冻结规则

- `schemaVersion` 当前固定为 `v0`。
- `rawInput` 保留原始用户输入语义，不重命名。
- `intent` 仍然是统一意图入口，不允许拆成多套平行字段。
- `target / operation / context` 可以补子字段，但**不得在 v0.1 阶段破坏现有字段名**。
- 如需新增复杂结构，优先在 `context` 或 `meta` 风格扩展位里追加，而不是改现有字段语义。

### 当前命名约定

当前允许继续沿用的 intent 语义包括但不限于：

- `open_device`
- `close_device`
- `set_property`
- `play_media`
- `query_device`
- `navigate_ui`

若新增 intent：

- 只新增，不重命名旧值
- 要补到统一意图清单里
- 要确保前后端、workflow、deep layer 都能理解

---

## 3.2 `StageResult` 冻结

### 冻结目标

`StageResult` 是 graph 各节点统一输出协议，是当前最重要的冻结对象。

### 最低稳定字段

以下字段名冻结：

- `schemaVersion`
- `ok`
- `stage`
- `next`
- `message`
- `reason`
- `confidence`
- `intent`
- `actions`
- `data`
- `meta`

### 冻结规则

- `schemaVersion` 当前固定为 `v0`。
- `ok / stage / next` 是最小稳定核心，不得删除、不得换名。
- `message / reason / confidence / intent / actions / data / meta` 可以为空，但字段语义不改。
- 允许增加 `meta.*` 子字段与 `data.*` 子字段。
- 不允许在 v0.1 阶段新增第二套并行 stage output 协议。

### 实施要求

- 所有 stage 输出都继续围绕 `StageResult`。
- handler、frontend、workflow bridge、debug payload 都不能绕开它造另一套结果体。

---

## 3.3 `CapabilityCommandV0` 冻结

### 冻结目标

`CapabilityCommandV0` 与 capability registry 是 CLI + Skills + Workflow + Deep Layer 的共同底座。

### 冻结原则

- `CapabilityCommandV0` 继续作为统一 capability command 语言。
- 当前字段名与含义以仓库现有 schema/实现为准，不做随意重命名。
- 对 capability 的扩展应尽量通过：
  - 新增 capability
  - 新增 metadata
  - 新增 precondition / requiredInputs / riskLevel
- 不允许通过“偷偷修改 command shape”来兼容新能力。

### v0.1 最小约束

所有 capability 至少必须能稳定表达以下信息：

- capability 名称
- action / command 映射关系
- required inputs
- risk level
- preconditions（如适用）

---

## 3.4 `WorkflowV0` 冻结

### 冻结目标

workflow 已经进入“草稿 / 候选 / 注册”的真实资产阶段，因此 `WorkflowV0` 必须冻结一版。

### 当前冻结内容

以下概念冻结：

- `WorkflowNodeV0`
- `WorkflowEdgeV0`
- `WorkflowV0`

以下节点类型冻结为当前合法集合：

- `start`
- `capability`
- `condition`
- `approval`
- `fallback`
- `parallel`
- `merge`
- `observe`
- `reflect`
- `end`

### 冻结规则

- 上述节点类型在 v0.1 阶段不删除、不换名。
- 可新增字段，但不破坏现有 node/edge/workflow 结构语义。
- workflow executor 的实现必须适配 `WorkflowV0`，而不是倒逼 `WorkflowV0` 频繁漂移。
- `draft -> candidate -> registry` 的对象命名继续保留，不改名。

---

## 3.5 `/api/chat` response shape 冻结

### 冻结目标

`/api/chat` 是前后端、debug 面板、评测、回归、workflow 草稿预览的共同入口，必须冻结主字段名。

### 当前冻结字段名

以下顶层字段名在 v0.1 阶段视为稳定：

- `reply`
- `trace`
- `intent`
- `registryDebug`
- `workflowDraft`
- `writeBackResults`
- `matched`
- `confidence`
- `outcomeType`
- `terminalSummary`
- `resolutionMeta`
- `toolResults`
- `llm`

### 冻结规则

- 允许字段值为 `null` / 空数组 / 空对象。
- 不允许在前后端未统一前改字段名。
- 新字段只能追加，不能替换旧字段。
- 若某字段准备废弃，必须经历：
  1. freeze 文档更新
  2. 前后端双读兼容
  3. 至少一个集成窗口后再移除

---

## 3.6 `/api/success-paths/*` 与 write_back record type 冻结

### write_back record type

当前冻结为：

- `success`
- `failure`
- `non_executable`
- `plan_only`
- `skipped`

### 冻结规则

- 以上值在 v0.1 阶段不得换名。
- success_paths 治理、运营面、指标、规则提升漏斗全部围绕这组类型工作。
- 若新增 record type，必须同步更新：
  - backend write_back
  - success_paths API
  - frontend governance UI
  - metrics / tests

---

## 4. Capability Naming 冻结

### 4.1 命名规则

capability 一律使用：

`domain.device.scope.action`

例如：

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

### 4.2 命名约束

- 全小写
- 使用 `.` 分层
- 不使用同义重复命名
- 不在 v0.1 阶段为同一能力保留两套别名
- 新 capability 先补 registry，再接 workflow / deep / frontend

### 4.3 禁止事项

- `open_bilibili` 这种 task-oriented 名称直接混入 capability 层
- 同时存在 `device.tv.open_app` 与 `device.tv.app.open` 两套叫法
- 未经过 registry 注册就被 deep layer 直接输出

---

## 5. 红区文件冻结

以下文件在 v0.1 阶段属于**红区文件**，默认只允许 Runtime Lead / 主干 owner 直接修改：

- `agent/src/state.ts`
- `agent/src/graph.ts`
- `agent/src/index.ts`
- `agent/src/tools/skillsRegistry.ts`
- `agent/src/workflowRegistry.ts`
- `agent/src/tools/memory/workflowCandidateDb.ts`
- `homesense-frontend/src/api/index.ts`

### 5.1 红区规则

- 其他 owner 如需改红区文件，只能：
  - 提交小 diff
  - 说明原因
  - 说明影响范围
- 不允许多个 coding agent 同时大改红区文件。
- 不允许红区文件被“顺手重构”。

### 5.2 默认改动边界

#### Runtime Lead
可改全部红区文件。

#### Tool & Capability Engineer
默认不改 `graph.ts` / `state.ts` 主协议。

#### Experience Layer Engineer
默认不改 `state.ts` / `/api/chat` 主响应结构。

#### Workflow Engineer
默认不改 `graph.ts` 主调度，只通过 bridge 接入。

#### Frontend / Ops UI Engineer
默认不改 backend 红区协议，只消费冻结字段。

#### Deep Agent / Prompt Engineer
默认不改 capability naming 与主响应字段，只在 deep layer 内收口。

#### QA / Observability Engineer
不改业务语义，只补测试、验证、指标。

---

## 6. 变更规则冻结

## 6.1 v0.1 总规则

### 允许
- 新增字段
- 新增 capability
- 新增 tests
- 新增 logs / metrics / dashboards
- 新增 workflow executor 实现
- 新增 adapter / bridge / validator

### 不允许
- 改已有字段名
- 删已有字段
- 改 capability 既有命名
- 改 write_back record type
- 改 stage 名称
- 同时跨多层重构

## 6.2 破坏性变更流程

若确实必须改 breaking change，必须按以下流程：

1. 先更新 freeze 文档
2. 给出影响清单
3. 前后端双读兼容
4. 补 contract/smoke tests
5. 在集成窗口统一落地

未经此流程，不接受 breaking change。

---

## 7. 并行开发操作规则

### 7.1 一条 workstream = 一个 worktree = 一个 owner

不允许两个 coding agent 在同一 worktree 内同时推进不同方向。

### 7.2 小 diff 合并

- 每次合并尽量只解决一个问题
- 不做“大而全分支”
- 不把 unrelated cleanup 混进功能提交

### 7.3 每次交付必须带 3 项信息

1. changed files
2. tests / smoke 结果
3. risks / follow-ups

### 7.4 未冻结前禁止上新产品面

在 workflow executor 未落地、deep 实力未收口前：

- 不优先做炫技型 visual orchestration
- 不优先做大范围 UI 改版
- 不优先扩展新概念层

---

## 8. 当前阶段唯一允许优先推进的主线

按当前项目状态，v0.1 阶段优先级冻结为：

### P0
1. workflow draft 持久化
2. deep 接真实大模型

### P1
3. draft -> example merge / upgrade
4. success_path 与 workflow 统一
5. 主链路 contract / smoke tests

### P2
6. capability 扩面
7. 前端治理与 debug 收口

### P3
8. 可视化编排
9. AI 自生成工作流

> 未进入上述优先级的“新想法”，默认不进入本轮实现。

---

## 9. 合并前检查清单

每个 worktree 合并前必须自检：

- 是否改了冻结字段名？
- 是否改了 capability 既有命名？
- 是否动了红区文件？为什么？
- 是否补了对应 smoke / contract tests？
- 是否把旧字段兼容考虑清楚？
- 是否会影响 chat debug / workflow preview / success-path governance？

任一答案不明确，先不合并。

---

## 10. 最终冻结声明

从本文件生效开始，HomeSense 的并行开发统一遵守以下原则：

> **边界冻结，执行并行；主链不乱动，能力在边界内扩张。**

也就是说：

- 架构方向不再反复讨论
- source of truth 不再混用
- coding agent 不再跨层自由改协议
- 所有加速都建立在 freeze contract 之上

这份文档就是当前阶段的工程边界。
