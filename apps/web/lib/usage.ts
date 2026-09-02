// HomeSense v5 — 用量/计费控制面聚合。
//
// 架构铁律：平台数据（token 用量/费用）统一存 PostgreSQL；
// 用户数据（聊天历史）留 per-tenant SQLite。费用 = PG pico_usage token × 单价（纯 Node）。
// 只读、fail-open：任一段失败仅影响该租户展示。

import { computeModelCost, readBillingConfig, readUsageByModel, monthStartISO } from "@/lib/billing"
import { listTenants } from "@/lib/tenant-store"

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

/** 读单个租户的 PG pico_usage 并聚合（本月）。fail-open：异常返回 available=false。 */
export async function readTenantUsage(
  tenantId: string,
  name: string,
  gatewayDir: string | null,
): Promise<TenantUsage> {
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
  try {
    const byModel = await readUsageByModel(tenantId, monthStartISO())
    const cfg = await readBillingConfig()
    base.by_model = byModel.map((r) => ({
      model: r.model,
      requests: r.requests,
      input_tokens: r.input,
      output_tokens: r.output,
      total_tokens: r.input + r.output,
      // 费用由云平台按单价计算（架构铁律：agent 不算钱）
      estimated_cost_usd: Math.round(computeModelCost(r.model, r.input, r.output, cfg) * 1e6) / 1e6,
    }))
    for (const m of base.by_model) {
      base.requests += m.requests
      base.input_tokens += m.input_tokens
      base.output_tokens += m.output_tokens
      base.total_tokens += m.total_tokens
      base.estimated_cost_usd += m.estimated_cost_usd
    }
    base.available = true
  } catch {
    return base
  }
  return base
}

/** 聚合所有租户的本月用量。只读、fail-open。 */
export async function readAllTenantUsage(): Promise<UsageSnapshot> {
  const tenants = listTenants()
  const usage = await Promise.all(
    tenants.map((t) => readTenantUsage(t.id, t.name, t.gatewayDir)),
  )
  const snapshot: UsageSnapshot = { tenants: usage, total_tokens: 0, total_estimated_cost_usd: 0 }
  for (const u of usage) {
    snapshot.total_tokens += u.total_tokens
    snapshot.total_estimated_cost_usd += u.estimated_cost_usd
  }
  return snapshot
}