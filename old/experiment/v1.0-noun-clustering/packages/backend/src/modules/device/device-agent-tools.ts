import { cliBridge, type CLIResult } from '../integration/index.js'
import { getDb } from '../../db/index.js'
import type { ExecutorInvokeResult } from '../executor-gateway/index.js'
import { buildDeviceCardProjection, buildDeviceRuntimeCard } from './device-card-projection.js'
import { getDeviceTypeSkill } from '../device-type-skill/service.js'
import { screenUnderstandService, type ScreenScreenshotInput, type ScreenUiTreeInput } from '../screen-understand/index.js'
import {
  buildDeviceCapabilityRegistry,
  getAdbDefinitions,
  MI_PROPERTY_KEYS,
  normalizeDeviceTypeForSkill,
  resolveDeviceCapability,
  resolveMiCapabilityKey,
  type DeviceAgentCapability,
  type JsonSchema,
} from './device-capability-registry.js'

interface UserDeviceRow {
  id: number
  name: string
  device_type: string
  room_id: number | null
  room_name?: string | null
  mi_did?: string | null
  adb_ip: string
  ip_address: string
}


export const DEVICE_AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_user_devices',
      description: 'List user-managed home devices. Use this before choosing a target device.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_device_capabilities',
      description: 'Get structured capabilities for one user-managed device.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_device_type_skill',
      description: 'Load the detailed Markdown skill guide for a device type after choosing a target device. Use this for progressive disclosure before planning multi-step device operations.',
      parameters: {
        type: 'object',
        properties: {
          device_type: { type: 'string', description: 'Device type such as tv_box, phone, speaker, computer, television, or stb.' },
        },
        required: ['device_type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rehearse_device_capability',
      description: 'Rehearse a device capability without touching the real device. Use this to validate target, capability, and arguments before execution when unsure.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
          capability_id: { type: 'string', description: 'Structured capability id, such as adb.launch_app or mi.target_temperature.' },
          capability: { type: 'string', description: 'Fallback Chinese capability name when capability_id is not known.' },
          arguments: { type: 'object', description: 'Structured arguments for the capability.' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'execute_device_capability',
      description: 'Execute a normal smart-home device capability. Ordinary reversible actions should run automatically when device, capability, and arguments are clear.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
          capability_id: { type: 'string', description: 'Structured capability id, such as adb.launch_app or mi.target_temperature.' },
          capability: { type: 'string', description: 'Fallback Chinese capability name when capability_id is not known.' },
          arguments: { type: 'object', description: 'Structured arguments for the capability.' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_device_apps',
      description: 'List installed apps on an ADB-backed device before launching an app.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
          keyword: { type: 'string' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_current_app',
      description: 'Read the foreground app on an ADB-backed device.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'take_screenshot',
      description: 'Take a screenshot from an ADB-backed device for observation.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ui_tree',
      description: 'Read visible UI elements from an ADB-backed device.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer' },
        },
        required: ['device_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'understand_screen',
      description: 'Understand the current screen using system processing. Reads ADB UI tree first, then screenshot if needed, and resolves elements through the app map and vision model.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer', description: 'Target device ID.' },
          package_name: { type: 'string', description: 'App package name (e.g. tv.danmaku.bilibili).' },
          element_name: { type: 'string', description: 'Name or description of the UI element to find.' },
        },
        required: ['device_id', 'package_name', 'element_name'],
      },
    },
  },
]

export function isDeviceAgentTool(name: string): boolean {
  return DEVICE_AGENT_TOOL_DEFINITIONS.some((tool) => tool.function.name === name)
}

