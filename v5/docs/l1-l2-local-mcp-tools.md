# L1/L2 本地规则引擎 — MCP 工具方案

> 设计日期：2026-09-02
> 状态：设计中
> 核心原则：L1（规则）和 L2（意图匹配）都是 **executor 本地的 MCP 工具**，LLM 通过 Tool Bridge WSS 远程调用，SQLite 存在手机/盒子本地

---

## 1. 整体架构

### 1.1 三级分层

```
┌──────────────────────────────────────────────────────────────────┐
│ 云端 (picoclaw gateway)                                          │
│                                                                  │
│  L3: LLM agent loop（原有）                                       │
│    · LLM 推理 → tool loop → 返回 SSE                            │
│    · 看到 L1/L2 工具定义 → 自主决定是否调用                       │
│    · 调用规则 → 通过 Tool Bridge WSS → 发到 executor              │
│    · 调用工作流 → 通过 Tool Bridge WSS → executor 跑 RuleGo      │
│                                                                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Tool Bridge WSS（双向）
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 执行端 (executor — 手机/盒子，常驻)                               │
│                                                                  │
│  L1: rule_engine（规则匹配 MCP tool）                             │
│    · SQLite：workspace/rule_engine.db（per-tenant 隔离）           │
│    · 同义词组 + 模板匹配（搬 v2 rule-engine-v3.md 设计）            │
│    · 命中 → 返回 {device_id, capability, args}                   │
│    · < 5ms，0 token                                              │
│                                                                  │
│  L2: workflow_match（意图匹配 MCP tool）                          │
│    · SQLite：workspace/intent_cache.db                           │
│    · 第一阶段：intent_fingerprint 精确匹配（O(1)，零 API）        │
│    · 第二阶段：小模型 embedding 模糊匹配（nomic-embed-text / 本地）│
│    · confidence ≥ 0.84 → 返回 workflow chain_id                 │
│    · < 100ms，0 token（不经过云端 LLM）                          │
│                                                                  │
│  L3: RuleGo 工作流执行（已就位）                                   │
│    · 收到 workflow_match 结果后执行对应 workflow                  │
│    · 10 个 capability 工具（mi/adb/a11y/...）                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流（一次典型对话）

```
用户: "开一下客厅灯"
  │
  ▼ 云端 LLM（picoclaw）
  推理：这是简单设备控制 → 应该调用 rule_engine
  │
  ▼ MCP 调用（WSS → executor）
  rule_engine.match("开一下客厅灯")
  │
  ▼ executor 本地
  SQLite 匹配 → rule #7: {打开}{room=客厅}{设备=灯}
  返回: {matched:true, device_id:"12345", capability:"power", args:{state:"on"}}
  │
  ▼ 云端 LLM 收到结果
  直接构造 mi_device action → 不再"思考怎么开灯"
  │
  ▼ executor 执行
  mi_device.set_prop(device_id=12345, capability=power, state=on)
  │
  ▼ 结果回传
  SSE 流 → 前端显示"已开灯"
  耗时: < 5ms（规则命中）vs 1-3s（走 LLM）
```

---

## 2. L1 规则引擎（executor 本地 MCP tool）

### 2.1 核心设计

- **位置**：`v5/backend/cmd/executor/`，作为新 MCP tool 注册
- **存储**：`{workspace}/rule_engine.db`（SQLite，modernc.org/sqlite，无 CGO）
- **schema**：从 v2 `rule-engine-v3.md` 直接搬（synonym_groups / synonyms / rule_templates / rule_actions / rule_match_log）
- **匹配逻辑**：同义词扩展 + 模板匹配 + 实体解析 + 消歧（v2 设计全部保留）

### 2.2 SQL Schema（从 v2 搬，微调）

```sql
CREATE TABLE synonym_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'verb' CHECK (category IN ('verb','device','room','custom')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE synonyms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES synonym_groups(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    is_canonical INTEGER NOT NULL DEFAULT 0,
    UNIQUE(group_id, word)
);

CREATE TABLE rule_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,       -- '{打开}{客厅}{灯}'
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rule_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES rule_templates(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN ('device','workflow')),
    action_target TEXT NOT NULL DEFAULT '',
    params_template TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rule_match_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input_text TEXT NOT NULL,
    rule_id INTEGER NULL,
    resolved_vars TEXT NOT NULL DEFAULT '{}',
    action_type TEXT NOT NULL DEFAULT '',
    action_target TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.3 MCP Tool 定义

```go
// v5/backend/cmd/executor/tools_rule_engine.go

func registerRuleEngineTool(server *mcp.Server, store *ruleengine.Store) {
    engine := ruleengine.New(store)
    mcp.AddTool(server, &mcp.Tool{
        Name:        "rule_engine",
        Description: `用户语音/文本指令的规则匹配。输入用户消息，返回是否命中预定义规则、匹配到的规则 ID、解析出的设备和动作参数。命中后可直接执行返回的 action，无需 LLM 推理。`,
        InputSchema: json.RawMessage(`{
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "用户输入文本"},
                "session_context": {"type": "object", "description": "可选：当前房间上下文等"}
            },
            "required": ["message"]
        }`),
    }, func(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
        var in struct {
            Message       string         `json:"message"`
            SessionContext map[string]any `json:"session_context,omitempty"`
        }
        _ = json.Unmarshal(req.Params.Arguments, &in)
        result := engine.Match(ctx, in.Message, in.SessionContext)
        return &mcp.CallToolResult{
            Content: []mcp.Content{&mcp.TextContent{Text: formatRuleResult(result)}},
            StructuredContent: result,
        }, nil, nil
    })
}
```

