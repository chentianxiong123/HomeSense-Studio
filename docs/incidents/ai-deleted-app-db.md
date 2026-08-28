# AI Agent 误删数据库事故报告

> 时间：2026-05-26 | 项目：HomeSense Studio

## 事故描述

AI coding agent（Codex CLI / Claude Code）在开发过程中执行了清理/重置操作，将 `homesense.db`（主数据库）清空为 0 字节。`chat.db`（聊天数据库）因存储在独立文件中，未受影响。

## 损坏范围

**`app.db`（homesense.db）— 20 张表全部丢失：**

| 业务域 | 表 | 影响 |
|--------|-----|------|
| 设备管理 | rooms, user_devices, device_capabilities, device_apps | 所有房间和设备配置丢失 |
| LLM 配置 | llm_providers, llm_models, llm_model_slots, llm_usage_log, embedding_profiles | 所有 API key 和模型配置丢失 |
| Agent 运行时 | agent_instances, conversations, conversation_sessions, conversation_messages | 所有对话历史和 agent 配置丢失 |
| 工作流 | workflows, workflow_nodes, workflow_edges, workflow_runs | 所有自动化工作流丢失 |
| 知识系统 | skills, experiences, rules, memory_entities, compiled_knowledge_items | 所有知识和规则丢失 |
| 系统 | settings, compensation_tasks | 系统配置丢失 |

**`chat.db` — 完好。**

## 根因分析

### 直接原因

AI agent 在"清理/重构"阶段执行了可能导致数据库文件被覆盖或删除的操作。agent 和开发者之间的认知差距：

| 开发者认知 | Agent 认知 |
|-----------|-----------|
| "清理无用文件" | 清理所有临时状态，包括数据库 |
| "重新初始化" | 调用 `initDb()` → 建空表 |
| 数据库 = 珍贵数据 | 数据库 = 可重建的中间状态 |

### 深层原因：缺乏边界隔离

20 张表共用一个 `.db` 文件 = **一毁俱毁**。chat.db 因为独立存储而幸免，证明了分库的价值。

## chat.db 为什么幸免

```typescript
// 主库 — 20 张表挤在一起
// packages/backend/src/db/index.ts
const DB_PATH = process.env.DB_PATH || './data/homesense.db'
// 一个 rm homesense.db，全部完蛋

// 聊天库 — 独立文件
// packages/backend/src/modules/chat/repository.ts
const DB_PATH = process.env.CHAT2_DB_PATH || './data/chat.db'
// rm homesense.db 不影响 chat.db
```

这不是"微服务架构"，这是**文件级别的领域隔离**。

## 教训

1. **AI agent 对数据价值无感知** — 它认为数据库是可重建的中间产物
2. **单文件 = 单点故障** — 所有鸡蛋在一个篮子里
3. **chat.db 的分库设计不是优化，是保命** — 它让聊天数据活了下来
4. **SQLite 不需要分布式也能分库** — 按业务域拆成多个 `.db` 文件即可

## SQLite 分库策略

### 核心原则

不是 MySQL 的分库分表（水平拆分 + 网络通信），而是**"领域驱动文件拆分"**：

| 维度 | MySQL 分库 | SQLite 分库 |
|------|----------|------------|
| 目标 | 分布式扩展 | 隔离故障域 |
| 粒度 | 按行/按表跨服务器 | 按业务域跨文件 |
| 通信 | 网络 RPC | 同进程内 ATTACH 或多连接 |
| 事务 | 两阶段提交 | 文件级 WAL 独立 |

### 按数据生命周期拆分

```
data/
├── meta.db        ← 配置、设置（低频变更，高频读取）
├── devices.db     ← 设备、房间（中频变更）
├── workflows.db   ← 工作流定义（中频变更）
├── memory.db      ← 知识图谱、经验（只追加不删改）
├── chat.db        ← 聊天消息（高频追加，高频读取）
├── analytics.db   ← 使用统计、日志（纯追加，可定期归档）
└── cache.db       ← 运行时缓存（随时可丢，推荐 :memory:）
```

### 拆分依据

| 维度 | 标准 | 示例 |
|------|------|------|
| **变动频率** | 不变（配置）+ 高频（消息）+ 只追加（日志）分库 | settings 万年不动，chat 每秒写入 |
| **重要程度** | 可重建 vs 不可重建 | cache 丢了无所谓，devices 丢了你得重配 |
| **生命周期** | 长期留存 vs 短期可删 | chat 消息可能归档，analytics 定期清理 |
| **访问模式** | 读多 vs 写多 vs 分析查询 | meta 只读查询，chat 高并发写入 |
| **AI 接触面** | 暴露给 agent vs 不暴露 | agent 永远不碰 meta.db，只读 chat.db |

### 实现方式

```typescript
// 方式1：每个域独立连接
class DeviceService {
  private db = new Database('./data/devices.db')
}
class ChatService {
  private db = new Database('./data/chat.db')
}

// 方式2：主库 ATTACH 子库（跨库 JOIN 用）
const mainDb = new Database('./data/meta.db')
mainDb.exec('ATTACH DATABASE "./data/chat.db" AS chat')
// SELECT * FROM chat.conversations WHERE ...

// 方式3：:memory: 做运行时缓存
const cacheDb = new Database(':memory:')  // 进程死了就丢，无所谓
```

### AI Agent 安全边界

```typescript
// 让 agent 永远只访问 chat.db
// 通过独立连接实现权限隔离
const agentDb = new Database('./data/chat.db', { readonly: false })
const systemDb = new Database('./data/homesense.db', { readonly: true })
// agent 误操作 chat.db → 最多丢聊天记录
// agent 误操作 systemDb → readonly，写不动
```

### 设计决策总结

| 场景 | 建议 |
|------|------|
| 用户数据（设备、配置） | 独立文件，定期备份 |
| 聊天消息 | 独立文件，可单独备份/归档 |
| 运行时缓存 | `:memory:` 或独立 tmp 文件 |
| 分析/日志 | 独立文件，定期 rotate |
| LLM API 配置 | 独立文件，加只读保护 |

## 附录：事故时间线

```
2026-05-05 17:17 — 0b1873e1: "clean: remove core project residuals"
                   删除 584 个文件（Tauri、Remix 组件）
                   app.db 大概率在这个阶段被清空

2026-05-18~26 — 重建阶段
                  从 Vue 前端 + API 后端重新开发
                  新增 wiki、graph 等功能模块

2026-05-26 13:09 — 57dd32e3: "fix: restore deleted core service files"
                   恢复被误删的核心服务文件
                   数据已不可恢复
```