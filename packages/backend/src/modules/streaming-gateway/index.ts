import dgram from 'node:dgram'
import type { ExternalIntegrationRecord } from '../external-integrations/index.js'
import { externalIntegrationsService } from '../external-integrations/index.js'

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

export interface RegisterStreamingHostInput {
  label?: string
  endpoint?: string
  host?: string
  base_port?: number | string
  mac_address?: string
  room?: string
  network_path?: StreamingNetworkPath | string
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

export interface StreamingGatewayServiceOptions {
  listIntegrations?: () => ExternalIntegrationRecord[]
  registerIntegration?: typeof externalIntegrationsService.register
  removeIntegration?: typeof externalIntegrationsService.remove
  fetchImpl?: typeof fetch
  now?: () => Date
  sendWakePacket?: (macAddress: string, broadcastAddress: string, port: number) => Promise<void>
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

export class StreamingGatewayService {
  constructor(private readonly options: StreamingGatewayServiceOptions = {}) {}

  listHosts(): StreamingHost[] {
    const integrations = (this.options.listIntegrations ?? (() => externalIntegrationsService.list()))()
    return integrations
      .filter((item) => item.metadata?.role === 'streaming_sunshine_host')
      .map(integrationToStreamingHost)
  }

  registerHost(input: RegisterStreamingHostInput): StreamingHost {
    const label = String(input.label ?? '').trim()
    const hostConfig = normalizeSunshineHostConfig(input)
    const endpoint = buildSunshineWebEndpoint(hostConfig.host, hostConfig.webPort)
    if (!label) throw new Error('label is required')
    if (!hostConfig.host) throw new Error('host or endpoint is required')
    const networkPath = normalizeNetworkPath(input.network_path)
    const registerIntegration = this.options.registerIntegration ?? externalIntegrationsService.register.bind(externalIntegrationsService)
    const record = registerIntegration({
      name: buildStreamingHostIntegrationName(label, endpoint),
      kind: 'http',
      endpoint,
      enabled: true,
      description: `Sunshine streaming host: ${label}`,
      capability_ids: [
        'streaming.host.sunshine',
        'streaming.host.probe',
        'streaming.wake_on_lan',
        'streaming.session.launch',
      ],
      actions: [
        { name: 'probe', capability_id: 'streaming.host.probe', description: 'Probe the Sunshine host HTTP endpoint.' },
        { name: 'wake', capability_id: 'streaming.wake_on_lan', description: 'Send a Wake-on-LAN magic packet when a MAC address is configured.' },
        { name: 'launch', capability_id: 'streaming.session.launch', description: 'Prepare a Moonlight launch path for this host.' },
      ],
      metadata: {
        source: 'user',
        role: 'streaming_sunshine_host',
        streaming_host: {
          label,
          host: hostConfig.host,
          base_port: hostConfig.basePort,
          web_port: hostConfig.webPort,
          tcp_ports: hostConfig.tcpPorts,
          udp_ports: hostConfig.udpPorts,
          discovery_ports: hostConfig.discoveryPorts,
          mac_address: optionalText(input.mac_address) || undefined,
          room: optionalText(input.room) || undefined,
          network_path: networkPath,
          protocol_owner: 'sunshine_moonlight',
        },
        auth: {
          mode: 'sunshine_pairing_or_service_auth',
          credentials_owned_by: 'sunshine_host',
          notes: 'HomeSense stores the host declaration and does not proxy the video stream.',
        },
      },
    })
    return integrationToStreamingHost(record)
  }

  removeHost(id: string): boolean {
    const match = /^integration:(\d+)$/.exec(id)
    if (!match) return false
    const removeIntegration = this.options.removeIntegration ?? externalIntegrationsService.remove.bind(externalIntegrationsService)
    return removeIntegration(Number(match[1]))
  }

