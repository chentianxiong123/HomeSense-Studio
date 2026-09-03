import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  void provider;
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}