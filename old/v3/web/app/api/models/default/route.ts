import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { ModelNotFoundError, setTenantDefaultModel } from "@/lib/models-default";

export const dynamic = "force-dynamic";

// POST /api/models/default  body: { model_name: string }
// 首页对话页模型下拉框调用。与 /api/models/default-chain 共用同一实现:
// 写 per-tenant settings.json + 热切换运行中的 session(超时 5s 内生效)。
export async function POST(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { model_name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "invalid JSON" }, { status: 400 });
  }
  const modelName =
    typeof body.model_name === "string" ? body.model_name.trim() : "";
  if (!modelName) {
    return NextResponse.json(
      { error: "bad_request", message: "model_name 不能为空" },
      { status: 400 },
    );
  }

  try {
    const result = await setTenantDefaultModel(auth.tenantId, modelName);
    return NextResponse.json({
      status: "ok",
      index: -1,
      default_model: result.default_model,
      provider: result.provider,
      hot_switched: result.hotSwitched,
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