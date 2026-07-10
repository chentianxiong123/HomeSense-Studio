# HomeSense 并行开发任务拆解表（可直接分配给 5~7 个人）

> 日期：2026-04-08  
> 用途：把《PROJECT_ACCELERATION_PLAN_2026-04-08.md》进一步落成可执行的人员分工表，便于直接拉人并行推进。  
> 适用阶段：HomeSense 当前已进入“主链路可运行、contract 初步稳定、适合并行扩展”的阶段。

---

## 0. 执行原则

并行开发不是把功能随便拆开，而是围绕**稳定 contract**拆工作。

本轮并行必须优先冻结以下 v0.1 接口：

1. `IntentSchema`
2. `StageResult`
3. `CapabilityCommandV0`
4. `WorkflowV0`
5. `/api/chat` response shape
6. `/api/success-paths/*` 基础返回 shape
7. capability naming（如 `device.tv.navigate.home`）
8. write_back record type：`success | failure | non_executable | plan_only | skipped`

如果这些对象继续频繁漂移，所有 owner 都会相互阻塞。

---

## 1. 推荐组织方式

## 方案 A：5 人并行（推荐）

1. **Runtime Lead**：主链路、`/api/chat`、graph、write_back、集成稳定
2. **Tool & Capability Engineer**：ADB/Hami/tool wrappers/capability registry
3. **Experience Layer Engineer**：success_paths、merge/audit、rule promotion funnel
4. **Workflow Engineer**：workflow draft/registry/executor
5. **Frontend / Ops UI Engineer**：chat debug、config console、workflow/rules/success-paths UI

## 方案 B：7 人并行（最快）

在 5 人基础上再加：

6. **Deep Agent / Prompt Engineer**：llm_agent、structured plan、guardrail、evaluation
7. **QA / Observability Engineer**：smoke/e2e/metrics/dashboard/contract validation

---

## 2. 工作流总表

| 工作流 | Owner 角色 | 优先级 | 是否阻塞他人 | 目标 |
|---|---|---:|---|---|
| A. Runtime 主链路稳定 | Runtime Lead | P0 | 中 | 把 graph、`/api/chat`、write_back 做稳 |
| B. Capability / Tooling 扩展 | Tool & Capability Engineer | P1 | 低-中 | 把统一能力面做厚 |
| C. Experience 治理 | Experience Layer Engineer | P1 | 低 | 把经验层做成可治理系统 |
| D. Workflow Runtime | Workflow Engineer | P1 | 低-中 | 把 workflow 从预览推进到执行 |
| E. Frontend / Ops UI | Frontend / Ops UI Engineer | P1 | 低 | 把前端变成可观测/治理面板 |
| F. Deep Agent 强化 | Deep Agent / Prompt Engineer | P2 | 低 | 提升复杂任务成功率 |
| G. QA / Observability | QA / Observability Engineer | P0/P1 | 中 | 给并行开发补护栏 |

---

## 3. 可直接分配的 Owner 任务卡

## A. Runtime Lead

### 负责范围
- `agent/src/graph.ts`
- `agent/src/state.ts`
- `agent/src/index.ts`
- `/api/chat`
- `write_back`
- graph stage contract tests

### 输入
- 现有 graph 主链路
- 已定义的 `IntentSchema` / `StageResult` / `CapabilityCommandV0`
- 现有 `/api/chat` rich response

### 输出
1. 冻结后的 runtime v0.1 contract
2. 稳定的 `/api/chat` response schema
3. graph stage contract tests
4. write_back 行为测试集
5. 统一 smoke 脚本

### 关键任务
1. 固化 `StageResult` / `StageTraceEntry` 字段边界
2. 固化 `/api/chat` 的返回字段
3. 补 rule hit / local_intent / success_paths / llm / tool_executor / write_back 的回归用例
4. 把 write_back 的 success/failure/plan_only/non_executable/skipped 行为测透
5. 减少 handler/graph/tool 层的协议漂移

### 依赖
- 基本不依赖其他组先完成
- 但会为 B/C/D/E/G 提供稳定接口

### 阻塞对象
- B、C、D、E、G 全部会被其 contract 漂移影响

### 验收标准
- `/api/chat` schema 出一版 freeze 清单
- graph 核心 stage 都有 contract test
- 至少覆盖：命中规则、命中 success path、deep fallback、tool partial failure、write_back skipped
- backend build 通过
- smoke 跑通且结果稳定

### Definition of Done
- 其他 owner 可以按文档接接口，不再反复追问字段含义

---

## B. Tool & Capability Engineer

