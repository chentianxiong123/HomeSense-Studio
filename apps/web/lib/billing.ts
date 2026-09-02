// HomeSense v5 — 云平台计费/钱包（全栈在 Next.js 控制面，数据存 PostgreSQL）。
//
// 架构铁律（见 v5/ARCHITECTURE.md §1 + v5/docs/billing-postgresql-platform-db.md）：
//   - 用户数据（聊天历史）留 per-tenant SQLite；平台数据（用量/钱包/单价/配额）统一 PG。
//   - Go 只是 agent 实例，不算钱；费用 = PG pico_usage 真实 token × 单价（纯 Node）。
//
// 金额全部用「分」（cents 整数）存储，杜绝浮点；对外展示转美元。

import { migrate, query, queryOne, withTransaction } from "@/lib/db"

export interface ModelPrice {
  input: number // USD per 1M input tokens
  output: number // USD per 1M output tokens
}

export type BillingPrices = Record<string, ModelPrice>
export type MonthlyQuota = Record<string, number> // tenantId -> tokens per month

export interface BillingConfig {
  model_prices: BillingPrices
  monthly_quota: MonthlyQuota
}

export interface WalletLedgerRow {
  id: number
  tenantId: string
  kind: "topup" | "charge" | "adjust" | "grant"
  model: string | null
  inputTokens: number
  outputTokens: number
  amountUsd: number
  balanceAfterUsd: number
  note: string | null
  createdAt: string
}

// ---- 单价 / 配额 ----

export async function readBillingConfig(): Promise<BillingConfig> {
  await migrate()
  const row = await queryOne<{ model_prices: unknown; monthly_quota: unknown }>(
    `SELECT model_prices, monthly_quota FROM billing_config WHERE id = 1`,
  )
  if (!row) return { model_prices: {}, monthly_quota: {} }
  // pg 驱动对 jsonb 列默认返回已解析对象，但也可能为字符串（取决于配置），双兼容。
  const prices = asRecord(row.model_prices) as BillingPrices | null
  const quota = asRecord(row.monthly_quota) as MonthlyQuota | null
  return { model_prices: prices ?? {}, monthly_quota: quota ?? {} }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown
      if (typeof parsed === "object" && !Array.isArray(parsed) && parsed !== null) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

export async function writeBillingConfig(cfg: BillingConfig): Promise<void> {
  await migrate()
  await query(
    `UPDATE billing_config
        SET model_prices = $1, monthly_quota = $2, updated_at = now()
      WHERE id = 1`,
    [JSON.stringify(cfg.model_prices ?? {}), JSON.stringify(cfg.monthly_quota ?? {})],
  )
}

/** 模型单价查询；缺省返回 0（fail-open，绝不报错）。 */
export async function priceFor(model: string, cfg?: BillingConfig): Promise<ModelPrice> {
  const c = cfg ?? (await readBillingConfig())
  const p = c.model_prices[model ?? ""]
  if (!p) return { input: 0, output: 0 }
  return { input: Number(p.input) || 0, output: Number(p.output) || 0 }
}

/** 纯函数：单次用量的美元费用 = input/1e6*price.input + output/1e6*price.output。 */
export function computeModelCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cfg?: BillingConfig,
): number {
  const p = cfg?.model_prices?.[model ?? ""]
  const input = Number(p?.input) || 0
  const output = Number(p?.output) || 0
  return (
    ((inputTokens || 0) / 1e6) * input +
    ((outputTokens || 0) / 1e6) * output
  )
}

export async function monthlyQuotaFor(tenantId: string, cfg?: BillingConfig): Promise<number> {
  const c = cfg ?? (await readBillingConfig())
  return Number(c.monthly_quota[tenantId]) || 0
}

// ---- 钱包 ----

