import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import dgram from 'node:dgram'
import { DeviceService } from '../devices/device.service'
import type { UserDevice } from '../devices/device.types'
import type {
  RegisterStreamingHostInput,
  StreamingHost,
  StreamingHostProbe,
  StreamingNetworkPath,
  StreamingPortProbe,
} from './streaming-gateway.types'

const DEFAULT_BASE_PORT = 47989
const DEVICE_TYPE = 'sunshine_host'
const HOST_CAPABILITIES = [
  'streaming.host.sunshine',
  'streaming.session.launch',
  'streaming.wake_on_lan',
  'streaming.network_path.check',
]

@Injectable()
export class StreamingGatewayService {
  constructor(private readonly devices: DeviceService) {}

  listHosts(): StreamingHost[] {
    return this.devices
      .list()
      .filter(isSunshineHostDevice)
      .map((device) => this.toStreamingHost(device))
  }

  registerHost(input: RegisterStreamingHostInput): StreamingHost {
    const label = String(input.label || '').trim()
    const endpoint = String(input.endpoint || '').trim()
    if (!label) throw new BadRequestException('label is required')
    if (!endpoint) throw new BadRequestException('endpoint is required')

    const basePort = normalizePort(input.base_port, DEFAULT_BASE_PORT)
    const parsed = parseEndpoint(endpoint, basePort)
    const networkPath = normalizeNetworkPath(input.network_path)
    const mac = normalizeMac(input.mac_address || '')

    const device = this.devices.create({
      name: label,
      props: {
        device_type: DEVICE_TYPE,
        streaming_kind: 'sunshine',
        sunshine_endpoint: parsed.endpoint,
        sunshine_host: parsed.host,
        sunshine_base_port: basePort,
        sunshine_web_port: parsed.port,
        mac_address: mac || undefined,
        room: String(input.room || '').trim() || undefined,
        network_path: networkPath,
        capabilities: HOST_CAPABILITIES,
      },
    })

    return this.toStreamingHost(device)
  }

  removeHost(id: string): void {
    const device = this.getHostDevice(id)
    this.devices.remove(device.id)
  }

  async probeHost(id: string): Promise<StreamingHostProbe> {
    const host = this.toStreamingHost(this.getHostDevice(id))
    const ports = buildPortPlan(host)
    const webPort = ports.find((port) => port.port === host.web_port && port.protocol === 'tcp')
    const checkedAt = new Date().toISOString()

    try {
      const result = await probeHttp(host)
      if (webPort) {
        webPort.checked = true
        webPort.reachable = result.reachable
        if (result.error) webPort.error = result.error
      }
      return {
        id: host.id,
        label: host.label,
        endpoint: host.endpoint,
        checked_at: checkedAt,
        reachable: result.reachable,
        status_code: result.statusCode,
        ports,
        ...(result.error ? { error: result.error } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (webPort) {
        webPort.checked = true
        webPort.reachable = false
        webPort.error = message
      }
      return {
        id: host.id,
        label: host.label,
        endpoint: host.endpoint,
        checked_at: checkedAt,
        reachable: false,
        status_code: null,
        ports,
        error: message,
      }
    }
  }

  async wakeHost(id: string) {
    const host = this.toStreamingHost(this.getHostDevice(id))
    if (!host.mac_address) {
      throw new BadRequestException('mac_address is required')
    }
    await sendWakeOnLan(host.mac_address)
    return {
      id: host.id,
      label: host.label,
      mac_address: host.mac_address,
      broadcast_address: '255.255.255.255',
      port: 9,
      sent: true,
    }
  }

  async runtimeStatus() {
    const endpoint = String(process.env.MOONLIGHT_WEB_RUNTIME_URL || process.env.STREAMING_RUNTIME_URL || '').trim()
    if (!endpoint) {
      return {
        name: 'moonlight-web-runtime',
        endpoint: '',
        enabled: false,
        registered: false,
        reachable: false,
        status_code: null,
        checked_at: new Date().toISOString(),
        notes: ['Set MOONLIGHT_WEB_RUNTIME_URL to expose an external Moonlight Web runtime.'],
      }
    }

    const status = await probeUrl(endpoint)
    return {
      name: 'moonlight-web-runtime',
      endpoint,
      enabled: true,
      registered: true,
      reachable: status.reachable,
      status_code: status.statusCode,
      checked_at: new Date().toISOString(),
      ...(status.error ? { error: status.error } : {}),
      notes: ['HomeSense manages the control plane; the runtime owns video transport.'],
    }
  }

  private getHostDevice(id: string): UserDevice {
    const numericId = Number(String(id).replace(/^device:/, ''))
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new BadRequestException('invalid host id')
    }
    const device = this.devices.get(numericId)
    if (!isSunshineHostDevice(device)) {
      throw new NotFoundException(`Sunshine host not found: ${id}`)
    }
    return device
  }

  private toStreamingHost(device: UserDevice): StreamingHost {
    const props = device.props ?? {}
    const basePort = normalizePort(props.sunshine_base_port, DEFAULT_BASE_PORT)
    const webPort = normalizePort(props.sunshine_web_port, basePort)
    const endpoint = stringProp(props.sunshine_endpoint) || stringProp(props.sunshine_host) || ''
    const parsed = parseEndpoint(endpoint, webPort)
    const tcpPorts = uniqueNumbers([webPort, basePort, 47984, 47989, 48010])
    const udpPorts = uniqueNumbers([47998, 47999, 48000, 48002, 48010])
    const discoveryPorts = uniqueNumbers([basePort, 47989, 48010])

    return {
      id: String(device.id),
      label: device.name,
      endpoint: parsed.endpoint,
      host: parsed.host,
      base_port: basePort,
      web_port: webPort,
      tcp_ports: tcpPorts,
      udp_ports: udpPorts,
      discovery_ports: discoveryPorts,
      mac_address: normalizeMac(stringProp(props.mac_address)) || undefined,
      room: stringProp(props.room) || undefined,
      network_path: normalizeNetworkPath(props.network_path),
      enabled: props.enabled !== false,
      status: 'registered',
      integration_id: device.id,
      capabilities: Array.isArray(props.capabilities) ? props.capabilities.map(String) : HOST_CAPABILITIES,
    }
  }
}

function isSunshineHostDevice(device: UserDevice): boolean {
  return device.props?.device_type === DEVICE_TYPE || device.props?.streaming_kind === 'sunshine'
}

function normalizePort(value: unknown, fallback: number): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}