export async function executeDeviceAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ExecutorInvokeResult> {
  try {
    switch (name) {
      case 'list_user_devices':
        return success(name, listUserDevices())
      case 'get_device_type_skill':
        return success(name, readDeviceTypeSkill(args))
      case 'get_device_capabilities':
        return success(name, await getDeviceCapabilities(readDeviceId(args)))
      case 'rehearse_device_capability':
        return await rehearseDeviceCapability(args)
      case 'execute_device_capability':
        return await executeDeviceCapability(args)
      case 'list_device_apps':
        return await listDeviceApps(readDeviceId(args), String(args.keyword ?? ''))
      case 'get_current_app':
        return await runAdbObservation(name, readDeviceId(args), 'get_current_app')
      case 'take_screenshot':
        return await runAdbObservation(name, readDeviceId(args), 'screenshot')
      case 'get_ui_tree':
        return await runAdbObservation(name, readDeviceId(args), 'ui_tree')
      case 'understand_screen':
        return await understandScreen(args)
      default:
        return error(name, 'UNKNOWN_DEVICE_TOOL', `Unknown device agent tool: ${name}`)
    }
  } catch (err) {
    return error(name, 'DEVICE_TOOL_ERROR', (err as Error).message)
  }
}

async function understandScreen(args: Record<string, unknown>): Promise<ExecutorInvokeResult> {
  const deviceId = readDeviceId(args)
  const packageName = String(args.package_name ?? '')
  const elementName = String(args.element_name ?? '')
  if (!packageName) throw new Error('package_name is required')
  if (!elementName) throw new Error('element_name is required')

  const device = loadUserDevice(deviceId)
  const uiTree = await readAdbObservationData(device, 'ui_tree')
  const treeResult = await screenUnderstandService.resolveElement({
    package_name: packageName,
    element_name: elementName,
    ui_tree: uiTree as ScreenUiTreeInput | null,
  })
  if (treeResult.elements.length > 0) {
    return success('understand_screen', formatScreenUnderstandResult(treeResult, { ui_tree: Boolean(uiTree), screenshot: false }))
  }

  const screenshot = await readAdbObservationData(device, 'screenshot')
  const result = await screenUnderstandService.resolveElement({
    package_name: packageName,
    element_name: elementName,
    screenshot: screenshot as ScreenScreenshotInput | null,
  })

  return success('understand_screen', formatScreenUnderstandResult(result, { ui_tree: Boolean(uiTree), screenshot: Boolean(screenshot) }))
}

async function readAdbObservationData(
  device: UserDeviceRow,
  action: 'ui_tree' | 'screenshot',
): Promise<Record<string, unknown> | null> {
  if (!device.adb_ip) return null

  const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
  if (connected.status !== 'success') return null

  const result = await cliBridge.run('adb-cli', action, { device: device.adb_ip })
  if (result.status !== 'success' || !result.data || typeof result.data !== 'object') return null
  return result.data as Record<string, unknown>
}

function formatScreenUnderstandResult(
  result: Awaited<ReturnType<typeof screenUnderstandService.resolveElement>>,
  observed: { ui_tree: boolean; screenshot: boolean },
): Record<string, unknown> {
  return {
    package_name: result.package_name,
    screen_id: result.screen_id,
    source: result.source,
    cached: result.cached,
    observed,
    elements: result.elements.map((el) => ({
      element_name: el.element_name,
      element_type: el.element_type,
      bounds: el.bounds_json,
      confidence: el.confidence,
      hit_count: el.hit_count,
      source: el.source,
    })),
  }
}

function readDeviceTypeSkill(args: Record<string, unknown>): Record<string, unknown> {
  const rawType = String(args.device_type ?? '').trim()
  const normalizedType = normalizeDeviceTypeForSkill(rawType)
  if (!normalizedType) throw new Error('device_type is required')

  const skill = getDeviceTypeSkill(normalizedType)
  if (!skill) {
    return {
      found: false,
      device_type: normalizedType,
      reason: 'No device type skill is registered for this type.',
    }
  }

  return {
    found: true,
    id: skill.id,
    device_type: skill.device_type,
    title: skill.title,
    summary: skill.summary,
    when_to_load: skill.when_to_load,
    preferred_tools: skill.preferred_tools,
    body: skill.body,
  }
}

function listUserDevices(): { devices: Array<Record<string, unknown>> } {
  const db = getDb()
  const rows = db.prepare(`
    SELECT d.*, r.name AS room_name
    FROM user_devices d
    LEFT JOIN rooms r ON r.id = d.room_id
    ORDER BY d.created_at DESC
  `).all() as UserDeviceRow[]

  return {
    devices: rows.map((device) => ({
      ...deviceSummary(device),
      mi_bound: Boolean(device.mi_did),
      adb_bound: Boolean(device.adb_ip),
    })),
  }
}

