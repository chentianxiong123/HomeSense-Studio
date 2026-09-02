// HomeSense v5 — 云平台计费/钱包（全栈在 Next.js 控制面）。
//
// 架构铁律（见 v5/ARCHITECTURE.md §1）：Go 只是 agent 实例（工作区），
// 不算钱、不判余额、不超限拦截。整套计费/钱包 100% 在云平台：
//   - wallet.sqlite 是唯一计费权威（余额 + 流水 + 单价表 + 月度配额）
//   - 费用 = pico_usage 真实 token × 单价（纯 Node 计算）
//   - 扣账是云平台动作，agent 全程不感知
//
// 计费用美元单位（不是虚拟币/积分），单价单位 USD / 1M tokens。

import { DatabaseSync } from "node:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const DATA_ROOT = resolve(
  process.env.HOMESENSE_DATA_ROOT || process.cwd(),
  "data",
)
const WALLET_DB_PATH = process.env.HOMESENSE_WALLET_DB_PATH || join(DATA_ROOT, "wallet.sqlite")

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
  balanceAfter: number
  note: string | null
  createdAt: string
}

export interface WalletView {
  tenantId: string
  name: string
  balanceUsd: number
  monthlyQuota: number // tokens, 0 = unlimited
  monthlyUsedTokens: number
  monthlyCostUsd: number
  recentLedger: WalletLedgerRow[]
}

let walletDb: DatabaseSync | null = null

function getWalletDb(): DatabaseSync {
  if (walletDb) return walletDb
  if (!existsSync(dirname(WALLET_DB_PATH))) {
    mkdirSync(dirname(WALLET_DB_PATH), { recursive: true })
  }
  const db = new DatabaseSync(WALLET_DB_PATH)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  applyWalletSchema(db)
  walletDb = db
  return db
}

function applyWalletSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      tenant_id   TEXT PRIMARY KEY,
      balance_usd REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     TEXT NOT NULL,
      kind          TEXT NOT NULL,
      model         TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      amount_usd    REAL NOT NULL,
      balance_after REAL NOT NULL,
      note          TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant ON wallet_ledger(tenant_id, id);
    CREATE TABLE IF NOT EXISTS billing_config (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      model_prices  TEXT NOT NULL DEFAULT '{}',
      monthly_quota TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL
    );
    INSERT OR IGNORE INTO billing_config (id, model_prices, monthly_quota, updated_at)
      VALUES (1, '{}', '{}', '');
  `)
}

// ---- 单价 / 配额 ----

export function readBillingConfig(): BillingConfig {
  const db = getWalletDb()
  const row = db
    .prepare(`SELECT model_prices, monthly_quota FROM billing_config WHERE id = 1`)
    .get() as { model_prices: string; monthly_quota: string } | undefined
  if (!row) return { model_prices: {}, monthly_quota: {} }
  let prices: BillingPrices = {}
  let quota: MonthlyQuota = {}
  try {
    prices = JSON.parse(row.model_prices) as BillingPrices
  } catch {
    prices = {}
  }
  try {
    quota = JSON.parse(row.monthly_quota) as MonthlyQuota
  } catch {
    quota = {}
  }
  return { model_prices: prices, monthly_quota: quota }
}

export function writeBillingConfig(cfg: BillingConfig): void {
  const db = getWalletDb()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO billing_config (id, model_prices, monthly_quota, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET model_prices = excluded.model_prices,
                                   monthly_quota = excluded.monthly_quota,
                                   updated_at = excluded.updated_at`,
  ).run(JSON.stringify(cfg.model_prices ?? {}), JSON.stringify(cfg.monthly_quota ?? {}), now)
}

/** 模型单价查询；缺省返回 0（fail-open，绝不报错）。 */
export function priceFor(model: string, cfg?: BillingConfig): ModelPrice {
  const c = cfg ?? readBillingConfig()
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
  const p = priceFor(model, cfg)
  return (
    ((inputTokens || 0) / 1e6) * p.input +
    ((outputTokens || 0) / 1e6) * p.output
  )
}

export function monthlyQuotaFor(tenantId: string, cfg?: BillingConfig): number {
  const c = cfg ?? readBillingConfig()
  return Number(c.monthly_quota[tenantId]) || 0
}

// ---- 钱包 ----

