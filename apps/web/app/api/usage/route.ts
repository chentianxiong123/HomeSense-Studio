import { NextResponse } from "next/server";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { readAllTenantUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

// 用量/计费账本:仅 admin 可见。读各租户 Go 网关的 pico_usage 累计表,只读、fail-open。
export async function GET() {
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能查看用量账本" },
      { status: 403 },
    );
  }
  // 有 SQLite 读权限才给完整账本;普通管理员降级只给汇总不至于报错
  try {
    return NextResponse.json(readAllTenantUsage());
  } catch (e) {
    return NextResponse.json(
      { error: "usage_aggregate_failed", message: String(e) },
      { status: 500 },
    );
  }
}