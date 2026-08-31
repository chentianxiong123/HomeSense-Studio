import { createAgentEventStream } from "@/lib/agent-event-stream";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (req.signal.aborted) return new Response(null, { status: 204 });

  // Phase 1.3: resolve ctx → tenantId,确保 resolveSessionPath 走 per-tenant sessions dir。
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return new Response("unauthenticated", { status: 401 });
  }
  const tenantId = auth.tenantId;

  // Fast path: already-running session
  const session = getRpcSession(id);
  let sessionPromise;
  if (session?.isAlive()) {
    sessionPromise = Promise.resolve(session);
  } else {
    const filePath = await resolveSessionPath(id, tenantId);
    if (req.signal.aborted) return new Response(null, { status: 204 });
    // 没 filePath 也 OK:startRpcSession 会用 SessionManager.create(cwd, sessionDir, {id})
    // 强制用 caller 传过来的 sessionId(就是 tenants.active_session_id)。
    sessionPromise = startRpcSession(id, filePath ?? undefined, filePath ? undefined : process.cwd(), { tenantId }).then((result) => result.session);
  }

  const stream = createAgentEventStream(req, id, sessionPromise);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
