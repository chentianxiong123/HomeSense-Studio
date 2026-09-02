import { NextResponse } from "next/server";

export async function POST(_req: Request) {
  return NextResponse.json(
    { error: "not_implemented", message: "该功能已迁移至 Go 后端" },
    { status: 501 },
  );
}