### 2.4 注册入口

在 `v5/backend/cmd/executor/tools.go` 的 `registerTools()` 末尾加一行：

```go
func registerTools() {
    // ... 现有工具注册 ...

    // L1 规则引擎
    ruleStore, err := ruleengine.NewStore(filepath.Join(workspaceDir, "rule_engine.db"))
    if err != nil {
        log.Printf("warning: rule engine init failed: %v", err)
    } else {
        registerRuleEngineTool(server, ruleStore)
    }
}
```

---

## 3. L2 意图匹配（executor 本地 MCP tool）

### 3.1 两级召回策略

**第一级：fingerprint 精确匹配（O(1)，零 API）**

```
intent_fingerprint = SHA256("{device_id}:{capability_id}:{normalized_args_hash}")

用户输入 → 先走 L1 rule_engine（提取 device_id + capability）→ 构造 fingerprint → 查 intent_cache.db
→ 精确命中 → 返回 workflow chain_id
```

这是 v2 `HANDOFF-2` §二 的 intent_fingerprint 机制，v5 搬过来：
- 写入：L3 成功执行后，从 tool_calls 提取 `{device_id}:{capability}:{args}` 构造 fingerprint 写库
- 读取：L2 tool 接收用户消息，先经 L1 解析出 device_id + capability，再构造 fingerprint 查库
- 置信度：`success_count / (success_count + failure_count)`，≥ 0.84 视为高置信

**第二级：小模型 embedding 模糊匹配（本地 O(1)，毫秒级）**

当 fingerprint 未命中时，用本地小 embedding 模型做语义相似度搜索：

```
用户输入 "把客厅灯调亮一点"
  ↓ L1 未完全匹配（动词"调亮"不在规则里）
  ↓ 提取意图关键词：{room=客厅, device_type=灯, action=调亮}
  ↓ 对 intent_cache.db 所有记录的 intent_text 做 embedding
  ↓ 计算余弦相似度，取 top-1
  ↓ similarity ≥ 0.75 → 返回对应 workflow chain_id
```

**embedding 模型选择**：

| 方案 | 模型 | 大小 | 延迟 | 依赖 |
|---|---|---|---|---|
| **首选** | `nomic-embed-text`（Ollama 本地） | 274MB | < 50ms | Ollama 已装则直接用 |
| **备选** | ONNX `sentence-transformers/all-MiniLM-L6` | 85MB | < 30ms | `github.com/mlabonne/onnxruntime-go` |
| **兜底** | 仅 fingerprint，不做 embedding | - | - | 零依赖 |

> v2 时代用 `qwen3-embedding-8b` 是云端 API。v5 执行端本地场景用 nomic-embed-text 更合适（小、快、本地）。

### 3.2 SQL Schema（intent_cache.db）

```sql
CREATE TABLE intent_cache (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    intent_text    TEXT NOT NULL,          -- 用户原始输入文本（用于 embedding 检索）
    fingerprint    TEXT NOT NULL UNIQUE,   -- SHA256("{device_id}:{capability}:{args_hash}")
    device_id      TEXT NOT NULL,
    capability     TEXT NOT NULL,
    args_hash      TEXT NOT NULL,
    workflow_id    TEXT NOT NULL,          -- RuleGo chain_id
    success_count  INTEGER NOT NULL DEFAULT 0,
    failure_count  INTEGER NOT NULL DEFAULT 0,
    embedding      BLOB,                   -- ONNX embedding 向量（256 维 float32）
    last_succeeded_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_intent_device_capability ON intent_cache(device_id, capability);
```

