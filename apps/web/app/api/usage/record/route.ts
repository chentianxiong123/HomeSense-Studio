import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { readTenantMonthTokens } from "@/lib/billing";
import { recordUsage } from "@/lib/billing";

export const dynamic = "force-dynamic";

// 用量上报：前端收齐助手消息（响应自带 usage payload）后调这里，写入 PG 平台库。
// body: { model, input_tokens, output_tokens, session_id?, task? }
export async function POST(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    model?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
    session_id?: unknown;
    task?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "body 必须是 JSON" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  const inputTokens = Number(body.input_tokens);
  const outputTokens = Number(body.output_tokens);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return NextResponse.json({ error: "bad_request", message: "input/output_tokens 必须为数字" }, { status: 400 });
  }
  if ((inputTokens <= 0 && outputTokens <= 0) && !model) {
    return NextResponse.json({ error: "bad_request", message: "无可用用量" }, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const task = typeof body.task === "string" ? body.task : "";

  try {
    const result = await recordUsage(
      auth.tenantId,
      sessionId,
      model || "unknown",
      inputTokens,
      outputTokens,
      task,
    );
    const monthly = await readTenantMonthTokens(auth.tenantId);
    return NextResponse.json({
      success: true,
      monthly_used_tokens: monthly,
      cost_usd: result.costUsd,
      balance_after_usd: result.balanceAfterUsd,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "usage_record_failed", message: String(e) },
      { status: 500 },
    );
  }
}