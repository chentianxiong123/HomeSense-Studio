# V4 关键提交定位（v5 上下文锚点）

冻结于 tag `v4`（HEAD = 3474688, main）。以下三次节点是 v5 要理解、继承或绕开的 V4 关键决策点。

## 节点 1：`5cbf535` — 改单会话（single-conversation SQLite timeline）

- 日期：2026-08-30
- 定位：整屋单会话。把多会话聊天 UI 换成一条无尽 timeline（whole-home single conversation）。
- 关键动作：
  - `lib/timeline-db.ts`：node:sqlite 持久化消息库 + meta + LIKE 子串搜索（FTS5 对 CJK 子串不可靠）
  - `lib/timeline-mirror.ts`：镜像引擎 message_end 事件进 SQLite，防刷新丢历史
  - `lib/timeline-backfill.ts`：一次性幂等导入旧 `~/.homesense/agent/sessions/<cwd>/*.jsonl`
  - `/api/timeline`：before/limit 分页 + q 搜索 + auto title + 自动续接活跃引擎 session
  - chat-page：去掉 session 切换器 + new-chat header；pi-bridge 从 timeline 初始化自动续接

## 节点 2：`bfbeeef` + `0fa87a3` — 改 SQLite 单库（per-tenant SQLite isolation）

- `bfbeeef` 2026-08-31：多租户账号 + per-tenant SQLite 隔离（Phase 1.1 baseline）。
  - `lib/tenant-store.ts`：一租户一 `data/<tenant-id>.db`；`tenants.db` 索引保存租户与全局唯一账号
  - `lib/auth-token.ts`：零依赖 HS256 JWT；`lib/auth-resolve.ts` 校验签名并复查 (user,userId,tenantId)
  - 默认租户 `default` 自动从 homesense-timeline.db 自举（保留 67 条历史消息）
- `0fa87a3` 2026-08-31：per-tenant SQLite 隔离端到端贯通。
  - timeline-db 全部函数必须携带 tenantId；rpc-manager 的 AgentSessionWrapper 持 tenantId
  - `/api/*` 全部要求认证；agent 路由从请求 ctx 取 tenantId 传给 startRpcSession
- 后续链：`fa3114b`(per-tenant MEMORY/USER.md) → `c4ee040`(per-tenant agentDir) → `7a11e75`(activeSessionId 绑定租户)

## 节点 3：`d5b3796` — 对话框优化（composer 输入隔离，修长历史打字卡顿）

- 日期：2026-08-30
- 根因（对齐 picoclaw issue #3350）：输入框状态放在 ChatPage，每次按键触全页重渲染 → 全部 messages.map + 子组件重渲染。低端嵌入式设备上几百条消息时打字无响应。
- 修法：输入串和 has-input/can-send 推导移进 ChatComposer（React.memo 包裹），打字只重渲染 composer。
- 后续链：`fa8999c`(snap to bottom) → `a3c5eae`(composer pinned) → `7524377`(思考/正文分离渲染)