/** 创建/确保租户钱包行（幂等）。首次开户余额 0。 */
export async function ensureWallet(tenantId: string): Promise<void> {
  await migrate()
  await query(
    `INSERT INTO wallets (tenant_id) VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  )
}

export async function getBalanceUsd(tenantId: string): Promise<number> {
  await ensureWallet(tenantId)
  const row = await queryOne<{ balance_cents: number }>(
    `SELECT balance_cents FROM wallets WHERE tenant_id = $1`,
    [tenantId],
  )
  return row ? centsToUsd(Number(row.balance_cents)) : 0
}

/**
 * 记账：原子地更新余额 + 写一条流水（balance_after 为快照）。
 * amountUsd > 0 充值/调整加钱；amountUsd < 0 消费扣钱。
 */
export async function postLedger(
  tenantId: string,
  kind: "topup" | "charge" | "adjust" | "grant",
  amountUsd: number,
  opts: { model?: string; inputTokens?: number; outputTokens?: number; note?: string } = {},
): Promise<{ ledgerId: number; balanceAfterUsd: number }> {
  await migrate()
  const amountCents = usdToCents(amountUsd)
  return withTransaction(async (run) => {
    await run(
      `INSERT INTO wallets (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    )
    const before = await run<{ balance_cents: number }>(
      `SELECT balance_cents FROM wallets WHERE tenant_id = $1`,
      [tenantId],
    )
    const balanceCents =
      Math.round((Number(before[0]?.balance_cents) + amountCents) * 1e6) / 1e6
    await run(
      `UPDATE wallets SET balance_cents = $1, updated_at = now() WHERE tenant_id = $2`,
      [balanceCents, tenantId],
    )
    const res = await run(
      `INSERT INTO wallet_ledger
         (tenant_id, kind, model, input_tokens, output_tokens, amount_cents, balance_after_cents, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        tenantId,
        kind,
        opts.model ?? null,
        opts.inputTokens ?? 0,
        opts.outputTokens ?? 0,
        amountCents,
        balanceCents,
        opts.note ?? null,
      ],
    )
    return { ledgerId: Number(res[0].id), balanceAfterUsd: centsToUsd(balanceCents) }
  })
}

export async function listLedger(tenantId: string, limit = 50): Promise<WalletLedgerRow[]> {
  await migrate()
  const rows = await query<{
    id: string
    tenant_id: string
    kind: string
    model: string | null
    input_tokens: number
    output_tokens: number
    amount_cents: number
    balance_after_cents: number
    note: string | null
    created_at: string
  }>(
    `SELECT id, tenant_id, kind, model, input_tokens, output_tokens,
            amount_cents, balance_after_cents, note, created_at
       FROM wallet_ledger WHERE tenant_id = $1
       ORDER BY id DESC LIMIT $2`,
    [tenantId, limit],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    tenantId: r.tenant_id,
    kind: r.kind as WalletLedgerRow["kind"],
    model: r.model,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    amountUsd: centsToUsd(Number(r.amount_cents)),
    balanceAfterUsd: centsToUsd(Number(r.balance_after_cents)),
    note: r.note,
    createdAt: new Date(r.created_at).toISOString(),
  }))
}

// ---- 用量（PG pico_usage，平台数据统一在平台库） ----

/**
 * 汇总某租户指定时间段按模型的 token 用量（读 PG，不再读 per-tenant SQLite）。
 */
export async function readUsageByModel(
  tenantId: string,
  since: string | null,
): Promise<{ model: string; requests: number; input: number; output: number }[]> {
  await migrate()
  const rows = await query<{
    model: string
    requests: number
    input: number
    output: number
  }>(
    `SELECT COALESCE(model,'') AS model,
            COALESCE(SUM(requests),0)::BIGINT AS requests,
            COALESCE(SUM(input_tokens),0)::BIGINT AS input,
            COALESCE(SUM(output_tokens),0)::BIGINT AS output
       FROM pico_usage
      WHERE tenant_id = $1${since ? " AND last_seen >= $2" : ""}
      GROUP BY model ORDER BY model`,
    since ? [tenantId, since] : [tenantId],
  )
  return rows.map((r) => ({
    model: r.model,
    requests: Number(r.requests),
    input: Number(r.input),
    output: Number(r.output),
  }))
}

/** 本月起始的 UTC 字符串（与旧口径一致）。 */
export function monthStartISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** 某租户本月按模型用量（读 PG）。 */
export function readTenantMonthUsageByModel(
  // 兼容旧签名：gatewayDir 已不用，保留参数避免大改调用方
  _gatewayDir: string | null,
  tenantId: string,
): Promise<{ model: string; requests: number; input: number; output: number }[]> {
  return readUsageByModel(tenantId, monthStartISO())
}

/** 计算某租户本月费用（按模型 × 单价，云平台纯计算）。 */
export async function computeTenantMonthCost(
  tenantId: string,
  cfg?: BillingConfig,
): Promise<number> {
  const c = cfg ?? (await readBillingConfig())
  const usage = await readUsageByModel(tenantId, monthStartISO())
  let total = 0
  for (const m of usage) {
    total += computeModelCost(m.model, m.input, m.output, c)
  }
  return Math.round(total * 1e6) / 1e6
}

/** 某租户本月已用 token 总数（读 PG 平台库）。 */
export async function readTenantMonthTokens(tenantId: string): Promise<number> {
  const usage = await readUsageByModel(tenantId, monthStartISO())
  let total = 0
  for (const m of usage) {
    total += m.input + m.output
  }
  return total
}

/**
 * 记录一次用量（前端上报 /api/usage/record 调用）。按 (tenant, session, model, task)
 * 累加，task 默认空串（主循环）。幂等 upsert。
 */
export async function recordUsage(
  tenantId: string,
  sessionId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  task = "",
): Promise<{ costUsd: number; balanceAfterUsd: number | null }> {
  await migrate()
  const inTok = Math.max(0, inputTokens || 0)
  const outTok = Math.max(0, outputTokens || 0)
  await query(
    `INSERT INTO pico_usage
       (tenant_id, session_id, model, task, requests, input_tokens, output_tokens, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, 1, $5, $6, now(), now())
     ON CONFLICT (tenant_id, session_id, model, task) DO UPDATE SET
       requests = pico_usage.requests + 1,
       input_tokens = pico_usage.input_tokens + excluded.input_tokens,
       output_tokens = pico_usage.output_tokens + excluded.output_tokens,
       last_seen = now()`,
    [tenantId, sessionId || "", model || "unknown", task, inTok, outTok],
  )

  // Compute the dollar cost of this single call and post a charge ledger
  // entry so the wallet balance tracks real spend. We don't pre-flight
  // balance here — that would block writes during partial outages of the
  // pricing table; the wallet simply goes negative and the admin UI shows
  // it. For pre-consume / hard-quota enforcement, the chat path should
  // call `getBalanceUsd` + `monthlyQuotaFor` before invoking the LLM.
  let costUsd = 0
  let balanceAfterUsd: number | null = null
  try {
    const cfg = await readBillingConfig()
    costUsd = computeModelCost(model, inTok, outTok, cfg)
    if (costUsd > 0) {
      const r = await postLedger(
        tenantId,
        "charge",
        -costUsd,
        {
          model,
          inputTokens: inTok,
          outputTokens: outTok,
          note: `usage ${model} ${inTok}+${outTok}tok`,
        },
      )
      balanceAfterUsd = r.balanceAfterUsd
    }
  } catch (e) {
    // Don't fail the whole usage record on a billing-side error — the
    // pico_usage row is the source of truth for cost, the ledger is just
    // a convenience view.
    console.warn("recordUsage: post-charge ledger failed", e)
  }
  return { costUsd, balanceAfterUsd }
}

// ---- 单位换算 ----

export function usdToCents(usd: number): number {
  return Math.round((usd || 0) * 100)
}

export function centsToUsd(cents: number): number {
  return Math.round((cents || 0) * 100) / 10000
}