async function getDeviceCapabilities(deviceId: number): Promise<{
  device: Record<string, unknown>
  capabilities: DeviceAgentCapability[]
}> {
  const device = loadUserDevice(deviceId)
  const capabilities = await buildDeviceCapabilityRegistry(device, cliBridge)

  return {
    device: deviceSummary(device),
    capabilities,
  }
}

async function executeDeviceCapability(args: Record<string, unknown>): Promise<ExecutorInvokeResult> {
  const deviceId = readDeviceId(args)
  const device = loadUserDevice(deviceId)
  const capabilityId = typeof args.capability_id === 'string' ? args.capability_id : ''
  const capabilityName = typeof args.capability === 'string' ? args.capability : ''
  const capArgs = readArguments(args)

  if (capabilityId.startsWith('adb.')) {
    return executeAdbCapability(device, capabilityId, capArgs)
  }

  if (capabilityId.startsWith('mi.') || capabilityName) {
    return executeMiCapability(device, capabilityId, capabilityName, capArgs)
  }

  return error('execute_device_capability', 'INVALID_PARAMS', 'capability_id or capability is required')
}

async function rehearseDeviceCapability(args: Record<string, unknown>): Promise<ExecutorInvokeResult> {
  const deviceId = readDeviceId(args)
  const device = loadUserDevice(deviceId)
  const capabilityId = typeof args.capability_id === 'string' ? args.capability_id : ''
  const capabilityName = typeof args.capability === 'string' ? args.capability : ''
  const capArgs = readArguments(args)
  const resolution = await resolveDeviceCapability(device, { capabilityId, capabilityName }, cliBridge)

  if (!resolution) {
    return success('rehearse_device_capability', {
      ok: false,
      executable: false,
      device: await buildDeviceRuntimeSummary(device),
      capability_id: capabilityId,
      capability: capabilityName,
      arguments: capArgs,
      reason: 'Unknown capability for this device.',
      predicted_effect: null,
      next_step: 'Ask the user to choose a known capability or call get_device_capabilities.',
    })
  }

  const missing = requiredFields(resolution.input_schema)
    .filter((field) => capArgs[field] === undefined || capArgs[field] === null || capArgs[field] === '')

  if (missing.length > 0) {
    return success('rehearse_device_capability', {
      ok: false,
      executable: false,
      device: await buildDeviceRuntimeSummary(device),
      capability_id: resolution.capability_id,
      capability: resolution.name,
      source: resolution.source,
      arguments: capArgs,
      missing_arguments: missing,
      predicted_effect: predictCapabilityEffect(resolution, capArgs),
      next_step: `Ask for missing argument(s): ${missing.join(', ')}`,
    })
  }

  const sandboxResult = await executeSandboxCapability(device, resolution, capArgs)
  const sandboxProjection = readSandboxProjection(sandboxResult.data)

  return success('rehearse_device_capability', {
    ok: sandboxResult.status === 'success',
    executable: sandboxResult.status === 'success',
    device: await buildDeviceRuntimeSummary(device),
    capability_id: resolution.capability_id,
    capability: resolution.name,
    source: resolution.source,
    arguments: capArgs,
    missing_arguments: [],
    predicted_effect: predictCapabilityEffect(resolution, capArgs),
    sandbox: sandboxResult,
    projection: sandboxProjection,
    before: sandboxProjection?.before,
    after: sandboxProjection?.after,
    changed_fields: sandboxProjection?.changed_fields ?? [],
    effect_summary: sandboxProjection?.effect_summary,
    next_step: sandboxResult.status === 'success'
      ? 'Sandbox rehearsal passed; the real action can run if still intended.'
      : `Sandbox rehearsal failed: ${sandboxResult.message ?? sandboxResult.error ?? 'unknown error'}`,
  })
}

