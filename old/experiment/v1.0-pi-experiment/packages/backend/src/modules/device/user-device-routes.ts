import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FastifyInstance } from 'fastify'
import { cliBridge } from '../cli-bridge/index.js'
import { getDb } from '../../db/index.js'
import { pingAllDevices } from './device-network.js'
import {
  buildDeviceCardProjection,
  buildDeviceRuntimeCard,
  type DeviceCardRow,
} from './device-card-projection.js'
import {
  buildDeviceCapabilityRegistry,
  getAdbDefinitions,
  type DeviceAgentCapability,
} from './device-capability-registry.js'
import { buildDeviceRuntimeManifest } from './device-runtime-manifest.js'
import { executeDeviceAgentTool } from './device-agent-tools.js'

const HISTORY_LOG = join('data', 'capability-usage.log')

export interface AdbCapDef {
  name: string
  name_en: string
  kind: 'action' | 'property'
  source: string
  adbAction: string
  input: Record<string, { type: string; description: string }> | null
  output: Record<string, { type: string; description: string }> | null
}

const ADB_CAPABILITY_EN_NAMES: Record<string, string> = {
  'adb.back': 'Back',
  'adb.home': 'Home',
  'adb.enter': 'Enter',
  'adb.volume_up': 'Volume Up',
  'adb.volume_down': 'Volume Down',
  'adb.power': 'Power',
  'adb.wake': 'Wake',
  'adb.tap': 'Tap XY',
  'adb.input_text': 'Input Text',
  'adb.launch_app': 'Launch App',
  'adb.screenshot': 'Screenshot',
  'adb.current_app': 'Current App',
  'adb.ui_tree': 'UI Tree',
  'adb.tap_element': 'Tap by Index',
  'adb.swipe': 'Swipe',
}

export function getAdbCapabilities(deviceType: string): AdbCapDef[] {
  return getAdbDefinitions(deviceType).map((definition) => ({
    name: definition.name,
    name_en: ADB_CAPABILITY_EN_NAMES[definition.id] ?? definition.adbAction,
    kind: definition.kind,
    source: 'adb',
    adbAction: definition.adbAction,
    input: jsonSchemaPropertiesToLegacy(definition.input_schema),
    output: jsonSchemaPropertiesToLegacy(definition.output_schema),
  }))
}

export function getAdbCapabilitiesForCache(deviceType: string): Array<{
  name: string
  kind: string
  type?: string
  source: string
  output?: Record<string, { type: string; description: string }> | null
}> {
  return getAdbCapabilities(deviceType).map((capability) => ({
    name: capability.name,
    kind: capability.kind,
    type: capability.input ? 'string' : undefined,
    source: capability.source,
    output: capability.output,
  }))
}

