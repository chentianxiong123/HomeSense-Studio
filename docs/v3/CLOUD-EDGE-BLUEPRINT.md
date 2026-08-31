# HomeSense v3 — 云控边实施蓝图

> 状态: 待评审
> 类型: 实施蓝图（与 `ARCHITECTURE.md` 互补 — 高层架构已定，本文聚焦落地）
> 基线: HomeSense Studio v3 (Next.js 16 + pi 引擎 + 单会话 SQLite 时间线)
> 形态: **云大脑 + 边执行器** — 数据全在云，agent 全在云，工具实现在边

---

## 一、目标与基线

### 1.1 现状（v3 今日形态）

- `apps/web` 单包 Next.js 全栈：UI + 后端 + 引擎 + SQLite 全部内嵌
- 单租户、单进程、单库：时间线 SQLite 单文件 `data/homesense-timeline.db`（`apps/web/lib/timeline-db.ts:13`）
- 认证：单密码 Basic Auth（`apps/web/lib/web-auth.ts`），`/api/auth/*` 当前 `available:false`（`33bbd00` 修复后状态）
- agent 会话：in-process 跑在 Node 进程里（`apps/web/lib/rpc-manager.ts:1991` `createAgentSessionFromServices`）
- 工具扩展：本地 in-process 执行（`apps/web/lib/memory-extension.ts` 是范例）
- 记忆：`~/.homesense/agent/memories/MEMORY.md` + `USER.md`（`memory-store.ts`）
- 模型/凭据/会话/主题全部存在 `getAgentDir()` 派生的全局目录

### 1.2 目标

将 v3 改造成 **云控边** SaaS 形态：

- **云端（apps/cloud，未来从 apps/web 拆出）**：用户、租户、agent 推理、记忆、时间线、工具**定义与编排** 全部在云
- **边缘（apps/hub / apps/mobile-executor）**：v2 的 Python/Go 子进程（mi-cli、adb-cli、media-cli、alist-driver、hami-cli）原样装进边缘执行器，负责工具**实现与执行**
- **通道**：出站 WebSocket（无需公网 IP），协议消息 JSON-RPC 风格

### 1.3 不变

- 单会话时间线心智（永远一条时间线，永远聊下去）
- 工具扩展机制（`defineTool` 模式）
- 多 Agent 架构（顶层编排 + 角色 Agent）
- 单一 Device API

### 1.4 与 ARCHITECTURE.md 的关系

`ARCHITECTURE.md` 已定的多租户策略（§10.2 一租户一 SQLite 文件）、商业模型（§9）、云边职责（§3）、关键决策（§13）继续作为顶层基线。本蓝图补齐**实施层**：

- 工具调用如何跨云边
- 边缘执行器契约
- v3 代码每个文件的改造点
- 落地阶段路线

---

## 二、三层契约

### 2.1 云端（apps/cloud）

| 模块 | 职责 | 关键文件（v3 现状路径） |
|------|------|------|
| 用户/认证 | 注册、登录、JWT、租户路由 | `lib/web-auth.ts`、`app/api/auth/*` |
| 租户隔离 | per-tenant 路径解析、ctx 注入 | `lib/session-reader.ts`、`lib/timeline-db.ts` |
| 时间线 | 单会话 SQLite（per-tenant 物理文件） | `lib/timeline-db.ts`、`lib/timeline-mirror.ts` |
| 记忆 | MEMORY.md / USER.md（per-tenant 路径） | `lib/memory-store.ts` |
| Agent 调度 | in-process 共享进程，per-tenant session 池 | `lib/rpc-manager.ts` |
| 工具**定义** | 白名单工具 schema（`defineTool`），implement 为 stub | `lib/memory-extension.ts`（范例） |
| 工具**编排** | 工具调用按 tenantId 路由到在线执行器 | 新增 `lib/tool-stub/dispatcher.ts` |
| 边缘连接管理 | Map<tenantId, edgeConnections> + 心跳 + 离线降级 | 新增 `lib/edge/connection-manager.ts` |
| 凭据/配置 | per-tenant auth.json / models.json / settings.json | `lib/provider-credential-store.ts`、`lib/models-config-store.ts` |