function readSandboxProjection(data: unknown): {
  before?: unknown
  after?: unknown
  changed_fields?: unknown[]
  effect_summary?: string
} | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  return {
    before: record.before,
    after: record.after,
    changed_fields: Array.isArray(record.changed_fields) ? record.changed_fields : [],
    effect_summary: typeof record.effect_summary === 'string' ? record.effect_summary : undefined,
  }
}

async function executeSandboxCapability(
  device: UserDeviceRow,
  capability: DeviceAgentCapability,
  args: Record<string, unknown>,
): Promise<CLIResult> {
  if (capability.source === 'adb') {
    const action = String(capability.metadata?.adb_action ?? capability.capability_id.replace(/^adb\./, ''))
    return cliBridge.run('sandbox-adb-cli', action, buildSandboxAdbParams(action, args))
  }

  const miKey = String(capability.metadata?.mi_capability ?? capability.capability_id.replace(/^mi\./, ''))
  const action = resolveSandboxMiAction(miKey, capability.name)
  return cliBridge.run('sandbox-mi-cli', action, buildSandboxMiParams(device, action, miKey, args))
}

function buildSandboxAdbParams(action: string, args: Record<string, unknown>): Record<string, unknown> {
  if (action === 'launch_app') return { package: requiredString(args, 'package') }
  if (action === 'tap') return { x: requiredNumber(args, 'x'), y: requiredNumber(args, 'y') }
  if (action === 'input_text') return { text: requiredString(args, 'text') }
  if (action === 'tap_element') {
    const params: Record<string, unknown> = {}
    if (args.index !== undefined) params.index = requiredNumber(args, 'index')
    if (args.text !== undefined) params.text = requiredString(args, 'text')
    return params
  }
  if (action === 'swipe') {
    return {
      start_x: requiredNumber(args, 'start_x'),
      start_y: requiredNumber(args, 'start_y'),
      end_x: requiredNumber(args, 'end_x'),
      end_y: requiredNumber(args, 'end_y'),
      ...(args.duration !== undefined ? { duration: requiredNumber(args, 'duration') } : {}),
    }
  }
  return {}
}

function resolveSandboxMiAction(miKey: string, capabilityName: string): string {
  if (miKey === 'execute_text') return 'speaker_execute'
  if (miKey === 'play_text') return 'speaker_play'
  if (miKey === 'ir_key' || capabilityName.includes('遥控')) return 'device_ir_press'
  return 'device_action'
}

function buildSandboxMiParams(
  device: UserDeviceRow,
  action: string,
  miKey: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (action === 'speaker_execute' || action === 'speaker_play') {
    return { did: device.mi_did, text: requiredString(args, 'text') }
  }
  if (action === 'device_ir_press') {
    const keyId = String(args.key_id ?? args.key ?? args.name ?? '').trim()
    if (!keyId) throw new Error('IR key rehearsal requires key_id or key/name')
    return { did: device.mi_did, key_id: keyId }
  }
  return {
    did: device.mi_did,
    capability: miKey,
    params: args.value !== undefined ? [args.value] : [],
  }
}

function requiredFields(schema: JsonSchema): string[] {
  const required = schema.required
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === 'string') : []
}

function deviceSummary(device: UserDeviceRow): Record<string, unknown> {
  const card = buildDeviceCardProjection(device)
  return {
    id: device.id,
    name: device.name,
    device_type: device.device_type,
    room: card.room.name,
    room_id: card.room.id,
    ip_address: card.bindings.ip_address,
    adb_ip: card.bindings.adb_ip,
    sources: card.sources,
    card,
  }
}

async function buildDeviceRuntimeSummary(device: UserDeviceRow): Promise<Record<string, unknown>> {
  const card = await buildDeviceRuntimeCard(device)
  return {
    ...deviceSummary(device),
    card,
    online_check: card.network,
  }
}

