# L1 规则引擎 — MCP 工具方案

> 设计日期：2026-09-02
> 状态：设计中
> 目标：让 L1 规则引擎成为 LLM 可调用的工具，SQLite 存本地，命中后直接触发

---

## 1. 核心思路

### 1.1 不是"绕过 LLM"，而是"LLM 主动调规则工具"

传统规则引擎是**前置拦截器**（v2 设计）：消息先走规则匹配，命中才跳过 LLM。
这个方案的问题是：规则更新要重启、LLM 不知道规则存在、语义模糊时规则帮不上忙。

**新方案**：L1 规则引擎作为 **native Go tool** 注册进 picoclaw agent，LLM 在每轮推理时自主决定是否调用：

```
用户: "开一下客厅的灯"
  │
  ▼ LLM 推理
  ├─ 识别到规则工具可用？→ 调用 rule_engine.match("开一下客厅的灯")
  │    → 命中 rule #3: {打开}{room=客厅}{设备=灯}
  │    → 返回 {matched:true, action:{device_id:12, capability:"power", state:"on"}}
  │    → LLM 直接执行 action（不再"思考怎么开灯"）
  └─ 无匹配 / LLM 选择不调用 → 继续正常 LLM 工具调用流程
```

**好处**：
- LLM 知道规则存在，可以在回答里解释："因为你之前说过'开灯就是开主灯'"
- 规则是**LLM 可理解的输入**，不是黑箱前置判断
- 用户可通过对话修改规则（"以后我说'亮一点'就是调到 60% 亮度"）
- SQLite 持久化在 workspace，重启不丢

### 1.2 SQLite 存储位置

```
{PICOCLAW_HOME}/workspace/
  └── rule_engine.db
      ├── synonym_groups    （同义词组）
      ├── synonyms          （同义词成员）
      ├── rule_templates    （规则模板）
      ├── rule_actions      （动作定义）
      ├── rule_match_log    （匹配日志）
      └── intent_fingerprints  （经验路径 fingerprint，L2 用）
```

- 路径 = `cfg.WorkspacePath()` + `/rule_engine.db`（和 cron jobs.json 同一目录）
- per-tenant 隔离：每个家庭一个 workspace，一个 db
- 文件即备份：`cp workspace/rule_engine.db backup/` 即可
- 无外部依赖：modernc.org/sqlite（已在本项目间接依赖中）

---

## 2. 架构位置

### 2.1 代码布局

```
v5/backend/pkg/
  ├── ruleengine/              ← 新建（规则引擎核心）
  │   ├── engine.go            ← RuleEngine 结构 + Match() + Execute()
  │   ├── schema.go            ← SQL schema（CREATE TABLE 等）
  │   ├── types.go             ← RuleTemplate / RuleAction / SynonymGroup
  │   ├── match.go             ← 同义词扩展 + 模板匹配逻辑（搬 v2 rule-engine-v3.md）
  │   └── store.go             ← SQLite CRUD（现代c/sqlite，纯 Go 无 CGO）
  │
  └── tools/
      └── rule_engine_tool.go  ← 新建（LLM 可调用的 Tool 实现）
          └── 实现 tools.Tool 接口
```

### 2.2 注册入口

参考 `gateway.go:860` 的 `setupCronTool` 模式：

```go
// gateway.go setupAndStartServices 里加
ruleEngineStore, err := ruleengine.NewStore(
    filepath.Join(cfg.WorkspacePath(), "rule_engine.db"),
)
if err != nil {
    return nil, fmt.Errorf("failed to init rule engine: %w", err)
}
ruleEngine := ruleengine.New(ruleEngineStore)
ruleTool := tools.NewRuleEngineTool(ruleEngine, al, msgBus, cfg)
al.RegisterTool(ruleTool)
```

`agent_inject.go` 已有 `RegisterTool` 方法，直接在 `al` 上调用即可。

### 2.3 Tool 接口实现

