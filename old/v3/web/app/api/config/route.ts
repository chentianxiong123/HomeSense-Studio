import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// HomeSense v3 — 配置 API 空态占位(未来接 pi settings.json)。
export async function GET() {
  return NextResponse.json({ channels: {}, version: "0.1.0" });
}

export async function PATCH() {
  return NextResponse.json({ ok: true });
}