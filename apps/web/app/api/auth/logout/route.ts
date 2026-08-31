import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { AUTH_COOKIE_NAME } from "@/lib/auth-token"

export const dynamic = "force-dynamic"

export async function POST() {
  const c = await cookies()
  c.delete(AUTH_COOKIE_NAME)
  return NextResponse.json({ ok: true })
}
