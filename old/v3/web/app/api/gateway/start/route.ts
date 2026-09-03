import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Handler = () => NextResponse;

function action(handler: Handler) {
  return async function POST() {
    return handler();
  };
}

export const POST = action(() => NextResponse.json({ status: "running", pid: process.pid }));