  async probeHost(id: string): Promise<StreamingHostProbe | null> {
    const host = this.findHostById(id)
    if (!host) return null
    const checkedAt = (this.options.now ?? (() => new Date()))().toISOString()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3500)
    try {
      const response = await (this.options.fetchImpl ?? fetch)(host.endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/json,text/plain,*/*' },
      })
      return {
        id: host.id,
        label: host.label,
        endpoint: host.endpoint,
        checked_at: checkedAt,
        reachable: response.ok,
        status_code: response.status,
        ports: buildPortProbePlan(host),
      }
    } catch (error) {
      return {
        id: host.id,
        label: host.label,
        endpoint: host.endpoint,
        checked_at: checkedAt,
        reachable: false,
        status_code: null,
        ports: buildPortProbePlan(host),
        error: error instanceof Error ? error.message : 'Sunshine host probe failed.',
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async wakeHost(id: string): Promise<WakeStreamingHostResult | null> {
    const host = this.findHostById(id)
    if (!host) return null
    if (!host.mac_address) throw new Error('mac_address is required for Wake-on-LAN.')
    const broadcastAddress = process.env.HOMESENSE_WOL_BROADCAST || '255.255.255.255'
    const port = Number(process.env.HOMESENSE_WOL_PORT || 9)
    await (this.options.sendWakePacket ?? sendWakeOnLanPacket)(host.mac_address, broadcastAddress, port)
    return {
      id: host.id,
      label: host.label,
      mac_address: host.mac_address,
      broadcast_address: broadcastAddress,
      port,
      sent: true,
    }
  }

  async getRuntimeStatus(): Promise<MoonlightWebRuntimeStatus> {
    const runtime = (this.options.listIntegrations ?? (() => externalIntegrationsService.list()))()
      .find((item) => item.name === 'moonlight-web-runtime')
    const endpoint = optionalText(runtime?.endpoint) || process.env.HOMESENSE_MOONLIGHT_WEB_RUNTIME_ENDPOINT || 'http://127.0.0.1:8080'
    const checkedAt = (this.options.now ?? (() => new Date()))().toISOString()
    const notes = [
      'Moonlight Web Runtime is a sidecar/runtime boundary, not embedded into the main HomeSense backend.',
      'The runtime owns Moonlight/GameStream media handling and browser playback transport.',
      'HomeSense owns registry, launch, network path, and UI embedding.',
    ]
    if (!isHttpEndpoint(endpoint)) {
      return {
        name: runtime?.name ?? 'moonlight-web-runtime',
        endpoint,
        enabled: runtime?.enabled ?? false,
        registered: Boolean(runtime),
        reachable: false,
        status_code: null,
        checked_at: checkedAt,
        error: 'Runtime endpoint is not HTTP or HTTPS.',
        notes,
      }
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    try {
      const response = await (this.options.fetchImpl ?? fetch)(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'text/html,text/plain,*/*' },
      })
      return {
        name: runtime?.name ?? 'moonlight-web-runtime',
        endpoint,
        enabled: runtime?.enabled ?? false,
        registered: Boolean(runtime),
        reachable: response.ok,
        status_code: response.status,
        checked_at: checkedAt,
        notes,
      }
    } catch (error) {
      return {
        name: runtime?.name ?? 'moonlight-web-runtime',
        endpoint,
        enabled: runtime?.enabled ?? false,
        registered: Boolean(runtime),
        reachable: false,
        status_code: null,
        checked_at: checkedAt,
        error: error instanceof Error ? error.message : 'Moonlight Web Runtime probe failed.',
        notes,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private findHostById(id: string): StreamingHost | null {
    return this.listHosts().find((host) => host.id === id) ?? null
  }
}

export const streamingGatewayService = new StreamingGatewayService()

function integrationToStreamingHost(record: ExternalIntegrationRecord): StreamingHost {
  const metadata = normalizeObject(record.metadata?.streaming_host)
  const config = normalizeSunshineHostConfig({
    endpoint: record.endpoint,
    host: metadata.host,
    base_port: metadata.base_port,
    web_port: metadata.web_port ?? metadata.port,
  })
  const endpoint = buildSunshineWebEndpoint(config.host, config.webPort)
  return {
    id: `integration:${record.id}`,
    label: String(metadata.label ?? record.name ?? endpoint).trim(),
    endpoint,
    host: config.host,
    base_port: config.basePort,
    web_port: config.webPort,
    tcp_ports: config.tcpPorts,
    udp_ports: config.udpPorts,
    discovery_ports: config.discoveryPorts,
    mac_address: optionalText(metadata.mac_address) || undefined,
    room: optionalText(metadata.room) || undefined,
    network_path: normalizeNetworkPath(metadata.network_path),
    enabled: record.enabled,
    status: record.enabled ? 'registered' : 'offline',
    integration_id: record.id,
    capabilities: record.capability_ids,
  }
}

function buildPortProbePlan(host: StreamingHost): StreamingPortProbe[] {
  return [
    ...host.tcp_ports.map((port) => ({
      port,
      protocol: 'tcp' as const,
      role: port === host.web_port ? 'sunshine_web' : 'moonlight_tcp',
      reachable: port === host.web_port ? null : null,
      checked: false,
    })),
    ...host.udp_ports.map((port) => ({
      port,
      protocol: 'udp' as const,
      role: 'moonlight_udp',
      reachable: null,
      checked: false,
      error: 'UDP reachability is not checked by HTTP probe.',
    })),
    ...host.discovery_ports.map((port) => ({
      port,
      protocol: 'udp' as const,
      role: 'discovery',
      reachable: null,
      checked: false,
      error: 'Discovery reachability is not checked by HTTP probe.',
    })),
  ]
}

async function sendWakeOnLanPacket(macAddress: string, broadcastAddress: string, port: number): Promise<void> {
  const packet = buildMagicPacket(macAddress)
  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', (error) => {
      socket.close()
      reject(error)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(packet, port, broadcastAddress, (error) => {
        socket.close()
        if (error) reject(error)
        else resolve()
      })
    })
  })
}