### 2.2 边缘执行器（apps/hub + apps/mobile-executor）

#### 2.2.1 形态分两种

| 形态 | 角色 | 跑什么 | 限制 |
|------|------|--------|------|
| **盒子（apps/hub）** | 执行器**主场** | v2 Python/Go CLI 全家桶（mi-cli、adb-cli、media-cli、alist-driver、hami-cli） | 需要家庭有常开宿主机 |
| **手机（apps/mobile-executor）** | 副手/遥控器 | 轻量执行器（不依赖 Python CLI），走局域网 HTTP 转发给盒子或自带少量直连协议 | 无法独立跑 v2 CLI |

#### 2.2.2 执行器职责

- 启动时向云端注册（出站 WebSocket）
- 声明自身支持的工具集（capabilities）
- 接收云端下发的 `tool_call`，本地执行，回传 `tool_result` / `tool_error`
- 维护心跳，超时离线
- 直连局域网设备（192.168.x.x，零 NAT 问题）

#### 2.2.3 不做的事

- 不存用户数据（数据全在云）
- 不跑 agent 推理（agent 全在云）
- 不修改工具 schema（工具定义在云）
- 不发起对云端的非响应连接（仅响应 + 心跳 + 注册）

### 2.3 通道（云↔边）

- **出站 WebSocket**（盒子/手机主动连云）— 解决 NAT 与公网 IP 问题
- **TLS** 强制（`wss://`）
- **协议**：JSON-RPC 风格，二进制帧内嵌 JSON
- **消息类型**：
  - 边→云：`register` / `heartbeat` / `tool_result` / `tool_error`
  - 云→边：`tool_call` / `unregister`

---

## 三、工具调用协议（核心改造点）

### 3.1 改造前（v3 现状，本地执行）

```ts
// apps/web/lib/memory-extension.ts
export function createHomeSenseMemoryExtension() {
  return defineTool({
    name: "memory",
    description: "...",
    parameters: Type.Object({...}),
    async execute(args) {
      // 进程内直接调 memory-store.ts
      memoryStore.add(args.section, args.content);
      return { result: "ok" };
    }
  });
}
```

### 3.2 改造后（云控边，stub 化）

```ts
// apps/cloud/lib/tool-stubs/home-control.ts
export function createHomeControlTool() {
  return defineTool({
    name: "home_control",
    description: "控制智能家居设备（米家、小爱、红外、HA 等）",
    parameters: Type.Object({
      device: Type.String(),
      action: Type.String(),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    async execute(input, ctx) {
      // ctx.tenantId 由 AsyncLocalStorage 注入
      return await dispatchToEdge({
        tenantId: ctx.tenantId,
        tool: "home_control",
        args: input,
        timeoutMs: 10_000,
      });
    }
  });
}
```

### 3.3 协议消息格式

#### 边→云

```jsonc
// register
{ "type": "register", "token": "user_jwt", "capabilities": ["home_control", "media_cast"], "edge_id": "hub_xxx" }

// heartbeat（每 30s）
{ "type": "heartbeat", "edge_id": "hub_xxx", "ts": 1735689600 }

// tool_result
{ "type": "tool_result", "call_id": "uuid", "result": { ... } }

// tool_error
{ "type": "tool_error", "call_id": "uuid", "code": "device_offline", "message": "..." }
```

#### 云→边

```jsonc
// tool_call
{ "type": "tool_call", "call_id": "uuid", "tool": "home_control", "args": { "device": "客厅灯", "action": "turn_on" } }

// unregister（强制下线）
{ "type": "unregister", "reason": "token_expired" }
```

### 3.4 调用时序

