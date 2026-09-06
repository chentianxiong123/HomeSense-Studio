/**
 * HomeSense v6 account auth.
 *
 * Login proxies through the v6 control plane (/api/auth/login), which
 * authenticates against new-api and returns a v6 session token. The token is
 * stored in localStorage and attached to WebSocket and API requests.
 */

const V6_TOKEN_KEY = "homesense:v6-token"

export type V6LoginResult =
  | {
      ok: true
      token: string
      userId: string
      username: string
      model: string
    }
  | { ok: false; status: number; error: string }

export type V6LoginResponse = {
  token: string
  user_id: string
  username: string
  model: string
}

export async function v6Login(
  username: string,
  password: string,
): Promise<V6LoginResult> {
  let res: Response
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: username.trim(), password }),
    })
  } catch {
    return { ok: false, status: 0, error: "network error" }
  }

  if (res.ok) {
    const data = (await res.json()) as V6LoginResponse
    if (data.token) {
      setV6Token(data.token)
      return {
        ok: true,
        token: data.token,
        userId: data.user_id,
        username: data.username,
        model: data.model,
      }
    }
  }

  return {
    ok: false,
    status: res.status,
    error: await readV6AuthError(res),
  }
}

/** Register a new account through the control plane (proxies one-api) and log
 * the new user in, returning the same shape as v6Login. */
export async function v6Register(
  username: string,
  password: string,
): Promise<V6LoginResult> {
  let res: Response
  try {
    res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: username.trim(), password }),
    })
  } catch {
    return { ok: false, status: 0, error: "network error" }
  }

  if (res.ok) {
    const data = (await res.json()) as V6LoginResponse
    if (data.token) {
      setV6Token(data.token)
      return {
        ok: true,
        token: data.token,
        userId: data.user_id,
        username: data.username,
        model: data.model,
      }
    }
  }

  return {
    ok: false,
    status: res.status,
    error: await readV6AuthError(res),
  }
}

export function setV6Token(token: string) {
  globalThis.localStorage?.setItem(V6_TOKEN_KEY, token)
}

export function getV6Token(): string {
  return globalThis.localStorage?.getItem(V6_TOKEN_KEY)?.trim() || ""
}

export function clearV6Token() {
  globalThis.localStorage?.removeItem(V6_TOKEN_KEY)
}

export async function v6Logout(): Promise<void> {
  const token = getV6Token()
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(token),
      },
      credentials: "same-origin",
      body: "{}",
    })
  } catch {
    /* ignore network errors on logout */
  }
  clearV6Token()
}

export type V6AuthStatus = {
  authenticated: boolean
  userId: string
  username: string
}

export async function v6AuthStatus(): Promise<V6AuthStatus> {
  const token = getV6Token()
  if (!token) {
    return { authenticated: false, userId: "", username: "" }
  }
  const res = await fetch("/api/auth/status", {
    method: "GET",
    headers: { Authorization: authHeader(token) },
    credentials: "same-origin",
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearV6Token()
      return { authenticated: false, userId: "", username: "" }
    }
    throw new Error(`status ${res.status}`)
  }
  const data = (await res.json()) as { user_id?: string; username?: string }
  return {
    authenticated: true,
    userId: data.user_id || "",
    username: data.username || "",
  }
}

export function authHeader(token: string): string {
  return token ? `Bearer ${token}` : ""
}

async function readV6AuthError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string; message?: string }
    if (j.error) return j.error
    if (j.message) return j.message
  } catch {
    /* ignore */
  }
  return `Request failed with status ${res.status}`
}