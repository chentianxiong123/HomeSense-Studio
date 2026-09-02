# v5 — 平台数据与用户数据分库（PostgreSQL + SQLite）

> 决策日期：2026-09-02
> 状态：已实施（commit 见 git log）
> 前置铁律：`v5/ARCHITECTURE.md §1` —— Go 不是网关，只是一个 agent 实例（工作区）。

## 0. 一句话决策

**用户数据（聊天历史/时间线）留在每租户 SQLite；平台数据（token 用量 + 钱包/账单/单价/配额）统一进一个 PostgreSQL。**
Go agent 实例不再写任何用量/计费数据。

## 1. 数据分界（不可打破）

| 数据 | 本质 | 归属 | 存储 |
|---|---|---|---|
| `pico_messages`（聊天历史） | **用户数据** | 用户的个人财产 | per-tenant SQLite ✅ |
| `pico_usage`（token 用量） | **平台账本** | 平台 | PostgreSQL ✅ |
| `wallets` / `wallet_ledger` | **平台账本** | 平台 | PostgreSQL ✅ |
| `billing_config`（单价/配额） | **平台配置** | 平台 | PostgreSQL ✅ |
| `tenants.db`（租户索引/登录） | 平台元数据 | 平台 | SQLite（保持现状） |

> SQLite **永远不存"用量"**。用量与钱是平台级的，混在用户 SQLite 里是错误架构。

## 2. 写入路径（pico_usage 不经手 SQLite）

```
Go agent 完成一次调用
  └─ 响应自带 { model_name, usage:{in,out} }（Go 只报事实，不存库）
       └─ 前端收齐助手消息 → POST /api/usage/record {model,in,out}（auth 定 tenant_id）
            └─ Next.js 直接 upsert PostgreSQL pico_usage
                  └─ 计费/钱包/账单全部读 PG —— 单一权威源，无同步
```

## 3. 角色

| 层 | 职责 |
|---|---|
| agent 实例（Go） | 做大脑、跑工具、响应带 model+usage 事实；**不写用量、不算钱** |
| 云平台（Next.js） | 唯一业务中心：接收上报 → 写 PG usage → 单价×token 算费 → 钱包扣账/流水 → 账单展示 |

## 4. PostgreSQL Schema（homesense 库）

```sql
pico_usage     (tenant_id, session_id, model, task,
                requests, input_tokens, output_tokens,
                first_seen, last_seen, UNIQUE(tenant_id,session_id,model,task))
wallets        (tenant_id PK, balance_cents BIGINT, updated_at)
wallet_ledger  (id PK, tenant_id, kind, model, input/output_tokens,
                amount_cents, balance_after_cents, note, created_at)
billing_config (id=1, model_prices JSONB, monthly_quota JSONB, updated_at)
```
金额全用**分（cents 整数）**，杜绝浮点。

## 5. 实施要点

- 连接：`lib/db.ts` 用 `pg` Pool，连接串环境变量 `HOMESENSE_DATABASE_URL`，缺省本地 `postgres://postgres:hsense2026@127.0.0.1:5432/homesense`；启动时幂等 migrate。
- `lib/billing.ts` / `lib/usage.ts`：`node:sqlite` → `db.query`；金额按分存储、展示转美元。
- `POST /api/usage/record`：前端上报 usage → PG upsert。
- Go：删除 `pico_usage` 写库路径；`pico_usage` 表移出 per-tenant SQLite。
- 旧 `apps/web/data/wallet.sqlite` 弃用不删（本轮不做数据迁移）。

## 6. 明确不做

- ❌ 数据迁移（现有数据极少，重建即得）
- ❌ Go 端任何用量/计费逻辑
- ❌ 预扣/回补/网关余额快照
- ❌ 虚拟币/积分（余额直接美元分；单价 USD/1M tokens）
- ❌ 把 tenant-store（tenants.db 登录索引）迁到 PG（保持现状，只动平台账本数据）