```
agent (云)         云 stub         云 ws-mgr         边 ws-client        边 CLI
   │                  │                 │                  │                 │
   │ execute(home_control)              │                  │                 │
   ├─────────────────►│ dispatchToEdge  │                  │                 │
   │                  ├────────────────►│ push tool_call   │                 │
   │                  │                 ├─────────────────►│ call mi-cli     │
   │                  │                 │                  ├────────────────►│
   │                  │                 │                  │◄────────────────┤
   │                  │                 │◄─────────────────┤ tool_result     │
   │◄─────────────────┤◄────────────────┤                  │                 │
   │  return result   │                 │                  │                 │
```

### 3.5 关键约束

- 所有消息带 `tenantId`（云内部）或 `edge_id`（边端标识）
- 超时：默认 10s，可按工具覆盖（home_control 短、media_cast 长）
- 重试：默认 0（智能家居执行不重试，避免重复开灯）
- 离线降级：租户无在线执行器 → 立即返回 `{ error: "edge_offline" }`，agent 据此回话

---

## 四、边缘执行器契约

### 4.1 启动与注册

```bash
# 盒子端
hub connect \
  --cloud wss://api.homesense.dev/edge \
  --token "$HOMESENSE_USER_TOKEN" \
  --capabilities home_control,media_cast,adb_remote,fs_copy
```

盒子启动流程：
1. 读 token（用户在云端生成，写到盒子 `/etc/homesense/token`）
2. 出站 TLS 连接 `wss://...`
3. 发送 `register` 消息
4. 云端校验 token、登记到 `Map<tenantId, Set<edgeConnection>>`
5. 启动心跳（30s 间隔）

### 4.2 心跳与离线

- 边每 30s 发 `heartbeat`
- 云端 90s 无心跳则标记离线
- 离线后：agent 调用工具 → 立即返回 `edge_offline` 错误
- 重连后：自动重新注册，原有 `tool_call` 队列丢弃（不重试）

### 4.3 工具调用下发

- 云端收到 agent 工具调用
- 查找该租户的在线执行器（按 capability 匹配）
- 多个执行器支持同一工具：按 round-robin 或就近选择（V1 简化为单租户单执行器）
- 通过 WS 推送 `tool_call`，带 `call_id`
- 等待 `tool_result` / `tool_error`，超时返回 `timeout`

### 4.4 错误码

| code | 含义 | agent 处理建议 |
|------|------|----------------|
| `device_offline` | 设备不在局域网 | 告诉用户设备不可用 |
| `edge_offline` | 执行器未注册 | 告诉用户开启盒子 |
| `timeout` | 边端执行超时 | 重试 0 次，告诉用户稍后再试 |
| `unauthorized` | 边端权限不足 | 告诉用户检查授权 |
| `unsupported_capability` | 执行器不支持 | 不应该发生（云端路由前过滤） |

### 4.5 能力声明

执行器启动时声明能力，云端在路由前过滤：

```jsonc
{
  "capabilities": [
    "home_control",   // mi-cli 包装
    "media_cast",     // media-cli 包装
    "adb_remote",     // adb-cli 包装
    "fs_copy"         // alist-driver 包装
  ]
}
```

未来扩展：执行器可声明子能力（如 `home_control.mi` vs `home_control.ha`），云端按更细粒度路由。

---

## 五、多租户隔离改造点（具体文件）

每条都标了 v3 现状文件路径与行号，按"先做基线、再做工具"顺序排列。

### 5.1 认证（Phase 1 第一步）

| 现状 | 文件 | 改造 |
|------|------|------|
| 单密码 Basic Auth | `apps/web/lib/web-auth.ts:13-17` | 改为读用户表 + 密码哈希（argon2）+ JWT 签发 |
| 端点 stub | `apps/web/app/api/auth/*` | 实现真 login / status / logout / register |
| 无中间件 | （无） | 新增 `apps/web/middleware.ts`：解析 JWT → 注入 tenantId 到 AsyncLocalStorage |
| 已修复返回 false | `apps/web/picoclaw/routes/__root.tsx`（auth 客户端） | 真做后会自动联调 |

### 5.2 AsyncLocalStorage ctx（Phase 1 第二步）

新增 `apps/web/lib/tenant-context.ts`：

