# HomeSense v5 扩容策略：per-tenant SQLite + 粘性 worker 池

> 落定日期：2026-09-02
> 替代：v3 阶段"上 Postgres"的默认 SaaS 思路
> 核心决策：**HomeSense 永远不迁 Postgres**

---

## 0. 一句话

**一个家庭一个 SQLite 文件，多 worker 按 tenantId 哈希粘性路由。**
扩容不是换数据库，是加 worker 副本。5000 家庭也用 SQLite。

---

## 1. 为什么不上 Postgres

通用 SaaS 模板的默认答案是"上 Postgres"——但那是**多租户共享一套库**场景下的答案。HomeSense 是**一个家庭一个大脑**：

| 维度 | per-tenant SQLite | Postgres |
|---|---|---|
| 删租户 | `rm file.db`，物理隔离无法泄漏 | `DROP SCHEMA`，有锁/缓存/残留 |
| 跨租户查询 | ❌ 天然无 | ✅ 容易聚合 |
| 单租户延迟 | 0 网络，本地文件 | 跨网连接池 |
| 写并发 | 单写者，但**租户之间不冲突** | 全局 MVCC |
| 运维 | 0（文件即一切） | pg_dump/wals/replica |
| GDPR/隐私 | **强**：物理隔离 | 弱：同盘同 schema |
| 单库成本 | $0 | 连接/IO/存储 |
| 备份粒度 | 1 文件 = 1 租户 | 整库或逻辑备份 |
| 冷热分层 | 租户文件可独立下沉到 S3 | schema 颗粒度粗 |

**HomeSense 唯一会问的"跨租户查询"是什么？**
答：没有。**一家人的数据不需要跟另一家 join**。运营要数据 = 走 timeline mirror 文件聚合，不走业务库。

**Postgres 赢的场景**（BI / 跨家庭聚合 / 全文检索 / 复杂事务）**在 HomeSense 永远不存在**。

---

## 2. 真正的瓶颈识别

### 2.1 不是 SQLite 写慢

- SQLite WAL 模式下**单库写并发**确实有限（150–500 QPS）
- 但 **per-tenant = 每家庭一库 = 库间完全不冲突**
- 1000 家庭 = 1000 个独立写者，**互不串行**
- "SQLite 写慢"在多租户场景是**伪命题**

### 2.2 真正的瓶颈是 worker 句柄

```
1 worker
  ├─ 200 个 tenant file handle（open SQLite）
  ├─ 200 个 pi agent session（内存状态 ~50MB/租户）
  └─ fd 上限：ulimit 通常 1024（开 200 库后只剩 800 给连接/网络/日志）
```

**单 worker 上限 = fd/100**。Linux 默认 1024 → 1 worker ≈ 8 家庭 = 太少。
**调高 ulimit 到 65535 → 1 worker ≈ 200 家庭 = 够用**。

### 2.3 真正的瓶颈是 pi agent 状态

- v0.84.3 是 Node 模块，**状态常驻进程内存**
- 重启 worker = 重启这些 session
- 解决：状态外置到 per-tenant timeline 文件 + 启动时回放
- **这就是 v3 已落地的"session 状态已外置"**

---

## 3. 扩容模型

### 3.1 架构图

```
                        ┌─ Cloudflare/ALB（TLS 终止）
                        │
                        ▼
              ┌─ Sticky LB（hash(tenantId) % N）
              │       │
              │       ├─→ worker-1  (持有 ten_a, ten_c, ten_e...)
              │       ├─→ worker-2  (持有 ten_b, ten_d, ten_f...)
              │       └─→ worker-N
              │              │
              │              ├─ per-tenant SQLite 文件（本地 + LiteFS 同步到 S3）
              │              ├─ pi agent session（内存，按 tenantId 索引）
              │              └─ WSS Tool Bridge → 执行端
              │
              └─ 读副本层（可选，LiteFS 提供只读快照）
                     ├─ 报表 / 导出 / 检索
                     └─ 不写、读多
```

### 3.2 粘性路由实现

