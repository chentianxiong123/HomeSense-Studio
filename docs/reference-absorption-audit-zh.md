# HomeSense Studio 参考项目吸收度审计

> 文档定位：检查当前代码里，哪些地方已经真正吸收了参考项目的主干，哪些地方还只是文档层或外形层。
> 结论基于：
> - `D:/files/HomeSense/新生/03-参考项目源码级细读/00-总索引.md`
> - `D:/files/HomeSense/新生/03-参考项目源码级细读/00-源码来源审计表.md`
> - `D:/files/HomeSense/新生/02-HomeSense Studio 模块映射/00-参考项目吸收策略与模块映射.md`
> - 当前 `D:/files/HomeSense Stdio` 代码

## 1. 总结论

如果只问一句：

```text
哪些地方已经做得“有模有样”了？
```

答案是：

- 系统分层和模块边界，已经很有参考项目吸收的味道。
- 设备/实体/服务/状态这套底座，已经明显吸了 Home Assistant 和米家生态映射思路。
- CLI Bridge + Skill 索引这条线，已经明显吸了 mcp2cli / Claude Code skills / phone-mcp 的做法。
- Chat + Studio 双入口的产品骨架，已经能看出 Dify + 老项目前端 + chat surface/studio surface 的融合方向。
- EventBus / Trace / Compensation / Poller / Cron 这些模块名和职责，已经不是随便拼的，确实在往参考项目主干靠。

但如果继续问：

```text
哪些地方已经真正达到参考项目主干级别？
```

答案就会收缩很多：

- `Home Assistant 式 Device/Entity/Service/State`：已经有 6 成味道。
- `mcp2cli / phone-mcp 式 CLI 执行边界`：已经有 6 到 7 成味道。
- `Claude Code skills 渐进式披露`：已有骨架，但还不到主干级。
- `Dify 式 WorkflowRuntime`：只有外壳，主干远远不够。
- `Orra 式可靠工作流恢复`：只有模块位，主干不够。
- `mempalace / ACE / Hermes 式记忆与自增强`：主要还在文档层。

## 2. 已经做得像的部分

### 2.1 Home Assistant / 小米生态：设备底座

对应参考：

- Home Assistant Core
- ha_xiaomi_home
- hass-xiaomi-miot
- miot-mcp
- mijia-api

当前代码里已经像的地方：

- [db/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/db/index.ts>)
- [device/routes.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/device/routes.ts>)
- [service-registry/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/service-registry/index.ts>)
- [device-state-poller/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/device-state-poller/index.ts>)

像在哪里：

- 有 `devices / device_features / entities / entity_states / state_history` 这套表结构。
- 有 device / feature / entity 三层分离。
- 有 service registry，而不是让上层直接打设备 API。
- 有 state poller 和 state machine 的分工。
- 设备发现结果会被归一化入库。

这已经不是 demo 级“设备列表页面”了，而是很明显在吸 HA 的实体模型和米家能力映射。

### 2.2 mcp2cli / phone-mcp / Claude Skills：CLI 执行边界

对应参考：

- mcp2cli
- phone-mcp
- Claude Code agents / skills

当前代码里已经像的地方：

- [cli-bridge/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/cli-bridge/index.ts>)
- [skills-system/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/skills-system/index.ts>)
- [skills/mi-cli/SKILL.md](<D:/files/HomeSense Stdio/skills/mi-cli/SKILL.md>)
- [packages/mi-cli/src/mi_cli/cli.py](<D:/files/HomeSense Stdio/packages/mi-cli/src/mi_cli/cli.py>)

像在哪里：

- `TS -> Python CLI -> JSON stdout` 这条桥已经成立。
- `mi-cli run <json>` 的执行模型已经是 tool/skill 友好的。
- skills 已经不是纯文档，而是会被索引成 action schema。
- CLI 的 action map 已经是显式能力边界。

这说明“省 token、强约束、让 CLI 做手”的思路已经进代码了，不只是文档里说说。

### 2.3 Chat + Studio 双入口骨架

对应参考：

- Dify
- 老项目前端
- chatgpt-web 改造经验

当前代码里已经像的地方：

- [App.vue](<D:/files/HomeSense Stdio/packages/frontend/src/App.vue>)
- [ChatView.vue](<D:/files/HomeSense Stdio/packages/frontend/src/views/ChatView.vue>)
- [StudioView.vue](<D:/files/HomeSense Stdio/packages/frontend/src/views/StudioView.vue>)
- [useChat.ts](<D:/files/HomeSense Stdio/packages/frontend/src/composables/useChat.ts>)
- [useWorkflow.ts](<D:/files/HomeSense Stdio/packages/frontend/src/composables/useWorkflow.ts>)

像在哪里：

- Chat 和 Studio 已经是两个真实页面，不是 README 里的口号。
- Chat 页面已经有 L1/L2/L3 展示位、动作结果展示位、设备侧边栏。
- Studio 已经有工作流列表、节点面板、画布、Runner 的基本交互。

它当然还不成熟，但“双入口单内核”的产品形状已经出来了。

### 2.4 模块化分层本身

对应参考：

- Dify
- Hermes Agent
- OpenClaw
- Orra
- agentmesh

当前代码里已经像的地方：

- `packages/backend/src/modules/*` 这整层目录结构

像在哪里：

- 模块已经按 runtime / device / skill / memory / compensation / cron / workflow / agent-runtime 分开了。
- 不是一坨 “controller/service/utils” 式普通 CRUD 工程。
- `event-bus`、`service-registry`、`rule-engine`、`self-enhancement`、`compensation`、`cron` 这些命名都很有“吸过主干”的味道。