```ts
import { AsyncLocalStorage } from "node:async_hooks";
export interface TenantContext {
  tenantId: string;
  userId: string;
  requestId: string;
}
export const tenantStorage = new AsyncLocalStorage<TenantContext>();
export function getTenant(): TenantContext { ... }
```

所有 `getAgentDir()` / `getTimelineDb()` / `providerCredentialStore.read()` 的调用点改为：

```ts
// before
const agentDir = getAgentDir();

// after
const { tenantId } = getTenant();
const agentDir = getTenantAgentDir(tenantId);
```

### 5.3 数据库 per-tenant 路径

| 现状 | 文件 | 改造 |
|------|------|------|
| 单库全局 | `apps/web/lib/timeline-db.ts:13` `DB_PATH` | 改为 `data/tenants/<tenantId>/timeline.db`（与 ARCHITECTURE §10.2 一致） |
| 单例 db | `apps/web/lib/timeline-db.ts:39` `let db: DatabaseSync \| null = null` | 改为 `Map<tenantId, DatabaseSync>`，LRU 淘汰保持内存可控 |
| mirror 写库 | `apps/web/lib/timeline-mirror.ts` | 通过 ctx 拿 tenantId，传给 db 工厂 |
| 回填 | `apps/web/lib/timeline-backfill.ts` | 同样改 per-tenant |

### 5.4 Agent 目录 per-tenant

v3 现状所有路径都基于 `getAgentDir()`（来自 pi 包，读 env `HOMESENSE_CODING_AGENT_DIR`）：

```ts
// pi 包
export function getAgentDir() {
  const envDir = process.env[ENV_AGENT_DIR];  // HOMESENSE_CODING_AGENT_DIR
  if (envDir) return expandTildePath(envDir);
  return join(homedir(), ".homesense", "agent");
}
```

**多租户改造方案**（选 B，最直接）：

- **方案 A（不推荐）**：每租户启进程时 set env — 多租户共享进程 env 冲突
- **方案 B（推荐）**：包装 `getAgentDir(tenantId)`，所有调用点改传参
- **方案 C**：上 pi 包 PR 加 ctx 参数 — 长期理想方案

具体包装（新增 `apps/web/lib/agent-dir.ts`）：

```ts
export function getTenantAgentDir(tenantId: string): string {
  const ctx = getTenant();
  const root = process.env.HOMESENSE_AGENTS_ROOT || path.resolve(process.cwd(), "data/agents");
  return path.join(root, ctx.tenantId, "agent");
}
```

需要改的调用点（v3 代码）：

| 文件 | 行 | 调用 |
|------|---|------|
| `lib/session-reader.ts` | 232 | `join(getAgentDir(), "sessions")` |
| `lib/rpc-manager.ts` | 1901 | `getAgentDir()` |
| `lib/subagent-runtime.ts` | 160 | `getAgentDir()` |
| `lib/skills-service.ts` | 7 | `getAgentDir()` |
| `lib/subagent-settings.ts` | 15 | `getAgentDir()` |
| `lib/project-command-env.ts` | 4 | `getAgentDir()` |
| `lib/powershell-settings.ts` | 43 | `getAgentDir()` |
| `lib/project-trust.ts` | 4 | `getAgentDir()` |
| `lib/skill-lock.ts` | 26 | `getAgentDir()` |
| `lib/models-config-store.ts` | 61 | `getAgentDir()` |
| `lib/provider-credential-store.ts` | 79 | `getAgentDir()` |
| `lib/memory-store.ts` | （用 `getAgentDir()`） | 同上 |
| `lib/timeline-backfill.ts` | 8 | `getAgentDir()` |

总改点数：~13 个文件，纯机械改造。

### 5.5 内存状态 globalThis → per-tenant Map