function jsonSchemaPropertiesToLegacy(schema: Record<string, unknown> | null): Record<string, { type: string; description: string }> | null {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
  const result: Record<string, { type: string; description: string }> = {}
  for (const [key, raw] of Object.entries(properties as Record<string, { type?: unknown; description?: unknown }>)) {
    result[key] = {
      type: typeof raw.type === 'string' ? raw.type : 'unknown',
      description: typeof raw.description === 'string' ? raw.description : '',
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

function adbDeviceCacheKey(deviceId: number, adbIp: string): string {
  return `adb:${deviceId}:${adbIp}`
}
interface CacheData {
  did: string
  name: string
  device_type: string
  room: string
  capabilities: Array<{ name: string; kind: string; type?: string }>
}

interface IrKeysData {
  controller_id: string
  name: string
  keys: Array<{ key_id: string; name: string; type?: string }>
}

function readCapabilitiesFromDb(miDid: string): CacheData | null {
  const db = getDb()
  const row = db.prepare('SELECT capabilities_json, updated_at FROM device_capabilities WHERE mi_did = ?').get(miDid) as { capabilities_json: string; updated_at: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.capabilities_json)
  } catch {
    return null
  }
}

function writeCapabilitiesToDb(miDid: string, data: CacheData, irKeys: IrKeysData | null = null): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO device_capabilities (mi_did, capabilities_json, ir_keys_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(mi_did) DO UPDATE SET
      capabilities_json = excluded.capabilities_json,
      ir_keys_json = excluded.ir_keys_json,
      updated_at = excluded.updated_at
  `).run(miDid, JSON.stringify(data), irKeys ? JSON.stringify(irKeys) : '[]')
}

function readIrKeysFromDb(miDid: string): IrKeysData | null {
  const db = getDb()
  const row = db.prepare('SELECT ir_keys_json FROM device_capabilities WHERE mi_did = ?').get(miDid) as { ir_keys_json: string } | undefined
  if (!row || row.ir_keys_json === '[]') return null
  try {
    const parsed = JSON.parse(row.ir_keys_json)
    if (!parsed || !parsed.controller_id) return null
    return parsed
  } catch {
    return null
  }
}

function writeIrKeysToDb(miDid: string, data: IrKeysData): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO device_capabilities (mi_did, ir_keys_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(mi_did) DO UPDATE SET
      ir_keys_json = excluded.ir_keys_json,
      updated_at = excluded.updated_at
  `).run(miDid, JSON.stringify(data))
}

// ─── App list cache (by adb_ip) ──────────────────────────────────────────
interface AppInfo {
  package: string
  name: string
}

function readAppsFromDb(adbIp: string): { apps: AppInfo[]; updated_at: string } | null {
  const db = getDb()
  const row = db.prepare('SELECT apps_json, updated_at FROM device_apps WHERE adb_ip = ?').get(adbIp) as { apps_json: string; updated_at: string } | undefined
  if (!row) return null
  try {
    return { apps: JSON.parse(row.apps_json), updated_at: row.updated_at }
  } catch {
    return null
  }
}

function writeAppsToDb(adbIp: string, apps: AppInfo[]): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO device_apps (adb_ip, apps_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(adb_ip) DO UPDATE SET
      apps_json = excluded.apps_json,
      updated_at = excluded.updated_at
  `).run(adbIp, JSON.stringify(apps))
}

function toDeviceManagementCapability(capability: DeviceAgentCapability): {
  capability_id: string
  name: string
  kind: string
  type?: string
  source: string
  input_schema: Record<string, unknown>
  output_schema?: Record<string, unknown> | null
  output?: Record<string, { type: string; description: string }> | null
  risk: string
  metadata?: Record<string, unknown>
} {
  return {
    capability_id: capability.capability_id,
    name: capability.name,
    kind: capability.kind,
    type: inferLegacyCapabilityType(capability.input_schema),
    source: capability.source,
    input_schema: capability.input_schema,
    output_schema: capability.output_schema,
    output: jsonSchemaPropertiesToLegacy(capability.output_schema),
    risk: capability.risk,
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

interface LegacyCapabilityExecuteBody {
  capability?: string
  capability_id?: string
  params?: string
  arguments?: Record<string, unknown>
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
      return {
        start_x,
        start_y,
        end_x,
        end_y,
        ...(Number.isFinite(duration) ? { duration } : {}),
      }
    }
    return { value: params }
  }
  if (capabilityId === 'adb.tap_element' || capability === '按索引点击') {
    if (params.startsWith('index:')) return { index: Number(params.slice(6).trim()) }
    const index = Number(params)
    return Number.isFinite(index) ? { index } : { text: params }
  }
  if (capabilityId === 'adb.launch_app' || capability === '启动应用') return { package: params }
  if (
    capabilityId === 'adb.input_text'
    || capabilityId === 'mi.execute_text'
    || capabilityId === 'mi.play_text'
    || capabilityId === 'mi.play_music'
    || ['输入文本', '执行文本命令', '播放文本', '播放音乐'].includes(capability)
  ) {
    return { text: params }
  }
  if (capabilityId === 'mi.ir_key' || capability === '遥控按键') return { key_id: params }
  return { value: coerceLegacyValue(params) }
}

function coerceLegacyValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function logUsage(deviceId: number, capability: string, params: string | undefined, status: string, result?: unknown): void {
  const resultStr = result !== undefined ? JSON.stringify(result, null, 0).replace(/\n/g, ' ') : ''
  const line = `${new Date().toISOString()}|${deviceId}|${capability}|${params ?? ''}|${status}|${resultStr}\n`
  writeFileSync(HISTORY_LOG, line, { flag: 'a' })
}

export async function userDeviceRoutes(app: FastifyInstance) {
  // List user-created devices (with room name from join)
  app.get('/api/user-devices', async () => {
    const db = getDb()
    const devices = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC
    `).all()
    return { devices }
  })

  // Unified device card projection for device management, chat trace and sandbox previews.
  app.get('/api/user-devices/cards', async (request) => {
    const query = request.query as { online?: string }
    const checkOnline = query.online === 'true' || query.online === '1'
    const db = getDb()
    const devices = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC
    `).all() as DeviceCardRow[]
    const cards = checkOnline
      ? await Promise.all(devices.map(device => buildDeviceRuntimeCard(device)))
      : devices.map(device => buildDeviceCardProjection(device))
    return { cards }
  })

  // Unified device runtime manifest for frontend helper panels and assistant awareness.
  app.get('/api/user-devices/runtime-manifest', async (request) => {
    const query = request.query as { online?: string; capabilities?: string; limit?: string }
    const includeCapabilities = query.capabilities === 'full'
      ? 'full'
      : query.capabilities === 'none'
        ? 'none'
        : 'summary'
    const manifest = await buildDeviceRuntimeManifest({
      online: query.online === 'true' || query.online === '1',
      includeCapabilities,
      limit: query.limit ? Number(query.limit) : 20,
    })
    return { manifest }
  })

  // Ping all devices with IP addresses (parallel, non-blocking)
  app.get('/api/user-devices/ping-all', async () => {
    const online = await pingAllDevices()
    return { online }
  })

  // Get one device
  app.get('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(Number(id))
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    return { device }
  })

  // Create device
  app.post('/api/user-devices', async (request) => {
    const body = request.body as {
      name: string
      device_type: string
      room_id?: number | null
      mi_did?: string | null
      adb_ip?: string
      ip_address?: string
    }
    if (!body.name) return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }

    let adbIp = body.adb_ip?.trim() || ''
    if (adbIp && !adbIp.includes(':')) adbIp = `${adbIp}:5555`

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO user_devices (name, device_type, room_id, mi_did, adb_ip, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      body.name, body.device_type || 'other', body.room_id ?? null,
      body.mi_did || null, adbIp, body.ip_address || '',
    )
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(result.lastInsertRowid)
    return { status: 'success', data: { device } }
  })

  // Update device
  app.put('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      device_type?: string
      room_id?: number | null
      mi_did?: string | null
      adb_ip?: string
      ip_address?: string
    }

    const db = getDb()
    const sets: string[] = []
    const vals: unknown[] = []

    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name) }
    if (body.device_type !== undefined) { sets.push('device_type = ?'); vals.push(body.device_type) }
    if (body.room_id !== undefined) { sets.push('room_id = ?'); vals.push(body.room_id ?? null) }
    if (body.mi_did !== undefined) { sets.push('mi_did = ?'); vals.push(body.mi_did || null) }
    if (body.adb_ip !== undefined) {
      const adbIp = body.adb_ip.trim()
      sets.push('adb_ip = ?'); vals.push(adbIp && !adbIp.includes(':') ? `${adbIp}:5555` : adbIp)
    }
    if (body.ip_address !== undefined) { sets.push('ip_address = ?'); vals.push(body.ip_address) }

    if (sets.length === 0) return { status: 'error', error: 'INVALID_PARAMS', message: 'No fields to update' }
    sets.push("updated_at = datetime('now')")
    vals.push(Number(id))
    db.prepare(`UPDATE user_devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(Number(id))
    return { status: 'success', data: { device } }
  })

  // Delete device
  app.delete('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    db.prepare('DELETE FROM user_devices WHERE id = ?').run(Number(id))
    return { status: 'success' }
  })

  // Get device capabilities from the same registry used by LLM tools and sandbox rehearsal.
  app.get('/api/user-devices/:id/capabilities', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(Number(id)) as {
      id: number
      mi_did?: string | null
      adb_ip?: string
      name?: string
      device_type?: string
      room_name?: string | null
    } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }
    const capabilities = await buildDeviceCapabilityRegistry({
      id: Number(id),
      name: device.name || '',
      device_type: device.device_type || 'other',
      mi_did: device.mi_did,
      adb_ip: device.adb_ip,
    }, cliBridge)
    const cacheData: CacheData = {
      did: device.mi_did || `adb:${id}`,
      name: device.name || '',
      device_type: device.device_type || 'other',
      room: device.room_name || '',
      capabilities: capabilities.map(toDeviceManagementCapability),
    }

    if (cacheData.capabilities.length === 0) {
      return { status: 'error', error: 'NO_CAPABILITIES', message: 'Device has no available capabilities' }
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
  })

  // Execute capability through the same registry-backed path used by LLM tools.
  app.post('/api/user-devices/:id/capabilities/execute', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as LegacyCapabilityExecuteBody
    const deviceId = Number(id)
    const capability = body.capability?.trim() ?? ''
    const capabilityId = body.capability_id?.trim() ?? ''
    if (!Number.isFinite(deviceId)) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'device id must be a number' }
    }
    if (!capability && !capabilityId) {
      return {
        status: 'error',
        error: 'INVALID_PARAMS',
        message: 'capability or capability_id is required',
      }
    }

    const result = await executeDeviceAgentTool('execute_device_capability', {
      device_id: deviceId,
      ...(capabilityId ? { capability_id: capabilityId } : {}),
      ...(capability ? { capability } : {}),
      arguments: parseLegacyCapabilityArguments(body),
    })
    if (result.status !== 'success') {
      return {
        status: 'error',
        error: result.error,
        message: result.message || 'Failed to execute capability',
        data: result.data,
      }
    }

    const data = result.data as { capability?: string; capability_id?: string; source?: string; output?: unknown } | undefined
    logUsage(deviceId, capability || capabilityId, body.params, 'ok', result.data)
    return {
      status: 'success',
      data: {
        capability: data?.capability ?? capability,
        capability_id: data?.capability_id ?? capabilityId,
        source: data?.source,
        output: data?.output ?? result.data,
      },
    }
  })

  // Get IR keys for an IR device (from DB cache or mi-cli)
  app.get('/api/user-devices/:id/ir-keys', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING' }

    if (!forceRefresh) {
      const cached = readIrKeysFromDb(device.mi_did)
      if (cached) return { status: 'success', data: cached }
    }

    const result = await cliBridge.run('mi-cli', 'device_ir_keys', { did: device.mi_did })
    if (result.status === 'success') {
      const data = result.data as IrKeysData
      writeIrKeysToDb(device.mi_did, data)
      return { status: 'success', data }
    }
    return { status: 'error', error: result.error, message: result.message }
  })

  // Press an IR key by key_id
  app.post('/api/user-devices/:id/ir-press', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { key_id: string }
    if (!body.key_id) return { status: 'error', error: 'INVALID_PARAMS', message: 'key_id is required' }

    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING' }

    const result = await cliBridge.run('mi-cli', 'device_ir_press', { did: device.mi_did, key_id: body.key_id })
    if (result.status === 'success') {
      return { status: 'success', data: { key_id: body.key_id, result: result.data } }
    }
    return { status: 'error', error: result.error, message: result.message }
  })

  // Capability usage history (simple log-based)
  app.get('/api/user-devices/:id/capabilities/history', async (request) => {
    const { id } = request.params as { id: string }
    if (!existsSync(HISTORY_LOG)) return { history: [] }
    const lines = readFileSync(HISTORY_LOG, 'utf-8').trim().split('\n').filter(Boolean)
    const entries = lines
      .map(l => { const [time, deviceId, capability, params, status, ...resultParts] = l.split('|'); return { time, deviceId, capability, params, status, result: resultParts.join('|') || '' } })
      .filter(e => e.deviceId === id)
      .slice(-100)
    return { history: entries }
  })

  // Get installed app list (cached, refresh optional)
  app.get('/api/user-devices/:id/apps', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { adb_ip?: string } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()

    if (!forceRefresh) {
      const cached = readAppsFromDb(adbIp)
      if (cached) return { status: 'success', data: cached }
    }

    // Ensure ADB connected before listing apps
    const connResult = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connResult.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB 设备未连接: ${adbIp}` }
    }

    // Fetch from adb: list packages (only non-system with filter)
    const listResult = await cliBridge.run('adb-cli', 'list_packages', { device: adbIp })
    if (listResult.status !== 'success') {
      return { status: 'error', error: listResult.error || 'FAILED', message: listResult.message }
    }

    const packages: string[] = (listResult.data as { packages?: string[] })?.packages ?? []
    const apps: AppInfo[] = packages.map(pkg => ({
      package: pkg,
      name: pkg.split('.').pop() ?? pkg,
    }))

    writeAppsToDb(adbIp, apps)
    return {
      status: 'success',
      data: { apps, updated_at: new Date().toISOString() },
    }
  })

  // Launch an app by package name
  app.post('/api/user-devices/:id/apps/launch', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { package?: string }
    if (!body.package) return { status: 'error', error: 'INVALID_PARAMS', message: 'package is required' }

    const db = getDb()
    const device = db.prepare('SELECT adb_ip FROM user_devices WHERE id = ?').get(Number(id)) as { adb_ip?: string } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()

    // Ensure ADB connected before launch
    const connResult = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connResult.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB 设备未连接: ${adbIp}` }
    }

    const result = await cliBridge.run('adb-cli', 'launch_app', { device: adbIp, package: body.package })
    if (result.status !== 'success') {
      return { status: 'error', error: result.error || 'LAUNCH_FAILED', message: result.message }
    }
    logUsage(Number(id), '启动应用', body.package, 'ok', result.data)
    return { status: 'success', data: result.data }
  })
  app.get('/api/user-devices/mi-candidates', async () => {
    const result = await cliBridge.run('mi-cli', 'discover')
    if (result.status === 'success' && result.data) {
      const data = result.data as { devices?: Array<Record<string, unknown>> }
      const devices = (data.devices ?? []).map(d => ({
        did: d.did,
        name: d.name,
        model: d.model,
        device_type: d.device_type,
        room_name: d.room_name,
        home_name: d.home_name,
      }))
      return { devices }
    }
    return { devices: [], error: (result as any).error }
  })
}
