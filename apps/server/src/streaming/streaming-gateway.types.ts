export type StreamingNetworkPath = 'lan' | 'vpn' | 'tunnel' | 'public'

export type StreamingHostStatus = 'registered' | 'offline' | 'ready'

export type StreamingPortProbe = {
  port: number
  protocol: 'tcp' | 'udp'
  role: string
  reachable: boolean | null
  checked: boolean
  error?: string
}

export type StreamingHost = {
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
  status: StreamingHostStatus
  integration_id: number
  source: 'authorization' | 'legacy_device'
  capabilities: string[]
  pairing?: StreamingHostPairing
}

export type StreamingHostPairing = {
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

export type StreamingSessionEntry = {
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

export type StreamingRuntimeApp = {
  app_id: number | string
  name: string
  stream_url: string
  running?: boolean
  hidden?: boolean
}

export type MoonlightWebRuntimeStatus = {
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

export type UpdateMoonlightWebRuntimeInput = {
  endpoint?: string
}

export type StreamingHostProbe = {
  id: string
  label: string
  endpoint: string
  checked_at: string
  reachable: boolean
  status_code: number | null
  ports: StreamingPortProbe[]
  error?: string
}

export type RegisterStreamingHostInput = {
  label?: string
  endpoint?: string
  base_port?: string | number
  mac_address?: string
  room?: string
  network_path?: StreamingNetworkPath
}

export type ScanStreamingHostsInput = {
  subnet?: string
  ports?: number[]
  timeout_ms?: number
}

export type StreamingHostScanCandidate = {
  ip: string
  port: number
  endpoint: string
  reachable: boolean
  latency_ms?: number
  error?: string
}

export type StreamingHostScanResult = {
  subnet: string
  subnets: string[]
  ports: number[]
  scanned: number
  candidates: StreamingHostScanCandidate[]
  count: number
}

export type StreamingHostPairResult = {
  id: string
  label: string
  endpoint: string
  pin: string
  pairing: StreamingHostPairing
  task_id?: string
}

export type StreamingHostPairTask = {
  task_id: string
  host_id: string
  status: 'pin' | 'paired' | 'failed'
  pin?: string
  error?: string
  started_at: string
  updated_at: string
  pairing?: StreamingHostPairing
}