function normalizeNetworkPath(value: unknown): StreamingNetworkPath {
  if (value === 'vpn' || value === 'tunnel' || value === 'public') return value
  return 'lan'
}

function normalizeMac(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (compact.length !== 12) return raw
  return compact.match(/.{1,2}/g)?.join(':') ?? raw
}

function stringProp(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseEndpoint(value: string, fallbackPort: number): { endpoint: string; host: string; port: number; url: string } {
  const raw = value.trim()
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withProtocol)
    const port = normalizePort(url.port || fallbackPort, fallbackPort)
    url.port = String(port)
    url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
    url.search = ''
    url.hash = ''
    return {
      endpoint: url.toString().replace(/\/$/, ''),
      host: url.hostname,
      port,
      url: url.toString().replace(/\/$/, ''),
    }
  } catch {
    throw new BadRequestException('endpoint is invalid')
  }
}

function buildPortPlan(host: StreamingHost): StreamingPortProbe[] {
  const tcp = host.tcp_ports.map((port) => ({
    port,
    protocol: 'tcp' as const,
    role: port === host.web_port ? 'sunshine-http' : 'moonlight-control',
    reachable: null,
    checked: false,
  }))
  const udp = host.udp_ports.map((port) => ({
    port,
    protocol: 'udp' as const,
    role: 'moonlight-stream',
    reachable: null,
    checked: false,
  }))
  return [...tcp, ...udp]
}

async function probeHttp(host: StreamingHost): Promise<{ reachable: boolean; statusCode: number | null; error?: string }> {
  const base = parseEndpoint(host.endpoint, host.web_port).url
  const serverInfo = `${base}/serverinfo`
  const first = await probeUrl(serverInfo)
  if (first.reachable) return first
  const second = await probeUrl(base)
  if (second.reachable) return second
  return first.error ? first : second
}

async function probeUrl(url: string): Promise<{ reachable: boolean; statusCode: number | null; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(1800),
    })
    return {
      reachable: response.status < 500,
      statusCode: response.status,
    }
  } catch (error) {
    return {
      reachable: false,
      statusCode: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0 && value <= 65535))]
}

function sendWakeOnLan(mac: string): Promise<void> {
  const bytes = normalizeMac(mac).split(':').map((part) => Number.parseInt(part, 16))
  if (bytes.length !== 6 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new BadRequestException('mac_address is invalid')
  }
  const packet = Buffer.alloc(6 + 16 * 6, 0xff)
  for (let i = 0; i < 16; i += 1) {
    for (let j = 0; j < 6; j += 1) {
      packet[6 + i * 6 + j] = bytes[j]
    }
  }

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', (error) => {
      socket.close()
      reject(error)
    })
    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(packet, 9, '255.255.255.255', (error) => {
        socket.close()
        if (error) reject(error)
        else resolve()
      })
    })
  })
}
