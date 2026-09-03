import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { ModelNotFoundError, setTenantDefaultModel } from "@/lib/models-default";

export const dynamic = "force-dynamic";

// PUT /api/models/default-chain  body: { default_model: string; fallback_chain?: string[] }
// models 页设置默认模型。与 /api/models/default 共用同一实现:
// 写 per-tenant settings.json + 热切换运行中的 session。
// 回退链不再使用(需求已删),body 里带 fallback_chain 只接收、忽略。
export async function PUT(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { default_model?: unknown; fallback_chain?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "invalid JSON" }, { status: 400 });
  }
  const defaultModelName =
    typeof body.default_model === "string" ? body.default_model.trim() : "";

  try {
    const result = await setTenantDefaultModel(auth.tenantId, defaultModelName);
    return NextResponse.json({
      default_model: result.default_model,
      fallback_chain: [],
    });
  } catch (error) {
    if (error instanceof ModelNotFoundError) {
      return NextResponse.json({ error: "not_found", message: error.message }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "internal",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}