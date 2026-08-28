import type { CLIBridge } from '../integration/index.js'

export type JsonSchema = Record<string, unknown>

export interface DeviceCapabilityRegistryDevice {
  id: number
  name: string
  device_type: string
  mi_did?: string | null
  adb_ip?: string | null
}

export interface DeviceAgentCapability {
  capability_id: string
  name: string
  kind: 'action' | 'property'
  source: 'adb' | 'mi'
  input_schema: JsonSchema
  output_schema: JsonSchema | null
  risk: 'normal' | 'high_impact' | 'destructive' | 'privacy_export'
  metadata?: Record<string, unknown>
}

export interface AdbCapabilityDefinition {
  id: string
  name: string
  kind: 'action' | 'property'
  adbAction: string
  input_schema: JsonSchema
  output_schema: JsonSchema | null
  risk?: DeviceAgentCapability['risk']
}

export interface CapabilityResolutionQuery {
  capabilityId?: string
  capabilityName?: string
}

export const EMPTY_INPUT_SCHEMA = {
  type: 'object',
  required: [],
  properties: {},
}

const ADB_CAPABILITIES_PHONE: AdbCapabilityDefinition[] = [
  { id: 'adb.back', name: '返回', kind: 'action', adbAction: 'back', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.home', name: '主页', kind: 'action', adbAction: 'home', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.enter', name: '确认', kind: 'action', adbAction: 'enter', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.volume_up', name: '音量+', kind: 'action', adbAction: 'volume_up', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.volume_down', name: '音量-', kind: 'action', adbAction: 'volume_down', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.power', name: '电源', kind: 'action', adbAction: 'power', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  { id: 'adb.wake', name: '唤醒', kind: 'action', adbAction: 'wake', input_schema: EMPTY_INPUT_SCHEMA, output_schema: null },
  {
    id: 'adb.tap',
    name: '点击坐标',
    kind: 'action',
    adbAction: 'tap',
    input_schema: {
      type: 'object',
      required: ['x', 'y'],
      properties: {
        x: { type: 'integer', description: 'X coordinate in pixels.' },
        y: { type: 'integer', description: 'Y coordinate in pixels.' },
      },
    },
    output_schema: {
      type: 'object',
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
      },
    },
  },
  {
    id: 'adb.input_text',
    name: '输入文本',
    kind: 'action',
    adbAction: 'input_text',
    input_schema: {
      type: 'object',
      required: ['text'],
      properties: { text: { type: 'string', description: 'Text to input.' } },
    },
    output_schema: null,
  },
  {
    id: 'adb.launch_app',
    name: '启动应用',
    kind: 'action',
    adbAction: 'launch_app',
    input_schema: {
      type: 'object',
      required: ['package'],
      properties: { package: { type: 'string', description: 'Android package name.' } },
    },
    output_schema: {
      type: 'object',
      properties: {
        package: { type: 'string' },
        component: { type: 'string' },
      },
    },
  },
  {
    id: 'adb.screenshot',
    name: '截屏',
    kind: 'property',
    adbAction: 'screenshot',
    input_schema: EMPTY_INPUT_SCHEMA,
    output_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        size_bytes: { type: 'integer' },
      },
    },
  },
  {
    id: 'adb.current_app',
    name: '当前应用',
    kind: 'property',
    adbAction: 'current_app',
    input_schema: EMPTY_INPUT_SCHEMA,
    output_schema: {
      type: 'object',
      properties: {
        current_app: { type: 'string' },
        activity: { type: 'string' },
      },
    },
  },
  {
    id: 'adb.ui_tree',
    name: '界面元素',
    kind: 'property',
    adbAction: 'ui_tree',
    input_schema: EMPTY_INPUT_SCHEMA,
    output_schema: {
      type: 'object',
      properties: {
        elements: { type: 'array' },
        count: { type: 'integer' },
        formatted: { type: 'string' },
      },
    },
  },
]

const ADB_CAPABILITIES_TV_BOX: AdbCapabilityDefinition[] = [
  ...ADB_CAPABILITIES_PHONE,
  {
    id: 'adb.tap_element',
    name: '按索引点击',
    kind: 'action',
    adbAction: 'tap_element',
    input_schema: {
      type: 'object',
      required: [],
      properties: {
        index: { type: 'integer', description: 'Element index.' },
        text: { type: 'string', description: 'Visible element text.' },
      },
    },
    output_schema: {
      type: 'object',
      properties: { element: { type: 'object' } },
    },
  },
  {
    id: 'adb.swipe',
    name: '滑动',
    kind: 'action',
    adbAction: 'swipe',
    input_schema: {
      type: 'object',
      required: ['start_x', 'start_y', 'end_x', 'end_y'],
      properties: {
        start_x: { type: 'integer' },
        start_y: { type: 'integer' },
        end_x: { type: 'integer' },
        end_y: { type: 'integer' },
        duration: { type: 'integer' },
      },
    },
    output_schema: {
      type: 'object',
      properties: {
        start: { type: 'object' },
        end: { type: 'object' },
        duration: { type: 'integer' },
      },
    },
  },
]

