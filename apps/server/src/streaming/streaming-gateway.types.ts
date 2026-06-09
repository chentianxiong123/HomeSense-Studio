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
  capabilities: string[]
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
