import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { execFile, spawn } from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { UserDevice } from '../devices/device.types'
import { getDb } from '../db/database'
import { readRuntimeSnapshot, writeRuntimeSnapshot } from '../db/runtime-snapshot'
import type {
  MoonlightWebRuntimeStatus,
  RegisterStreamingHostInput,
  ScanStreamingHostsInput,
  StreamingHost,
  StreamingHostPairResult,
  StreamingHostPairTask,
  StreamingHostPairing,
  StreamingHostProbe,
  StreamingRuntimeApp,
  StreamingHostScanResult,
  StreamingSessionEntry,
  StreamingNetworkPath,
  StreamingPortProbe,
  UpdateMoonlightWebRuntimeInput,
} from './streaming-gateway.types'
import { MoonlightWebRuntimeService } from './moonlight-web-runtime.service'

const DEFAULT_BASE_PORT = 47989
const DEFAULT_SCAN_PORTS = [47989]
const DEFAULT_SCAN_SUBNET = '192.168.31.0/24'
const DEFAULT_RUNTIME_ENDPOINT = 'http://localhost:8080'
const RUNTIME_SNAPSHOT_KEY = 'streaming.moonlight_web_runtime'
const PAIRING_ROOT = path.resolve(process.cwd(), '../../data/streaming/moonlight')
const execFileAsync = promisify(execFile)
const DEVICE_TYPE = 'sunshine_host'
const HOST_CAPABILITIES = [
  'streaming.host.sunshine',
  'streaming.session.launch',
  'streaming.wake_on_lan',
  'streaming.network_path.check',
]

type MoonlightRuntimeHost = {
  host_id: number | string
  name?: string
  address?: string
  http_port?: number
  paired?: string
}

type MoonlightRuntimeApp = {
  app_id: number | string
  name?: string
  AppTitle?: string
  title?: string
  running?: boolean
  hidden?: boolean
}

type PairTaskRecord = StreamingHostPairTask & {
  host: StreamingHost
}

interface StreamingHostRow {
  id: number
  label: string
  endpoint: string
  host: string
  base_port: number
  web_port: number
  mac_address: string | null
  room: string | null
  network_path: string
  enabled: number
  props_json: string
  created_at: string
  updated_at: string
}

@Injectable()
export class StreamingGatewayService {
  private readonly pairTasks = new Map<string, PairTaskRecord>()

  constructor(private readonly moonlightRuntime: MoonlightWebRuntimeService) {}

  listHosts(): StreamingHost[] {
    const rows = getDb()
      .prepare(
        `SELECT id, label, endpoint, host, base_port, web_port, mac_address, room, network_path, enabled, props_json, created_at, updated_at
         FROM streaming_hosts
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as StreamingHostRow[]
    return [
      ...rows.map((row) => this.rowToStreamingHost(row)),
      ...this.listLegacyDeviceHosts(),
    ]
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

    const result = getDb()
      .prepare(
        `INSERT INTO streaming_hosts (label, endpoint, host, base_port, web_port, mac_address, room, network_path, enabled, props_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        label,
        parsed.endpoint,
        parsed.host,
        basePort,
        parsed.port,
        mac || null,
        String(input.room || '').trim() || null,
        networkPath,
        JSON.stringify({ streaming_kind: 'sunshine', capabilities: HOST_CAPABILITIES }),
      )

    return this.rowToStreamingHost(this.getHostRow(Number(result.lastInsertRowid)))
  }

  removeHost(id: string): void {
    const parsed = parseHostId(id)
    if (parsed.kind === 'legacy_device') {
      getDb().prepare('DELETE FROM devices WHERE id = ?').run(parsed.id)
      return
    }
    const result = getDb().prepare('DELETE FROM streaming_hosts WHERE id = ?').run(parsed.id)
    if (result.changes === 0) throw new NotFoundException(`Sunshine host not found: ${id}`)
  }

  async probeHost(id: string): Promise<StreamingHostProbe> {
    const host = this.getHost(id)
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

  async scanHosts(input: ScanStreamingHostsInput = {}): Promise<StreamingHostScanResult> {
    const hasExplicitSubnet = Boolean(String(input.subnet || '').trim())
    const subnets = normalizeScanSubnets(input.subnet)
    const ports = normalizeScanPorts(input.ports)
    const timeoutMs = normalizeScanTimeout(input.timeout_ms)
    const tasks: Array<{ ip: string; port: number }> = []
    const ips = hasExplicitSubnet
      ? subnets.flatMap((subnet) => expandCidr24(subnet))
      : await discoverNearbyIps(subnets)

    for (const ip of ips) {
      for (const port of ports) {
        tasks.push({ ip, port })
      }
    }
    const results = await mapWithConcurrency(tasks, 64, async ({ ip, port }) => {
      const result = await probeTcp(ip, port, timeoutMs)
      if (!result.reachable) return null
      return {
        ip,
        port,
        endpoint: endpointForStreamingPort(ip, port),
        reachable: true,
        latency_ms: result.latencyMs,
      }
    })
    const candidates = results.filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))

    return {
      subnet: subnets[0] ?? '',
      subnets,
      ports,
      scanned: tasks.length,
      candidates,
      count: candidates.length,
    }
  }

