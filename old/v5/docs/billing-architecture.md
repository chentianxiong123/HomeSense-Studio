# v5 计费与钱包子系统

> 写在简历上的那一段：HomeSense 云平台自研 LLM 计费引擎。

## 一句话定位

HomeSense 是一个**多租户云平台**。每个家庭（tenant）登录后用自己的钱包余额调 LLM。**计费、钱包、配额、流水**四件事全在 Next.js 这层自己做，**不依赖任何外部网关**（不挂 one-api / new-api）。

## 设计目标

| 目标 | 实现 |
|---|---|
| **算钱明明白白** | 拿 LLM 返回的真 `usage.prompt_tokens` / `usage.completion_tokens` × 配置的单价 = 美元费用 |
| **真钱包** | 每个租户独立钱包（cents 整数存储），充值/扣费/调整全有 ledger 流水 |
| **多租户** | RBAC：admin 能看/改任意租户钱包，普通用户只能看自己 |
| **流式响应也能计费** | 助手消息流式到达最后一帧时，前端把 `usage` payload 上报 `/api/usage/record`，Next.js 写账 |
| **零外部依赖** | PostgreSQL 一张表存钱包、一张存流水、一张存用量、一张存配置 |

## 数据模型

所有表都在 **PostgreSQL**（容器名 `hs-pg`，库名 `homesense`），由 `apps/web/lib/db.ts` 启动时自动 migrate：

```sql
-- 平台配置（单行 id=1）：每个模型 input/output 单价
CREATE TABLE billing_config (
  id          INT PRIMARY KEY DEFAULT 1,
  model_prices JSONB DEFAULT '{}'::jsonb,  -- {"gpt-4o": {"input":2.5,"output":10}, ...}
  monthly_quota JSONB DEFAULT '{}'::jsonb,  -- {tenantId: tokens_per_month}
  updated_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT billing_config_single CHECK (id = 1)
);

-- 真实 token 用量（每条 LLM 调用一行，累加）
CREATE TABLE pico_usage (
  tenant_id     TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  model         TEXT NOT NULL,
  task          TEXT NOT NULL DEFAULT '',
  requests      BIGINT NOT NULL DEFAULT 0,
  input_tokens  BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, model, task)
);

-- 钱包（每个租户一行）
CREATE TABLE wallets (
  tenant_id     TEXT PRIMARY KEY,
  balance_cents BIGINT NOT NULL DEFAULT 0,  -- 全部用分（cents 整数），杜绝浮点
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 钱包流水（每笔账一行，append-only 不可改）
CREATE TABLE wallet_ledger (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  kind               TEXT NOT NULL,  -- 'topup' | 'charge' | 'adjust' | 'grant'
  model              TEXT,
  input_tokens       BIGINT NOT NULL DEFAULT 0,
  output_tokens      BIGINT NOT NULL DEFAULT 0,
  amount_cents       BIGINT NOT NULL,  -- 正=入账，负=扣费
  balance_after_cents BIGINT NOT NULL,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 金额不浮点

所有金额用 **cents 整数**（BIGINT）存储：

```ts
usdToCents(usd)  = Math.round(usd * 100)
centsToUsd(cents) = Math.round(cents * 100) / 10000
```

写进 `wallets.balance_cents` 永远是正/负整数。前端展示时 `cents / 100` 转美元。

## 算钱公式

```ts
costUsd(model, inputTokens, outputTokens, cfg) =
  (inputTokens / 1_000_000) * cfg.model_prices[model].input +
  (outputTokens / 1_000_000) * cfg.model_prices[model].output
```

例：模型 `gpt-4o` 单价 `{input: 2.5, output: 10}`，一次 1000 in + 500 out：
```
cost = (1000/1e6) * 2.5 + (500/1e6) * 10
     = 0.0025 + 0.005
     = $0.0075
```

**这就是 one-api / new-api 的 `ModelRatio` 模式**，但**代码是我们自己写的**。

## 写入路径

```
[浏览器 → pico chat 流式响应]
  ↓
  最后一帧 payload.usage = {input_tokens, output_tokens, model_name}
  ↓
[protocol.ts 解析 usage，内存去重防重复]
  ↓
POST /api/usage/record  (model, input_tokens, output_tokens, session_id)
  ↓
[apps/web/app/api/usage/record/route.ts]
  ↓
recordUsage(tenantId, sessionId, model, in, out, task)
  ↓
  ┌──────────────────────────┐    ┌──────────────────────────┐
  │ INSERT pico_usage        │    │ readBillingConfig()      │
  │ ON CONFLICT DO UPDATE    │    │ computeModelCost(...)    │
  │ (累加 tokens)            │    │ postLedger(tenant,       │
  └──────────────────────────┘    │   "charge", -costUsd,    │
                                  │   {model, in, out, note}) │
                                  └──────────────────────────┘
  ↓
