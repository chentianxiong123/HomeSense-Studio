import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import {
  readBillingConfig,
  writeBillingConfig,
  type BillingConfig,
  type BillingPrices,
  type MonthlyQuota,
} from "@/lib/billing";
import { listTenants } from "@/lib/tenant-store";
import { readAllTenantUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

// 计费配置：模型单价 + 每租户月度配额。仅 admin。云平台唯一计费权威。
export async function GET() {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能查看/修改计费配置" },
      { status: 403 },
    );
  }
  try {
    const config = readBillingConfig();
    const usage = readAllTenantUsage(); // 费用已由 usage.ts 按单价计算
    const tenants = listTenants().map((t) => ({
      tenantId: t.id,
      name: t.name,
      gatewayDir: t.gatewayDir,
    }));
    return NextResponse.json({ config, tenants, usage });
  } catch (e) {
    return NextResponse.json(
      { error: "billing_read_failed", message: String(e) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能修改计费配置" },
      { status: 403 },
    );
  }

  let body: { model_prices?: unknown; monthly_quota?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "body 必须是 JSON" }, { status: 400 });
  }

  const next: BillingConfig = readBillingConfig();
  if (body.model_prices !== undefined) {
    if (typeof body.model_prices !== "object" || body.model_prices === null) {
      return NextResponse.json({ error: "bad_request", message: "model_prices 必须是对象" }, { status: 400 });
    }
    const prices: BillingPrices = {};
    for (const [model, src] of Object.entries(body.model_prices as Record<string, unknown>)) {
      if (typeof src !== "object" || src === null) continue;
      const s = src as Record<string, unknown>;
      prices[model] = {
        input: Number(s.input) || 0,
        output: Number(s.output) || 0,
      };
    }
    next.model_prices = prices;
  }
  if (body.monthly_quota !== undefined) {
    if (typeof body.monthly_quota !== "object" || body.monthly_quota === null) {
      return NextResponse.json({ error: "bad_request", message: "monthly_quota 必须是对象" }, { status: 400 });
    }
    const quota: MonthlyQuota = {};
    for (const [tenantId, src] of Object.entries(body.monthly_quota as Record<string, unknown>)) {
      const n = Number(src);
      quota[tenantId] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
    next.monthly_quota = quota;
  }

  try {
    writeBillingConfig(next);
    return NextResponse.json({ success: true, config: next });
  } catch (e) {
    return NextResponse.json(
      { error: "billing_write_failed", message: String(e) },
      { status: 500 },
    );
  }
}