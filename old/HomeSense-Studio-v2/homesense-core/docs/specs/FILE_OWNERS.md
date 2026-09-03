# FILE_OWNERS.md

> HomeSense 当前并行开发的目录所有权与红区规则

## 1. Owner 角色

- Runtime Lead
- Tool & Capability Engineer
- Experience Layer Engineer
- Workflow Engineer
- Frontend / Ops UI Engineer
- Deep Agent / Prompt Engineer（可选）
- QA / Observability Engineer（可选）

## 2. 红区文件（需主干 owner 审核）

- `agent/src/state.ts`
- `agent/src/graph.ts`
- `agent/src/index.ts`
- `agent/src/tools/skillsRegistry.ts`
- `agent/src/workflowRegistry.ts`
- `agent/src/tools/memory/workflowCandidateDb.ts`
- `homesense-frontend/src/api/index.ts`

## 3. 目录默认归属

### Runtime Lead
主要负责：
- `agent/src/graph.ts`
- `agent/src/state.ts`
- `agent/src/index.ts`
- graph tests
- `/api/chat`
- `write_back`

### Tool & Capability Engineer
主要负责：
- `agent/src/tools/index.ts`
- `agent/src/tools/skillsRegistry.ts`（仅在 approved 情况下）
- `agent/src/tools/adb/`
- `agent/src/tools/hami/`
- `skills/*.md`

### Experience Layer Engineer
主要负责：
- `agent/src/tools/success_paths/`
- success path merge / audit / promotion 相关接口与逻辑
- 经验层治理脚本

### Workflow Engineer
主要负责：
- `agent/src/workflowRegistry.ts`（小 diff / approved）
- `agent/src/tools/memory/workflowCandidateDb.ts`（小 diff / approved）
- workflow executor
- workflow candidate / registry / execute bridge

### Frontend / Ops UI Engineer
主要负责：
- `homesense-frontend/src/views/chat/`
- `homesense-frontend/src/views/config/`
- workflow / success-path / rules 相关组件
- `homesense-frontend/src/api/index.ts`（仅 approved 小 diff）

### Deep Agent / Prompt Engineer
主要负责：
- `agent/src/tools/llm_agent/`
- llm structured plan / validation / recovery
- deep evaluation assets

### QA / Observability Engineer
主要负责：
- tests/
- smoke/
- validation/
- metrics/
- dashboard/

## 4. 默认禁止事项

- 不跨 owner 改目录“顺手清理”
- 不在同一个提交里同时做协议变更 + UI 大改
- 不在未通知 Runtime Lead 的情况下改冻结字段
- 不在未更新 freeze 文档的情况下做 breaking change

## 5. 合并审批规则

### 必须 Runtime Lead 审核
- 修改 `StageResult`
- 修改 `IntentSchema`
- 修改 `/api/chat` response shape
- 修改 capability naming
- 修改 graph stage 顺序
- 修改 write_back record type

### 必须对应 owner 审核
- success-path 治理 API 改动
- workflow candidate / registry / executor 改动
- frontend debug / ops UI 数据绑定改动
- deep layer structured output 改动

## 6. 交付要求

每个 owner 的 PR / patch 都必须说明：

1. 影响目录
2. 是否触碰红区文件
3. 是否影响冻结字段
4. 已跑测试
5. 后续待做事项
