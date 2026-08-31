import { NextResponse } from "next/server";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";

export const dynamic = "force-dynamic";

export async function GET() {
  // 模型配置任何登录用户都能读(看自己用啥)
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(readModelsConfig());
}

export async function PUT(req: Request) {
  // 修改模型配置:必须 admin(全员生效,敏感操作)
  const auth = await resolveAuthFromRequest();
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden", message: "只有管理员能修改模型配置" },
      { status: 403 },
    );
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    writeModelsConfig(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "bad_request", message: String(error) },
      { status: 400 },
    );
  }
}
