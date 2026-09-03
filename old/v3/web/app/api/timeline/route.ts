import { NextResponse } from "next/server";
import { backfillLegacySessionsIfNeeded } from "@/lib/timeline-backfill";
import {
  getActiveEngineSession,
  getTimelineTitle,
  listTimelineMessages,
  searchTimelineMessages,
  statsTimeline,
} from "@/lib/timeline-db";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";

export const dynamic = "force-dynamic";

// GET /api/timeline?before=<cursor>&limit=<n>
// GET /api/timeline?q=<query>
//
// Phase 1.2: 强制 token,走调用方 ctx.tenantId 路由到 per-tenant db。
// 无 token → 401(由 proxy.ts 拦截;此函数仍防御性检查)。
export async function GET(req: Request) {
  try {
    const auth = await resolveAuthFromRequest();
    if (!auth) {
      return NextResponse.json(
        { error: "unauthenticated", message: "需要登录" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const tenantId = auth.tenantId;

    backfillLegacySessionsIfNeeded(tenantId);
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (query) {
      const results = searchTimelineMessages(tenantId, query);
      return NextResponse.json(
        { results, count: results.length },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const beforeRaw = url.searchParams.get("before");
    const beforeId = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;

    const { messages, hasMore } = listTimelineMessages(tenantId, { beforeId, limit });
    return NextResponse.json(
      {
        messages,
        hasMore,
        title: getTimelineTitle(tenantId),
        activeSessionId: getActiveEngineSession(tenantId),
        stats: statsTimeline(tenantId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
