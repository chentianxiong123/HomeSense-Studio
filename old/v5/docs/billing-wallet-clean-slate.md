# v5 — 计费/钱包：云平台全栈实现（Clean Slate）

> 决策日期：2026-09-02
> 状态：设计定稿，按此实现
> 关联铁律：`v5/ARCHITECTURE.md §1` —— **Go 不是网关，只是一个 agent 实例（工作区）**。

## 0. 一句话决策

**整套计费/钱包逻辑 100% 放在 Next.js 控制面（云平台）完成，Go agent 实例零参与。**

Go 进程不碰任何钱：不算费用、不判余额、不超限拦截。
它唯一保留的是自动记录的客观用量（真实 LLM token，`pico_usage` 表），那是它干活的副产物。

## 1. 为什么这么定

- 一个家庭一个 **agent 实例**，实例只负责"干活"：跑大脑、执行工具、读自己的工作区。
  它不是业务系统，没有义务理解"钱"。
- 云平台（Next.js）已经是唯一的业务中心：租户、登录、模型源、配置下发。
  计费/钱包是纯业务，理应和它们同层。
- 避免"双写余额""网关同步余额快照""预扣/回补"这类复杂且易漂移的分布式计费，
  全栈单库（一个 `wallet.sqlite`）事务原子，最快完成且最稳。

## 2. 分工（铁律落地）

| 层 | 职责 | 绝不做什么 |
|---|---|---|
| **agent 实例（Go）** | 做大脑、跑工具；写 `pico_usage` 真实 token 客观记录 | 不算钱、不仍判余额、不超限拦截、不含任何计费逻辑 |
| **云平台（Next.js）** | 钱包账本、模型单价、月度配额、用量账本、费用换算、充值流水 | 不依赖 Go 进程返回任何商业判定 |

> 用户侧若需"超限提示"：云平台读 `pico_usage` + 钱包，在前端提示，不打扰 agent。

## 3. 数据模型（全部在云平台）

```
data/
  wallet.sqlite            ← 新增：云平台钱包账本（唯一计费权威）
    wallets(
      tenant_id      TEXT PRIMARY KEY,
      balance_usd    REAL NOT NULL DEFAULT 0,   -- 当前余额（美元）
      created_at, updated_at
    )
    wallet_ledger(
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     TEXT NOT NULL,
      kind          TEXT NOT NULL,   -- topup | charge | adjust | grant
      model         TEXT,            -- charge 时为模型名
      input_tokens  INTEGER,         -- charge 时
      output_tokens INTEGER,         -- charge 时
      amount_usd    REAL NOT NULL,   -- +充值 / -消费
      balance_after REAL NOT NULL,   -- 流水发生后的余额（快照）
      note          TEXT,
      created_at    TEXT NOT NULL
    )
    billing_config(  -- 单行
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      model_prices  TEXT NOT NULL,   -- JSON: { "<model_name>": { input: USD/1M, output: USD/1M } }
      monthly_quota TEXT NOT NULL,   -- JSON: { "<tenant_id>": <tokens/月> }
      updated_at
    )
  每租户 pico-history.db 的 pico_usage      ← 只读数据源：真实 input/output token（Go 已自动记录）
  每租户 config.json                         ← 只读/只写不涉及钱；模型的「能指"用哪个模型"」沿用现有
```

## 4. 费用换算（云平台唯一计算）

```
tenant 本月费用 = Σ_{按模型} (
    model.input_tokens  × model_prices[model].input  / 1e6
  + model.output_tokens × model_prices[model].output / 1e6 )
```
- 读 `pico_usage`（本月 `last_seen`）→ 按 model 聚合 → 乘单价 → fail-open（单价缺省按 0，绝不报错）。
- 扣账动作是**云平台**在合适的时机把费用写成一条 `wallet_ledger(kind=charge, amount_usd=-费用)`，
  由云平台完成，agent 全程不感知。

## 5. API 一览（Next.js route handlers）

| 端点 | 权限 | 用途 |
|---|---|---|
| `GET /api/wallet` | 登录用户 | 自己租户的余额 + 本月消费 + 近流水 |
| `POST /api/wallet` | admin | 充值/调整（topup / adjust），写 ledger |
| `GET /api/billing` | admin | 读单价表 + 每租户月配额 + 本月用量 + 费用 |
| `PUT /api/billing` | admin | 存单价表 + 每租户月配额 |
| `GET /api/usage` | admin | 用量账本（沿用现有，费用改为云平台按单价算） |

## 6. 明确不做（本轮）

- ❌ Go 进程任何价格计算 / 余额判断 / 超限拦截
- ❌ 预扣 / 回补 / 网关余额快照同步
- ❌ 每请求实时扣费（云平台按批次/按需记账即可）
- ❌ 虚拟币/积分体系（余额直接用美元单位，单价用 USD / 1M tokens）