```go
// 边缘 LB：hash(tenantId) % N
func PickWorker(tenantId string, workers int) int {
    h := fnv.New32a()
    h.Write([]byte(tenantId))
    return int(h.Sum32()) % workers
}

// worker 内部：按 tenantId 取本地句柄（LRU + 持久化）
type TenantStore struct {
    mu    sync.RWMutex
    dbs   map[string]*sql.DB       // tenantId -> open SQLite
    agents map[string]*AgentSession // tenantId -> pi agent
    limit int                        // 上限，避免 fd 爆炸
}
```

- 同 tenant 永远落到同 worker（粘性）
- worker 挂掉 = 该 worker 的 tenant 被 hash 到别的 worker
- 别的 worker 没这个文件 → 从 S3 拉 → 重建 session → 接流量
- **SLA = (worker 数 - 1) / worker 数**

### 3.3 故障迁移

| 故障 | 检测 | 恢复 |
|---|---|---|
| 单 worker 挂 | LB 心跳超时（5s） | 它的 tenant 哈希到新 worker，从 S3 拉文件 |
| 数据库文件损坏 | `PRAGMA integrity_check` 启动时跑 | 备份版本回放（LiteFS 历史快照） |
| 网络分区 | worker 与 LB 失联 | 重新挂载，重建会话 |
| S3 不可达 | 本地有最近 WAL | 仍可服务，WAL 堆积待恢复 |

---

## 4. 容量里程碑

| 阶段 | 形态 | 家庭数 | 并发聊天 | 月成本（估算） |
|---|---|---|---|---|
| **M0 早鸟** | 1 worker，1 进程，1 机器 | 50–200 | 100–400 | $5–20（2C4G 即可） |
| **M1 验证** | 2 worker，粘性分流 | 200–500 | 500–1000 | $30–80（4C8G × 2） |
| **M2 增长** | 4 worker + 读副本（LiteFS） | 500–1500 | 1000–3000 | $150–400（8C16G × 4 + 读副本） |
| **M3 规模** | 8 worker + LiteFS 跨机 | 2000–5000 | 5000+ | $800–2000（16C32G × 8） |
| **M4 万人** | 16+ worker + S3 冷热分层 | 10000+ | 20000+ | $3000+ |

**单 worker 容量锚点**：
- 200 个 tenant file（fd 限制）
- 200 个并发长连接聊天
- 400 GB 总数据（每家庭 2GB timeline）
- ~10 GB 内存（agent 50MB × 200）

> 真正成本不在计算，在**存储**。timeline 无限增长要分层。

---

## 5. 持久化分层

```
热（SSD，本地）
  └─ 当前 200 家庭的 SQLite + WAL（每个 ~2GB）

温（S3 Standard）
  └─ 6 个月内未活跃租户的 SQLite 文件（LiteFS 同步）

冷（S3 Glacier）
  └─ 6 个月以上未活跃租户的压缩快照
     激活时 = 下载 → 解压 → 触发 hash 重算 → 加进粘性池
```

**激活冷租户 = 30 秒到 2 分钟**（取决于文件大小和网络）。
**对家庭场景完全可接受**（用户不会秒级激活半年没用的家庭）。

---

## 6. 备份与灾难恢复

| 层级 | 机制 | RPO | RTO |
|---|---|---|---|
| **实时** | LiteFS → S3 持续同步（WAL 流） | < 5s | 进程重启秒级 |
| **小时** | S3 版本控制（每小时快照） | < 1h | 5min（拉快照重启） |
| **天** | S3 跨区复制 | < 24h | 30min（跨区拉取） |
| **租户级** | 单文件 `VACUUM INTO` 一键导出 | 0 | 0（即时） |

> **租户级导出 = 杀手锏**：GDPR / 数据迁移 / 用户带走数据 = `cp file.db` 完成。
> 这是 Postgres **永远做不到**的颗粒度。

---

## 7. 为什么不是"上 Redis"或"上 Kafka"

- **Redis**：缓存层，加；不解决容量问题。**可加**（放 pi agent 热记忆）
- **Kafka**：消息队列；HomeSense 同步调用为主，**不需要**
- **Postgres**：上面已说，不要
- **MongoDB / ES**：检索 timeline？**SQLite FTS5 够用 100GB 内**
- **K8s**：5000 家庭以下用不上；裸机 + systemd + LiteFS 已足够