function buildMagicPacket(macAddress: string): Buffer {
  const cleaned = macAddress.replace(/[^a-fA-F0-9]/g, '')
  if (!/^[a-fA-F0-9]{12}$/.test(cleaned)) throw new Error('Invalid MAC address.')
  const mac = Buffer.from(cleaned, 'hex')
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)])
}

function normalizeSunshineHostConfig(input: { endpoint?: unknown; host?: unknown; base_port?: unknown; web_port?: unknown }) {
  const parsedEndpoint = parseEndpoint(input.endpoint)
  const host = optionalText(input.host) || parsedEndpoint?.hostname || ''
  const parsedPort = Number(input.base_port)
  const parsedWebPort = Number(input.web_port)
  const endpointPort = Number(parsedEndpoint?.port)
  const basePort = normalizeBasePort(
    Number.isFinite(parsedPort) && parsedPort > 0
      ? parsedPort
      : Number.isFinite(parsedWebPort) && parsedWebPort > 0
        ? inferBasePortFromEndpointPort(parsedWebPort)
      : Number.isFinite(endpointPort) && endpointPort > 0
        ? inferBasePortFromEndpointPort(endpointPort)
        : 47989,
  )
  const portSet = buildSunshinePortSet(basePort)
  return {
    host,
    basePort,
    webPort: portSet.webPort,
    tcpPorts: portSet.tcpPorts,
    udpPorts: portSet.udpPorts,
    discoveryPorts: portSet.discoveryPorts,
  }
}

function buildSunshineWebEndpoint(host: string, webPort: number): string {
  if (!host) return ''
  return `https://${host}:${webPort}`
}

function buildSunshinePortSet(basePort: number) {
  return {
    webPort: basePort + 1,
    tcpPorts: uniqueNumbers([basePort - 5, basePort, basePort + 21]),
    udpPorts: uniqueNumbers([basePort + 9, basePort + 10, basePort + 11, basePort + 13, basePort + 21]),
    discoveryPorts: [5353],
  }
}

function inferBasePortFromEndpointPort(port: number): number {
  if (port === 47990) return 47989
  return port
}

function normalizeBasePort(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 47989
  return Math.floor(value)
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).filter((value) => Number.isFinite(value) && value > 0)
}

function parseEndpoint(value: unknown): URL | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

function isHttpEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeNetworkPath(value: unknown): StreamingNetworkPath {
  if (value === 'vpn' || value === 'tunnel' || value === 'public') return value
  return 'lan'
}

function buildStreamingHostIntegrationName(label: string, endpoint: string): string {
  const slug = `${label}-${endpoint}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `streaming-host-${slug || 'sunshine'}`
}

function optionalText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
