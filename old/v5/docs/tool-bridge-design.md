# Tool Bridge — 执行端 → 云大脑 双向通道

> 状态：设计中（2026-09-02）
> 关联：v5/ARCHITECTURE.md §1.5 工具桥梁

---

## 核心决策

**执行端主动连大脑，不是大脑找执行端。**

```
大脑（gateway, 固定地址）
   ▲
   │ WSS 入站
   │ 接收 executor 注册
   │ 转发工具调用请求
   │ 回传结果
   │
   │
手机/盒子（executor, IP 不固定）
   └── WSS 出站 → 主动连接大脑
```

**收益：**
- 手机不需要固定 IP，回家自然上线，出门自动断连
- 盒子未来用固定 IP，同样走这条通道，行为一致
- 大脑维护 executor 表，不知道也不关心设备怎么连上来

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│  云大脑 (gateway)                                   │
│                                                     │
│  PicoChannel (微信/飞书/...耳朵)                      │
│       │                                             │
│       ▼                                             │
│  Agent Loop  ──→  MCP Client Manager                │
│       │              (现有代码 pkg/mcp/)             │
│       │              支持 stdio/sse/streamable        │
│       │                                             │
│       │              ▲                              │
│       │              │ WSS 入站 handler（新增）       │
│       │              │                               │
│       │         Executor Registry                   │
│       │         (executor_id → WebSocket)           │
│       │                                              │
│       │         工具派发                               │
│       │         (大脑把 AI 规划的工具调用推给执行端)      │
│       │                                              │
└───────┼──────────────────────────────────────────────┘
        │
        │  WSS 出站（executor 主动连接）
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  执行端 (executor)                                  │
│                                                     │
│  pkg/capabilities/a11y_ctl    ← 无障碍自动化         │
│  pkg/capabilities/adb_cmd     ← Android ADB          │
│  pkg/capabilities/moonlight   ← 游戏串流             │
│  pkg/capabilities/bilibili    ← B站视频              │
│  pkg/capabilities/dlna        ← DLNA投屏             │
│  pkg/capabilities/remote_desktop ← VNC 远程桌面      │
│  pkg/capabilities/mi_device   ← 小米 IoT             │
│  pkg/capabilities/netdisk_sync  ← 网盘文件            │
│  pkg/capabilities/media_sniff   ← 资源嗅探            │
│  cmd/executor/tools.go        ← 注册入口             │
│                                                     │
│  wss_outbound.go   (新增)                           │
│    - 启动时主动连大脑 gateway                        │
│    - 发送注册消息：{id, hostname, capabilities}      │
│    - 保持心跳，断线自动重连                          │
│                                                     │
│  wss_inbound.go    (新增)                           │
│    - 接收大脑发来的工具调用                          │
│    - 路由到对应 capability handler                   │
│    - 回传结果                                        │
└─────────────────────────────────────────────────────┘
```

---

## 协议设计

### 注册阶段（executor → 大脑）

```json
// 注册消息
{
  "type": "executor_register",
  "id": "executor_<hostname>_<timestamp>",
  "hostname": "home-box-01",
  "os": "linux",
  "arch": "arm64",
  "go_version": "go1.24.0",
  "capabilities": ["a11y_ctl", "adb_cmd", "moonlight_ctl", ...],
  "tools": [
    {
      "name": "a11y_ctl",
      "description": "无障碍自动化...",
      "input_schema": { ... }
    }
  ]
}
```

### 工具调用（大脑 → executor）

```json
// 请求
{
  "type": "call_tool",
  "id": "<uuid>",
  "tool": "a11y_ctl",
  "args": { "action": "dump", "device": "192.168.1.x:5555" }
}

// 响应
{
  "type": "tool_result",
  "id": "<uuid>",
  "status": "success",
  "data": { ... }
}

// 错误
{
  "type": "tool_result",
  "id": "<uuid>",
  "status": "error",
  "error": "ADB_NOT_FOUND",
  "message": "adb not found in PATH"
}
```

### 心跳

```json
// executor → 大脑（每 30s）
{ "type": "ping" }

// 大脑 → executor（响应）
{ "type": "pong" }
```

---

## 实施步骤

### Phase 1：executor 侧（WSS 出站）

1. **新增 `pkg/executor/wss_client.go`**
   - 配置：`EXECUTOR_GW_URL`（从环境变量读取，如 `ws://localhost:18790/wss/executor`）
   - 启动时连接，注册身份
   - 断线自动重连（指数退避）
   - 心跳保活

2. **修改 `cmd/executor/main.go`**
   - 启动 WSS client goroutine
   - 与现有 SSE MCP server 并行运行

3. **修改 `cmd/executor/tools.go`**
   - 暴露当前所有 tool 列表给 wss_client（用于注册时上报）

### Phase 2：大脑侧（WSS 入站 + 派发）

4. **新增 `pkg/gateway/executor_bridge.go`**
   - 在 gateway HTTP server 上挂载 `/wss/executor` 端点
   - 维护 executor map：`id → *websocket.Conn`
   - 收到 `call_tool` 消息时转发到对应 executor

5. **修改大脑 agent loop**
   - 当 AI 决定调用 executor 工具时，通过 bridge 转发
   - 返回结果给 AI 继续推理

### Phase 3：配置化

6. **`tenant-brain.sh` 启动时注入 `EXECUTOR_GW_URL`**
   - 从 gateway config 读取真实地址
   - 执行端无需配置，环境变量驱动

7. **大脑 config 加 `executors` 字段**（可选）
   - 允许配置白名单/鉴权

---

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `EXECUTOR_GW_URL` | 大脑 gateway WSS 地址 | 必填 |
| `EXECUTOR_ID` | 执行端标识（可选，缺省用 hostname+pid） | 自动生成 |
| `EXECUTOR_HEARTBEAT_SEC` | 心跳间隔 | 30 |

---

## 安全考虑

- WSS（而非 WS）确保加密传输
- executor_id 由大脑分配（而非执行端自报），防止伪造
- 心跳超时自动断开，僵尸连接自动清理
- 工具调用带 session_id，大脑追踪哪个 executor 处理了哪个请求

---

## 未来扩展：盒子 vs 手机

| 维度 | 盒子（固定 IP） | 手机（移动） |
|------|----------------|-------------|
| 连接方式 | 同 WSS 出站，启动即连 | 同 WSS 出站，开机连 |
| 断线处理 | 断网后重试 | 移动网络切换重连 |
| 优先级 | 默认选盒子 | 盒子不可用降级到手机 |
| 工具集 | 完整（含媒体库等） | 精简（a11y/adb/投屏） |

---

## 相关文件

- `v5/backend/cmd/executor/main.go` — executor 入口
- `v5/backend/cmd/executor/tools.go` — 工具注册
- `v5/backend/pkg/mcp/manager.go` — 大脑侧 MCP 客户端（已有 SSE 支持）
- `v5/backend/pkg/channels/pico/pico.go` — pico WSS 服务端参考实现
- `v5/backend/pkg/config/config.go` — MCPServerConfig（已有 SSE 配置字段）
