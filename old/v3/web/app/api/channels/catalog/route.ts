import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// HomeSense v3 — 通道(渠道)尚为空态:pi 引擎无 Discord/微信等通道。
// 返回空 catalog,侧边栏通道分组与通道页正常渲染但不显示任何项。
export async function GET() {
  return NextResponse.json({
    channels: [],
    supported_channels: [],
  });
}