### 负责范围
- `agent/src/tools/index.ts`
- `agent/src/tools/skillsRegistry.ts`
- `agent/src/tools/adb/*`
- `agent/src/tools/hami/*`
- 各 tool `skills/*.md`

### 输入
- Runtime Lead 冻结后的 capability/output contract
- 当前已有 capability registry v0
- ADB/Hami 现有工具动作

### 输出
1. 更完整的 capability registry
2. 每个 capability 的 `requiredInputs` / `riskLevel` / `preconditions`
3. ADB progressive skills 扩展
4. Hami/Home capabilities 扩展
5. capability coverage checklist
6. capability contract validation 脚本

### 关键任务
1. 补齐 TV 导航、UI 感知、点击、打开 app 等能力
2. 补齐 Home voice / remote commands
3. 明确 tool action -> capability 的映射
4. 建 requiredInputs 缺失检查
5. 建 precondition 预检查
6. 给 registry preview/runtime preview 提供稳定元信息

### 依赖
- 依赖 capability naming 冻结
- 弱依赖 Runtime Lead 的 schema 稳定

### 阻塞对象
- D Workflow、F Deep Agent、E Frontend 都依赖 capability contract

### 验收标准
- 形成 capability 清单文档
- 每个 capability 至少有：名称、preferredTool、action、riskLevel、requiredInputs
- 新增 capability 能在 registry preview 中看到
- capability validation 脚本可识别缺字段/脏映射
- backend build 通过

### Definition of Done
- Workflow 和 Deep Agent 可以直接消费 capability，不再自己猜动作细节

---

## C. Experience Layer Engineer

### 负责范围
- `success_paths` tool
- `/api/success-paths/*`
- rule candidate promotion
- cluster / merge / audit 流程
- write_back 质量治理

### 输入
- Runtime 持续产出的 write_back 记录
- 已有 success paths 数据
- 现有 merge/audit/rule candidate 接口

### 输出
1. success path record schema v0.1
2. merge/cluster 质量改进
3. failure/non_executable/plan_only 治理策略
4. promotion funnel 指标口径
5. rule candidate 审核策略
6. 更稳定的治理 API 返回结构

### 关键任务
1. 固定 success path 的关键字段和可选字段
2. 细化哪些记录可写回、哪些必须跳过
3. 优化 cluster 质量和 merge 策略
4. 让 promotion / rollback / enable / disable 形成稳定流程
5. 增加污染控制与人工审阅入口

### 依赖
- 依赖 Runtime Lead 固定 write_back record type
- 弱依赖 Frontend 提供治理操作面

### 阻塞对象
- 不强阻塞其他组，但会影响长期数据质量

### 验收标准
- merge/audit API 可稳定返回可消费结构
- 至少能区分 success/failure/non_executable/plan_only/skipped
- rule candidate -> promote -> rollback 流程可验证
- 污染控制有明确策略，不再“全量写回”

### Definition of Done
- 经验层从“堆数据”变成“可审查、可合并、可回滚、可统计”

---

## D. Workflow Engineer

### 负责范围
- `agent/src/workflowRegistry.ts`
- `agent/src/tools/memory/workflowCandidateDb.ts`
- workflow candidate / registry 逻辑
- workflow executor（新增）

### 输入
- `WorkflowV0` schema
- capability registry
- chat 产出的 workflowDraft

### 输出
1. workflow executor contract
2. capability node -> runtime action bridge
3. workflow 节点状态机
4. replay/debug 数据模型
5. 最小可执行 workflow runtime
6. 审批/人工接管点设计

### 关键任务
1. 定义 executor 输入输出
2. 把 workflow node 映射到 runtime command/action
3. 建 pending/running/success/failure/blocked 状态机
4. 支持 candidate -> accept -> registry -> execute 的最小链路
5. 预留审批节点和中断恢复结构

### 依赖
- 依赖 `WorkflowV0` 固定
- 中度依赖 capability naming 和 capability registry
- 弱依赖 Runtime 返回统一执行结果

### 阻塞对象
- 不强阻塞主链路，但会影响 workflow 从展示走向产品化

### 验收标准
- 至少一个 workflow 能从 registry 执行
- capability 节点可成功桥接到 runtime action
- 执行结果能回传节点状态
- candidate/registry/execution 三段链路可串起来

### Definition of Done
- workflow 不再只是 preview，而是可跑一个最小真实编排

---

## E. Frontend / Ops UI Engineer

### 负责范围
- `homesense-frontend/src/views/chat/index.vue`
- `homesense-frontend/src/views/config/index.vue`
- workflow/debug/rules/success-paths 相关组件
- `homesense-frontend/src/api/index.ts`

