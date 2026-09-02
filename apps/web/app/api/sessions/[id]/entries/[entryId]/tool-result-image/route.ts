import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  void id;
  void entryId;
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}