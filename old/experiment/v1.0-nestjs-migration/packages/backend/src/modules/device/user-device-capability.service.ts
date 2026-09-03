import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { cliBridge } from '../integration/index.js'
import { getDb } from '../../db/index.js'
import {
  buildDeviceCapabilityRegistry,
  getAdbDefinitions,
  type DeviceAgentCapability,
} from './device-capability-registry.js'
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

export interface LegacyCapabilityExecuteBody {
  capability?: string
  capability_id?: string
  params?: string
  arguments?: Record<string, unknown>
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
  const existing = readCapabilitiesFromDb(miDid)
  writeCapabilitiesToDb(miDid, existing ?? {
    did: miDid,
    name: '',
    device_type: 'other',
    room: '',
    capabilities: [],
  }, data)
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

export class UserDeviceCapabilityService {
  async getCapabilities(id: number) {
    const db = getDb()
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(id) as {
      id: number
      mi_did?: string | null
      adb_ip?: string
      name?: string
      device_type?: string
      room_name?: string | null
    } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }

    const capabilities = await buildDeviceCapabilityRegistry({
      id,
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

    if (device.mi_did) {
      writeCapabilitiesToDb(device.mi_did, cacheData)
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
    const capability = body.capability?.trim() ?? ''
    const capabilityId = body.capability_id?.trim() ?? ''
    if (!Number.isFinite(id)) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'device id must be a number' }
    }
    if (!capability && !capabilityId) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'capability or capability_id is required' }
    }

    const result = await executeDeviceAgentTool('execute_device_capability', {
      device_id: id,
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
    logUsage(id, capability || capabilityId, body.params, 'ok', result.data)
    return {
      status: 'success',
      data: {
        capability: data?.capability ?? capability,
        capability_id: data?.capability_id ?? capabilityId,
        source: data?.source,
        output: data?.output ?? result.data,
      },
    }
  }

  async getIrKeys(id: number, forceRefresh: boolean) {
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(id) as { mi_did?: string | null } | undefined
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
  }

  async pressIrKey(id: number, keyId: string) {
    if (!keyId) return { status: 'error', error: 'INVALID_PARAMS', message: 'key_id is required' }

    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(id) as { mi_did?: string | null } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING' }

    const result = await cliBridge.run('mi-cli', 'device_ir_press', { did: device.mi_did, key_id: keyId })
    if (result.status === 'success') {
      return { status: 'success', data: { key_id: keyId, result: result.data } }
    }
    return { status: 'error', error: result.error, message: result.message }
  }

  getCapabilityHistory(id: string) {
    if (!existsSync(HISTORY_LOG)) return { history: [] }
    const lines = readFileSync(HISTORY_LOG, 'utf-8').trim().split('\n').filter(Boolean)
    const entries = lines
      .map((line) => {
        const [time, deviceId, capability, params, status, ...resultParts] = line.split('|')
        return { time, deviceId, capability, params, status, result: resultParts.join('|') || '' }
      })
      .filter((entry) => entry.deviceId === id)
      .slice(-100)
    return { history: entries }
  }
}

export const userDeviceCapabilityService = new UserDeviceCapabilityService()
