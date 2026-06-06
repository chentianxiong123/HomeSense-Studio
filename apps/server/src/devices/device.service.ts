import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cliBridge, type CLIResult } from '../cli/cli-bridge'
import { getDb } from '../db/database'
import {
  buildDeviceCapabilityRegistry,
  getAdbDefinitions,
  MI_PROPERTY_KEYS,
  resolveMiCapabilityKey,
  type DeviceAgentCapability,
} from './device-capability-registry'
import { buildDeviceCardProjection, buildDeviceRuntimeCard } from './device-card-projection'
import { pingAllDevices } from './device-network'
import type {
  CreateUserDeviceInput,
  DeviceRuntimeManifest,
  DeviceRuntimeManifestItem,
  DeviceType,
  LegacyCapabilityExecuteBody,
  UpdateUserDeviceInput,
  UserDevice,
} from './device.types'

export interface CacheData {
  did: string
  name: string
  device_type: string
  room: string
  capabilities: Array<Record<string, unknown>>
}

export interface IrKeysData {
  controller_id: string
  name: string
  keys: Array<{ key_id: string; name: string; type?: string }>
}

export interface AppInfo {
  package: string
  name: string
}

export interface MiCandidate {
  did: string
  name: string
  model: string
  device_type: string
  room_name: string
  home_name: string
}

type CapabilityExecutionResult =
  | { status: 'success'; data: { source?: string; output?: unknown }; duration_ms: number }
  | { status: 'error'; error: string; message?: string; data?: unknown; duration_ms: number }

const ALLOWED_DEVICE_TYPES: ReadonlySet<DeviceType> = new Set([
  'television',
  'stb',
  'speaker',
  'router',
  'outlet',
  'phone',
  'tv_box',
  'tablet',
  'computer',
  'other',
])

const HISTORY_LOG = path.resolve(__dirname, '../../../../data/capability-usage.log')
const MI_CANDIDATES_CACHE_TTL_MS = 5 * 60 * 1000
const MI_CLI_DEVICE_CACHE_FILE = path.join(process.env.MI_CLI_CONFIG_DIR || path.join(os.homedir(), '.cache', 'mi-cli'), 'devices.json')

@Injectable()
export class DeviceService {
  private miCandidatesCache: { devices: MiCandidate[]; cachedAt: number } | null = null
  private miCandidatesInFlight: Promise<{ devices: MiCandidate[]; source?: string; error?: string; message?: string }> | null = null

  list(): UserDevice[] {
    return this.listRows()
  }

  async listCards(checkOnline: boolean) {
    const devices = this.listRows()
    const cards = checkOnline
      ? await Promise.all(devices.map((device) => buildDeviceRuntimeCard(device)))
      : devices.map((device) => buildDeviceCardProjection(device))
    return { cards }
  }

  async getRuntimeManifest(input: {
    online?: boolean
    capabilities?: string
    limit?: number
  }): Promise<{ manifest: DeviceRuntimeManifest }> {
    const includeCapabilities = input.capabilities === 'full'
      ? 'full'
      : input.capabilities === 'none'
        ? 'none'
        : 'summary'
    const limit = Math.max(1, input.limit ?? 20)
    const rows = this.listRows(limit)
    const cards = input.online
      ? await Promise.all(rows.map((row) => buildDeviceRuntimeCard(row)))
      : rows.map((row) => buildDeviceCardProjection(row))

    const devices: DeviceRuntimeManifestItem[] = []
    for (const card of cards) {
      const item: DeviceRuntimeManifestItem = { ...card, capability_count: 0 }
      if (includeCapabilities === 'none') {
        devices.push(item)
        continue
      }

      const capabilities = await buildDeviceCapabilityRegistry({
        id: card.id,
        name: card.name,
        device_type: card.device_type,
        mi_did: card.bindings.mi_did,
        adb_ip: card.bindings.adb_ip,
      }, cliBridge)
      item.capability_count = capabilities.length
      item.capabilities = includeCapabilities === 'full'
        ? capabilities as unknown as Array<Record<string, unknown>>
        : capabilities.map(toCapabilitySummary)
      devices.push(item)
    }

    return {
      manifest: {
        version: 1,
        generated_at: new Date().toISOString(),
        include_capabilities: includeCapabilities,
        devices,
      },
    }
  }

  async pingAll() {
    return { online: await pingAllDevices() }
  }

