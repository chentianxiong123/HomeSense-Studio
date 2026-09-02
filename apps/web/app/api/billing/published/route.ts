// 用户侧：拉取管理员已「公布」的模型目录。
// 任何已登录用户都能看（无 admin 限制），只返回 enabled=true 的模型。
// 这是聊天选择器的权威数据源：用户只能用管理员公布的模型。
//
// admin 侧：PUT 写 published_models（管理员在「模型目录」tab 保存时用）。

import { NextResponse } from "next/server"

import {
  listPublishedForUser,
  writePublishedModels,
  type PublishedModels,
} from "@/lib/billing"
import { resolveAuthFromRequest } from "@/lib/auth-resolve"

export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await resolveAuthFromRequest()
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const models = await listPublishedForUser()
    return NextResponse.json({ models })
  } catch (e) {
    return NextResponse.json(
      { error: "billing_published_read_failed", message: String(e) },
      { status: 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await resolveAuthFromRequest()
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能修改模型目录" },
      { status: 403 },
    )
  }

  let body: { published_models?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "bad_request", message: "body 必须是 JSON" }, { status: 400 })
  }
  if (typeof body.published_models !== "object" || body.published_models === null) {
    return NextResponse.json(
      { error: "bad_request", message: "published_models 必须是对象" },
      { status: 400 },
    )
  }

  const next: PublishedModels = {}
  for (const [model, src] of Object.entries(body.published_models as Record<string, unknown>)) {
    if (typeof src !== "object" || src === null) continue
    const s = src as Record<string, unknown>
    next[String(model)] = {
      enabled: Boolean(s.enabled),
      display_name: String(s.display_name ?? model),
      input_price: Number(s.input_price) || 0,
      output_price: Number(s.output_price) || 0,
      description: typeof s.description === "string" ? s.description : "",
    }
  }

  try {
    await writePublishedModels(next)
    const enabled_count = Object.values(next).filter((p) => p.enabled).length
    return NextResponse.json({
      ok: true,
      enabled_count,
      total_count: Object.keys(next).length,
    })
  } catch (e) {
    return NextResponse.json(
      { error: "billing_published_write_failed", message: String(e) },
      { status: 500 },
    )
  }
}