**结论**：5000 家庭以下，**整套架构 = 8 个 Go/Node 进程 + 1 个 S3 桶**。
**没有数据库服务器，没有消息队列，没有 K8s，没有微服务。**

---

## 8. 监控指标

```promql
# 核心 SLO
tenant_open_files{worker} < 200          # fd 余量
pi_agent_sessions{worker} < 200          # agent 内存
chat_concurrent{worker} < 300            # 长连接上限
sqlite_wal_size{tenant} < 100MB          # 写堆积预警
litefs_lag_seconds{tenant} < 30          # S3 同步延迟
sticky_hit_ratio > 99%                   # 粘性命中

# 业务 SLO
first_token_latency_p99 < 2s
tool_call_success_rate > 99%
workflow_completion_rate > 95%
executor_wss_reconnect_per_hour < 3
```

---

## 9. 与 v3 / v5 ARCH 的关系

- **v3** 已经实现：per-tenant SQLite、per-tenant timeline、auth 绑 tenantId、pi agent
- **v5 ARCH 5.2** 之前写的是"无状态 HTTP + 粘性路由 + jsonl 恢复"——**这句话说反了**
  - 不是"无状态"，是"**按租户小有状态**"
  - 不是"jsonl 恢复"，是"**per-tenant SQLite + LiteFS**"
- **本篇** 给出具体路径：worker 池容量、粘性算法、故障迁移、持久化分层
- **实施分阶段**：M0 早鸟已经在跑；M1 验证 = 给 LB 加 hash + worker 间健康检查；M2+ = LiteFS + 读副本

---

## 10. 不要做的事

- ❌ **不要迁 Postgres**：跨租户聚合在 HomeSense 无业务价值
- ❌ **不要拆微服务**：5000 家庭 8 进程足矣，微服务是 5 万+ 才需要的复杂度
- ❌ **不要上 K8s**：8 worker 用 systemd 部署，运维成本 1/10
- ❌ **不要把 pi agent 改成独立服务**：v0.84.3 进程内嵌已经够用，重写 = 半年没业务
- ❌ **不要为单租户加"专用数据库"**：per-tenant SQLite 本身就是"专用数据库"
- ❌ **不要先做多区域**：5000 家庭一个区域够；多区域是 1 万+ 才需要

---

## 11. 风险与对应

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 单租户数据爆炸（>10GB） | 低 | 高 | 监控 + 自动冷归档到 S3 Glacier |
| pi agent 内存泄漏 | 中 | 中 | worker 定期重启（每 24h 滚动） |
| LiteFS 写延迟抖动 | 低 | 中 | 监控 S3 同步延迟；超阈值报警 |
| 粘性路由脑裂 | 低 | 高 | 写锁走租户文件 WAL，不走共享存储 |
| worker 同时挂 2 个 | 低 | 中 | SLO 设计 = (N-1)/N 可用，N≥4 即可容忍 1 挂 |
| S3 区域故障 | 极低 | 高 | 跨区复制 + 备用 worker 区域 |

---

## 12. 接下来做什么

按优先级：

1. **M0 → M1**：实现 sticky hash 路由（10 行 Go + LB 配置）
2. **M1 → M2**：引入 LiteFS，per-tenant 文件同步到 S3（**这是关键一步**）
3. **M2 → M3**：加读副本，跑报表 / 导出不走主 worker
4. **M3 → M4**：跨区域 + 冷热分层
5. **同步**：补 WSS Tool Bridge（脑→executor 双向，v5 ARCH §1.5）
6. **同步**：补渠道路由（飞书进家庭大脑，v5 ARCH §3）

> **任何一项都不是"换数据库"，是"加 worker 副本 + 加 S3 桶 + 加健康检查"**。
> 容量增长 = 加机器，**业务代码不变**。

---

## 13. 引用

- `v5/ARCHITECTURE.md` §5.2 已落定本文档为扩容基线
- `v5/docs/tool-bridge-design.md` — WSS 协议
- `v5/docs/rulego-workflow-integration.md` — 工作流引擎
- LiteFS 项目：https://fly.io/docs/litefs/
- v3 per-tenant 实现：`apps/web/lib/tenant-db.ts`、`apps/web/lib/tenants.ts`

---

*最后更新：2026-09-02。HomeSense 永远不会迁 Postgres。*