  get(id: number): UserDevice {
    const device = this.getOptional(id)
    if (!device) throw new NotFoundException(`User device not found: ${id}`)
    return device
  }

  create(input: CreateUserDeviceInput): UserDevice {
    const body = this.normalizeWriteInput(input, true)
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO user_devices (name, device_type, room_id, mi_did, adb_ip, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(body.name, body.device_type, body.room_id, body.mi_did, body.adb_ip, body.ip_address)
    return this.get(Number(result.lastInsertRowid))
  }

  update(id: number, input: UpdateUserDeviceInput): UserDevice {
    this.get(id)
    const body = this.normalizeWriteInput(input, false)
    const sets: string[] = []
    const vals: unknown[] = []

    for (const [key, value] of Object.entries(body)) {
      sets.push(`${key} = ?`)
      vals.push(value)
    }

    if (sets.length === 0) {
      throw new BadRequestException('No fields to update')
    }

    sets.push("updated_at = datetime('now')")
    vals.push(id)
    getDb().prepare(`UPDATE user_devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  remove(id: number): { status: 'deleted'; id: number } {
    this.get(id)
    getDb().prepare('DELETE FROM user_devices WHERE id = ?').run(id)
    return { status: 'deleted', id }
  }

  async listMiCandidates(options?: { refresh?: boolean }) {
    const now = Date.now()
    if (!options?.refresh && this.miCandidatesCache && now - this.miCandidatesCache.cachedAt < MI_CANDIDATES_CACHE_TTL_MS) {
      return { devices: this.miCandidatesCache.devices, source: 'memory_cache' }
    }
    if (!options?.refresh) {
      const diskDevices = this.loadMiCandidatesFromDiskCache()
      if (diskDevices.length > 0) {
        this.miCandidatesCache = { devices: diskDevices, cachedAt: now }
        return { devices: diskDevices, source: 'mi_cli_disk_cache' }
      }
    }
    if (!options?.refresh && this.miCandidatesInFlight) return this.miCandidatesInFlight

    this.miCandidatesInFlight = this.loadMiCandidates()
    try {
      return await this.miCandidatesInFlight
    } finally {
      this.miCandidatesInFlight = null
    }
  }

  private async loadMiCandidates() {
    const result = await cliBridge.run('mi-cli', 'discover', { summary_only: true })
    if (result.status === 'success' && result.data) {
      const data = result.data as { devices?: Array<Record<string, unknown>>; summary?: Array<Record<string, unknown>> }
      const rows = data.summary ?? data.devices ?? []
      const devices = this.toMiCandidates(rows)
      this.miCandidatesCache = { devices, cachedAt: Date.now() }
      return { devices, source: 'mi_cli_cache_first' }
    }
    if (this.miCandidatesCache) {
      return { devices: this.miCandidatesCache.devices, source: 'stale_memory_cache', error: result.status === 'error' ? result.error : undefined, message: result.status === 'error' ? result.message : undefined }
    }
    if (result.status === 'error') return { devices: [], error: result.error, message: result.message }
    return { devices: [] }
  }

  private loadMiCandidatesFromDiskCache(): MiCandidate[] {
    if (!fs.existsSync(MI_CLI_DEVICE_CACHE_FILE)) return []
    try {
      const cache = JSON.parse(fs.readFileSync(MI_CLI_DEVICE_CACHE_FILE, 'utf8')) as { devices?: Array<Record<string, unknown>> }
      return this.toMiCandidates(cache.devices ?? [])
    } catch {
      return []
    }
  }

  private toMiCandidates(rows: Array<Record<string, unknown>>): MiCandidate[] {
    return rows.map((device) => ({
      did: String(device.did ?? ''),
      name: String(device.name ?? ''),
      model: String(device.model ?? ''),
      device_type: String(device.device_type ?? ''),
      room_name: String(device.room_name ?? device.room ?? ''),
      home_name: String(device.home_name ?? ''),
    }))
  }

  async getCapabilities(id: number) {
    const device = this.get(id)
    const capabilities = await buildDeviceCapabilityRegistry(device, cliBridge)
    const cacheData: CacheData = {
      did: device.mi_did || `adb:${id}`,
      name: device.name,
      device_type: device.device_type,
      room: device.room_name || '',
      capabilities: capabilities.map(toDeviceManagementCapability),
    }

    if (cacheData.capabilities.length === 0) {
      return { status: 'error', error: 'NO_CAPABILITIES', message: 'Device has no available capabilities' }
    }

    if (device.mi_did) {
      this.writeCapabilitiesToDb(device.mi_did, cacheData)
    }

    return {
      status: 'success',
      data: cacheData,
      registry: {
        version: 1,
        source: 'device-capability-registry',
        capabilities,
      },
    }
  }

  async executeCapability(id: number, body: LegacyCapabilityExecuteBody) {
    const device = this.get(id)
    const capability = body.capability?.trim() ?? ''
    const capabilityId = body.capability_id?.trim() ?? ''
    if (!capability && !capabilityId) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'capability or capability_id is required' }
    }

    const args = parseLegacyCapabilityArguments(body)
    const result = await this.executeResolvedCapability(device, capabilityId, capability, args)

    if (result.status === 'error') {
      return { status: 'error', error: result.error, message: result.message, data: result.data }
    }

    this.logUsage(id, capability || capabilityId, body.params, 'ok', result.data)
    return {
      status: 'success',
      data: {
        capability: capability || capabilityId,
        capability_id: capabilityId,
        source: result.data?.source,
        output: result.data?.output ?? result.data,
      },
    }
  }

  async getIrKeys(id: number, forceRefresh: boolean) {
    const device = this.get(id)
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING' }

    if (!forceRefresh) {
      const cached = this.readIrKeysFromDb(device.mi_did)
      if (cached) return { status: 'success', data: cached }
    }

    const result = await cliBridge.run('mi-cli', 'device_ir_keys', { did: device.mi_did })
    if (result.status === 'success') {
      const data = result.data as IrKeysData
      this.writeIrKeysToDb(device.mi_did, data)
      return { status: 'success', data }
    }
    return { status: 'error', error: result.error, message: result.message }
  }

  async pressIrKey(id: number, keyId: string) {
    if (!keyId) return { status: 'error', error: 'INVALID_PARAMS', message: 'key_id is required' }
    const device = this.get(id)
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING' }

    const result = await cliBridge.run('mi-cli', 'device_ir_press', { did: device.mi_did, key_id: keyId })
    if (result.status === 'success') {
      this.logUsage(id, '遥控按键', keyId, 'ok', result.data)
      return { status: 'success', data: { key_id: keyId, result: result.data } }
    }
    return { status: 'error', error: result.error, message: result.message }
  }

  getCapabilityHistory(id: string) {
    if (!fs.existsSync(HISTORY_LOG)) return { history: [] }
    const lines = fs.readFileSync(HISTORY_LOG, 'utf-8').trim().split('\n').filter(Boolean)
    const history = lines
      .map((line) => {
        const [time, deviceId, capability, params, status, ...resultParts] = line.split('|')
        return { time, deviceId, capability, params, status, result: resultParts.join('|') || '' }
      })
      .filter((entry) => entry.deviceId === id)
      .slice(-100)
    return { history }
  }

  async getApps(id: number, forceRefresh: boolean) {
    const device = this.get(id)
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()
    if (!forceRefresh) {
      const cached = this.readAppsFromDb(adbIp)
      if (cached) return { status: 'success', data: cached }
    }

    const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connected.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB device is not connected: ${adbIp}` }
    }

    const result = await cliBridge.run('adb-cli', 'list_packages', { device: adbIp })
    if (result.status !== 'success') {
      return { status: 'error', error: result.error || 'FAILED', message: result.message }
    }

    const packages: string[] = (result.data as { packages?: string[] })?.packages ?? []
    const apps = packages.map((pkg) => ({ package: pkg, name: pkg.split('.').pop() ?? pkg }))
    this.writeAppsToDb(adbIp, apps)
    return { status: 'success', data: { apps, updated_at: new Date().toISOString() } }
  }

