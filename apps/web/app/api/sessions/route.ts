import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  return NextResponse.json({
    sessions: [],
    runningSessionIds: [],
    completionNotificationSuppressedSessionIds: [],
  });
}