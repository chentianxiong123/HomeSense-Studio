export interface CliPassThroughRequest {
  action: string
  params?: Record<string, unknown>
  ttl_ms?: number
  bypass_cache?: boolean
}

export interface CliPassThroughResponse<T = unknown> {
  status: 'success' | 'error'
  data?: T
  error?: string
  message?: string
  cache?: 'hit' | 'miss' | 'bypass'
  duration_ms?: number
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export const cliApi = {
  run: <T = unknown>(cliName: 'mi-cli' | 'adb-cli' | 'media-cli', body: CliPassThroughRequest) =>
    request<CliPassThroughResponse<T>>(`/api/cli/${cliName}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
