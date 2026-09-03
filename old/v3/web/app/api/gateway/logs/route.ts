import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "running",
    pid: process.pid,
    logs: [],
    log_total: 0,
  });
}