### 输入
- `/api/chat` rich response
- `/api/success-paths/*` 治理接口
- `/api/workflows/*` / `/api/workflow-candidates`
- registry preview / skills policy payload

### 输出
1. 普通视图 / debug 视图双模式
2. trace/debug 折叠展示优化
3. workflow draft/candidate/registry 交互收口
4. success-path merge/audit 操作反馈
5. rule promotion/rollback 治理 UX

### 关键任务
1. 把聊天页的 rich payload 展示做清楚
2. 保持默认视图简洁，debug 视图展开信息
3. 补 workflow candidate 审阅操作
4. 补 success path merge/audit 的操作反馈和错误提示
5. 配置页信息组织收口

### 依赖
- 依赖 API shape 稳定
- 不依赖 llm_agent 完成
- 可与 C/D 并行推进

### 阻塞对象
- 基本不阻塞其他组

### 验收标准
- 聊天页能稳定展示 reply / intent / trace / workflowDraft / registryDebug / writeBackResults
- 支持 debug 折叠/展开
- config 页可完成 success path merge/audit、rule promote/rollback、workflow 候选查看
- frontend build 通过

### Definition of Done
- 前端已经是运营/调试面板，而不只是聊天壳子

---

## F. Deep Agent / Prompt Engineer（7 人方案）

### 负责范围
- `agent/src/tools/llm_agent/tool.ts`
- `agent/src/graph.ts` 中 llm_agent 分支
- prompt / policy / validation / recovery

### 输入
- capability registry
- selected skills
- success path 提示
- Runtime 返回的上下文 contract

### 输出
1. deep 输入上下文 contract
2. structured plan 输出格式
3. invalid_actions 检测/修复逻辑
4. planner-only / actionable / blocked 评估集
5. 可执行与不可执行边界策略

### 关键任务
1. 优化 prompt 结构
2. 提升 structured output 稳定性
3. 增加 invalid action 检测与清洗
4. 明确 deep layer guardrail
5. 构建离线评估样本集

### 依赖
- 依赖 capability registry 稳定
- 依赖 Runtime 的 deep 输入字段稳定

### 阻塞对象
- 不阻塞前端和主链路，但直接影响高复杂任务成功率

### 验收标准
- actionable / plan_only / blocked / invalid_actions 有清晰区分
- structured output 稳定率明显提升
- 有一组固定评估样本可反复跑
- llm_agent 不再频繁产出无效动作

### Definition of Done
- deep layer 可以被持续调优，而不是每次临时改 prompt

---

## G. QA / Observability Engineer（7 人方案）

### 负责范围
- backend tests
- frontend smoke tests
- API contract checks
- e2e flows
- stage metrics / dashboard

### 输入
- Runtime contract
- capability registry
- workflow schema
- 关键用户路径清单

### 输出
1. route smoke test
2. stage-level contract / snapshot tests
3. capability validation checks
4. workflow schema validation
5. 关键路径 e2e 集
6. metrics/dashboard 方案

### 关键任务
1. 给 `/api/chat`、`/api/success-paths/*`、`/api/workflows/*` 建 smoke
2. 给 graph stage 建 contract/snapshot test
3. capability registry 建校验器
4. workflow schema 建校验器
5. 建 success funnel / escalation rate / tool failure attribution 指标

### 依赖
- 依赖 Runtime/API shape 冻结
- 可与所有组穿插协作

### 阻塞对象
- 短期不阻塞，长期会决定整体速度上限

### 验收标准
- 至少覆盖核心路由 smoke
- 至少覆盖 3~5 条关键用户路径 e2e
- stage metrics 可统计
- 能快速定位是 rule、capability、tool 还是 deep layer 出问题

### Definition of Done
- 并行人一多时，团队不会因为回归失控而失速

---

## 4. 依赖图（简版）

## 强依赖

1. **Runtime Lead** 先冻结 v0.1 contract
   - 否则 E/F/G 都会反复返工

2. **Tool & Capability Engineer** 尽快稳定 capability naming
   - 否则 D/F/C 无法收口

3. **Experience Layer Engineer** 与 Runtime Lead 一起固定 write_back record types
   - 否则治理 UI、统计口径、规则漏斗都不稳定

## 弱依赖

以下可以并行：
- E Frontend UI 与 F Deep Agent
- C Experience 治理 与 D Workflow Executor
- B Capability 扩展 与 E Config UX
- G QA 验证脚本 与各组同步推进

---

## 5. 两周执行排班建议

## Week 1：先稳 contract + 铺能力底座

### Runtime Lead
- 冻结 `IntentSchema` / `StageResult` / `/api/chat` response
- 补 graph stage contract tests
- 补 write_back 用例