  async wakeHost(id: string) {
    const host = this.getHost(id)
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

  async pairHost(id: string): Promise<StreamingHostPairResult> {
    const host = this.getHost(id)
    if (host.source !== 'authorization') {
      throw new BadRequestException('legacy device hosts cannot store pairing state')
    }
    const runtimeHost = await this.ensureMoonlightRuntimeHost(host)
    const task = await this.startMoonlightPairTask(host, runtimeHost)
    return {
      id: host.id,
      label: host.label,
      endpoint: host.endpoint,
      pin: task.pin || '',
      task_id: task.task_id,
      pairing: {
        status: 'pairing',
        pin: task.pin,
        notes: ['Waiting for Sunshine PIN confirmation.'],
      },
    }
  }

  pairTask(taskId: string): StreamingHostPairTask {
    const task = this.pairTasks.get(taskId)
    if (!task) throw new NotFoundException(`Pairing task not found: ${taskId}`)
    return {
      task_id: task.task_id,
      host_id: task.host_id,
      status: task.status,
      pin: task.pin,
      error: task.error,
      started_at: task.started_at,
      updated_at: task.updated_at,
      pairing: task.pairing,
    }
  }

  async runtimeStatus(): Promise<MoonlightWebRuntimeStatus> {
    const managed = await this.moonlightRuntime.status()
    if (managed.binary) {
      return {
        name: 'moonlight-web-runtime',
        endpoint: managed.publicPath,
        enabled: true,
        registered: true,
        reachable: managed.reachable,
        status_code: managed.statusCode,
        checked_at: managed.checkedAt,
        configured_by: 'managed',
        pair_url: managed.publicPath,
        manage_hosts_url: managed.publicPath,
        public_path: managed.publicPath,
        managed: true,
        pid: managed.pid,
        binary: managed.binary,
        ...(managed.error ? { error: managed.error } : {}),
        notes: [
          `HomeSense is managing Moonlight Web as a child process on ${managed.endpoint}.`,
          'The browser uses the same HomeSense origin through /moonlight/.',
        ],
      }
    }

    const runtime = resolveMoonlightRuntimeConfig()
    const status = await probeUrl(runtime.endpoint)
    return {
      name: 'moonlight-web-runtime',
      endpoint: runtime.endpoint,
      enabled: true,
      registered: true,
      reachable: status.reachable,
      status_code: status.statusCode,
      checked_at: new Date().toISOString(),
      configured_by: runtime.configuredBy,
      pair_url: runtime.endpoint,
      manage_hosts_url: runtime.endpoint,
      managed: false,
      ...(status.error ? { error: status.error } : {}),
      notes: [
        managed.error || 'Managed Moonlight Web runtime is not available.',
        runtime.configuredBy === 'default'
          ? `Using the default Moonlight Web runtime endpoint: ${DEFAULT_RUNTIME_ENDPOINT}.`
          : 'Using the configured Moonlight Web runtime endpoint.',
        'HomeSense manages discovery, wake, probe, and session routing; the runtime owns pairing and video transport.',
      ],
    }
  }

  async updateRuntime(input: UpdateMoonlightWebRuntimeInput): Promise<MoonlightWebRuntimeStatus> {
    const raw = String(input.endpoint || '').trim()
    if (!raw) throw new BadRequestException('endpoint is required')
    const endpoint = normalizeRuntimeEndpoint(raw)
    writeRuntimeSnapshot(RUNTIME_SNAPSHOT_KEY, { endpoint })
    return this.runtimeStatus()
  }

  async sessionEntry(id: string, origin = ''): Promise<StreamingSessionEntry> {
    const host = this.getHost(id)
    const runtime = await this.runtimeStatus()
    const sessionId = `sunshine-${host.id.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
    const base = origin.replace(/\/+$/, '')
    const runtimeUrl = toPublicRuntimeUrl(runtime, base)
    const viewerUrl = runtimeUrl
      ? appendQuery(runtimeUrl, {
          host: host.host,
          endpoint: host.endpoint,
          session_id: sessionId,
        })
      : ''
    return {
      session_id: sessionId,
      host,
      runtime,
      viewer_url: viewerUrl,
      runtime_url: runtimeUrl,
      pair_url: base ? `${base}/authorizations?local=streaming` : '/authorizations?local=streaming',
      manage_hosts_url: base ? `${base}/authorizations?local=streaming` : '/authorizations?local=streaming',
      sunshine_url: host.endpoint,
      controller_url: base ? `${base}/streaming/control/${encodeURIComponent(sessionId)}` : `/streaming/control/${encodeURIComponent(sessionId)}`,
      monitor_url: base ? `${base}/streaming/monitor/${encodeURIComponent(sessionId)}` : `/streaming/monitor/${encodeURIComponent(sessionId)}`,
      notes: [
        'HomeSense owns host selection, wake, probe, and browser routing.',
        'Moonlight/Sunshine still own the low-latency video transport.',
      ],
    }
  }

  async listHostApps(id: string, origin = ''): Promise<StreamingRuntimeApp[]> {
    const host = this.getHost(id)
    const runtime = await this.runtimeStatus()
    if (!runtime.reachable) {
      throw new BadRequestException(runtime.error || 'Moonlight Web runtime is not ready.')
    }
    const runtimeHost = await this.ensureMoonlightRuntimeHost(host)
    let response: { apps?: MoonlightRuntimeApp[] }
    try {
      response = await this.moonlightRuntime.requestJson<{ apps?: MoonlightRuntimeApp[] }>(
        'GET',
        `/apps?host_id=${encodeURIComponent(String(runtimeHost.host_id))}`,
      )
    } catch (error) {
      throw new BadRequestException(normalizeMoonlightRuntimeError(error, host))
    }
    const base = toPublicRuntimeUrl(runtime, origin.replace(/\/+$/, ''))
    return (response.apps ?? []).map((app) => this.runtimeAppToEntry(app, runtimeHost.host_id, base))
  }

  private runtimeAppToEntry(app: MoonlightRuntimeApp, runtimeHostId: number | string, runtimeUrl: string): StreamingRuntimeApp {
    const appId = app.app_id
    const name = stringProp(app.name) || stringProp(app.AppTitle) || stringProp(app.title) || `App ${appId}`
    const streamUrl = runtimeUrl
      ? appendQuery(`${runtimeUrl.replace(/\/+$/, '')}/stream.html`, {
          hostId: String(runtimeHostId),
          appId: String(appId),
        })
      : ''
    return {
      app_id: appId,
      name,
      stream_url: streamUrl,
      running: app.running === true,
      hidden: app.hidden === true,
    }
  }

  private getHost(id: string): StreamingHost {
    const parsed = parseHostId(id)
    if (parsed.kind === 'legacy_device') {
      const device = getDb()
        .prepare('SELECT id, name, props, created_at, updated_at FROM devices WHERE id = ?')
        .get(parsed.id) as { id: number; name: string; props: string; created_at: string; updated_at: string } | undefined
      if (!device) throw new NotFoundException(`Sunshine host not found: ${id}`)
      return this.legacyDeviceToStreamingHost({
        id: device.id,
        name: device.name,
        props: safeParseRecord(device.props),
        created_at: device.created_at,
        updated_at: device.updated_at,
      })
    }
    return this.rowToStreamingHost(this.getHostRow(parsed.id))
  }

  private getHostRow(id: number): StreamingHostRow {
    const row = getDb()
      .prepare(
        `SELECT id, label, endpoint, host, base_port, web_port, mac_address, room, network_path, enabled, props_json, created_at, updated_at
         FROM streaming_hosts
         WHERE id = ?`,
      )
      .get(id) as StreamingHostRow | undefined
    if (!row) throw new NotFoundException(`Sunshine host not found: ${id}`)
    return row
  }

  private rowToStreamingHost(row: StreamingHostRow): StreamingHost {
    const props = safeParseRecord(row.props_json)
    const basePort = normalizePort(row.base_port, DEFAULT_BASE_PORT)
    const webPort = normalizePort(row.web_port, basePort)
    const parsed = parseEndpoint(row.endpoint || row.host, webPort)
    const tcpPorts = uniqueNumbers([webPort, basePort, 47984, 47989, 48010])
    const udpPorts = uniqueNumbers([47998, 47999, 48000, 48002, 48010])
    const discoveryPorts = uniqueNumbers([basePort, 47989, 48010])

    return {
      id: `streaming:${row.id}`,
      label: row.label,
      endpoint: parsed.endpoint,
      host: parsed.host,
      base_port: basePort,
      web_port: webPort,
      tcp_ports: tcpPorts,
      udp_ports: udpPorts,
      discovery_ports: discoveryPorts,
      mac_address: normalizeMac(row.mac_address || '') || undefined,
      room: row.room || undefined,
      network_path: normalizeNetworkPath(row.network_path),
      enabled: row.enabled !== 0,
      status: 'registered',
      integration_id: row.id,
      source: 'authorization',
      capabilities: Array.isArray(props.capabilities) ? props.capabilities.map(String) : HOST_CAPABILITIES,
      pairing: normalizePairing(props.pairing),
    }
  }

  private listLegacyDeviceHosts(): StreamingHost[] {
    const rows = getDb()
      .prepare('SELECT id, name, props, created_at, updated_at FROM devices ORDER BY created_at DESC, id DESC')
      .all() as Array<{ id: number; name: string; props: string; created_at: string; updated_at: string }>
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        props: safeParseRecord(row.props),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
      .filter(isSunshineHostDevice)
      .map((device) => this.legacyDeviceToStreamingHost(device))
  }

  private legacyDeviceToStreamingHost(device: UserDevice): StreamingHost {
    const props = device.props ?? {}
    const basePort = normalizePort(props.sunshine_base_port, DEFAULT_BASE_PORT)
    const webPort = normalizePort(props.sunshine_web_port, basePort)
    const endpoint = stringProp(props.sunshine_endpoint) || stringProp(props.sunshine_host) || ''
    const parsed = parseEndpoint(endpoint, webPort)
    const tcpPorts = uniqueNumbers([webPort, basePort, 47984, 47989, 48010])
    const udpPorts = uniqueNumbers([47998, 47999, 48000, 48002, 48010])
    const discoveryPorts = uniqueNumbers([basePort, 47989, 48010])

    return {
      id: `device:${device.id}`,
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
      source: 'legacy_device',
      capabilities: Array.isArray(props.capabilities) ? props.capabilities.map(String) : HOST_CAPABILITIES,
      pairing: normalizePairing(props.pairing),
    }
  }

  private updateHostPairing(id: number, pairing: StreamingHostPairing): void {
    const row = this.getHostRow(id)
    const props = safeParseRecord(row.props_json)
    props.pairing = pairing
    getDb()
      .prepare('UPDATE streaming_hosts SET props_json = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(props), id)
  }

  private async ensureMoonlightRuntimeHost(host: StreamingHost): Promise<MoonlightRuntimeHost> {
    const existing = await this.findMoonlightRuntimeHost(host)
    if (existing) return existing
    try {
      const created = await this.moonlightRuntime.requestJson<{ host: MoonlightRuntimeHost }>('POST', '/host', {
        address: host.host,
        http_port: host.web_port,
      })
      return created.host
    } catch (error) {
      throw new BadRequestException(normalizeMoonlightRuntimeError(error, host))
    }
  }

  private async findMoonlightRuntimeHost(host: StreamingHost): Promise<MoonlightRuntimeHost | null> {
    const stored = findStoredMoonlightRuntimeHost(host)
    if (stored) return stored

    try {
      const stream = await this.moonlightRuntime.requestJsonStream('/hosts')
      const first = await readFirstJsonLine<{ hosts?: MoonlightRuntimeHost[] }>(stream)
      if (!first || typeof first === 'string') return null
      const hosts = first?.hosts ?? []
      const matches: MoonlightRuntimeHost[] = []
      for (const summary of hosts) {
        const detail = await this.getMoonlightRuntimeHostDetail(summary)
        if (sameRuntimeHost(detail, host)) matches.push(detail)
      }
      return matches.find(isPairedRuntimeHost) ?? matches[0] ?? null
    } catch {
      return null
    }
  }

  private async getMoonlightRuntimeHostDetail(summary: MoonlightRuntimeHost): Promise<MoonlightRuntimeHost> {
    try {
      const response = await this.moonlightRuntime.requestJson<{ host?: MoonlightRuntimeHost }>(
        'GET',
        `/host?host_id=${encodeURIComponent(String(summary.host_id))}`,
      )
      return response.host ? { ...summary, ...response.host } : summary
    } catch {
      return summary
    }
  }

  private async startMoonlightPairTask(host: StreamingHost, runtimeHost: MoonlightRuntimeHost): Promise<StreamingHostPairTask> {
    const taskId = `pair-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const now = new Date().toISOString()
    const task: PairTaskRecord = {
      task_id: taskId,
      host_id: host.id,
      status: 'pin',
      started_at: now,
      updated_at: now,
      host,
    }
    this.pairTasks.set(taskId, task)

    let stream: NodeJS.ReadableStream
    try {
      stream = await this.moonlightRuntime.requestJsonStream('/pair', { host_id: runtimeHost.host_id })
    } catch (error) {
      throw new BadRequestException(normalizeMoonlightRuntimeError(error, host))
    }
    const first = await readFirstJsonLine<Record<string, any>>(stream)
    if (!first || typeof first === 'string') {
      task.status = 'failed'
      task.error = typeof first === 'string' ? first : 'Moonlight Web did not return a PIN.'
      task.updated_at = new Date().toISOString()
      throw new BadRequestException(task.error)
    }
    task.pin = String(first.Pin || first.pin || '')
    if (!task.pin) {
      task.status = 'failed'
      task.error = 'Moonlight Web did not return a PIN.'
      task.updated_at = new Date().toISOString()
      throw new BadRequestException(task.error)
    }

    void this.finishMoonlightPairTask(task, stream)
    return task
  }

  private async finishMoonlightPairTask(task: PairTaskRecord, stream: NodeJS.ReadableStream): Promise<void> {
    try {
      const second = await readFirstJsonLine<Record<string, any>>(stream)
      if (!second || typeof second === 'string') {
        task.status = 'failed'
        task.error = typeof second === 'string' ? second : 'Moonlight Web pairing ended without a result.'
        task.updated_at = new Date().toISOString()
        return
      }
      const pairing: StreamingHostPairing = {
        status: 'paired',
        paired_at: new Date().toISOString(),
        pin: task.pin,
        notes: ['Paired by Moonlight Web runtime through HomeSense.'],
      }
      this.updateHostPairing(task.host.integration_id, pairing)
      task.status = 'paired'
      task.pairing = pairing
      task.updated_at = new Date().toISOString()
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.updated_at = new Date().toISOString()
    }
  }
}

function isSunshineHostDevice(device: UserDevice): boolean {
  return device.props?.device_type === DEVICE_TYPE || device.props?.streaming_kind === 'sunshine'
}

function parseHostId(value: string): { kind: 'authorization' | 'legacy_device'; id: number } {
  const raw = String(value || '').trim()
  const legacy = raw.match(/^device:(\d+)$/)
  if (legacy) return { kind: 'legacy_device', id: Number(legacy[1]) }
  const streaming = raw.match(/^streaming:(\d+)$/)
  if (streaming) return { kind: 'authorization', id: Number(streaming[1]) }
  const numeric = Number(raw)
  if (Number.isInteger(numeric) && numeric > 0) return { kind: 'authorization', id: numeric }
  throw new BadRequestException('invalid host id')
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

function safeParseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function normalizePairing(value: unknown): StreamingHostPairing | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const status = raw.status === 'paired' || raw.status === 'pairing' || raw.status === 'failed' ? raw.status : 'unpaired'
  return {
    status,
    mock_pairing: raw.mock_pairing === true,
    paired_at: stringProp(raw.paired_at) || undefined,
    pin: stringProp(raw.pin) || undefined,
    client_certificate_ref: stringProp(raw.client_certificate_ref) || undefined,
    client_private_key_ref: stringProp(raw.client_private_key_ref) || undefined,
    server_certificate_ref: stringProp(raw.server_certificate_ref) || undefined,
    error: stringProp(raw.error) || undefined,
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : undefined,
  }
}

function normalizePairingRefs(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const raw = { ...(value as Record<string, unknown>) }
  for (const key of ['client_certificate_ref', 'client_private_key_ref', 'server_certificate_ref']) {
    const ref = stringProp(raw[key])
    if (!ref) continue
    const relative = path.relative(path.resolve(process.cwd(), '../..'), ref)
    raw[key] = relative && !relative.startsWith('..') ? relative.replace(/\\/g, '/') : ref
  }
  return raw
}

function sameRuntimeHost(candidate: MoonlightRuntimeHost, host: StreamingHost): boolean {
  const address = stringProp(candidate.address).toLowerCase()
  const name = stringProp(candidate.name).toLowerCase()
  const candidatePort = normalizePort(candidate.http_port, host.web_port)
  return candidatePort === host.web_port && (address === host.host.toLowerCase() || name === host.label.toLowerCase())
}

function isPairedRuntimeHost(candidate: MoonlightRuntimeHost): boolean {
  return stringProp(candidate.paired).toLowerCase() === 'paired'
}

function findStoredMoonlightRuntimeHost(host: StreamingHost): MoonlightRuntimeHost | null {
  const dataPath = path.resolve(process.cwd(), '../../data/runtime/moonlight-web/package/server/data.json')
  let parsed: any
  try {
    parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  } catch {
    return null
  }
  const records = parsed?.hosts && typeof parsed.hosts === 'object' && !Array.isArray(parsed.hosts)
    ? Object.entries(parsed.hosts as Record<string, Record<string, unknown>>)
    : []
  const matches = records
    .map(([id, record]) => ({ id, record }))
    .filter(({ record }) =>
      stringProp(record.address).toLowerCase() === host.host.toLowerCase() &&
      normalizePort(record.http_port, host.web_port) === host.web_port
    )
  const selected = matches.find(({ record }) => Boolean(record.pair_info)) ?? matches[0]
  if (!selected) return null
  return {
    host_id: selected.id,
    address: stringProp(selected.record.address),
    http_port: normalizePort(selected.record.http_port, host.web_port),
    name: stringProp((selected.record.cache as Record<string, unknown> | undefined)?.name) || host.label,
    paired: selected.record.pair_info ? 'Paired' : 'NotPaired',
  }
}

function normalizeMoonlightRuntimeError(error: unknown, host: StreamingHost): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/IncompleteMessage|SendRequest|HyperClient|timeout|ECONNREFUSED|unreachable/i.test(message)) {
    return `无法连接 Sunshine 主机 ${host.endpoint}。请确认 Sunshine 已启动，地址和端口正确。`
  }
  return message
}

