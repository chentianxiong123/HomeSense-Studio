import { NextResponse } from "next/server";
import { stat } from "fs/promises";
import { resolve } from "path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadModelsWithCache } from "@/lib/models-cache";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { resolveTenantAgentDir } from "@/lib/tenant-paths";
import { loadModels } from "@/lib/models-lib";

export const dynamic = "force-dynamic";

// PUT /api/models/default-chain  body: { default_model: string; fallback_chain?: string[] }
// 设置当前用户的默认模型(按租户写入 per-tenant settings.json)。
// 回退链不再使用(需求已删),body 里带 fallback_chain 只接收、忽略。
export async function PUT(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenantId = auth.tenantId;

  let body: { default_model?: unknown; fallback_chain?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "invalid JSON" }, { status: 400 });
  }
  const defaultModelName = typeof body.default_model === "string" ? body.default_model.trim() : "";

  const cwd = process.cwd();
  try {
    const data = await loadModelsWithCache(cwd, () => loadModels(cwd, tenantId));
    const target = data.modelList.find(
      (m) => (m.name || m.id) === defaultModelName,
    );
    if (!target) {
      return NextResponse.json(
        { error: "not_found", message: `模型不存在: ${defaultModelName}` },
        { status: 404 },
      );
    }
    const settingsManager = SettingsManager.create(cwd, resolveTenantAgentDir(tenantId));
    settingsManager.setDefaultModelAndProvider(target.provider, target.id);
    await settingsManager.flush();

    return NextResponse.json({
      default_model: target.name || target.id,
      fallback_chain: [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "internal", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