| 现状 | 文件 | 改造 |
|------|------|------|
| `globalThis.__piSessions` | `lib/rpc-manager.ts:1576` | `Map<tenantId, Map<sessionId, session>>` |
| session 列表缓存 | `lib/session-reader.ts:180-225` | 同上加 tenantId 维度 |
| path/id cache | `lib/session-reader.ts:220-225` | 同上 |
| start locks | `lib/rpc-manager.ts:1634` | 同上 |
| starting cwd | `lib/rpc-manager.ts:1648` | 同上 |

### 5.6 凭据与配置 per-tenant 路径

| 文件 | 现状 | 改造 |
|------|------|------|
| `lib/provider-credential-store.ts:79` | `auth.json` 在 `getAgentDir()` | 跟着 5.4 走，自动 per-tenant |
| `lib/models-config-store.ts:61` | `models.json` 在 `getAgentDir()` | 同上 |
| `lib/powershell-settings.ts:44` | `settings.json` 在 `getAgentDir()` | 同上 |
| `lib/subagent-settings.ts:15` | `agents/settings.json` 在 `getAgentDir()` | 同上 |

### 5.7 工具实现 stub 化（核心新增）

新增 `apps/web/lib/tool-stub/dispatcher.ts`：

```ts
export interface DispatchRequest {
  tenantId: string;
  tool: string;
  args: unknown;
  timeoutMs?: number;
}

export async function dispatchToEdge(req: DispatchRequest): Promise<unknown> {
  const conn = edgeConnectionManager.getOnlineConnection(req.tenantId, req.tool);
  if (!conn) {
    throw new ToolError("edge_offline", "执行器未在线");
  }
  const callId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new ToolError("timeout", "执行超时"));
    }, req.timeoutMs ?? 10_000);
    pendingCalls.set(callId, { resolve, reject, timer });
    conn.send({ type: "tool_call", call_id: callId, tool: req.tool, args: req.args });
  });
}
```

新增 `apps/web/lib/edge/connection-manager.ts`：维护 `Map<tenantId, Set<EdgeConnection>>`，含心跳检测。

迁移 `apps/web/lib/memory-extension.ts` 为 `apps/web/lib/tool-stubs/memory.ts`，把直接调 `memoryStore` 改成调用 `dispatchToEdge({ tool: "memory", ... })` — **但 memory 是云端本地操作**（不需要去边端），所以保留原样或迁移到 `apps/web/lib/tool-stubs/local-only/` 表示云端工具（无 stub 派发）。

---

## 六、v2 子系统 → 工具 / 执行器 映射

按之前讨论的三档：

### A 档：直接变 agent 工具（云端定义 + 边端执行）

| v2 资产 | 工具名 | 执行器侧 | 依赖 |
|---------|--------|----------|------|
| mi-cli（米家/小爱/红外/场景） | `home_control` | 盒子 Python CLI | 局域网设备 + miio 协议 |
| media-cli（Bilibili/DLNA/资源搜索） | `media_cast` | 盒子 Python CLI | 局域网 DLNA + 公网 Bilibili API |
| adb-cli（ADB 操作/截屏/UI 树） | `adb_remote` | 盒子 Python CLI | 局域网 adb 端点 |
| hami-cli（Home Assistant） | `ha_action` | 盒子 Python CLI | HA WebSocket |
| alist-driver（Go 文件） | `fs_copy` / `fs_list` / `fs_get` | 盒子 Go 二进制 | 本地文件系统 + 远端 webdav/sftp |

> **手机端执行器**：手机无法跑 Python/Go，所以手机 app 作为**副手**（局域网转发给盒子、自带少数直连协议如家庭网关 HTTP），不作为独立执行器跑 A 档工具。

### B 档：设备能力底座（云端数据 + 工具参数注入）

- 设备孪生（JSON props）→ 云端 SQLite `devices` 表
- 能力注册表 → 云端 SQLite `capabilities` 表
- 房间/分组 → 云端 SQLite
- agent 通过 timeline_search / 系统 prompt 注入读这些表
- A 档工具调用时，参数从这些表里来（设备 ID → 解析为 IP/属性）

### C 档：重型子系统（不在聊天里，单独 Web 页面，二期）

