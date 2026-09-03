const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  return response.json()
}

export type RuntimeCapabilityDomain =
  | 'device'
  | 'executor'
  | 'provider'
  | 'workflow_node'
  | 'skill'

export interface RuntimeCapabilityAction {
  name: string
  description?: string
  params_schema?: Record<string, unknown>
  sample?: Record<string, unknown>
}

export interface RuntimeCapabilitySurface {
  id: string
  domain: RuntimeCapabilityDomain
  title: string
  description: string
  status: 'ready' | 'planned' | 'disabled' | 'dry_run' | 'offline' | 'unknown'
  configured: boolean
  action_count: number
  actions: RuntimeCapabilityAction[]
  tags: string[]
  usage_hint: string
  sample_invocation?: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface RuntimeCapabilityMap {
  version: number
  generated_at: string
  summary: {
    total_surfaces: number
    total_actions: number
    configured: number
    by_domain: Record<RuntimeCapabilityDomain, number>
  }
  domains: Array<{
    domain: RuntimeCapabilityDomain
    title: string
    count: number
    action_count: number
    configured: number
  }>
  surfaces: RuntimeCapabilitySurface[]
}

export const runtimeCapabilityApi = {
  get: (deviceLimit = 30) =>
    request<{ map: RuntimeCapabilityMap }>(`/api/runtime-capabilities?device_limit=${deviceLimit}`),
}
