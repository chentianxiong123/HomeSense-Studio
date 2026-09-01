import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { ensureTenantBrain } from "@/lib/tenant-brain";

export const dynamic = "force-dynamic";

// 按需冷启动当前登录租户的云大脑 gateway。
// 进程空闲自动退出后，前端连 WS / 发消息前调用本接口重新拉起。
export async function POST() {
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const brain = await ensureTenantBrain(auth.tenantId);
    return NextResponse.json({ brain });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message ?? "ensure failed" },
      { status: 500 },
    );
  }
}