| v2 系统 | 形态 | 落地 |
|---------|------|------|
| 存储网关（双栏文件浏览器） | `/storage` 页面 | 复用 v2 UI 逻辑 + 云端 per-tenant storage_mounts 表 |
| 终端（xterm） | `/terminal` 页面 | 复用 v2 terminal.gateway + 云端代理 |
| Moonlight 串流 | `/streaming` 页面 | v2 moonlight-web-viewer + P2P 引导（云只做信令） |
| scrcpy H264 | `/devices/:id` 详情页内嵌 | 走边端 WebSocket 直出（不经过云） |
| AList 完整后台 | `/storage/admin` | 复用 v2 alist-sidecar |
| SSDP/DLNA 虚拟化 | `/devices/discover` | 边端后台，扫码 + 状态同步云 |

---

## 七、落地阶段路线

### Phase 1：多租户基线（约 4 周）

1. **认证**：`web-auth.ts` → 用户表 + 密码哈希 + JWT（替换单密码）
2. **ctx 注入**：`AsyncLocalStorage<TenantContext>` + 中间件
3. **per-tenant 路径**：`getAgentDir()` → `getTenantAgentDir(tenantId)`（13 个文件机械改造）
4. **SQLite per-tenant**：`timeline-db.ts` 改 Map 缓存 + 路径
5. **globalThis 单例 → per-tenant Map**（`rpc-manager` + `session-reader`）
6. **provider/models/settings 自动 per-tenant**（跟着 5.4 走）
7. **跑通**：本地启 2 个租户，时间线/记忆/会话/凭据互相隔离

### Phase 2：云控边通道（约 3 周）

1. **WebSocket 服务端**：`apps/web/lib/edge/ws-server.ts`，挂在现有 Next.js server 上
2. **边缘客户端 SDK**（独立包 `packages/edge-client`）：封装出站连接 + 注册 + 心跳 + tool_call 接收
3. **协议消息**：按 §3.3 定义 + TypeBox schema 校验
4. **连接管理**：`connection-manager.ts`（Map<tenantId, Set<EdgeConnection>> + 心跳维护）
5. **dispatcher 框架**：`tool-stub/dispatcher.ts`
6. **本地 mock 执行器**：写一个 node 脚本订阅 ws，echo 调用结果，验证链路
7. **跑通**：把 `home_control` 工具从本地直接执行改成"通过 WS 推给 mock 执行器"

### Phase 3：v2 工具接入（约 4 周）

1. **mi-cli 包装**：`apps/hub/executors/home_control.py`，对外暴露 JSON CLI
2. **`home_control` 工具 stub**：云端 `apps/web/lib/tool-stubs/home-control.ts`
3. **media-cli / adb-cli / alist-driver 同样接入**
4. **端到端测试**：聊天说"打开客厅灯" → 云 agent 调 `home_control` → stub → ws → 盒子 → mi-cli → 灯亮 → 结果回传 → 时间线记录
5. **离线降级**：拔盒子网络，agent 收到 `edge_offline` 错误，回话告知用户

### Phase 4：UI 改造（约 4 周）

1. **多租户登录注册**：改造 picoclaw 路由
2. **边端管理页**：`/edge`，展示盒子上线状态、注册能力、token 轮换
3. **设备管理页**：`/devices`（v2 孪生 JSON 编辑器简化版）
4. **C 档页面**（按需）：`/storage` `/terminal` `/streaming`

### Phase 5：商业化与规模（视情况）

1. 订阅档位、计费
2. 私有化部署支持
3. 多 region、CDN
4. 监控与告警

---

## 八、关键文件路径总表（落地对照）

