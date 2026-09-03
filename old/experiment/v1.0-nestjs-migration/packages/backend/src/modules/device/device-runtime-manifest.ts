import { getDb as defaultGetDb } from '../../db/index.js'
import { cliBridge } from '../integration/index.js'
import { buildDeviceCardProjection, buildDeviceRuntimeCard, type DeviceCardRow, type DeviceCardProjection } from './device-card-projection.js'
import { buildDeviceCapabilityRegistry, type DeviceAgentCapability } from './device-capability-registry.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>
export type DeviceRuntimeManifestCapabilityMode = 'none' | 'summary' | 'full'

export interface DeviceRuntimeManifestOptions {
  includeCapabilities?: DeviceRuntimeManifestCapabilityMode
  online?: boolean
  limit?: number
}

export interface DeviceRuntimeManifestCapabilitySummary {
  capability_id: string
  name: string
  kind: DeviceAgentCapability['kind']
  source: DeviceAgentCapability['source']
  risk: DeviceAgentCapability['risk']
  required_fields: string[]
  input_schema: DeviceAgentCapability['input_schema']
  output_schema: DeviceAgentCapability['output_schema']
  sample_arguments: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface DeviceRuntimeManifestItem extends DeviceCardProjection {
  capability_count: number
  capabilities?: DeviceRuntimeManifestCapabilitySummary[] | DeviceAgentCapability[]
}

export interface DeviceRuntimeManifest {
  version: number
  generated_at: string
  include_capabilities: DeviceRuntimeManifestCapabilityMode
  devices: DeviceRuntimeManifestItem[]
}

export async function buildDeviceRuntimeManifest(
  options: DeviceRuntimeManifestOptions = {},
  getDb: GetDbFn = defaultGetDb,
): Promise<DeviceRuntimeManifest> {
  const includeCapabilities = options.includeCapabilities ?? 'summary'
  const limit = Math.max(1, options.limit ?? 20)
  const db = getDb()
  const rows = db.prepare(`
    SELECT d.*, r.name AS room_name
    FROM user_devices d
    LEFT JOIN rooms r ON r.id = d.room_id
    ORDER BY d.created_at DESC
    LIMIT ?
  `).all(limit) as DeviceCardRow[]

  const cards = options.online
    ? await Promise.all(rows.map((row) => buildDeviceRuntimeCard(row)))
    : rows.map((row) => buildDeviceCardProjection(row))

  const devices: DeviceRuntimeManifestItem[] = []
  for (const card of cards) {
    const deviceItem: DeviceRuntimeManifestItem = {
      ...card,
      capability_count: 0,
    }

    if (includeCapabilities === 'none') {
      devices.push(deviceItem)
      continue
    }

    const capabilities = await buildCapabilityList(card)
    deviceItem.capability_count = capabilities.length
    deviceItem.capabilities = includeCapabilities === 'full'
      ? capabilities
      : capabilities.map(toCapabilitySummary)
    devices.push(deviceItem)
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    include_capabilities: includeCapabilities,
    devices,
  }
}

async function buildCapabilityList(card: DeviceCardProjection): Promise<DeviceAgentCapability[]> {
  if (!card.bindings.mi_did && !card.bindings.adb_ip) return []
  return buildDeviceCapabilityRegistry({
    id: card.id,
    name: card.name,
    device_type: card.device_type,
    mi_did: card.bindings.mi_did,
    adb_ip: card.bindings.adb_ip,
  }, cliBridge)
}

function toCapabilitySummary(capability: DeviceAgentCapability): DeviceRuntimeManifestCapabilitySummary {
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

function requiredFields(schema: DeviceAgentCapability['input_schema']): string[] {
  const required = schema.required
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : []
}

function sampleArguments(capability: DeviceAgentCapability): Record<string, unknown> {
  const id = capability.capability_id
  if (id === 'mi.ir_key') return { key: 'BACK' }
  if (id === 'adb.launch_app') return { package: 'com.xiaodianshi.tv.yst' }
  if (id === 'adb.input_text') return { text: 'Hello' }
  if (id === 'adb.tap') return { x: 0, y: 0 }
  if (id === 'adb.swipe') return { start_x: 0, start_y: 0, end_x: 0, end_y: 0, duration: 300 }
  if (id === 'adb.tap_element') return { index: 0 }
  if (id === 'mi.execute_text' || id === 'mi.play_text' || id === 'mi.play_music') return { text: '播放音乐' }

  const args: Record<string, unknown> = {}
  const properties = capability.input_schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return args

  for (const [key, raw] of Object.entries(properties as Record<string, { type?: unknown }>)) {
    const type = typeof raw.type === 'string' ? raw.type : 'string'
    if (type === 'number' || type === 'integer') {
      args[key] = 0
      continue
    }
    if (type === 'boolean') {
      args[key] = false
      continue
    }
    args[key] = ''
  }

  return args
}
