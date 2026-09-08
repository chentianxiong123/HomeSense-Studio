/**
 * HomeSense per-tenant config API.
 * Reads/writes the current user's own picoclaw config.json
 * (GET/PUT /api/v1/users/{id}/config) with the v6 Bearer token.
 */
import { authHeader, getV6Token } from "@/api/v6-auth"

export type TenantConfig = Record<string, unknown>

/** Resolve the current tenant id from the auth status endpoint. */
export async function getCurrentUserId(): Promise<string> {
  const token = getV6Token()
  if (!token) return ""
  const res = await fetch("/api/auth/status", {
    method: "GET",
    headers: { Authorization: authHeader(token) },
  })
  if (!res.ok) return ""
  const data = (await res.json()) as { user_id?: string }
  return data.user_id || ""
}

/** Fetch the tenant's own config.json (raw merged-surface object). */
export async function getUserConfig(): Promise<TenantConfig> {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error("not authenticated")
  return getUserConfigFor(userId)
}

/** Fetch a tenant's config.json by id (administrative). */
export async function getUserConfigFor(userId: string): Promise<TenantConfig> {
  const token = getV6Token()
  const res = await fetch(`/api/v1/users/${encodeURIComponent(userId)}/config`, {
    method: "GET",
    headers: token ? { Authorization: authHeader(token) } : undefined,
    credentials: "same-origin",
  })
  if (!res.ok) {
    throw new Error(`GET config ${res.status}`)
  }
  return (await res.json()) as TenantConfig
}

/** Persist the tenant's config.json. */
export async function saveUserConfigFor(
  userId: string,
  config: TenantConfig,
): Promise<void> {
  const token = getV6Token()
  const res = await fetch(`/api/v1/users/${encodeURIComponent(userId)}/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: authHeader(token) } : {}),
    },
    credentials: "same-origin",
    body: JSON.stringify(config, null, 2),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`PUT config ${res.status}: ${body}`)
  }
}