| 改造点 | v3 现状文件 | 目标形态 |
|--------|-------------|----------|
| DB 路径 | `apps/web/lib/timeline-db.ts:13` | per-tenant `data/tenants/<id>/timeline.db` |
| DB 单例 | `apps/web/lib/timeline-db.ts:39` | `Map<tenantId, DatabaseSync>` + LRU |
| Sessions 目录 | `apps/web/lib/session-reader.ts:232` | `getTenantAgentDir(tenantId)/sessions` |
| Agent 进程池 | `apps/web/lib/rpc-manager.ts:1576` | `Map<tenantId, Map<sessionId, session>>` |
| 认证 | `apps/web/lib/web-auth.ts` | 用户表 + JWT |
| 中间件 | （无） | `apps/web/middleware.ts`（新增） |
| 凭据 | `apps/web/lib/provider-credential-store.ts:79` | per-tenant auth.json |
| 模型配置 | `apps/web/lib/models-config-store.ts:61` | per-tenant models.json |
| 设置 | `apps/web/lib/powershell-settings.ts:44` | per-tenant settings.json |
| 记忆 | `apps/web/lib/memory-store.ts` | per-tenant MEMORY/USER |
| 工具定义范例 | `apps/web/lib/memory-extension.ts` | 保留为云端本地工具范例 |
| 工具 stub 框架 | （无） | 新增 `apps/web/lib/tool-stub/dispatcher.ts` |
| 边缘连接管理 | （无） | 新增 `apps/web/lib/edge/connection-manager.ts` |
| 边缘 WS 服务 | （无） | 新增 `apps/web/lib/edge/ws-server.ts` |
| 工具 stub 集合 | （无） | 新增 `apps/web/lib/tool-stubs/{home-control,media-cast,adb-remote,fs-*}.ts` |
| 边缘执行器宿主 | （无） | 新增 `apps/hub/`（从 v2 复用） |
| 边缘客户端 SDK | （无） | 新增 `packages/edge-client/`（供盒子/手机复用） |

---

## 九、风险与约束

| 风险 | 说明 | 缓解 |
|------|------|------|
| in-process agent 多租户内存 | 共享进程跑所有租户活跃会话 | 靠 10 分钟 idle 回收（`rpc-manager.ts:441`）+ per-tenant Map；瓶颈是活跃会话数（不是注册用户数），智能家居低频场景足够 |
| 工具调用延迟 | 云→边 WS + 边端 CLI 执行 | 比云直调 LLM 慢 100-500ms；智能家居可接受 |
| 执行器离线 | 用户断网/关机时无法控设备 | 边缘盒子本地跑最小规则集（v2 已有） |
| v2 CLI 的 Python 依赖 | 盒子必须装 Python + uv | 盒子作为执行器主场；手机作副手（局域网转发） |
| n8n / HA 许可证 | n8n 商业禁止打包（ARCHITECTURE §11 已红线） | 盒子装 HA 走 Apache-2.0 OK；n8n 仅自用 |
| 协议升级 | 云边协议后续会演进 | TypeBox schema 写消息 + 版本号字段，向后兼容 |
| 设备数据归属 | A 档工具调用时，参数从 B 档云端表解析 | B 档表是云端唯一真相，A 档只执行 |
| PII 与隐私 | 智能家居涉及家庭生活数据 | 时间线 + 记忆 per-tenant 物理隔离；摄像头流只走边端（不经过云） |

---

## 十、相关文档

- `docs/v3/ARCHITECTURE.md`：高层架构与商业模式（已定案）
- `docs/v3/CLOUD-EDGE-BLUEPRINT.md`：本文，云控边实施蓝图

---

## 十一、待评审问题

落地前需要确认：

1. **租户数据库文件粒度**：ARCHITECTURE §10.2 是每租户一个 SQLite 文件（物理隔离）。本文按此实施。是否需要支持超大租户合并为 PG？建议留 Phase 5 之后考虑。
2. **盒子是否开源 / 商业策略**：盒子是交付物还是开源？影响执行器代码组织。
3. **多 region 部署**：是否要 Phase 1 就设计 region 隔离？建议 V1 单 region。
4. **手机执行器形态**：手机是否真要做独立执行器（自带直连协议），还是只做遥控器？影响 Phase 3 工作量。
5. **时间线云端 vs 端**：当前是云端单库（per-tenant）。是否需要"本地客户端有副本"？建议 V1 不做。
