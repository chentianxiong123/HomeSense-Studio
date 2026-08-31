import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, signToken } from "@/lib/auth-token"
import {
  findUserByUsername,
  getUserView,
  listTenants,
  touchUserLastSeen,
  verifyPassword,
} from "@/lib/tenant-store"

export const dynamic = "force-dynamic"

function badRequest(message: string) {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 })
}

function unauthorized(message = "用户名或密码错误") {
  return NextResponse.json({ error: "unauthorized", message }, { status: 401 })
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
  if (!username || !password) return badRequest("用户名和密码必填")

  const idx = findUserByUsername(username)
  if (!idx) return unauthorized()
  if (!verifyPassword(password, idx.passwordSalt, idx.passwordHash)) {
    return unauthorized()
  }
  const view = getUserView(idx.tenantId, idx.userId)
  if (!view) return unauthorized()

  const token = signToken({ sub: view.userId, tid: view.tenantId, uname: view.username })
  const c = await cookies()
  c.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  })
  touchUserLastSeen(view.tenantId, view.userId)

  const tenant = listTenants().find((t) => t.id === view.tenantId)
  return NextResponse.json({ ok: true, user: view, tenant, token })
}