function predictCapabilityEffect(capability: DeviceAgentCapability, args: Record<string, unknown>): string {
  if (capability.capability_id === 'adb.launch_app') {
    return `Would launch Android package ${String(args.package ?? '(missing package)')}.`
  }
  if (capability.capability_id === 'adb.tap') {
    return `Would tap screen coordinate (${String(args.x ?? '?')}, ${String(args.y ?? '?')}).`
  }
  if (capability.capability_id === 'adb.input_text') {
    return `Would input text "${String(args.text ?? '')}".`
  }
  if (capability.capability_id === 'mi.ir_key') {
    return `Would press IR key ${String(args.key_id ?? args.key ?? args.name ?? '(missing key)')}.`
  }
  return `Would run ${capability.source.toUpperCase()} capability "${capability.name}".`
}

async function executeAdbCapability(
  device: UserDeviceRow,
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<ExecutorInvokeResult> {
  if (!device.adb_ip) {
    return error('execute_device_capability', 'NO_ADB_BINDING', 'Device has no ADB binding')
  }

  const definition = getAdbDefinitions(device.device_type).find((cap) => cap.id === capabilityId || cap.name === capabilityId)
  if (!definition) {
    return error('execute_device_capability', 'UNKNOWN_CAPABILITY', `Unknown ADB capability: ${capabilityId}`)
  }

  const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
  if (connected.status !== 'success') {
    return error('execute_device_capability', connected.error, connected.message ?? 'ADB device is offline')
  }

  const params: Record<string, unknown> = { device: device.adb_ip }
  switch (definition.adbAction) {
    case 'tap':
      params.x = requiredNumber(args, 'x')
      params.y = requiredNumber(args, 'y')
      break
    case 'input_text':
      params.text = requiredString(args, 'text')
      break
    case 'launch_app':
      params.package = requiredString(args, 'package')
      break
    case 'tap_element':
      if (args.index !== undefined) params.index = requiredNumber(args, 'index')
      if (args.text !== undefined) params.text = requiredString(args, 'text')
      if (params.index === undefined && params.text === undefined) {
        throw new Error('tap_element requires index or text')
      }
      break
    case 'swipe':
      params.start_x = requiredNumber(args, 'start_x')
      params.start_y = requiredNumber(args, 'start_y')
      params.end_x = requiredNumber(args, 'end_x')
      params.end_y = requiredNumber(args, 'end_y')
      if (args.duration !== undefined) params.duration = requiredNumber(args, 'duration')
      break
  }

  const result = await cliBridge.run('adb-cli', definition.adbAction, params)
  return cliResult('execute_device_capability', result, {
    device: deviceSummary(device),
    device_id: device.id,
    capability_id: definition.id,
    capability: definition.name,
    source: 'adb',
    arguments: args,
  })
}

async function executeMiCapability(
  device: UserDeviceRow,
  capabilityId: string,
  capabilityName: string,
  args: Record<string, unknown>,
): Promise<ExecutorInvokeResult> {
  if (!device.mi_did) {
    return error('execute_device_capability', 'NO_MI_BINDING', 'Device has no MI binding')
  }

  const capabilityKey = resolveMiCapabilityKey(capabilityId, capabilityName)

  if (!capabilityKey) {
    return error('execute_device_capability', 'UNKNOWN_CAPABILITY', `Unknown MI capability: ${capabilityName || capabilityId}`)
  }

  if (capabilityKey === 'ir_key') {
    const keyId = await resolveIrKeyId(device.mi_did, args)
    const result = await cliBridge.run('mi-cli', 'device_ir_press', { did: device.mi_did, key_id: keyId })
    return cliResult('execute_device_capability', result, {
      device: deviceSummary(device),
      device_id: device.id,
      capability_id: 'mi.ir_key',
      capability: '遥控按键',
      source: 'mi',
      arguments: args,
    })
  }

  let result: CLIResult
  if (capabilityKey === 'execute_text') {
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: requiredString(args, 'text') })
  } else if (capabilityKey === 'play_text') {
    result = await cliBridge.run('mi-cli', 'speaker_play', { did: device.mi_did, text: requiredString(args, 'text') })
  } else if (capabilityKey === 'play_music') {
    const text = typeof args.text === 'string' && args.text.trim() ? `播放${args.text}` : '播放音乐'
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text })
  } else if (capabilityKey === 'volume_up') {
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: '音量增加' })
  } else if (capabilityKey === 'volume_down') {
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: '音量减小' })
  } else if (capabilityKey === 'shutdown') {
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: '关机' })
  } else if (capabilityKey === 'pause') {
    result = await cliBridge.run('mi-cli', 'speaker_execute', { did: device.mi_did, text: '暂停播放' })
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

  return cliResult('execute_device_capability', result, {
    device: deviceSummary(device),
    device_id: device.id,
    capability_id: `mi.${capabilityKey}`,
    capability: capabilityName || capabilityKey,
    source: 'mi',
    arguments: args,
  })
}

