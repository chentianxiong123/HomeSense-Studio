import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { provider } = await params;
  void provider;
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}

export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  void provider;
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}