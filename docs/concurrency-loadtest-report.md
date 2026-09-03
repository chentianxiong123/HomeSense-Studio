# v6 并发多实例压测报告

> 日期：2026-09-03 · 状态：M1/M2 已完成
> 目的：验证「官方 picoclaw 单进程能否承载多用户多实例并发」这一 v6 核心假设

## 1. 结论摘要

**可行，没有结构性问题。** 官方 picoclaw 原生支持单进程多实例（`AgentRegistry` 持有 `map[string]*AgentInstance`），实测 128 个独立 agent 实例同进程同时对话，**零超时、零串线**，内存超卖余量大。

必须动的源码仅一处：注册表补运行时热增删（`AddUserAgent/RemoveUserAgent`）；必须自建的控制面一处：按用户并发限流（官方 `MaxParallelTurns` 是全进程共享槽）。

## 2. 测试环境

| 项 | 值 |
|---|---|
| 源码 | 官方 `sipeed/picoclaw` 原版，复制到 `v6/third_party/picoclaw`（主 module 以 `replace` 引用） |
| Go | 1.26.5 linux/amd64 |
| 压测器 | `v6/cmd/usersim`（自研，无真实 API，注入 mock Provider） |
| 模型链路 | mock Provider 实现 `providers.LLMProvider`，无真 API |

## 3. 压测器实现

- **每用户 = 一个 `AgentInstance`**（独立 workspace + 独立会话存储），dispatch rule 按 `sender=uXXX` 路由到对应实例
- **Mock Provider** 注入官方 `providers.LLMProvider` 接口，回显用户标识做隔离校验
- **fan-out 修复**：共享 `OutboundChan` 必须由单一 `pump` 按 chatID 分发到每用户队列，否则多 goroutine 抢消息会丢响应（这是压测器的坑，非 picoclaw 的问题）
- **行为模拟**：多轮上下文累积 + 工具意图 + 随机停顿 + 阶梯并发

## 4. 测试数据

### 4.1 M1 · 纯并发回显（无工具）

| 用户数 | 并行 | 完成 turns | 超时 | 隔离违规 | p50 | p95 | p99 | Heap 增量 |
|---|---|---|---|---|---|---|---|---|
| 2 | 2 | 6/6 | 0 | 0 | 14ms | 16ms | 16ms | - |
| 16 | 16 | 160/160 | 0 | 0 | 35ms | 43ms | 48ms | +1.2MB |
| 32 | 32 | 256/256 | 0 | 0 | 35ms | 49ms | 53ms | +5MB |
| 64 | 64 | 384/384 | 0 | 0 | 36ms | 46ms | 54ms | +18MB |
| 128 | 128 | 640/640 | 0 | 0 | 77ms | 168ms | 194ms | +31MB |
| 16 | **1** | 80/80 | 0 | 0 | **435ms** | 484ms | 504ms | +1MB |

`parallel=1` 行揭示关键点：官方 `MaxParallelTurns` 是全进程共享的并发槽，16 用户排队导致单轮 435ms（群聊效应）。

### 4.2 M2 · 真实场景（真实工具编排）

注入 `/mnt/shared/.picoclaw/workspace` 真实数据：

- 28 条真实用户话术（"帮我推送吧"、"看看内存状态"、"分析一下改 react 难不难"…）
- 8 个真实 skills（weather/github/hardware/tmux/summarize…）+ SOUL.md/AGENT.md 人格，复制进每用户 workspace 独立加载
- mock 场景感知：工具意图（查内存/看进程/推代码/查天气）返回 `tool_call`，触发**真实 `exec` 工具**执行 `free -m`/`ps`/`git status` 等真命令，走通 `LLM→工具→结果回填→二次 LLM` 完整链路，含 git 失败的错误回填路径

| 用户数 | 并行 | 完成 turns | 工具轮 | 超时 | 隔离违规 | p50 | p95 | p99 | Heap 峰值 | RSS 峰值 |
|---|---|---|---|---|---|---|---|---|---|---|
| 16 | 16 | 96 | 50 | 0 | 0 | 31ms | 92ms | 120ms | +2.9MB | 35.7MB |
| 64 | 64 | 384 | 236 | 0 | 0 | 43ms | 184ms | 243ms | +23MB | 60.5MB |
| 128 | 128 | 768 | 494 | 0 | 0 | 162ms | 585ms | 623ms | +46MB | 85MB |

内存换算：128 用户**全部同时活跃对话**，进程峰值 RSS ~85MB（约 660KB/用户）；空闲用户为纯内存对象，单用户 KB 级。一台 64GB 机器承载几千注册级用户成立。

## 5. 隔离校验方法

- **AgentID 断言**：出站响应 `AgentID` 与预期实例比对，不匹配即违规
- **内容回显**：mock 回显发话者标识，响应内容必须包含对应 userID
- 结果：所有测试隔离违规恒为 0

## 6. 结论与待办

### 已验证 ✅

1. 官方原生单进程多实例成立（`AgentRegistry` 原生设计，非 hack）
2. 数据物理隔离成立（独立 workspace + 独立会话存储，实测零串线）
3. 内存超卖成立（128 活跃并发峰值 ~85MB）
4. 真实工具编排并发稳定（494 轮真实 shell 执行 + 回填二次推理全通过）

### 需 v6 处理 ⚠️

| 项 | 性质 | 动作 |
|---|---|---|
| 注册表运行时热增删 | 官方无 `AddUserAgent/RemoveUserAgent` | fork 补接口（~50-100 行，map+锁已存在） |
| `MaxParallelTurns` 全局共享 | 单用户占满并发槽会饿死他人 | supervisor 按用户/实例设置并发上限 |
| seahorse SQLite 全局单库 | hardcode 在 default agent workspace | 用 per-agent JSONL（默认）可规避；用 seahorse 则需改 per-agent DB |

## 7. 复现

```bash
# 纯并发回显（M1）
go run ./cmd/usersim -users 128 -rounds 6 -parallel 128 -mock-latency-ms 25 -tool-every 0 \
  -workspaces /tmp/ws -corpus ./testdata/corpus -corpus-msgs ./testdata/corpus/user_msgs.txt

# 真实场景（M2）
go run ./cmd/usersim -users 64 -rounds 6 -parallel 64 -tool-every 2 \
  -workspaces /tmp/ws -corpus ./testdata/corpus -corpus-msgs ./testdata/corpus/user_msgs.txt
```

语料位于 `v6/testdata/corpus/`（含从 `/mnt/shared/.picoclaw` 提取的 8 个 skills、SOUL.md、AGENT.md、user_msgs.txt 真实数据，已随仓库归档）。