  async launchApp(id: number, pkg?: string) {
    if (!pkg) return { status: 'error', error: 'INVALID_PARAMS', message: 'package is required' }
    const device = this.get(id)
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()
    const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connected.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB device is not connected: ${adbIp}` }
    }

    const result = await cliBridge.run('adb-cli', 'launch_app', { device: adbIp, package: pkg })
    if (result.status !== 'success') {
      return { status: 'error', error: result.error || 'LAUNCH_FAILED', message: result.message }
    }

    this.logUsage(id, '启动应用', pkg, 'ok', result.data)
    return { status: 'success', data: result.data }
  }

  private listRows(limit?: number): UserDevice[] {
    const sql = `
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC, d.id DESC
      ${limit ? 'LIMIT ?' : ''}
    `
    const statement = getDb().prepare(sql)
    return (limit ? statement.all(limit) : statement.all()) as UserDevice[]
  }

  private getOptional(id: number): UserDevice | undefined {
    return getDb().prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(id) as UserDevice | undefined
  }

  private normalizeWriteInput(
    input: CreateUserDeviceInput | UpdateUserDeviceInput,
    creating: boolean,
  ): Partial<UserDevice> & { name?: string; device_type?: DeviceType } {
    const body: Partial<UserDevice> & { name?: string; device_type?: DeviceType } = {}

    if ('name' in input && input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new BadRequestException('name is required')
      body.name = name
    } else if (creating) {
      throw new BadRequestException('name is required')
    }

    if (input.device_type !== undefined) {
      if (!ALLOWED_DEVICE_TYPES.has(input.device_type)) {
        throw new BadRequestException(`Invalid device_type: ${input.device_type}`)
      }
      body.device_type = input.device_type
    } else if (creating) {
      body.device_type = 'other'
    }

    if (input.room_id !== undefined) body.room_id = input.room_id ?? null
    if (input.mi_did !== undefined) body.mi_did = input.mi_did?.trim() || null
    if (input.adb_ip !== undefined) body.adb_ip = normalizeAdbIp(input.adb_ip)
    else if (creating) body.adb_ip = ''
    if (input.ip_address !== undefined) body.ip_address = input.ip_address.trim()
    else if (creating) body.ip_address = ''

    return body
  }

  private async executeResolvedCapability(
    device: UserDevice,
    capabilityId: string,
    capabilityName: string,
    args: Record<string, unknown>,
  ): Promise<CapabilityExecutionResult> {
    if (capabilityId.startsWith('adb.')) {
      return this.executeAdbCapability(device, capabilityId, args)
    }
    if (capabilityId.startsWith('mi.') || capabilityName) {
      return this.executeMiCapability(device, capabilityId, capabilityName, args)
    }
    return { status: 'error', error: 'INVALID_PARAMS', message: 'capability_id or capability is required', duration_ms: 0 }
  }

  private async executeAdbCapability(
    device: UserDevice,
    capabilityId: string,
    args: Record<string, unknown>,
  ): Promise<CapabilityExecutionResult> {
    if (!device.adb_ip) {
      return { status: 'error', error: 'NO_ADB_BINDING', message: 'Device has no ADB binding', duration_ms: 0 }
    }

    const definition = getAdbDefinitions(device.device_type).find((cap) => cap.id === capabilityId || cap.name === capabilityId)
    if (!definition) {
      return { status: 'error', error: 'UNKNOWN_CAPABILITY', message: `Unknown ADB capability: ${capabilityId}`, duration_ms: 0 }
    }

    const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
    if (connected.status !== 'success') return connected

    const params: Record<string, unknown> = { device: device.adb_ip }
    if (definition.adbAction === 'tap') {
      params.x = requiredNumber(args, 'x')
      params.y = requiredNumber(args, 'y')
    } else if (definition.adbAction === 'input_text') {
      params.text = requiredString(args, 'text')
    } else if (definition.adbAction === 'launch_app') {
      params.package = requiredString(args, 'package')
    } else if (definition.adbAction === 'tap_element') {
      if (args.index !== undefined) params.index = requiredNumber(args, 'index')
      if (args.text !== undefined) params.text = requiredString(args, 'text')
    } else if (definition.adbAction === 'swipe') {
      params.start_x = requiredNumber(args, 'start_x')
      params.start_y = requiredNumber(args, 'start_y')
      params.end_x = requiredNumber(args, 'end_x')
      params.end_y = requiredNumber(args, 'end_y')
      if (args.duration !== undefined) params.duration = requiredNumber(args, 'duration')
    }

    const result = await cliBridge.run('adb-cli', definition.adbAction, params)
    if (result.status === 'error') return result
    return { ...result, data: { source: 'adb', output: result.data } }
  }

  private async executeMiCapability(
    device: UserDevice,
    capabilityId: string,
    capabilityName: string,
    args: Record<string, unknown>,
  ): Promise<CapabilityExecutionResult> {
    if (!device.mi_did) {
      return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no MI binding', duration_ms: 0 }
    }

    const capabilityKey = resolveMiCapabilityKey(capabilityId, capabilityName)
    if (!capabilityKey) {
      return {
        status: 'error',
        error: 'UNKNOWN_CAPABILITY',
        message: `Unknown MI capability: ${capabilityName || capabilityId}`,
        duration_ms: 0,
      }
    }

    let result: CLIResult
    if (capabilityKey === 'ir_key') {
      const keyId = String(args.key_id ?? args.key ?? args.value ?? '').trim()
      if (!keyId) return { status: 'error', error: 'INVALID_PARAMS', message: 'IR key_id is required', duration_ms: 0 }
      result = await cliBridge.run('mi-cli', 'device_ir_press', { did: device.mi_did, key_id: keyId })
    } else if (capabilityKey === 'execute_text') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: requiredString(args, 'text') })
    } else if (capabilityKey === 'play_text') {
      result = await cliBridge.run('mi-cli', 'speaker_play', { did: device.mi_did, text: requiredString(args, 'text') })
    } else if (capabilityKey === 'play_music') {
      const text = typeof args.text === 'string' && args.text.trim() ? `播放${args.text}` : '播放音乐'
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text })
    } else if (MI_PROPERTY_KEYS.has(capabilityKey)) {
      result = await cliBridge.run('mi-cli', 'device_prop', {
        did: device.mi_did,
        capability: capabilityKey,
        value: args.value,
      })
    } else {
      result = await cliBridge.run('mi-cli', 'device_action', {
        did: device.mi_did,
        capability: capabilityKey,
        params: args.value !== undefined ? [args.value] : [],
      })
    }

    if (result.status === 'error') return result
    return { ...result, data: { source: 'mi', output: result.data } }
  }

  private readCapabilitiesFromDb(miDid: string): CacheData | null {
    const row = getDb().prepare('SELECT capabilities_json FROM device_capabilities WHERE mi_did = ?').get(miDid) as { capabilities_json: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.capabilities_json) as CacheData
    } catch {
      return null
    }
  }

  private writeCapabilitiesToDb(miDid: string, data: CacheData, irKeys: IrKeysData | null = null): void {
    getDb().prepare(`
      INSERT INTO device_capabilities (mi_did, capabilities_json, ir_keys_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(mi_did) DO UPDATE SET
        capabilities_json = excluded.capabilities_json,
        ir_keys_json = excluded.ir_keys_json,
        updated_at = excluded.updated_at
    `).run(miDid, JSON.stringify(data), irKeys ? JSON.stringify(irKeys) : '[]')
  }

  private readIrKeysFromDb(miDid: string): IrKeysData | null {
    const row = getDb().prepare('SELECT ir_keys_json FROM device_capabilities WHERE mi_did = ?').get(miDid) as { ir_keys_json: string } | undefined
    if (!row || row.ir_keys_json === '[]') return null
    try {
      const parsed = JSON.parse(row.ir_keys_json) as IrKeysData
      return parsed?.controller_id ? parsed : null
    } catch {
      return null
    }
  }

  private writeIrKeysToDb(miDid: string, data: IrKeysData): void {
    const existing = this.readCapabilitiesFromDb(miDid) ?? {
      did: miDid,
      name: '',
      device_type: 'other',
      room: '',
      capabilities: [],
    }
    this.writeCapabilitiesToDb(miDid, existing, data)
  }

  private readAppsFromDb(adbIp: string): { apps: AppInfo[]; updated_at: string } | null {
    const row = getDb().prepare('SELECT apps_json, updated_at FROM device_apps WHERE adb_ip = ?').get(adbIp) as { apps_json: string; updated_at: string } | undefined
    if (!row) return null
    try {
      return { apps: JSON.parse(row.apps_json) as AppInfo[], updated_at: row.updated_at }
    } catch {
      return null
    }
  }

  private writeAppsToDb(adbIp: string, apps: AppInfo[]): void {
    getDb().prepare(`
      INSERT INTO device_apps (adb_ip, apps_json, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(adb_ip) DO UPDATE SET
        apps_json = excluded.apps_json,
        updated_at = excluded.updated_at
    `).run(adbIp, JSON.stringify(apps))
  }

  private logUsage(deviceId: number, capability: string, params: string | undefined, status: string, result?: unknown): void {
    fs.mkdirSync(path.dirname(HISTORY_LOG), { recursive: true })
    const resultText = result !== undefined ? JSON.stringify(result).replace(/\n/g, ' ') : ''
    const line = `${new Date().toISOString()}|${deviceId}|${capability}|${params ?? ''}|${status}|${resultText}\n`
    fs.writeFileSync(HISTORY_LOG, line, { flag: 'a' })
  }
}

function normalizeAdbIp(value: string): string {
  const adbIp = value.trim()
  return adbIp && !adbIp.includes(':') ? `${adbIp}:5555` : adbIp
}

function toDeviceManagementCapability(capability: DeviceAgentCapability): Record<string, unknown> {
  return {
    capability_id: capability.capability_id,
    name: capability.name,
    kind: capability.kind,
    type: inferLegacyCapabilityType(capability.input_schema),
    source: capability.source,
    input_schema: capability.input_schema,
    output_schema: capability.output_schema,
    risk: capability.risk,
    metadata: capability.metadata,
  }
}

function toCapabilitySummary(capability: DeviceAgentCapability): Record<string, unknown> {
  return {
    capability_id: capability.capability_id,
    name: capability.name,
    kind: capability.kind,
    source: capability.source,
    risk: capability.risk,
    required_fields: requiredFields(capability.input_schema),
    input_schema: capability.input_schema,
    output_schema: capability.output_schema,
    sample_arguments: sampleArguments(capability),
    metadata: capability.metadata,
  }
}

function inferLegacyCapabilityType(schema: Record<string, unknown>): string | undefined {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined
  const value = (properties as Record<string, { type?: string }>).value
  const text = (properties as Record<string, { type?: string }>).text
  return value?.type ?? text?.type
}

function requiredFields(schema: Record<string, unknown>): string[] {
  const required = schema.required
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : []
}

function sampleArguments(capability: DeviceAgentCapability): Record<string, unknown> {
  if (capability.capability_id === 'mi.ir_key') return { key_id: 'power' }
  if (capability.capability_id === 'adb.launch_app') return { package: 'com.example.app' }
  if (capability.capability_id === 'adb.input_text') return { text: 'Hello' }
  if (capability.capability_id === 'adb.tap') return { x: 0, y: 0 }
  if (capability.capability_id === 'adb.swipe') return { start_x: 0, start_y: 0, end_x: 0, end_y: 0, duration: 300 }
  if (capability.capability_id === 'adb.tap_element') return { index: 0 }
  if (capability.capability_id === 'mi.execute_text' || capability.capability_id === 'mi.play_text') return { text: '播放音乐' }

  const args: Record<string, unknown> = {}
  const properties = capability.input_schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return args

  for (const [key, raw] of Object.entries(properties as Record<string, { type?: unknown }>)) {
    const type = typeof raw.type === 'string' ? raw.type : 'string'
    if (type === 'number' || type === 'integer') args[key] = 0
    else if (type === 'boolean') args[key] = false
    else args[key] = ''
  }
  return args
}

function parseLegacyCapabilityArguments(body: LegacyCapabilityExecuteBody): Record<string, unknown> {
  if (body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)) {
    return body.arguments
  }

  const params = body.params?.trim()
  if (!params) return {}

  try {
    const parsed = JSON.parse(params) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}

  const capability = body.capability ?? ''
  const capabilityId = body.capability_id ?? ''
  if (capabilityId === 'adb.tap' || capability === '点击坐标') {
    const [x, y] = params.split(',').map((item) => Number(item.trim()))
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { value: params }
  }
  if (capabilityId === 'adb.swipe' || capability === '滑动') {
    const [start_x, start_y, end_x, end_y, duration] = params.split(',').map((item) => Number(item.trim()))
    if ([start_x, start_y, end_x, end_y].every(Number.isFinite)) {
      return { start_x, start_y, end_x, end_y, ...(Number.isFinite(duration) ? { duration } : {}) }
    }
    return { value: params }
  }
  if (capabilityId === 'adb.tap_element' || capability === '按索引点击') {
    const index = Number(params.startsWith('index:') ? params.slice(6).trim() : params)
    return Number.isFinite(index) ? { index } : { text: params }
  }
  if (capabilityId === 'adb.launch_app' || capability === '启动应用') return { package: params }
  if (capabilityId === 'adb.input_text' || capabilityId === 'mi.execute_text' || capabilityId === 'mi.play_text') return { text: params }
  if (capabilityId === 'mi.ir_key' || capability === '遥控按键') return { key_id: params }
  return { value: coerceLegacyValue(params) }
}

function coerceLegacyValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = typeof args[key] === 'number' ? args[key] : Number(args[key])
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return value
}
