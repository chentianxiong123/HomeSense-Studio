/**
 * Dashboard auth API (multi-tenant, scrypt + JWT).
 * Uses plain fetch (not launcherFetch) to avoid redirect loops on auth pages.
 */

export type AuthResult =
  | {
      ok: true
      user: { userId: string; tenantId: string; username: string; displayName: string; role: string }
      tenant?: { id: string; name: string; createdAt: string }
    }
  | { ok: false; status: number; error: string }

export type RegisterResult =
  | {
      ok: true
      user: { userId: string; tenantId: string; username: string; displayName: string; role: string }
      tenant: { id: string; name: string; createdAt: string }
    }
  | { ok: false; status: number; error: string }

export interface AuthStatus {
  available: boolean
  initialized: boolean
  authenticated: boolean
  tenantCount: number
}

export interface AuthMe {
  authenticated: boolean
  available: boolean
  user?: { userId: string; tenantId: string; username: string; displayName: string; role: string }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { credentials: "same-origin" })
  if (!res.ok) return { available: false, initialized: false, authenticated: false, tenantCount: 0 }
  return (await res.json()) as AuthStatus
}

export async function getAuthMe(): Promise<AuthMe> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" })
  if (!res.ok) return { authenticated: false, available: false }
  return (await res.json()) as AuthMe
}

export async function postLogin(username: string, password: string): Promise<AuthResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username: username.trim(), password }),
  })
  if (res.ok) {
    const body = (await res.json()) as { user: AuthResult extends { ok: true; user: infer U } ? U : never; tenant?: AuthResult extends { ok: true; tenant?: infer T } ? T : never }
    return { ok: true, user: body.user, ...(body.tenant ? { tenant: body.tenant } : {}) }
  }
  return { ok: false, status: res.status, error: await readError(res) }
}

export async function postRegister(
  username: string,
  password: string,
  tenantName?: string,
  displayName?: string,
): Promise<RegisterResult> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      username: username.trim(),
      password,
      ...(tenantName ? { tenantName: tenantName.trim() } : {}),
      ...(displayName ? { displayName: displayName.trim() } : {}),
    }),
  })
  if (res.ok) {
    const body = (await res.json()) as {
      user: { userId: string; tenantId: string; username: string; displayName: string; role: string }
      tenant: { id: string; name: string; createdAt: string }
    }
    return { ok: true, user: body.user, tenant: body.tenant }
  }
  return { ok: false, status: res.status, error: await readError(res) }
}

export async function postLogout(): Promise<boolean> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  })
  return res.ok
}

// 兼容旧名称(launcher-auth 已有调用方),保留别名以免破坏其他模块
export const getLauncherAuthStatus = getAuthStatus
export const postLauncherDashboardLogin = async (password: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  // 旧调用只传 password,假定用户名为"owner",已不适用。返回明确错误。
  void password
  return { ok: false, status: 410, error: "launcher-auth legacy flow removed; use postLogin(username,password)" }
}
export const postLauncherDashboardLogout = postLogout
export const postLauncherDashboardSetup = async (
  password: string,
  confirm: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  void password
  void confirm
  return { ok: false, error: "setup flow removed; use postRegister" }
}

async function readError(res: Response): Promise<string> {
  let msg = `Request failed with status ${res.status}`
  try {
    const j = (await res.json()) as { error?: string; message?: string }
    if (j.error) msg = j.message ? `${j.error}: ${j.message}` : j.error
  } catch {
    /* ignore */
  }
  return msg
}
