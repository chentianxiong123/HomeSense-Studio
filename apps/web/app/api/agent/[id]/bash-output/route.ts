import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  void id;
  return NextResponse.json({ ok: true, data: [], total: 0 });
}