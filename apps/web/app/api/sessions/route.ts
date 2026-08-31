import { NextResponse } from "next/server";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await resolveAuthFromRequest();
    if (!auth) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force, tenantId: auth.tenantId }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions);
    return NextResponse.json(
      {
        sessions,
        runningSessionIds: getRunningRpcSessionIds(),
        completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
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
