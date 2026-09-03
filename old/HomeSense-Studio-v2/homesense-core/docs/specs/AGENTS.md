# AGENTS.md

> HomeSense 的 Codex 约束文件

在开始任何修改前，先阅读：

1. `AGENTS.md`
2. `CONTRACT_FREEZE_V0_1_2026-04-08.md`
3. `PROJECT_ACCELERATION_PLAN_2026-04-08.md`
4. `PARALLEL_WORKSTREAM_ASSIGNMENT_2026-04-08.md`

## Codex 专用规则

### 1. 默认角色

Codex 在本仓库默认承担：

- 分析
- 审查
- 测试补全
- 风险归纳
- 局部实现
- 文档收口

而不是跨层随意重构者。

### 2. 默认偏好

优先做：

- contract test
- smoke test
- workflow / upgrade 规则设计
- success-path 治理收口
- deep layer guardrail
- review 与 diff 风险提示

谨慎做：

- 修改 `agent/src/graph.ts`
- 修改 `agent/src/state.ts`
- 修改 `homesense-frontend/src/api/index.ts`
- 改 capability naming
- 改 `/api/chat` 顶层字段

### 3. 对红区文件的态度

若任务需要改红区文件，回答里必须明确：

- 为什么必须改
- 影响哪些 owner / workstream
- 是否会造成 contract 漂移
- 需要补哪些 tests

### 4. 跨层变更规则

如果改动涉及两层及以上（例如 graph + workflow，backend + frontend，capability + llm），必须先给出：

- 变更范围
- 依赖关系
- 兼容策略
- 最小 diff 路径

再进行实现。

### 5. 输出要求

每次完成后都要附：

- changed files
- implemented behavior
- tests run
- known risks

### 6. 默认目标

目标不是“写得更花”，而是：

- 主链更稳
- contract 更清楚
- 并行更少冲突
- 下一个 owner 更容易接手
