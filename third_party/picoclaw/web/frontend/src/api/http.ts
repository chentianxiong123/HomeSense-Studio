import { isLauncherAuthPathname } from "@/lib/launcher-login-path"
import { authHeader, getV6Token } from "@/api/v6-auth"

function isLauncherAuthPath(): boolean {
  if (typeof globalThis.location === "undefined") {
    return false
  }
  if (isLauncherAuthPathname(globalThis.location.pathname || "/")) {
    return true
  }
  try {
    return isLauncherAuthPathname(
      new URL(globalThis.location.href).pathname || "/",
    )
  } catch {
    return false
  }
}

/**
 * Same-origin fetch that sends cookies; redirects to launcher login on 401 JSON responses.
 * Skips redirect while already on an auth page (login or setup) to avoid reload loops.
 */
export async function launcherFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getV6Token()
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", authHeader(token))
  }
  const res = await fetch(input, {
    credentials: "same-origin",
    ...init,
    headers,
  })
  if (res.status === 401) {
    const ct = res.headers.get("content-type") || ""
    if (
      ct.includes("application/json") &&
      typeof globalThis.location !== "undefined" &&
      !isLauncherAuthPath()
    ) {
      globalThis.location.assign("/launcher-login")
    }
  }
  return res
}
