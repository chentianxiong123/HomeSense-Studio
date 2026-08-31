// HomeSense v3 — 鉴权相关共享工具
//
// 解析请求里的 token(Authorization: Bearer ... 或 hs_token cookie),
// 不直接注入 ctx(proxy.ts 才是注入入口,这里只解析 + 校验)。
// 真正注入 ctx 见 lib/tenant-context.ts 的 runWithTenant。

import type { NextRequest } from "next/server"
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

interface RequestLike {
  headers: { get(name: string): string | null }
  cookies: { get(name: string): { value: string } | undefined }
}

/**
 * 解析 token + 校验 + 查索引库。
 *
 * - 在 proxy.ts 上下文里:**必须**传 `request`(NextRequest)进来。
 *   原因:`next/headers` 的 cookies()/headers() 在 proxy/middleware 上下文
 *   里拿不到当前请求的 cookie/header,会返回空 → 永远 401。proxy 必须用
 *   `request.cookies.get()` / `request.headers.get()`。
 * - 在 server component / route handler 上下文里:不传 `request`,内部用
 *   `next/headers` 自动绑到当前请求。
 */
export async function resolveAuthFromRequest(
  request?: NextRequest | RequestLike,
): Promise<ResolvedAuth | null> {
  let token: string | null = null

  if (request) {
    // proxy.ts 路径:直接从 NextRequest 读
    const h = request.headers.get("authorization")
    if (h) {
      const m = /^Bearer\s+(\S+)$/i.exec(h)
      if (m) token = m[1]
    }
    if (!token) {
      token = request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null
    }
  } else {
    // server component / route handler 路径:用 next/headers
    const h = await headers()
    const auth = h.get("authorization")
    if (auth) {
      const m = /^Bearer\s+(\S+)$/i.exec(auth)
      if (m) token = m[1]
    }
    if (!token) {
      const c = await cookies()
      token = c.get(AUTH_COOKIE_NAME)?.value ?? null
    }
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
