const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return response.json()
}

export type ExternalIntegrationKind = 'http' | 'cli' | 'local_service' | 'webhook'

export interface ExternalIntegrationAction {
  name: string
  capability_id?: string
  description?: string
  method?: string
  path?: string
  params_schema?: Record<string, unknown>
  sample?: Record<string, unknown>
}

export interface ExternalIntegrationRecord {
  id: number
  name: string
  kind: ExternalIntegrationKind
  endpoint: string
  description: string
  capability_ids: string[]
  actions: ExternalIntegrationAction[]
  enabled: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export const externalIntegrationApi = {
  list: () => request<{ integrations: ExternalIntegrationRecord[] }>('/api/external-integrations'),
  register: (body: Record<string, unknown>) =>
    request<{ status: string; integration: ExternalIntegrationRecord }>('/api/external-integrations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    request<{ status: string }>(`/api/external-integrations/${id}`, { method: 'DELETE' }),
}
