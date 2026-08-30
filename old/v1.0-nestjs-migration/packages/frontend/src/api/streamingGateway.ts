const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  return response.json()
}

export type StreamingNetworkPath = 'lan' | 'vpn' | 'tunnel' | 'public'

export interface StreamingHost {
  id: string
  label: string
  endpoint: string
  host: string
  base_port: number
  web_port: number
  tcp_ports: number[]
  udp_ports: number[]
  discovery_ports: number[]
  mac_address?: string
  room?: string
  network_path: StreamingNetworkPath
  enabled: boolean
  status: 'registered' | 'offline' | 'ready'
  integration_id: number
  capabilities: string[]
}

export interface StreamingPortProbe {
  port: number
  protocol: 'tcp' | 'udp'
  role: string
  reachable: boolean | null
  checked: boolean
  error?: string
}

export interface StreamingHostProbe {
  id: string
  label: string
  endpoint: string
  checked_at: string
  reachable: boolean
  status_code: number | null
  ports: StreamingPortProbe[]
  error?: string
}

export interface WakeStreamingHostResult {
  id: string
  label: string
  mac_address: string
  broadcast_address: string
  port: number
  sent: boolean
}

export interface MoonlightWebRuntimeStatus {
  name: string
  endpoint: string
  enabled: boolean
  registered: boolean
  reachable: boolean
  status_code: number | null
  checked_at: string
  error?: string
  notes: string[]
}

export const streamingGatewayApi = {
  hosts: () => request<{ status: string; data: StreamingHost[] }>('/api/streaming-gateway/hosts'),
  registerHost: (body: Record<string, unknown>) =>
    request<{ status: string; data: StreamingHost }>('/api/streaming-gateway/hosts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeHost: (id: string) =>
    request<{ status: string }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  probeHost: (id: string) =>
    request<{ status: string; data: StreamingHostProbe }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/probe`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  wakeHost: (id: string) =>
    request<{ status: string; data: WakeStreamingHostResult }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/wake`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  runtimeStatus: () => request<{ status: string; data: MoonlightWebRuntimeStatus }>('/api/streaming-gateway/runtime'),
}
