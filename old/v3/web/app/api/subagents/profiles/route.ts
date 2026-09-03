import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  return NextResponse.json({ profiles: [] });
}

export async function PUT(_req: Request) {
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}

export async function PATCH(_req: Request) {
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}

export async function DELETE(_req: Request) {
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}