```go
// v5/backend/pkg/tools/rule_engine_tool.go

type RuleEngineTool struct {
    engine *ruleengine.Engine
    al     *agent.AgentLoop
    bus    *bus.MessageBus
}

func (t *RuleEngineTool) Name() string { return "rule_engine" }

func (t *RuleEngineTool) Description() string {
    return `Check if the user message matches any predefined voice command rule.
Returns matched rule, resolved action, and confidence.
If matched=true, execute the returned action directly without LLM reasoning.`
}

func (t *RuleEngineTool) Parameters() map[string]any {
    return map[string]any{
        "type": "object",
        "properties": map[string]any{
            "message": map[string]any{
                "type": "string",
                "description": "User's spoken or typed message to match against rules",
            },
        },
        "required": []string{"message"},
    }
}

func (t *RuleEngineTool) Execute(ctx context.Context, args map[string]any) *ToolResult {
    msg, _ := args["message"].(string)
    if msg == "" {
        return tools.ErrorResult("message is required")
    }
    return t.engine.Match(ctx, msg)
}
```

### 2.4 集成进 `processMessage` 流（可选 fast-path 短路）

在 `agent_message.go:123` 的 `processMessage` 里，调用 LLM 之前加一个**轻量短路检查**：

```go
func (al *AgentLoop) processMessage(ctx context.Context, msg bus.InboundMessage) (string, error) {
    // ... 现有 prepareInboundMessageForAgent ...

    // L1 fast-path: 如果规则引擎工具已注册，先做一次快速匹配（毫秒级）
    // 仅当置信度 ≥ 0.95 时短路，避免误判
    if result := al.tryFastRuleMatch(ctx, msg.Content); result != nil {
        logger.InfoCF("agent", "L1 rule match shortcut", map[string]any{
            "rule_id": result.RuleID,
            "msg":     utils.Truncate(msg.Content, 60),
        })
        return al.executeRuleAction(ctx, msg, result)
    }

    // ... 后续 LLM 流程不变 ...
}
```

`tryFastRuleMatch` 是**非阻塞**的轻量检查（不调 LLM，纯规则匹配），只有高置信度命中才短路。
`executeRuleAction` 调用同一个 tool 的 Execute，复用逻辑。

> 注意：这是**可选优化**。即使不加这段短路，LLM 自己调 `rule_engine` tool 也能工作。
> 短路的收益是：简单指令零 LLM 调用，**< 5ms 响应**。

---

## 3. L2 经验路径（fingerprint 召回）

### 3.1 概念

L2 不是"规则"，是"历史成功路径的记忆"。
用户上次说"把客厅灯调亮一点"，LLM 选了 brightness=80%，执行成功。
这次再说"把客厅灯调亮一点" → L2 直接召回，0 token。

```
intent_fingerprint = hash(device_id, capability, normalized_args)
  ↓
confidence = experience_path.success_count / (success_count + failure_count)
  ↓
confidence ≥ 0.84 → 直接执行该 workflow（L2 hit）
confidence < 0.84 → 注入 system prompt，LLM 决策（降级到 L3）
```

### 3.2 存储

同一个 `rule_engine.db`，加表：

```sql
CREATE TABLE IF NOT EXISTS intent_fingerprints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,  -- SHA256("{device_id}:{capability_id}:{arg_hash}")
    device_id   TEXT NOT NULL,
    capability  TEXT NOT NULL,
    args_hash   TEXT NOT NULL,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    workflow_id TEXT,                  -- 关联 RuleGo workflow chain_id
    last_succeeded_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fingerprint_device ON intent_fingerprints(device_id, capability);
```

### 3.3 写回时机（L3 → L2 晋升）

在 `pipeline_execute.go` 的 `RunToolLoop` 成功结束后（tool 调用链全部返回成功），提取本次执行的 fingerprint 并写库：

```go
// pipeline_execute.go RunToolLoop 末尾
if result.Success {
    fingerprint := extractFingerprintFromToolCalls(ts.toolCalls)
    fingerprintStore.Record(fingerprint, true)
}
```

`extractFingerprintFromToolCalls` 从成功的 tool_call 列表里提取 `{device_id}:{capability}:{args}`。

