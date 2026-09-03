const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return response.json()
}

export interface ManifestRecord {
  id: string
  kind: 'cli' | 'agent' | 'a2a' | 'service' | 'channel'
  display_name: string
  description: string
  capabilities: string[]
  protocol: string
  transport: string
  status: 'ready' | 'planned' | 'disabled' | 'dry_run'
  configured: boolean
  timeout_ms?: number
  endpoint_env?: string
  actions: Array<{
    name: string
    description?: string
    params_schema?: Record<string, unknown>
  }>
  sample_invocation?: Record<string, unknown>
}

export const manifestApi = {
  list: () => request<{ manifests: ManifestRecord[]; summary: Record<string, unknown> }>('/api/manifests'),
  get: (id: string) => request<{ manifest: ManifestRecord }>(`/api/manifests/${encodeURIComponent(id)}`),
}
