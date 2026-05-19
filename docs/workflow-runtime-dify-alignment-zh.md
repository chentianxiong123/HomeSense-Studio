# WorkflowRuntime 对齐 Dify 的约束

> 文档定位：明确 HomeSense Studio Plus 的 `WorkflowRuntime` 不能停留在轻量节点执行器，而应吸收 Dify/Graph 引擎式运行时的关键骨架。

## 1. 先说判断

当前项目里的 `WorkflowRuntime` 还不是 Dify 式工作流引擎。

现在的实现更接近：

```text
读 DB 节点
-> 拓扑排序
-> 逐个 executeNode
-> 收集 trace
```

这能做演示骨架，但还不够支撑你要的：

- Studio 作为 Agent 中枢
- 多执行器 / 多 Agent 节点
- 子流程
- 变量作用域
- 条件分支
- 运行态控制
- 未来像 Dify 一样扩节点

## 2. Dify 真正值得吸收的东西

根据本地 Dify 细读：

- `WorkflowEntry`
- `GraphEngine`
- `GraphRuntimeState`
- `VariablePool`
- `NodeFactory`
- `Node` 基类
- Child engine builder

HomeSense 不一定照抄名字，但必须吸收这些结构。

## 3. 当前实现的主要不足

对应文件：

- [run-workflow.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/run-workflow.ts>)
- [execute-node.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/execute-node.ts>)
- [variable-pool.ts](<D:/files/HomeSense Stdio/packages/backend/src/modules/workflow/variable-pool.ts>)

### 不足 1：没有真正的 Graph Runtime State

现在只有一个 `VariablePool` 和一条 `trace` 数组。

还缺：

- run context
- call depth
- cancellation / command channel
- node-level runtime state
- child workflow state
- execution metadata

### 不足 2：没有 NodeFactory

现在是 `switch(node.type)`。

这在节点少的时候能跑，但一旦要加：

- agent executor
- cli executor
- subflow
- human confirm
- external tool / gateway node

这个 `switch` 很快会失控。

### 不足 3：没有 Node 基类和统一事件模型

现在 `executeNode()` 直接返回 `NodeResult`。

还缺：

- `Node` 抽象
- `NodeRunContext`
- `NodeEvent`
- `NodeRunResult`
- 节点生命周期统一协议

这会直接影响：

- trace 粒度
- 节点调试
- 子流程
- 流式事件

### 不足 4：变量作用域太薄

当前 `VariablePool` 只像一个简单 KV。

还缺：

- workflow 输入作用域
- node 输出作用域
- branch 局部作用域
- child workflow 继承 / 覆盖
- executor / agent 输出映射

### 不足 5：分支与并行还只是外形

现在虽然有 `if_else`、`parallel` 节点类型，但 runtime 没有真正的图引擎控制力。

例如：

- `parallel` 只是返回 success，并没有实际并发子执行。
- `if_else` 只是算个值，没有显式 branch routing。
- 没有 iteration / loop 能力。
- 没有 child workflow engine。

### 不足 6：Workflow 还没有成为 Agent 中枢

当前节点仍主要围绕：

- `device_control`
- `xiaoai`
- `ir_control`
- `llm`
- `code`

但你现在要的 Studio 是：

```text
设备执行器
+ CLI 执行器
+ 外部 Agent 执行器
+ 子流程
+ 人工确认
+ 内容生产节点
```

这要求 runtime 本身是可扩展引擎，而不是写死设备节点的 runner。

## 4. HomeSense 该怎么吸收 Dify

### 第一层：保留现有骨架，但停止继续堆 `switch`

现有 runtime 不用立刻推翻，但从现在开始不要继续往 `executeNode.ts` 里加更多硬编码 case。

### 第二层：补上这几个核心抽象

建议新增：

```text
WorkflowRuntime
GraphRuntimeState
WorkflowNodeFactory
WorkflowNodeBase
NodeRunContext
NodeEvent
ExecutorRegistry / AgentGateway
```

### 第三层：把节点从“类型分支”变成“类/处理器注册”

目标形态：

```text
node.type
-> factory.create(node)
-> node.run(context)
-> yield events / return result
```

### 第四层：把子流程当 child engine

这点非常像 Dify，必须要有。

因为你后面一定会需要：

- `看 B 站` 是一个子流程
- `打开台式机` 是一个子流程
- `调用 B 站 CLI 生成草稿` 是一个子流程
- `调 Claude Code / Codex / OpenClaw` 是一个子流程或 executor 节点

没有 child engine，Studio 很快会碎成一堆重复大图。

## 5. 对当前接管工作的影响

这不意味着我们现在要先重写整个 WorkflowRuntime，再去测 Hero 路径。

正确顺序是：

1. 先继续打通 Hero 路径所需的非模型链路。
2. 同时停止给现有 `switch` 模式继续加复杂节点。
3. 在 Hero 路径站稳后，优先重构 WorkflowRuntime 核心抽象。

也就是说：

```text
Hero 路径先站起来
WorkflowRuntime 再升级为 Dify 式引擎
```

而不是反过来。

## 6. 接下来必须优先做的 Runtime 约束

如果按优先级排，我建议是：

1. `WorkflowNodeFactory`
2. `WorkflowNodeBase` / `run(context)`
3. `GraphRuntimeState`
4. `NodeEvent` 流
5. `Subflow / ChildEngine`
6. `ExecutorRegistry / AgentGateway`

## 7. 最终要求

以后我们判断一个 `WorkflowRuntime` 改动是不是对的，不看它“能不能多跑一个节点”，而看它是否更接近这几个标准：

- 节点是否通过工厂创建
- 节点是否有统一运行上下文
- trace 是否来自统一事件模型
- 子流程是否是 child engine，不是手写递归
- executor / agent 节点是否能自然接入
- 变量池是否有作用域概念

这才是你要的 Studio。