### 3.3 MCP Tool 定义

```go
// v5/backend/cmd/executor/tools_workflow_match.go

func registerWorkflowMatchTool(server *mcp.Server, cache *intentcache.Store, emb *embedder.Engine) {
    mcp.AddTool(server, &mcp.Tool{
        Name:        "workflow_match",
        Description: `意图-工作流匹配。输入用户消息，先做指纹精确匹配，再 fallback 到 embedding 语义匹配。返回匹配的 workflow chain_id 和 confidence。调用方根据 confidence 决定是直接执行还是交给 LLM 处理。`,
        InputSchema: json.RawMessage(`{
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "device_id_hint": {"type": "string", "description": "可选：L1 已解析的设备 ID"},
                "capability_hint": {"type": "string", "description": "可选：L1 已解析的能力名"}
            },
            "required": ["message"]
        }`),
    }, func(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
        // 实现：先 fingerprint 精确匹配，再 embedding 模糊匹配
        // 返回 {chain_id, confidence, method:"fingerprint"|"embedding"}
    })
}
```

---

## 4. 三级完整流程（端到端）

```
用户: "把客厅灯调到 60%"

┌─ 云端 LLM ─────────────────────────────────────────────────────┐
│ 推理："这是设备控制，应该调 rule_engine 或 workflow_match"       │
│ 调用 rule_engine.match("把客厅灯调到 60%")                      │
└───────────────────────┬────────────────────────────────────────┘
                        │ WSS → executor
                        ▼
┌─ Executor L1 ───────────────────────────────────────────────────┐
│ SQLite 匹配：pattern={调到}{=N}% → device=客厅灯 N=60           │
│ 返回: {matched:true, device_id:"abc123", capability:"brightness", args:{value:60}} │
└───────────────────────┬────────────────────────────────────────┘
                        │ WSS → 云端
                        ▼
┌─ 云端 LLM ─────────────────────────────────────────────────────┐
│ 收到匹配结果 → 直接构造 mi_device.brightness(device_id, 60)     │
│ （不再"思考怎么调亮度"）                                         │
└───────────────────────┬────────────────────────────────────────┘
                        │ WSS → executor
                        ▼
┌─ Executor L3 ───────────────────────────────────────────────────┐
│ mi_device.execute(device_id="abc123", capability="brightness",  │
│                   args={"value":60})                            │
│ → 米家协议下发 → 成功                                            │
│ → 写回 L2: intent_cache 插入/更新 fingerprint + success_count   │
└─────────────────────────────────────────────────────────────────┘
                        │
                        ▼
用户："好的，已调到 60%"（SSE 流）
```

**第二次相同输入**：
- L1 命中 → < 5ms → 直接执行
- 若 L1 不命中但 L2 fingerprint 命中 → < 100ms → 直接跑 workflow
- 若 L1/L2 都不命中 → 走 L3（LLM 推理，1-3s）

---

## 5. L3 → L2 自动写回（学习机制）

在 executor 的 L3 执行成功结束时，自动提取 fingerprint 并写回 intent_cache：

```go
// v5/backend/pkg/workflow/workflow.go 或 executor 的 tool 执行后 hook
func recordSuccessFingerprint(deviceID, capability, argsHash, workflowID string) {
    hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s", deviceID, capability, argsHash)))
    fingerprint := hex.EncodeToString(hash[:])

    // INSERT OR UPDATE intent_cache
    // success_count += 1
    // last_succeeded_at = now
    // 若有 embedding 模型，同时计算并存储 embedding
}
```

**写回触发时机**：
- rule_engine 命中后执行成功
- workflow_match 命中后 workflow 执行成功
- L3 正常 tool call 链路结束且结果非 error

---

## 6. 代码布局

```
v5/backend/
  ├── cmd/
  │   └── executor/
  │       ├── tools.go                    ← 现有，加 registerRuleEngineTool/registerWorkflowMatchTool
  │       ├── tools_rule_engine.go        ← 新建：L1 MCP tool
  │       └── tools_workflow_match.go     ← 新建：L2 MCP tool
  │
  ├── pkg/
  │   ├── ruleengine/                     ← 新建：L1 规则引擎核心
  │   │   ├── engine.go                   ← RuleEngine struct + Match()
  │   │   ├── schema.go                   ← SQL schema（CREATE TABLE）
  │   │   ├── types.go                    ← RuleTemplate / RuleAction
  │   │   ├── match.go                    ← 同义词扩展 + 模板匹配（搬 v2 逻辑）
  │   │   └── store.go                    ← SQLite CRUD
  │   │
  │   ├── intentcache/                    ← 新建：L2 缓存核心
  │   │   ├── store.go                    ← IntentCache struct + Match() + Record()
  │   │   ├── schema.go                   ← SQL schema
  │   │   ├── fingerprint.go              ← SHA256 fingerprint 生成
  │   │   └── embedder.go                 ← embedding 封装（nomic-embed-text / ONNX）
  │   │
  │   └── embedder/                       ← 新建：本地 embedding 引擎（可选）
  │       ├── engine.go                   ← Interface: Embed(text) []float32
  │       ├── nomic_ollama.go             ← 通过 Ollama HTTP 调用本地 nomic-embed-text
  │       └── onnx.go                     ← ONNX 运行时（无外部依赖）
  │
  └── pkg/workflow/                       ← 现有：RuleGo 工作流引擎（已就位）
      └── adapters/adapters.go            ← 现有：10 个工具适配器（已就位）
```

