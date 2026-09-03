import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  return NextResponse.json({ ok: true, data: [], total: 0 });
}

export async function POST(_req: Request) {
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}