async function listDeviceApps(deviceId: number, keyword: string): Promise<ExecutorInvokeResult> {
  const device = loadUserDevice(deviceId)
  if (!device.adb_ip) {
    return error('list_device_apps', 'NO_ADB_BINDING', 'Device has no ADB binding')
  }
  const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
  if (connected.status !== 'success') {
    return error('list_device_apps', connected.error, connected.message ?? 'ADB device is offline')
  }
  const result = await cliBridge.run('adb-cli', 'list_packages', {
    device: device.adb_ip,
    ...(keyword ? { keyword } : {}),
  })
  return cliResult('list_device_apps', result, { device_id: deviceId })
}

async function runAdbObservation(
  toolName: string,
  deviceId: number,
  action: string,
): Promise<ExecutorInvokeResult> {
  const device = loadUserDevice(deviceId)
  if (!device.adb_ip) {
    return error(toolName, 'NO_ADB_BINDING', 'Device has no ADB binding')
  }
  const connected = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
  if (connected.status !== 'success') {
    return error(toolName, connected.error, connected.message ?? 'ADB device is offline')
  }
  const result = await cliBridge.run('adb-cli', action, { device: device.adb_ip })
  return cliResult(toolName, result, { device_id: deviceId })
}

async function resolveIrKeyId(miDid: string, args: Record<string, unknown>): Promise<string> {
  if (typeof args.key_id === 'string' && args.key_id.trim()) return args.key_id
  const wanted = String(args.key ?? args.name ?? '').trim()
  if (!wanted) throw new Error('IR key execution requires key_id or key/name')

  const result = await cliBridge.run('mi-cli', 'device_ir_keys', { did: miDid })
  if (result.status !== 'success') {
    throw new Error(result.message ?? result.error ?? 'Failed to load IR keys')
  }
  const keys = ((result.data as { keys?: Array<{ key_id: string | number; name: string }> })?.keys ?? [])
  const found = keys.find((key) => key.name === wanted || String(key.key_id) === wanted)
  if (!found) throw new Error(`IR key not found: ${wanted}`)
  return String(found.key_id)
}

function loadUserDevice(deviceId: number): UserDeviceRow {
  const db = getDb()
  const device = db.prepare(`
    SELECT d.*, r.name AS room_name
    FROM user_devices d
    LEFT JOIN rooms r ON r.id = d.room_id
    WHERE d.id = ?
  `).get(deviceId) as UserDeviceRow | undefined
  if (!device) throw new Error(`Device not found: ${deviceId}`)
  return device
}

function readDeviceId(args: Record<string, unknown>): number {
  const raw = args.device_id
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) throw new Error('device_id must be a number')
  return value
}

function readArguments(args: Record<string, unknown>): Record<string, unknown> {
  const value = args.arguments
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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

function cliResult(
  executor: string,
  result: CLIResult,
  envelope: Record<string, unknown>,
): ExecutorInvokeResult {
  if (result.status === 'error') {
    return {
      status: 'error',
      executor,
      error: result.error,
      message: result.message,
      data: { ...envelope, duration_ms: result.duration_ms },
    }
  }
  return {
    status: 'success',
    executor,
    data: {
      ...envelope,
      output: result.data ?? null,
      duration_ms: result.duration_ms,
    },
  }
}

function success(executor: string, data: unknown): ExecutorInvokeResult {
  return { status: 'success', executor, data }
}

function error(executor: string, code: string, message: string): ExecutorInvokeResult {
  return { status: 'error', executor, error: code, message }
}
