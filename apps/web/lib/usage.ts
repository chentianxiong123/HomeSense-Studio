// HomeSense v5 — 用量/计费控制面聚合。
//
// 计量在每租户 Go 网关（pico_usage 累积表，按 session+model+task 累计），
// 记账是数据面的事；这里读各租户的 pico-history.db 把账算出来给 admin 看：
//   - 每租户本月总用量（token + 请求数）
//   - 按模型明细
//   - 模型单价（写回 estimated_cost_usd 做费用估算）
//
// 只读、fail-open：任一个租户库异常不影响其它租户展示。

import { DatabaseSync } from "node:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { listTenants } from "@/lib/tenant-store"

const BRAIN_DATA_DIR = process.env.HS_BRAIN_DATA ?? "/home/a1/HomeSense-Studio-v3/.hs-brain"

export interface UsagePerModel {
  model: string
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost_usd: number
}

export interface TenantUsage {
  tenantId: string
  name: string
  gatewayDir: string | null
  available: boolean
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost_usd: number
  by_model: UsagePerModel[]
}

export interface UsageSnapshot {
  tenants: TenantUsage[]
  total_tokens: number
  total_estimated_cost_usd: number
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从租户 config.json 读 pico db_path；缺省推导为 DATA_DIR/<dir>/pico-history.db。 */
function picoDbPath(gatewayDir: string): string {
  const cfg = readJson(join(BRAIN_DATA_DIR, gatewayDir, "config.json"))
  const ch = cfg?.channel_list as Record<string, { settings?: { db_path?: unknown } }> | undefined
  const dbPath = ch?.pico?.settings?.db_path
  if (typeof dbPath === "string" && dbPath.trim()) return dbPath.trim()
  return join(BRAIN_DATA_DIR, gatewayDir, "pico-history.db")
}

/** 本月起始的 UTC RFC3339Nano 字符串，与 Go 侧 MonthUsage 口径一致。 */
function monthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** 读单个租户的 pico_usage 并聚合（本月）。fail-open：异常返回 available=false。 */
export function readTenantUsage(tenantId: string, name: string, gatewayDir: string | null): TenantUsage {
  const base: TenantUsage = {
    tenantId,
    name,
    gatewayDir,
    available: false,
    requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    by_model: [],
  }
  if (!gatewayDir) return base
  const dbPath = picoDbPath(gatewayDir)
  if (!existsSync(dbPath)) return base
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const rows = db
        .prepare(
          `SELECT COALESCE(model,'') AS model,
                  COALESCE(SUM(requests),0) AS requests,
                  COALESCE(SUM(input_tokens),0) AS input_tokens,
                  COALESCE(SUM(output_tokens),0) AS output_tokens,
                  COALESCE(SUM(estimated_cost_usd),0) AS estimated_cost_usd
             FROM pico_usage
            WHERE last_seen >= ?
            GROUP BY model
            ORDER BY model`,
        )
        .all(monthStart()) as unknown as {
        model: string
        requests: number
        input_tokens: number
        output_tokens: number
        estimated_cost_usd: number
      }[]

      base.by_model = rows.map((r) => ({
        model: r.model,
        requests: Number(r.requests),
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
        total_tokens: Number(r.input_tokens) + Number(r.output_tokens),
        estimated_cost_usd: Number(r.estimated_cost_usd),
      }))
      for (const m of base.by_model) {
        base.requests += m.requests
        base.input_tokens += m.input_tokens
        base.output_tokens += m.output_tokens
        base.total_tokens += m.total_tokens
        base.estimated_cost_usd += m.estimated_cost_usd
      }
      base.available = true
    } finally {
      db.close()
    }
  } catch {
    return base
  }
  return base
}

/** 聚合所有租户的本月用量。只读、fail-open。 */
export function readAllTenantUsage(): UsageSnapshot {
  const tenants = listTenants()
  const usage = tenants.map((t) => readTenantUsage(t.id, t.name, t.gatewayDir))
  const snapshot: UsageSnapshot = { tenants: usage, total_tokens: 0, total_estimated_cost_usd: 0 }
  for (const u of usage) {
    snapshot.total_tokens += u.total_tokens
    snapshot.total_estimated_cost_usd += u.estimated_cost_usd
  }
  return snapshot
}