这点很重要，因为它说明前任 AI 至少没有把 20 多个参考项目只吸成“概念清单”，而是真的把模块边界学进去了。

## 3. 做出外形了，但还没吸到主干的部分

### 3.1 Dify：WorkflowRuntime

对应参考：

- Dify

当前代码：

- [run-workflow.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/run-workflow.ts>)
- [execute-node.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/execute-node.ts>)
- [variable-pool.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/variable-pool.ts>)

当前状态：

- 有工作流表。
- 有节点表和边表。
- 有变量池。
- 有拓扑排序执行。
- 有 trace。

为什么还不算真正吸到 Dify 主干：

- 没有 `NodeFactory`。
- 没有 `Node` 基类。
- 没有 `GraphRuntimeState`。
- 没有 child engine / subflow runtime。
- `parallel` / `if_else` 还只是简化版。
- 还是 `switch(node.type)` 的轻执行器，不是图引擎。

所以这块现在是：

```text
外形已经像工作流平台
但 runtime 还没有 Dify 味
```

### 3.2 Orra：可靠工作流与补偿

对应参考：

- Orra

当前代码：

- [compensation/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/compensation/index.ts>)
- [db/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/db/index.ts>)

当前状态：

- 有 `compensation_tasks` 表。
- 有 `processPendingTasks()`。
- 有错误策略和 retry 入口。

为什么还不算像：

- 还没有工作流级预演 / grounding。
- 没有明确的 orchestration state 模型。
- 没有部分成功 / 过期 / 补偿生命周期主干。
- 没有把 workflow runtime 和 compensation runtime 深度绑起来。

所以它更像“预留了 Orra 的位置”，还不是“做出了 Orra 的主干”。

### 3.3 mempalace / Hermes / ACE：记忆与自增强

对应参考：

- mempalace
- hermes-agent
- agentic-context-engine

当前代码：

- [memory](<D:/files/HomeSense Stdio/packages/backend/src/modules/memory>)
- [self-enhancement](<D:/files/HomeSense Stdio/packages/backend/src/modules/self-enhancement>)
- [agent-runtime/index.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/agent-runtime/index.ts>)

当前状态：

- 表已经有：`memory_entities / memory_triples / memory_attributes`
- 模块目录已经有：`memory`、`self-enhancement`
- AgentRuntime 已经会尝试 `rule -> skill -> memory -> llm`

为什么还不算真正吸到主干：

- `memory_triples` 还没形成真正的图谱 runtime。
- 没有像 mempalace 那样的分层记忆与搜索策略。
- 没有像 ACE 那样的 `ADD / UPDATE / TAG / REMOVE` 自学习闭环。
- 没有像 Hermes 那样把 cron / memory / self-improvement 形成长期运行结构。

现在它主要是：

```text
schema 和模块名已经像了
runtime 还没站起来
```

### 3.4 OpenClaw / Agent 中枢

对应参考：

- openclaw
- claude-code-agents
- agentmesh

当前状态：

- 文档里已经把 Studio 升级成 Agent 中枢。
- 代码里还没有真正的 `AgentGateway / ExecutorRegistry` runtime。
- Workflow 节点里还没有外部 agent executor 节点主干。

所以这块现在主要停留在架构正确、实现未跟上。

## 4. 当前最像“参考项目吸收成功”的 5 个点

如果一定要挑“已经做得最像样”的五处，我会选：

1. `Device / Feature / Entity / State` 这套数据库与模块分层  
   已经明显吸了 HA + 米家生态映射。

2. `CLIBridge -> mi-cli` 这条工具执行边界  
   已经明显吸了 mcp2cli / phone-mcp / skills 执行模式。

3. `skills-system + SKILL.md action schema` 这条渐进式能力索引  
   已经有 Claude Code skills 的味道。

4. `Chat + Studio` 双入口页面骨架  
   已经能看出 Dify + 老项目前端主线。

5. backend 模块目录的总体拆法  
   说明参考项目主干至少被学进了结构层，而不是只学了名词。

## 5. 当前最明显“偷懒 / 不敢做深”的地方

如果反过来说，前任 AI 最明显没做深的地方是：

1. `WorkflowRuntime`
   这是最大的。最该吸 Dify 主干的地方，当前只做到了轻 runner。

2. `Memory / Self-enhancement`
   最该体现 mempalace / Hermes / ACE 的地方，当前主要停在表和模块名。

3. `Agent 中枢`
   文档已经跑到 OpenClaw / Claude Code / Codex / 外部 Agent 了，代码还没建立真正的 executor runtime。

4. `补偿与可靠性`
   Orra 的可靠工作流精髓还没进运行时主干。

5. `ADB / TV 执行链`
   旧项目做过，文档也想清楚了，但新项目还没把 Hero 路径重新接回来。

## 6. 最终判断

所以我会给你一个不讨好、但比较真实的判断：

当前这份代码不是“参考项目乱抄拼接物”，也不是“纯文档工程”。

它已经有这些真实价值：

- 架构分层吸收得不错。
- 设备底座吸收得不错。
- CLI/skills 执行边界吸收得不错。
- 双入口产品形状已经有了。

但它也还没有做到：

- Dify 级 WorkflowRuntime
- Orra 级可靠执行
- mempalace / ACE / Hermes 级记忆与自增强
- OpenClaw 级 Agent 中枢

最准确的描述应该是：

```text
参考项目的“系统骨架”和“模块语言”已经吸到了
但最深的 runtime 主干，只有一部分真的落了代码
```
