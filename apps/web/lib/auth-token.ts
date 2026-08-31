// HomeSense v3 — 会话令牌 (HS256 JWT, node:crypto, 零外部依赖)
//
// 用途: 浏览器 cookie 存 token,proxy.ts 解析 → 注入 TenantContext → 所有 API 用 ctx 路由到对应租户库。
// 私钥: 进程启动时随机生成(每次重启会失效,生产环境应改成持久 secret,见 Phase 1.1 后补)。
// 寿命: 默认 30 天,支持 refresh(本版本先不实现)。

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const TOKEN_VERSION = "v1"

const secret = process.env.HOMESENSE_JWT_SECRET || randomBytes(32).toString("base64url")
if (!process.env.HOMESENSE_JWT_SECRET && process.env.NODE_ENV === "production") {
  console.warn("[auth] HOMESENSE_JWT_SECRET 未设置,使用进程内随机密钥(重启后旧 token 失效)")
}

export interface TokenPayload {
  v: typeof TOKEN_VERSION
  sub: string       // userId
  tid: string       // tenantId
  uname: string     // username (便利字段,避免查库)
  iat: number       // issued at (unix seconds)
  exp: number       // expires at (unix seconds)
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, "base64url")
}

export function signToken(payload: Omit<TokenPayload, "v" | "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: TokenPayload = {
    v: TOKEN_VERSION,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    ...payload,
  }
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(JSON.stringify(fullPayload))
  const data = `${header}.${body}`
  const sig = base64url(createHmac("sha256", secret).update(data).digest())
  return `${data}.${sig}`
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_version" }

export function verifyToken(token: string): VerifyResult {
  const parts = token.split(".")
  if (parts.length !== 3) return { ok: false, reason: "malformed" }
  const [header, body, sig] = parts
  const data = `${header}.${body}`
  const expected = base64url(createHmac("sha256", secret).update(data).digest())
  const a = fromBase64url(sig)
  const b = fromBase64url(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" }
  }
  let payload: TokenPayload
  try {
    payload = JSON.parse(fromBase64url(body).toString("utf8")) as TokenPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }
  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: "wrong_version" }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" }
  }
  return { ok: true, payload }
}

export const AUTH_COOKIE_NAME = "hs_token"
export const AUTH_COOKIE_MAX_AGE = TOKEN_TTL_SECONDS