function readFirstJsonLine<T>(stream: NodeJS.ReadableStream): Promise<T | string | null> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const cleanup = () => {
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
    }
    const finish = (value: T | string | null) => {
      cleanup()
      resolve(value)
    }
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index).trim()
      if (!line) return
      try {
        finish(JSON.parse(line) as T)
      } catch {
        finish(line)
      }
    }
    const onEnd = () => {
      const line = buffer.trim()
      if (!line) {
        finish(null)
        return
      }
      try {
        finish(JSON.parse(line) as T)
      } catch {
        finish(line)
      }
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('error', onError)
  })
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

function resolveMoonlightRuntimeConfig(): { endpoint: string; configuredBy: 'environment' | 'database' | 'default' } {
  const envEndpoint = String(process.env.MOONLIGHT_WEB_RUNTIME_URL || process.env.STREAMING_RUNTIME_URL || '').trim()
  if (envEndpoint) {
    return { endpoint: normalizeRuntimeEndpoint(envEndpoint), configuredBy: 'environment' }
  }

  const stored = readRuntimeSnapshot<{ endpoint?: string }>(RUNTIME_SNAPSHOT_KEY)
  const storedEndpoint = String(stored?.endpoint || '').trim()
  if (storedEndpoint) {
    return { endpoint: normalizeRuntimeEndpoint(storedEndpoint), configuredBy: 'database' }
  }

  return { endpoint: DEFAULT_RUNTIME_ENDPOINT, configuredBy: 'default' }
}

