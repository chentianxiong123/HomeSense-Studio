import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, signToken } from "@/lib/auth-token"
import { createTenant } from "@/lib/tenant-store"

export const dynamic = "force-dynamic"

function badRequest(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const username = typeof body.username === "string" ? body.username.trim() : ""
  const password = typeof body.password === "string" ? body.password : ""
  const tenantName = typeof body.tenantName === "string" ? body.tenantName.trim() : ""
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : ""

  if (!username || username.length < 2) return badRequest("用户名至少 2 个字符")
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    return badRequest("用户名只能包含字母、数字、点、下划线、连字符")
  }
  if (!password || password.length < 6) return badRequest("密码至少 6 个字符")

  try {
    const { tenant, user } = createTenant({
      name: tenantName || `${username} 的家`,
      ownerUsername: username,
      password,
      ...(displayName ? { displayName } : {}),
    })
    const token = signToken({ sub: user.userId, tid: user.tenantId, uname: user.username })
    const c = await cookies()
    c.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE,
    })
    return NextResponse.json({ ok: true, tenant, user, token })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes("已存在") ? 409 : 500
    return NextResponse.json({ error: "register_failed", message }, { status })
  }
}