返回 {success, monthly_used_tokens, cost_usd, balance_after_usd}
```

**关键点**：
- `recordUsage` 内部事务里 **先写 pico_usage → 再算费用 → 再写 ledger → 再更新 wallets**。任意一步失败整个回滚（PG 事务）。
- `postLedger` 用 `withTransaction` 包住，先 `INSERT wallets ON CONFLICT DO NOTHING`（建钱包）→ `SELECT balance_cents` → `UPDATE balance_cents` → `INSERT wallet_ledger`。
- ledger 是 **append-only**（无 UPDATE/DELETE），完整审计链。

## 充值 / 调整

只有 admin 能调。`POST /api/wallet` body：

```json
{
  "tenantId": "ten_2uZluZQxAcIA",
  "amount": 10,           // 正=入账，负=扣
  "kind": "topup",        // 或 "adjust" / "grant"
  "note": "Stripe 充值"
}
```

## 余额/账单查询

`GET /api/wallet?tenant=ten_xxx`（admin）返回：

```json
{
  "tenantId": "ten_2uZluZQxAcIA",
  "name": "string 的家",
  "balance_usd": 9.7985,
  "monthly_quota": 0,
  "monthly_used_tokens": 501500,
  "monthly_cost_usd": 0.4015,
  "recent_ledger": [
    {"id":4,"kind":"topup","amountUsd":10,"balanceAfterUsd":9.8,...},
    {"id":3,"kind":"charge","model":"auto","inputTokens":200000,"outputTokens":50000,"amountUsd":-0.2,"balanceAfterUsd":-0.2,...}
  ]
}
```

admin 页 `/admin/billing` 展示每个租户的钱包 + 流水；admin 页 `/admin/usage` 展示每租户本月 token 账本。

## RBAC

- **普通用户**：`GET /api/wallet` 只能查自己，`POST /api/wallet` 直接 403。
- **admin**：`GET /api/wallet?tenant=xxx` 查任意租户；`POST /api/wallet` 可充值/调整任意租户。
- **`/api/usage/record`**：任何登录用户都能调（系统替他自己租户写账）。

## 简历向设计点

这个子系统在简历上能写：

1. **多租户云平台计费引擎**（PG 4 张表 + 事务一致性 + 整数防浮点）
2. **真钱包 + append-only ledger**（充值/扣费/调整/grant 四种 kind 流水可审计）
3. **流式响应中的 token 计量**（前端解析 LLM `usage` payload 上报，前端去重防重复）
4. **RBAC**（普通用户 vs admin 的 API 权限分层）
5. **费用 = 真 token × 单价**（不是按请求估算，按 LLM 真实 usage 算账）

## 关键文件

| 文件 | 作用 |
|---|---|
| `apps/web/lib/db.ts` | PG Pool + migrate（4 张表 DDL） |
| `apps/web/lib/billing.ts` | 全部计费/钱包/单价/配额逻辑（≈350 行） |
| `apps/web/lib/usage.ts` | 用量聚合读路径（按租户/按模型/按月） |
| `apps/web/app/api/billing/route.ts` | GET/PUT 单价 + 配额 |
| `apps/web/app/api/wallet/route.ts` | GET 查账，POST 充值/调整（admin only） |
| `apps/web/app/api/usage/record/route.ts` | 前端流式响应上报入口 |
| `apps/web/app/api/usage/route.ts` | admin 用量账本 |
| `apps/web/picoclaw/features/chat/protocol.ts` | 解析 LLM `usage` payload + 去重上报 |
| `apps/web/picoclaw/components/admin/billing-panel.tsx` | admin 钱包/单价/配额编辑 UI |
| `apps/web/picoclaw/components/admin/usage-panel.tsx` | admin 用量账本 UI |

## 已知限制

- **不预扣 / 不截断**。对话结束才记（事后计费）。余额变负数由 admin 补回。**生产级 SaaS 需要加 pre-consume**，但 10~20 租户规模足够。
- **不接 OAuth**。用户名密码登录，自己 JWT 签发。
- **不接 Stripe/支付**。admin 后台手动充值。生产级接支付渠道要加 webhook 回调。
- **centsToUsd 精度**：`Math.round(cents*100)/10000` 截到 0.01 美元。生产级建议用 decimal 库（Decimal.js / bignumber.js）。

## 端到端验证记录

```
1. admin 登录 → cookie
2. PUT /api/billing → 设 auto {input:0.5, output:2.0} per 1M
3. POST /api/wallet {tenantId, amount:10, kind:topup} → 充值 +10
4. string 用户登录 → cookie
5. POST /api/usage/record {model:"auto", input:200000, output:50000}
   → response: {success:true, monthly_used_tokens:250000, cost_usd:0.2, balance_after_usd:-0.2}
6. GET /api/wallet → balance 9.8, monthly_cost 0.4, ledger 显示 topup+10 / charge-0.2
```

费用算得明明白白：`200k * 0.5/1M + 50k * 2/1M = 0.1 + 0.1 = $0.2`。
