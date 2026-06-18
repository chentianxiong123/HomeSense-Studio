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
  source: 'authorization' | 'legacy_device'
  capabilities: string[]
  pairing?: StreamingHostPairing
}

export interface StreamingHostPairing {
  status: 'unpaired' | 'pairing' | 'paired' | 'failed'
  mock_pairing?: boolean
  paired_at?: string
  pin?: string
  client_certificate_ref?: string
  client_private_key_ref?: string
  server_certificate_ref?: string
  error?: string
  notes?: string[]
}

export interface StreamingHostPairResult {
  id: string
  label: string
  endpoint: string
  pin: string
  pairing: StreamingHostPairing
  task_id?: string
}

export interface StreamingHostPairTask {
  task_id: string
  host_id: string
  status: 'pin' | 'paired' | 'failed'
  pin?: string
  error?: string
  started_at: string
  updated_at: string
  pairing?: StreamingHostPairing
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
  configured_by: 'managed' | 'environment' | 'database' | 'default'
  pair_url: string
  manage_hosts_url: string
  public_path?: string
  managed?: boolean
  pid?: number
  binary?: string
  error?: string
  notes: string[]
}

export interface StreamingSessionEntry {
  session_id: string
  host: StreamingHost
  runtime: MoonlightWebRuntimeStatus
  viewer_url: string
  runtime_url: string
  pair_url: string
  manage_hosts_url: string
  sunshine_url: string
  controller_url: string
  monitor_url: string
  notes: string[]
}

export interface StreamingRuntimeApp {
  app_id: number | string
  name: string
  stream_url: string
  running?: boolean
  hidden?: boolean
}

export interface StreamingScanCandidate {
  ip: string
  port: number
  endpoint: string
  reachable: boolean
  latency_ms?: number
  error?: string
}

export interface StreamingScanResult {
  subnet: string
  subnets: string[]
  ports: number[]
  scanned: number
  candidates: StreamingScanCandidate[]
  count: number
}

export interface AdbScrcpySessionInput {
  device?: string
  profile?: string
  max_size?: number | string
  bit_rate?: string
  max_fps?: number | string
  video_codec?: string
  video_buffer?: number | string
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
  pairHost: (id: string) =>
    request<{ status: string; data: StreamingHostPairResult }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/pair`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  pairTask: (taskId: string) =>
    request<{ status: string; data: StreamingHostPairTask }>(`/api/streaming-gateway/pair-tasks/${encodeURIComponent(taskId)}`),
  scanHosts: (body: { subnet?: string; ports?: number[]; timeout_ms?: number }) =>
    request<{ status: string; data: StreamingScanResult }>('/api/streaming-gateway/scan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  wakeHost: (id: string) =>
    request<{ status: string; data: WakeStreamingHostResult }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/wake`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  sessionEntry: (id: string) =>
    request<{ status: string; data: StreamingSessionEntry }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/session-entry`),
  hostApps: (id: string) =>
    request<{ status: string; data: StreamingRuntimeApp[] }>(`/api/streaming-gateway/hosts/${encodeURIComponent(id)}/apps`),
  runtimeStatus: () => request<{ status: string; data: MoonlightWebRuntimeStatus }>('/api/streaming-gateway/runtime'),
  updateRuntime: (body: { endpoint: string }) =>
    request<{ status: string; data: MoonlightWebRuntimeStatus }>('/api/streaming-gateway/runtime', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
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
