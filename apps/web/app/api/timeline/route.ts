import { NextResponse } from "next/server";
import { backfillLegacySessionsIfNeeded } from "@/lib/timeline-backfill";
import {
  getActiveEngineSession,
  getTimelineTitle,
  listTimelineMessages,
  searchTimelineMessages,
  statsTimeline,
} from "@/lib/timeline-db";

export const dynamic = "force-dynamic";

// GET /api/timeline?before=<cursor>&limit=<n>
// GET /api/timeline?q=<query>
export async function GET(req: Request) {
  try {
    backfillLegacySessionsIfNeeded();
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (query) {
      const results = searchTimelineMessages(query);
      return NextResponse.json(
        { results, count: results.length },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const beforeRaw = url.searchParams.get("before");
    const beforeId = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : undefined;

    const { messages, hasMore } = listTimelineMessages({ beforeId, limit });
    return NextResponse.json(
      {
        messages,
        hasMore,
        title: getTimelineTitle(),
        activeSessionId: getActiveEngineSession(),
        stats: statsTimeline(),
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