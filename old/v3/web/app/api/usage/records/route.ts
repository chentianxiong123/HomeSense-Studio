import { NextResponse } from "next/server"

import { resolveAuthFromRequest } from "@/lib/auth-resolve"
import {
  computeModelCost,
  monthStartISO,
  readBillingConfig,
  readUsageBySession,
} from "@/lib/billing"

export const dynamic = "force-dynamic"

// 用户账单：返回本租户本月按会话聚合的用量明细，每行含 tokens + 费用。
// 用户视角的"我的对话账本" — admin 仍用 /api/usage 拉多租户聚合。
export async function GET(req: Request) {
  const auth = await resolveAuthFromRequest()
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get("limit") ?? 50)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200)
  const since = url.searchParams.get("since") || monthStartISO()

  try {
    const [rows, cfg] = await Promise.all([
      readUsageBySession(auth.tenantId, since, limit),
      readBillingConfig(),
    ])
    const enriched = rows.map((r) => {
      // 单 session 跨多个模型时，把每个模型都算一次再相加
      const costUsd = r.models.reduce(
        (acc, m) => acc + computeModelCost(m, r.inputTokens, r.outputTokens, cfg) / Math.max(r.models.length, 1),
        0,
      )
      return {
        ...r,
        estimated_cost_usd: Math.round(costUsd * 1e6) / 1e6,
      }
    })
    const totalTokens = enriched.reduce((s, r) => s + r.totalTokens, 0)
    const totalCostUsd =
      Math.round(enriched.reduce((s, r) => s + r.estimated_cost_usd, 0) * 1e4) / 1e4
    return NextResponse.json({
      tenantId: auth.tenantId,
      since,
      sessions: enriched,
      total_sessions: enriched.length,
      total_tokens: totalTokens,
      total_estimated_cost_usd: totalCostUsd,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "usage_records_failed", message: String(e) },
      { status: 500 },
    )
  }
}
