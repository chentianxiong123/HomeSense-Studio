import { NextResponse } from "next/server";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  void id;
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  void id;
  return NextResponse.json({ ok: true, data: [], total: 0 });
}