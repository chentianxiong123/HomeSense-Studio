import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import {
  ensureWallet,
  getBalance,
  listLedger,
  postLedger,
  readBillingConfig,
  monthlyQuotaFor,
  readTenantMonthTokens,
  computeTenantMonthCost,
} from "@/lib/billing";
import { getTenant } from "@/lib/tenant-store";

export const dynamic = "force-dynamic";

// 钱包：登录用户查自己租户的余额/本月用量/流水；admin 可传 ?tenant= 查任意租户、可充值/调整。
export async function GET(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let targetTenant = auth.tenantId;
  if (auth.role === "admin") {
    const url = new URL(req.url);
    const q = url.searchParams.get("tenant")?.trim();
    if (q) targetTenant = q;
  }

  const tenant = getTenant(targetTenant);
  const gatewayDir = tenant?.gatewayDir ?? null;
  ensureWallet(targetTenant);

  const cfg = readBillingConfig();
  const monthlyUsedTokens = readTenantMonthTokens(gatewayDir);
  const monthlyCostUsd = computeTenantMonthCost(gatewayDir, cfg);

  return NextResponse.json({
    tenantId: targetTenant,
    name: tenant?.name ?? targetTenant,
    balance_usd: getBalance(targetTenant),
    monthly_quota: monthlyQuotaFor(targetTenant, cfg),
    monthly_used_tokens: monthlyUsedTokens,
    monthly_cost_usd: monthlyCostUsd,
    recent_ledger: listLedger(targetTenant, 30),
  });
}

// 充值/调整：仅 admin。body: { tenantId, amount, kind?, note? }
export async function POST(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能充值/调整钱包" },
      { status: 403 },
    );
  }

  let body: { tenantId?: unknown; amount?: unknown; kind?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request", message: "body 必须是 JSON" }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) {
    return NextResponse.json({ error: "bad_request", message: "tenantId 必填" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "bad_request", message: "amount 必须是非零数字" }, { status: 400 });
  }
  const kindRaw = typeof body.kind === "string" ? body.kind : "";
  const kind = kindRaw === "adjust" || kindRaw === "grant" ? kindRaw : "topup";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  const { balanceAfter } = postLedger(tenantId, kind, amount, { note: note ?? undefined });
  return NextResponse.json({ success: true, tenantId, amount, balance_usd: balanceAfter });
}