function normalizeRuntimeEndpoint(value: string): string {
  const raw = value.trim()
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withProtocol)
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new BadRequestException('runtime endpoint is invalid')
  }
}

async function probeUrl(url: string): Promise<{ reachable: boolean; statusCode: number | null; error?: string }> {
  return requestProbeUrl(url, 1800)
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0 && value <= 65535))]
}

function appendQuery(rawUrl: string, params: Record<string, string>): string {
  try {
    const url = new URL(rawUrl)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }
    return url.toString()
  } catch {
    return rawUrl
  }
}

function toPublicRuntimeUrl(runtime: { endpoint: string }, origin: string): string {
  const endpoint = runtime.endpoint || ''
  if (!endpoint) return ''
  if (endpoint.startsWith('/')) return origin ? `${origin}${endpoint}` : endpoint
  return endpoint
}

function normalizeScanPorts(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_SCAN_PORTS
  const ports = uniqueNumbers(value.map((item) => Number(item)))
  return ports.length > 0 ? ports.slice(0, 8) : DEFAULT_SCAN_PORTS
}

function normalizeScanTimeout(value: unknown): number {
  const timeout = Number(value)
  if (!Number.isFinite(timeout)) return 350
  return Math.max(100, Math.min(2000, Math.trunc(timeout)))
}