---

## 7. 实施步骤

| 阶段 | 内容 | 工作量 | 依赖 |
|---|---|---|---|
| **P0** | `pkg/ruleengine/` 核心（schema + Match），单元测试 | 1 天 | v2 rule-engine-v3.md |
| **P1** | executor 注册 `rule_engine` MCP tool | 半天 | P0 |
| **P2** | `pkg/intentcache/` 核心（fingerprint + SQLite） | 1 天 | — |
| **P3** | executor 注册 `workflow_match` MCP tool（fingerprint 部分） | 半天 | P2 |
| **P4** | L3 成功后自动写回 fingerprint 到 intent_cache | 1 天 | P3 |
| **P5** | embedding 模糊匹配（nomic-embed-text via Ollama） | 2 天 | P4，需 Ollama 运行 |
| **P6** | 端到端测试：用户消息 → L1/L2 → 执行 → 写回 | 1 天 | P5 |

**总计：约 7-8 天**，P0-P4 即可实现基本三级分流，P5-P6 补全 embedding 模糊匹配。

---

## 8. 与 Tool Bridge WSS 的关系

本文档的 L1/L2 工具注册在 **executor**（`cmd/executor/`），通过已有的 Tool Bridge WSS 协议暴露给云端 picoclaw agent：

```
云端 picoclaw agent
  ↓ MCP CallTool（rule_engine / workflow_match）
  ↓ WSS（Tool Bridge，v5/docs/tool-bridge-design.md）
  ↓
executor MCP server
  ↓ 本地 SQLite 匹配
  ↓ 返回结果
```

Tool Bridge 的 `load_workflow` / `dispatch_workflow` 消息类型（文档已设计）与 L2 的 `workflow_match` tool 配合使用：
- L2 返回 `chain_id`（workflow 名称）
- 云端 agent 用 `dispatch_workflow(chain_id, params)` 通知 executor 执行对应 workflow

**Tool Bridge WSS 实现是本文档的前置依赖**，目前设计文档已就绪（`v5/docs/tool-bridge-design.md`），代码尚未实现。

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Ollama 未安装（embedding 不可用） | L2 仅指纹匹配，模糊匹配失效 | P5 为可选依赖，P0-P4 不受影响 |
| 规则冲突（两条规则都匹配） | 错误执行 | 按 `priority` 字段排序，高优先命中 |
| fingerprint 碰撞 | L2 误判 | SHA256 碰撞概率极低，可忽略 |
| SQLite 并发写 | 数据损坏 | per-tenant 单写者，无并发写问题 |
| LLM 不调 L1/L2 tool | 始终走 L3 | L1/L2 短路检查在 executor 侧做（独立于 LLM） |
| 规则库膨胀（> 1000 条） | 匹配变慢 | 同义词组和模板数量在家庭场景极少超过 100，无性能问题 |

---

## 10. 参考

- v2 rule-engine 完整设计：`old/v2-main/studio-v1/docs/design/rule-engine-v3.md`（486 行，同义词组 + 模板匹配 + 消歧）
- v2 HANDOFF-2 §二：经验路径召回（intent_fingerprint + confidence 阈值）
- v5 executor MCP 注册模式：`v5/backend/cmd/executor/tools.go`（`mcp.AddTool` 模式）
- v5 工作流引擎：`v5/backend/pkg/workflow/workflow.go`（RuleGo 已就位）
- Tool Bridge WSS 协议：`v5/docs/tool-bridge-design.md`
- Workspace 路径：`v5/backend/pkg/config/config.go:1713` 的 `WorkspacePath()`
- embedding 模型参考：`nomic-embed-text`（274MB，256 维，本地推理 ~30ms）

---

*本文档为设计方案，尚未实现。批准后从 P0 开始编码。*