/** 创建/确保租户钱包行（幂等）。首次开户余额 0。 */
export function ensureWallet(tenantId: string): void {
  const db = getWalletDb()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO wallets (tenant_id, balance_usd, created_at, updated_at)
     VALUES (?, 0, ?, ?)`,
  ).run(tenantId, now, now)
}

export function getBalance(tenantId: string): number {
  const db = getWalletDb()
  ensureWallet(tenantId)
  const row = db
    .prepare(`SELECT balance_usd FROM wallets WHERE tenant_id = ?`)
    .get(tenantId) as { balance_usd: number } | undefined
  return row ? Number(row.balance_usd) || 0 : 0
}

/**
 * 记账：原子地更新余额 + 写一条流水（balance_after 为快照）。
 * amount > 0 充值/调整加钱；amount < 0 消费扣钱。返回流水 id。
 */
export function postLedger(
  tenantId: string,
  kind: "topup" | "charge" | "adjust" | "grant",
  amountUsd: number,
  opts: { model?: string; inputTokens?: number; outputTokens?: number; note?: string } = {},
): { ledgerId: number; balanceAfter: number } {
  const db = getWalletDb()
  ensureWallet(tenantId)
  const now = new Date().toISOString()
  db.exec("BEGIN")
  try {
    const before = getBalance(tenantId)
    const after = Math.round((before + amountUsd) * 1e6) / 1e6
    db.prepare(
      `UPDATE wallets SET balance_usd = ?, updated_at = ? WHERE tenant_id = ?`,
    ).run(after, now, tenantId)
    const res = db
      .prepare(
        `INSERT INTO wallet_ledger
           (tenant_id, kind, model, input_tokens, output_tokens, amount_usd, balance_after, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        tenantId,
        kind,
        opts.model ?? null,
        opts.inputTokens ?? 0,
        opts.outputTokens ?? 0,
        amountUsd,
        after,
        opts.note ?? null,
        now,
      )
    db.exec("COMMIT")
    return { ledgerId: Number(res.lastInsertRowid), balanceAfter: after }
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

export function listLedger(tenantId: string, limit = 50): WalletLedgerRow[] {
  const db = getWalletDb()
  const rows = db
    .prepare(
      `SELECT id, tenant_id AS tenantId, kind, model, input_tokens AS inputTokens,
              output_tokens AS outputTokens, amount_usd AS amountUsd,
              balance_after AS balanceAfter, note, created_at AS createdAt
       FROM wallet_ledger WHERE tenant_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(tenantId, limit) as unknown as WalletLedgerRow[]
  return rows
}

// ---- 用量 + 扣账（云平台唯一费用计算） ----

/**
 * 汇总某租户本月按模型的 token 用量（读 agent 实例记录的 pico_usage）。
 * fail-open：库不可读返回空。
 */
export function readTenantMonthUsageByModel(
  gatewayDir: string | null,
): { model: string; input: number; output: number }[] {
  if (!gatewayDir) return []
  const brainDir = process.env.HS_BRAIN_DATA ?? "/home/a1/HomeSense-Studio-v3/.hs-brain"
  const dbPath = join(brainDir, gatewayDir, "pico-history.db")
  if (!existsSync(dbPath)) return []
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      const rows = db
        .prepare(
          `SELECT COALESCE(model,'') AS model,
                  COALESCE(SUM(input_tokens),0) AS input,
                  COALESCE(SUM(output_tokens),0) AS output
           FROM pico_usage WHERE last_seen >= ? GROUP BY model`,
        )
        .all(monthStart) as unknown as { model: string; input: number; output: number }[]
      return rows.map((r) => ({ model: r.model, input: Number(r.input), output: Number(r.output) }))
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

/** 计算某租户本月费用（按模型 × 单价，云平台纯计算）。 */
export function computeTenantMonthCost(
  gatewayDir: string | null,
  cfg?: BillingConfig,
): number {
  const c = cfg ?? readBillingConfig()
  let total = 0
  for (const m of readTenantMonthUsageByModel(gatewayDir)) {
    total += computeModelCost(m.model, m.input, m.output, c)
  }
  return Math.round(total * 1e6) / 1e6
}

/** 某租户本月已用 token 总数（读 pico_usage，云平台只读数据源）。 */
export function readTenantMonthTokens(gatewayDir: string | null): number {
  let total = 0
  for (const m of readTenantMonthUsageByModel(gatewayDir)) {
    total += m.input + m.output
  }
  return total
}

/**
 * 对某租户按本月用量扣一笔账（kind=charge）。费用为 0 时跳过。
 * 返回扣掉的金额（负数）或 0。
 */
export function chargeTenantForMonth(
  tenantId: string,
  gatewayDir: string | null,
  cfg?: BillingConfig,
): number {
  const c = cfg ?? readBillingConfig()
  const usage = readTenantMonthUsageByModel(gatewayDir)
  if (usage.length === 0) return 0
  let cost = 0
  for (const m of usage) {
    const cst = computeModelCost(m.model, m.input, m.output, c)
    if (cst > 0) {
      postLedger(tenantId, "charge", -cst, {
        model: m.model,
        inputTokens: m.input,
        outputTokens: m.output,
        note: "本月模型用量",
      })
      cost += cst
    }
  }
  return Math.round(cost * 1e6) / 1e6
}