function normalizeScanSubnets(value: unknown): string[] {
  const raw = String(value || '').trim()
  if (raw) return [normalizeCidr24(raw)]
  return [DEFAULT_SCAN_SUBNET]
}

function normalizeCidr24(value: string): string {
  const raw = value.trim()
  const host = raw.includes('/') ? raw.split('/')[0] : raw
  const parts = host.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new BadRequestException('subnet must be an IPv4 address or /24 CIDR')
  }
  if (parts[0] === 127) throw new BadRequestException('loopback subnet is not scannable')
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
}

function expandCidr24(value: string): string[] {
  const subnet = normalizeCidr24(value)
  const [a, b, c] = subnet.split('/')[0].split('.')
  return Array.from({ length: 254 }, (_, index) => `${a}.${b}.${c}.${index + 1}`)
}

async function discoverNearbyIps(subnets: string[]): Promise<string[]> {
  const prefixes = subnets.map((subnet) => subnet.split('/')[0].split('.').slice(0, 3).join('.'))
  const localIps = new Set<string>()
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4') localIps.add(entry.address)
    }
  }
  try {
    const { stdout } = await execFileAsync('arp', ['-a'], { timeout: 1500 })
    const ips = [...stdout.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)]
      .map((match) => match[0])
      .filter((ip) => {
        const parts = ip.split('.').map((part) => Number(part))
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
        if (parts[0] === 127 || parts[3] === 0 || parts[3] === 255) return false
        return prefixes.some((prefix) => ip.startsWith(`${prefix}.`))
      })
    return [...new Set([...[...localIps].filter((ip) => prefixes.some((prefix) => ip.startsWith(`${prefix}.`))), ...ips])].slice(0, 64)
  } catch {
    return [...localIps].filter((ip) => prefixes.some((prefix) => ip.startsWith(`${prefix}.`))).slice(0, 64)
  }
}