export const MI_CAPABILITY_TO_KEY: Record<string, string> = {
  '开机': 'turn_on',
  '关机': 'shutdown',
  '音量加': 'volume_up',
  '音量减': 'volume_down',
  '频道加': 'channel_up',
  '频道减': 'channel_down',
  '静音开启': 'mute_on',
  '静音关闭': 'mute_off',
  '切换输入源': 'input_source',
  '电源开关': 'power',
  '亮': 'brightness',
  '亮度': 'brightness',
  '色温': 'color_temperature',
  '目标温度': 'target_temperature',
  '模式': 'mode',
  '风速': 'fan_speed',
  '窗帘位置': 'cover_position',
  '执行文本命令': 'execute_text',
  '播放文本': 'play_text',
  '播放音乐': 'play_music',
  '音量增加': 'volume_up',
  '音量减小': 'volume_down',
  '暂停播放': 'pause',
  '遥控按键': 'ir_key',
}

export const MI_PROPERTY_KEYS = new Set([
  'power',
  'brightness',
  'color_temperature',
  'target_temperature',
  'mode',
  'fan_speed',
  'cover_position',
])

export function normalizeDeviceTypeForSkill(deviceType: string): string {
  if (deviceType === 'television' || deviceType === 'stb') return 'tv_box'
  return deviceType
}

export async function buildDeviceCapabilityRegistry(
  device: DeviceCapabilityRegistryDevice,
  cliBridge: CLIBridge,
): Promise<DeviceAgentCapability[]> {
  const capabilities: DeviceAgentCapability[] = []

  if (device.adb_ip) {
    capabilities.push(...getAdbDefinitions(device.device_type).map(toDeviceAgentCapability))
  }

  if (device.mi_did) {
    const result = await cliBridge.run('mi-cli', 'device_capabilities', { did: device.mi_did })
    if (result.status === 'success') {
      const miCaps = ((result.data as { capabilities?: Array<{ name: string; kind: string; type?: string; source?: string }> })?.capabilities ?? [])
      capabilities.push(...miCaps.map(toMiDeviceAgentCapability))
    }
  }

  return capabilities
}

export async function resolveDeviceCapability(
  device: DeviceCapabilityRegistryDevice,
  query: CapabilityResolutionQuery,
  cliBridge: CLIBridge,
): Promise<DeviceAgentCapability | null> {
  const capabilityId = query.capabilityId ?? ''
  const capabilityName = query.capabilityName ?? ''

  if (capabilityId.startsWith('adb.')) {
    const definition = getAdbDefinitions(device.device_type).find((cap) => cap.id === capabilityId || cap.name === capabilityId)
    return definition ? toDeviceAgentCapability(definition) : null
  }

  if (capabilityId.startsWith('mi.') || capabilityName) {
    const key = resolveMiCapabilityKey(capabilityId, capabilityName)
    if (!key) return null
    return {
      capability_id: `mi.${key}`,
      name: capabilityName || key,
      kind: 'action',
      source: 'mi',
      input_schema: buildMiInputSchema(key),
      output_schema: null,
      risk: 'normal',
      metadata: { mi_capability: key },
    }
  }

  const capabilities = await buildDeviceCapabilityRegistry(device, cliBridge)
  return capabilities.find((cap) => cap.name === capabilityName || cap.capability_id === capabilityId) ?? null
}

export function resolveMiCapabilityKey(capabilityId: string, capabilityName: string): string {
  if (capabilityId.startsWith('mi.')) return capabilityId.slice(3)
  return MI_CAPABILITY_TO_KEY[capabilityName] ?? ''
}

export function getAdbDefinitions(deviceType: string): AdbCapabilityDefinition[] {
  return deviceType === 'tv_box' ? ADB_CAPABILITIES_TV_BOX : ADB_CAPABILITIES_PHONE
}

function toDeviceAgentCapability(definition: AdbCapabilityDefinition): DeviceAgentCapability {
  return {
    capability_id: definition.id,
    name: definition.name,
    kind: definition.kind,
    source: 'adb',
    input_schema: definition.input_schema,
    output_schema: definition.output_schema,
    risk: definition.risk ?? 'normal',
    metadata: { adb_action: definition.adbAction },
  }
}

function toMiDeviceAgentCapability(capability: { name: string; kind: string; type?: string }): DeviceAgentCapability {
  const key = MI_CAPABILITY_TO_KEY[capability.name] ?? capability.name
  return {
    capability_id: `mi.${key}`,
    name: capability.name,
    kind: capability.kind === 'action' ? 'action' : 'property',
    source: 'mi',
    input_schema: buildMiInputSchema(key, capability.type),
    output_schema: null,
    risk: 'normal',
    metadata: { mi_capability: key, value_type: capability.type ?? 'none' },
  }
}

function buildMiInputSchema(key: string, type?: string): JsonSchema {
  if (MI_PROPERTY_KEYS.has(key)) {
    return {
      type: 'object',
      required: ['value'],
      properties: { value: { type: type && type !== 'none' ? normalizeJsonType(type) : 'string' } },
    }
  }
  if (!type || type === 'none') return EMPTY_INPUT_SCHEMA
  if (key === 'execute_text' || key === 'play_text' || key === 'play_music') {
    return {
      type: 'object',
      required: key === 'play_music' ? [] : ['text'],
      properties: { text: { type: 'string' } },
    }
  }
  return {
    type: 'object',
    required: ['value'],
    properties: { value: { type: normalizeJsonType(type) } },
  }
}

function normalizeJsonType(type: string): string {
  if (type === 'integer' || type === 'float') return 'number'
  if (type === 'boolean') return 'boolean'
  return 'string'
}
