/**
 * Dashboard launcher auth API.
 * Uses plain fetch (not launcherFetch) to avoid redirect loops on auth pages.
 */
export type LoginResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export async function postLauncherDashboardLogin(
  password: string,
): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password: password.trim() }),
  })
  if (res.ok) return { ok: true }

  return {
    ok: false,
    status: res.status,
    error: await readLauncherAuthError(res),
  }
}

export type LauncherAuthStatus = {
  authenticated: boolean
  /** true when a bcrypt password has been stored in the DB */
  initialized: boolean
  /**
   * false when the launcher auth endpoints are not implemented (Next.js has
   * no /api/auth/status etc.), so the UI must not redirect to login/setup.
   */
  available: boolean
}

export async function getLauncherAuthStatus(): Promise<LauncherAuthStatus> {
  const res = await fetch("/api/auth/status", {
    method: "GET",
    credentials: "same-origin",
  })
  // Launcher auth endpoints are not implemented in this Next.js app. They
  // return an HTML 404 page, so res.json() would throw "Unexpected token '<'".
  // Treat that as "auth unavailable" instead of an error the UI must show.
  const contentType = res.headers.get("content-type") ?? ""
  if (!res.ok || !contentType.includes("application/json")) {
    return { authenticated: false, initialized: false, available: false }
  }
  const body = (await res.json()) as Partial<LauncherAuthStatus>
  return {
    authenticated: Boolean(body.authenticated),
    initialized: Boolean(body.initialized),
    available: true,
  }
}

export async function postLauncherDashboardLogout(): Promise<boolean> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  })
  return res.ok
}

export type SetupResult = { ok: true } | { ok: false; error: string }

export async function postLauncherDashboardSetup(
  password: string,
  confirm: string,
): Promise<SetupResult> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      password: password.trim(),
      confirm: confirm.trim(),
    }),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await readLauncherAuthError(res) }
}

async function readLauncherAuthError(res: Response): Promise<string> {
  let msg = `Request failed with status ${res.status}`
  try {
    const j = (await res.json()) as { error?: string }
    if (j.error) msg = j.error
  } catch {
    /* ignore */
  }
  return msg
}
