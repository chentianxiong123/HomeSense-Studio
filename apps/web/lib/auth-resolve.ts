// HomeSense v3 — 鉴权相关共享工具
//
// 解析请求里的 token(Authorization: Bearer ... 或 hs_token cookie),
// 不直接注入 ctx(proxy.ts 才是注入入口,这里只解析 + 校验)。
// 真正注入 ctx 见 lib/tenant-context.ts 的 runWithTenant。

import { cookies, headers } from "next/headers"
import { verifyToken, AUTH_COOKIE_NAME, type TokenPayload } from "./auth-token"
import { findUserByUsername, getUserView } from "./tenant-store"

export interface ResolvedAuth {
  payload: TokenPayload
  userId: string
  tenantId: string
  username: string
  displayName: string
  role: string
}

export async function resolveAuthFromRequest(): Promise<ResolvedAuth | null> {
  let token: string | null = null

  // 1. Authorization: Bearer ...
  const h = await headers()
  const auth = h.get("authorization")
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth)
    if (m) token = m[1]
  }

  // 2. hs_token cookie
  if (!token) {
    const c = await cookies()
    token = c.get(AUTH_COOKIE_NAME)?.value ?? null
  }

  if (!token) return null

  const result = verifyToken(token)
  if (!result.ok) return null
  const { sub: userId, tid: tenantId, uname: username } = result.payload

  // 双重确认 username → tenant_id 仍指向同一个 user_id(防止 token 与索引库不一致)
  const idx = findUserByUsername(username)
  if (!idx || idx.userId !== userId || idx.tenantId !== tenantId) return null

  const view = getUserView(tenantId, userId)
  if (!view) return null

  return {
    payload: result.payload,
    userId,
    tenantId,
    username,
    displayName: view.displayName,
    role: view.role,
  }
}