### Tool & Capability Engineer
- 补 capability registry 第一轮
- 整理 ADB/Hami skills
- 建 capability coverage checklist

### Experience Layer Engineer
- 固定 success path schema
- 固定 merge/audit 返回结构
- 固定 promotion funnel 基础口径

### Workflow Engineer
- 产出 workflow executor 设计稿
- 固定 node state model
- 设计 capability bridge

### Frontend / Ops UI Engineer
- 清理 chat/config 面板的字段映射
- 做 debug 视图 / 普通视图分层
- 预留 workflow candidate 审阅位

### Deep Agent / Prompt Engineer（若有）
- 固定 deep input context
- 建第一版 structured output contract

### QA / Observability Engineer（若有）
- 建 `/api/chat`、`/api/success-paths/*` smoke
- 建 stage contract 测试框架

## Week 1 交付物
- 一版 contract freeze 清单
- 一版 capability registry 清单
- 一版 success path schema
- 一版 workflow executor 设计
- 一版 smoke/contract test 雏形

---

## Week 2：执行闭环 + 治理收口

### Runtime Lead
- 收口 graph/write_back 的剩余协议问题
- 跑集成回归

### Tool & Capability Engineer
- 扩充第二轮 capabilities
- 完成 precondition/riskLevel/requiredInputs 校验

### Experience Layer Engineer
- 提升 merge/audit 质量
- 打通 promote/rollback/enable/disable 治理闭环

### Workflow Engineer
- 打通最小 workflow executor
- 打通 candidate -> accept -> execute

### Frontend / Ops UI Engineer
- workflow candidate / registry / merge audit 交互收口
- debug 面板增强

### Deep Agent / Prompt Engineer（若有）
- 跑离线评估集
- 提升 invalid actions 检测

### QA / Observability Engineer（若有）
- 补 e2e
- 出 stage 命中率 / escalation / failure attribution 初版指标

## Week 2 交付物
- 一版可执行 workflow runtime
- 一版 experience 治理闭环
- 一版前端运营面增强
- 一版 smoke/e2e/metrics 基础护栏

---

## 6. 每个 Owner 的验收口径

为避免“写了很多但无法交付”，每个 owner 最终验收统一看 5 件事：

1. **接口是否稳定**：是否还能被其他组直接消费
2. **是否可验证**：有没有 smoke/test/demo path
3. **是否可回归**：改完后能否重复验证
4. **是否可运营**：不是只在代码里存在，而是能被查看/治理/解释
5. **是否减少系统复杂度**：不能靠增加隐式逻辑换取短期看似可用

---

## 7. 推荐的协作节奏

### 每天固定 15 分钟同步
每个 owner 只报 4 件事：
1. 昨天完成了什么
2. 今天要交付什么
3. 当前 blocker 是什么
4. 有没有 contract 变更

### contract 变更规则
- 非必要不改字段名
- 新字段只增不破
- 若必须改，先更新 freeze 清单，再通知前后端/QA

### 每周固定两次集成窗口
- 周三：中周集成
- 周六：周收口集成

这样可以避免“大家各自都能跑，但一合并就爆”。

---

## 8. 最小启动顺序

如果今天就开工，建议直接这样启动：

### Day 1
1. Runtime Lead 出 contract freeze v0.1
2. Tool & Capability Engineer 冻结 capability naming
3. Experience Layer Engineer 冻结 write_back record type
4. Workflow Engineer 出 executor contract 草稿
5. Frontend / Ops UI Engineer 对齐当前 payload 展示点
6. QA/Observability 建 smoke 基架

### Day 2~3
- 各 owner 开始并行开发
- 所有变更围绕 freeze contract 推进
- 第一批 smoke/contract tests 同步进 repo

### Day 4~5
- 中周集成
- 修复 contract 漂移
- 补第一轮验收 demo

---

## 9. 我的直接建议

如果你现在就是要提速，最值得立刻执行的是：

1. 先按 **5 人并行结构**启动
2. 把 **Runtime Lead + Tool/Capability Engineer + Workflow Engineer** 视为核心主轴
3. 把 **Experience Layer + Frontend/Ops UI** 作为产品化与治理双翼
4. 如果能再加 2 人，就立刻补上 **Deep Agent** 和 **QA/Observability**

最重要的不是“再想清楚一点”，而是：

- 先冻结 contract
- 立刻分 owner
- 让每个人围绕同一套接口并行产出
- 用 smoke/test 护住节奏

这样 HomeSense 会从“一个人连续往前堆功能”，真正进入“可持续提速的工程化并行阶段”。
