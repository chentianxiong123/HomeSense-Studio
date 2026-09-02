import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  void id;
  void entryId;
  return NextResponse.json({ ok: true, data: [], total: 0 });
}