---

## 4. 三级架构最终形态

```
用户输入
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ [L1] 规则引擎 tool（LLM 可调用，可选短路）                    │
│   · synonym_groups + rule_templates（用户预编辑）              │
│   · 高置信度（≥0.95）→ 直接短路，< 5ms                        │
│   · 低置信度 → 放行给 LLM                                    │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ [L2] 经验路径指纹召回（LLM 可调用，可选短路）                  │
│   · intent_fingerprints（自动学习自 L3 成功路径）              │
│   · confidence ≥ 0.84 → 直接执行 workflow，< 100ms           │
│   · 低置信度 → 放行给 LLM                                    │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ [L3] picoclaw agent loop（原有）                              │
│   · LLM + tool loop（mi_device / adb / workflow_dispatch ...）│
│   · 成功执行后 → 自动提取 fingerprint 写 L2 缓存               │
└─────────────────────────────────────────────────────────────┘
```

**关键设计**：
- L1/L2 都是 **LLM 可调用的 tool**，也是**可选短路**
- L1 规则由**用户维护**（对话/Studio 编辑器）
- L2 路径由**系统自动学习**（L3 成功后写回）
- 短路与 tool 调用**并存不悖**：用户习惯的指令走短路（零延迟），新场景走 LLM（灵活）

---

## 5. 实施步骤

| 阶段 | 内容 | 工作量 | 验证方式 |
|---|---|---|---|
| **P0** | 建 `pkg/ruleengine/`，SQLite schema + Match() 核心逻辑 | 1 天 | `go test` 单测，对照 v2 rule-engine-v3.md 场景 1-6 |
| **P1** | 建 `tools/rule_engine_tool.go`，实现 `tools.Tool` 接口 | 半天 | 注册到 agent，LLM 能调用并看到工具定义 |
| **P2** | `gateway.go` 加 `setupRuleEngineTool()` 注册 | 半天 | 启动日志看到 `rule_engine` 工具已加载 |
| **P3** | `agent_message.go` 加 `tryFastRuleMatch` 短路 | 1 天 | 简单指令（"开灯"）不走 LLM，SSE 直接返回 |
| **P4** | L2 fingerprint 写回（L3 成功后自动学习） | 1 天 | 执行一次成功后，同输入下次命中 L2 |
| **P5** | L2 短路（高置信度直接走 workflow） | 1 天 | 经验路径 confidence ≥ 0.84 时绕过 LLM |

**总计：约 5-6 天**，可分步提交每阶段。

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| LLM 不调 rule_engine tool（"忘记"了） | 短路永远不触发 | P3 短路检查不依赖 LLM，独立运行 |
| 规则冲突（两条规则都匹配） | 错误执行 | 按 `priority` 字段排序，高优先命中 |
| SQLite WAL 模式并发写 | 无（per-tenant 单写者） | 不需要特殊处理 |
| L2 经验路径污染（失败路径被记住） | 后续误判 | 失败路径也记录，confidence 自动下降 |
| 用户改规则后 LLM 缓存旧行为 | 行为不一致 | rule_engine tool 每次动态读 DB，无内存缓存 |

---

## 7. 参考

- v2 rule-engine 完整设计：`old/v2-main/studio-v1/docs/design/rule-engine-v3.md`（486 行，同义词组 + 模板匹配 + 消歧逻辑）
- v2 HANDOFF-2 §二：经验路径召回链路（intent_fingerprint 生成 + 向量召回 + confidence 阈值）
- v5 现有工具注册模式：`v5/backend/pkg/gateway/gateway.go:860` 的 `setupCronTool`
- v5 工具接口：`v5/backend/pkg/tools/shared/base.go:10` 的 `tools.Tool`
- 执行入口：`v5/backend/pkg/agent/agent_message.go:123` 的 `processMessage`
- Workspace 路径：`v5/backend/pkg/config/config.go:1713` 的 `WorkspacePath()`

---

*本文档为设计方案，尚未实现。批准后从 P0 开始编码。*
