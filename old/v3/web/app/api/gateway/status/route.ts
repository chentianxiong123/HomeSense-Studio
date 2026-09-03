import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Pi 引擎是常驻进程,"gateway" 概念映射为 always running,
// 以便 PicoClaw 聊天层的 connectChat/发送逻辑正常放行。
export async function GET() {
  return NextResponse.json({
    gateway_status: "running",
    gateway_start_allowed: false,
    gateway_restart_required: false,
    pid: process.pid,
  });
}