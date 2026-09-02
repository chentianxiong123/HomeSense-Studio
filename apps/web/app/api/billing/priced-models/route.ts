// 用户侧：拉取「管理员已公布 + 已配价」的模型列表。
// 任何已登录用户都能看（不限 admin），只返回 model_prices 里 enabled=true 的模型。
// 这是 chat 选择器的权威数据源：用户只能选这里列出的模型。
//
// 数据流：readModelsConfig() (真模型 = admin 在 /models 配的 provider 配置)
//       ∩ readBillingConfig().model_prices.enabled=true (admin 在 /admin 计费面板勾选 + 配价)

import { NextResponse } from "next/server"

import { readBillingConfig } from "@/lib/billing"
import { resolveAuthFromRequest } from "@/lib/auth-resolve"
import { readModelsConfig } from "@/lib/models-config-store"

export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await resolveAuthFromRequest()
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const modelsCfg = readModelsConfig()
    const bill = await readBillingConfig()
    const prices = bill.model_prices ?? {}

    const seen = new Set<string>()
    const out: { model_id: string; display_name: string; input_price: number; output_price: number }[] = []
    for (const provider of Object.values(modelsCfg.providers ?? {})) {
      for (const m of provider.models ?? []) {
        const id = String(m?.id ?? "").trim()
        if (!id || seen.has(id)) continue
        const p = prices[id]
        if (!p || p.enabled !== true) continue
        seen.add(id)
        out.push({
          model_id: id,
          display_name: String(m?.name ?? id),
          input_price: Number(p.input) || 0,
          output_price: Number(p.output) || 0,
        })
      }
    }
    out.sort((a, b) => a.display_name.localeCompare(b.display_name))
    return NextResponse.json({ models: out })
  } catch (e) {
    return NextResponse.json(
      { error: "priced_models_read_failed", message: String(e) },
      { status: 500 },
    )
  }
}
