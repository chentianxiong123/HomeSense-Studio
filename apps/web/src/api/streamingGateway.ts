const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = body?.message || body?.error || `Request failed: ${response.status} ${response.statusText}`
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message))
  }
  return body as T
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

export interface AdbScrcpySessionInput {
  device?: string
  profile?: string
  max_size?: number | string
  bit_rate?: string
  max_fps?: number | string
  video_codec?: string
  display_id?: number | string
  audio?: boolean
  control?: boolean
  window?: boolean
  playback?: boolean
  tunnel_mode?: string
  record?: string
  v4l2_sink?: string
  extra_args?: string[]
  label?: string
  dry_run?: boolean
}

export interface AdbScrcpyCommandSpec {
  executable: string
  args: string[]
  argv: string[]
  command_line: string
  device: string
  profile: string
  headless: boolean
  window: boolean
  playback: boolean
  audio: boolean
  control: boolean
  tunnel_mode: string
  direct_cli_video: boolean
  effective_video: boolean
  requires_backend_bridge: boolean
  bridge_strategy: string
  notes: string[]
}

export interface AdbScrcpyRawBridge {
  kind: 'raw_h264'
  ws_path: string
  local_host: string
  local_port: number
  socket_name: string
  scid: string
  device_server_path: string
  server_version: string
  ready: boolean
  mime: 'video/h264'
  notes: string[]
}

export interface AdbScrcpySession {
  id: string
  label: string
  device: string
  state: 'starting' | 'running' | 'prepared' | 'exited' | 'failed' | 'stopped'
  created_at: string
  updated_at: string
  started_at?: string
  exited_at?: string
  exit_code?: number | null
  signal?: string | null
  pid?: number
  command: AdbScrcpyCommandSpec
  stream?: AdbScrcpyRawBridge
  dry_run: boolean
  stdout_tail: string[]
  stderr_tail: string[]
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
  adbScrcpySessions: () =>
    request<{ status: string; data: AdbScrcpySession[] }>('/api/streaming-gateway/adb-scrcpy/sessions'),
  adbScrcpySession: (id: string) =>
    request<{ status: string; data: AdbScrcpySession }>(`/api/streaming-gateway/adb-scrcpy/sessions/${encodeURIComponent(id)}`),
  createAdbScrcpySession: (body: AdbScrcpySessionInput) =>
    request<{ status: string; data: AdbScrcpySession }>('/api/streaming-gateway/adb-scrcpy/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  stopAdbScrcpySession: (id: string) =>
    request<{ status: string; data: AdbScrcpySession }>(`/api/streaming-gateway/adb-scrcpy/sessions/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  removeAdbScrcpySession: (id: string) =>
    request<{ status: string }>(`/api/streaming-gateway/adb-scrcpy/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
}
