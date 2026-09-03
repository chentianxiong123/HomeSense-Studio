import { NextResponse } from "next/server"

import { resolveAuthFromRequest } from "@/lib/auth-resolve"
import { listLedger } from "@/lib/billing"

export const dynamic = "force-dynamic"

// 用户钱包流水：分页拉本租户 ledger（充值/扣费/调整/grant 四种 kind）
export async function GET(req: Request) {
  const auth = await resolveAuthFromRequest()
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get("limit") ?? 100)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500)
  const kind = url.searchParams.get("kind")?.trim() || null

  try {
    let rows = await listLedger(auth.tenantId, limit)
    if (kind && (kind === "topup" || kind === "charge" || kind === "adjust" || kind === "grant")) {
      rows = rows.filter((r) => r.kind === kind)
    }
    const totalIn = rows.filter((r) => r.amountUsd > 0).reduce((s, r) => s + r.amountUsd, 0)
    const totalOut = rows.filter((r) => r.amountUsd < 0).reduce((s, r) => s + r.amountUsd, 0)
    return NextResponse.json({
      tenantId: auth.tenantId,
      kind: kind ?? "all",
      entries: rows,
      count: rows.length,
      total_in_usd: Math.round(totalIn * 1e4) / 1e4,
      total_out_usd: Math.round(totalOut * 1e4) / 1e4,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "ledger_query_failed", message: String(e) },
      { status: 500 },
    )
  }
}