function endpointForStreamingPort(ip: string, port: number): string {
  return `http://${ip}:${port}`
}

function requestProbeUrl(url: string, timeoutMs: number): Promise<{ reachable: boolean; statusCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve({ reachable: false, statusCode: null, error: 'invalid url' })
      return
    }

    const client = parsed.protocol === 'https:' ? https : http
    const request = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
      } as https.RequestOptions,
      (response) => {
        response.resume()
        resolve({
          reachable: response.statusCode != null && response.statusCode < 500,
          statusCode: response.statusCode ?? null,
        })
      },
    )
    request.once('timeout', () => {
      request.destroy()
      resolve({ reachable: false, statusCode: null, error: 'timeout' })
    })
    request.once('error', (error) => {
      resolve({ reachable: false, statusCode: null, error: error.message })
    })
    request.end()
  })
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  const started = Date.now()
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (result: { reachable: boolean; latencyMs?: number; error?: string }) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ reachable: true, latencyMs: Date.now() - started }))
    socket.once('timeout', () => finish({ reachable: false, error: 'timeout' }))
    socket.once('error', (error) => finish({ reachable: false, error: error.message }))
  })
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await mapper(items[current])
    }
  })
  await Promise.all(workers)
  return results
}

function runMoonlightDriverPair(host: StreamingHost): Promise<{ pin: string; pairing: StreamingHostPairing }> {
  return new Promise((resolve, reject) => {
    const pairingDir = path.join(PAIRING_ROOT, host.id.replace(/[^a-zA-Z0-9_-]+/g, '-'))
    const command = resolveMoonlightDriverCommand()
    const args = [...command.args, 'pair', '--host', host.host, '--port', String(host.web_port), '--output-dir', pairingDir]
    const child = spawn(command.file, args, {
      cwd: command.cwd,
      env: {
        ...process.env,
        ...(command.pythonPath ? { PYTHONPATH: [process.env.PYTHONPATH, command.pythonPath].filter(Boolean).join(process.platform === 'win32' ? ';' : ':') } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let pin = ''
    let pairing: StreamingHostPairing | undefined
    const timer = setTimeout(() => {
      child.kill()
      reject(new BadRequestException('moonlight-driver pair timed out'))
    }, 30000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const payload = JSON.parse(line) as Record<string, any>
          if (payload.stage === 'pin' && payload.pin) pin = String(payload.pin)
          if (payload.stage === 'paired' && payload.data) pairing = normalizePairing(normalizePairingRefs(payload.data)) ?? undefined
        } catch {
          // Wait until process exit; partial lines can be ignored here.
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new BadRequestException(stderr || `moonlight-driver exited with code ${code}`))
        return
      }
      if (!pin || !pairing) {
        reject(new BadRequestException('moonlight-driver did not return pairing data'))
        return
      }
      resolve({ pin, pairing })
    })
  })
}

function resolveMoonlightDriverCommand(): { file: string; args: string[]; cwd: string; pythonPath?: string } {
  const root = process.cwd().replace(/apps[\\/]server$/, '')
  const realDriver = String(process.env.MOONLIGHT_DRIVER_BIN || '').trim()
  if (realDriver) {
    return {
      file: realDriver,
      args: [],
      cwd: root,
    }
  }
  return {
    file: 'python',
    args: ['-m', 'moonlight_driver'],
    cwd: root,
    pythonPath: path.join(root, 'packages/moonlight-driver/src'),
  }
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
