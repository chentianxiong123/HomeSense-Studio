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
  const text = await res.text()
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`
    try {
      const body = JSON.parse(text) as { message?: string; error?: string }
      message = body.message || body.error || message
    } catch {
      if (text.trim()) message = text.trim()
    }
    throw new Error(message)
  }
  return (text ? JSON.parse(text) : {}) as T
}

export const cliApi = {
  run: <T = unknown>(cliName: 'mi-cli' | 'adb-cli' | 'media-cli', body: CliPassThroughRequest) =>
    request<CliPassThroughResponse<T>>(`/api/cli/${cliName}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
