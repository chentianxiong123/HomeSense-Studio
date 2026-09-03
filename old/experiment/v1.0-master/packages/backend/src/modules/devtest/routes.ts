import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliBridge } from '../cli-bridge/index.js'
import { serviceRegistry } from '../service-registry/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { eventBus, HeartEvent } from '../event-bus/index.js'
import { getDb } from '../../db/index.js'
import { getAdbCapabilities, getAdbCapabilitiesForCache } from '../device/user-device-routes.js'
import { buildDeviceCardProjection } from '../device/device-card-projection.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIRTUAL_HOME_STATE_PATH = path.resolve(__dirname, '../../../../../skills/virtual-home-state.json')
const SANDBOX_ADB_SUPPORTED_ACTIONS = new Set([
  'wait',
  'ensure_connected',
  'list_packages',
  'launch_app',
  'back',
  'home',
  'enter',
  'volume_up',
  'volume_down',
  'power',
  'wake',
  'tap',
  'input_text',
  'screenshot',
  'current_app',
  'ui_tree',
  'tap_element',
  'swipe',
])

interface SmokeStep {
  order: number
  label: string
  tool: string
  action: string
  params: Record<string, unknown>
  status: 'success' | 'error' | 'skipped'
  duration_ms: number
  result?: unknown
  error?: string
}

interface RealRoomRow {
  id: number
  name: string
  created_at?: string
  updated_at?: string
}

interface RealDeviceRow {
  id: number
  name: string
  device_type: string
  room_id: number | null
  room_name: string | null
  mi_did: string | null
  adb_ip: string
  ip_address: string
  created_at?: string
  updated_at?: string
}

interface CapabilityCacheRow {
  mi_did: string
  capabilities_json: string
  ir_keys_json: string
  updated_at: string
}

interface AppCacheRow {
  adb_ip: string
  apps_json: string
  updated_at: string
}

interface SandboxExecuteBody {
  device_id?: number
  capability?: string
  params?: string | Record<string, unknown> | unknown[]
}

const SMOKE_SEQUENCE: Array<Omit<SmokeStep, 'status' | 'duration_ms' | 'result' | 'error'>> = [
  { order: 1, label: 'Run sandbox Mijia power scene', tool: 'sandbox-mi-cli', action: 'scene_execute', params: { scene_name: '东芝电视开机' } },
  { order: 2, label: 'Ask sandbox XiaoAi hub to prepare TV path', tool: 'sandbox-mi-cli', action: 'speaker_execute', params: { text: '打开东芝电视和机顶盒', silent: true } },
  { order: 3, label: 'Ensure sandbox ADB connected', tool: 'sandbox-adb-cli', action: 'ensure_connected', params: {} },
  { order: 4, label: 'List sandbox installed packages', tool: 'sandbox-adb-cli', action: 'list_packages', params: { keyword: 'bili' } },
  { order: 5, label: 'Launch Bilibili TV in sandbox', tool: 'sandbox-adb-cli', action: 'launch_app', params: { package: 'com.xiaodianshi.tv.yst' } },
  { order: 6, label: 'Notify via Feishu (channel)', tool: 'service:channel.feishu.send', action: 'invoke', params: { text: 'Smoke test passed: Toshiba TV Bilibili ready' } },
  { order: 7, label: 'Prepare Bilibili dry-run upload', tool: 'bilibili-cli', action: 'prepare_upload', params: { title: 'HomeSense smoke', source_path: './exports/smoke.mp4', dry_run: true } },
]

export async function devtestRoutes(app: FastifyInstance) {
  app.get('/api/devtest/virtual-home', async () => {
    return { sandbox: loadVirtualHomeSandbox() }
  })

  app.get('/api/devtest/sandbox/registry', async () => {
    return { registry: buildSandboxRegistry() }
  })

  app.post('/api/devtest/sandbox/execute', async (request) => {
    const body = request.body as SandboxExecuteBody
    if (!body.device_id || !body.capability) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'device_id and capability are required' }
    }

    const db = getDb()
    const device = db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(Number(body.device_id)) as RealDeviceRow | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }

    const started = Date.now()
    const beforeSandbox = loadVirtualHomeSandbox()
    const execution = await executeSandboxCapability(device, body.capability, body.params)
    const sandbox = loadVirtualHomeSandbox()
    const timeline = Array.isArray(sandbox.timeline) ? sandbox.timeline : []
    const result = execution.result && typeof execution.result === 'object' && !Array.isArray(execution.result)
      ? execution.result as Record<string, unknown>
      : {}

    return {
      status: execution.status,
      error: execution.error,
      message: execution.message,
      duration_ms: Date.now() - started,
      device: {
        id: device.id,
        name: device.name,
        device_type: device.device_type,
        room_name: device.room_name,
      },
      request: {
        capability: body.capability,
        params: body.params ?? null,
      },
      execution,
      sandbox: {
        projection: sandbox.projection,
        before: result.before ?? beforeSandbox,
        after: result.after ?? sandbox,
        changed_fields: Array.isArray(result.changed_fields) ? result.changed_fields : [],
        effect_summary: result.effect_summary ?? null,
        timeline_tail: timeline.slice(-5),
      },
    }
  })

  app.post('/api/devtest/smoke', async () => {
    const intent = 'devtest.smoke.watch_bilibili'
    const started = Date.now()
    const steps: SmokeStep[] = []

    eventBus.fire(HeartEvent.DEVTEST_SMOKE_STARTED, { intent, started_at: new Date().toISOString() })

    for (const spec of SMOKE_SEQUENCE) {
      const stepStart = Date.now()
      let status: 'success' | 'error' | 'skipped' = 'skipped'
      let result: unknown = undefined
      let error: string | undefined

      try {
        if (spec.tool.startsWith('service:')) {
          const serviceName = spec.tool.slice('service:'.length)
          if (!serviceRegistry.has(serviceName)) {
            status = 'skipped'
            error = 'service not registered'
          } else {
            result = await serviceRegistry.call(serviceName, spec.params)
            status = 'success'
          }
        } else if (cliBridge.hasExecutor(spec.tool)) {
          const cliResult = await cliBridge.run(spec.tool, spec.action, spec.params)
          if (cliResult.status === 'success') {
            status = 'success'
            result = cliResult.data
          } else {
            status = 'error'
            error = cliResult.error
          }
        } else {
          status = 'skipped'
          error = `executor not registered: ${spec.tool}`
        }
      } catch (err) {
        status = 'error'
        error = (err as Error).message
      }

      const duration_ms = Date.now() - stepStart
      steps.push({ ...spec, status, duration_ms, result, error })

      try {
        memoryKernel.observeOutcome({
          intent,
          tool: spec.tool,
          action: spec.action,
          success: status === 'success',
          error,
        })
      } catch {}
    }

    const totalSuccess = steps.filter((s) => s.status === 'success').length
    const totalError = steps.filter((s) => s.status === 'error').length
    const totalSkipped = steps.filter((s) => s.status === 'skipped').length
    const overall: 'success' | 'partial' | 'failed' =
      totalError === 0 && totalSkipped === 0 ? 'success' : totalError > 0 ? 'failed' : 'partial'

    eventBus.fire(HeartEvent.DEVTEST_SMOKE_COMPLETED, {
      intent,
      duration_ms: Date.now() - started,
      overall,
      success: totalSuccess,
      error: totalError,
      skipped: totalSkipped,
    })

    return {
      status: 'success',
      intent,
      duration_ms: Date.now() - started,
      overall,
      summary: { success: totalSuccess, error: totalError, skipped: totalSkipped, total: steps.length },
      steps,
    }
  })

  app.get('/api/devtest/smoke/sequence', async () => {
    return { sequence: SMOKE_SEQUENCE }
  })
}

async function executeSandboxCapability(
  device: RealDeviceRow,
  capability: string,
  params: SandboxExecuteBody['params'],
): Promise<Record<string, unknown>> {
  const trimmedCapability = capability.trim()
  if (!trimmedCapability) {
    return { status: 'error', error: 'INVALID_PARAMS', message: 'capability is required' }
  }

  const adbDef = device.adb_ip
    ? getAdbCapabilities(device.device_type).find((cap) =>
      cap.name === trimmedCapability || cap.name_en === trimmedCapability || cap.adbAction === trimmedCapability)
    : undefined

  if (adbDef) {
    return executeSandboxAdbCapability(device, adbDef.adbAction, params)
  }

  if (device.mi_did) {
    return executeSandboxMiCapability(device, trimmedCapability, params)
  }

  return {
    status: 'error',
    error: 'NO_SANDBOX_BINDING',
    message: 'Device has no MI or ADB binding available for sandbox execution',
  }
}

async function executeSandboxAdbCapability(
  device: RealDeviceRow,
  adbAction: string,
  params: SandboxExecuteBody['params'],
): Promise<Record<string, unknown>> {
  if (!SANDBOX_ADB_SUPPORTED_ACTIONS.has(adbAction)) {
    return {
      status: 'error',
      error: 'SANDBOX_ACTION_UNSUPPORTED',
      message: `sandbox-adb-cli does not support ${adbAction} yet`,
      tool: 'sandbox-adb-cli',
      action: adbAction,
    }
  }

  const toolParams = normalizeSandboxAdbParams(adbAction, params)
  const result = await cliBridge.run('sandbox-adb-cli', adbAction, toolParams)
  return {
    status: result.status,
    error: result.status === 'error' ? result.error : undefined,
    message: result.status === 'error' ? result.message : undefined,
    tool: 'sandbox-adb-cli',
    action: adbAction,
    params: toolParams,
    result: result.status === 'success' ? result.data : result.data ?? null,
    real_device_id: device.id,
  }
}

async function executeSandboxMiCapability(
  device: RealDeviceRow,
  capability: string,
  params: SandboxExecuteBody['params'],
): Promise<Record<string, unknown>> {
  const text = paramsToText(params)
  let action = 'device_action'
  let toolParams: Record<string, unknown> = {
    did: device.mi_did,
    capability,
    params: paramsToArray(params),
  }

  if (capability === '执行文本命令' || capability === 'execute_text') {
    action = 'speaker_execute'
    toolParams = { did: device.mi_did, text }
  } else if (capability === '播放文本' || capability === 'play_text') {
    action = 'speaker_play'
    toolParams = { did: device.mi_did, text }
  } else if (capability.includes('遥控') || capability === 'device_ir_press') {
    action = 'device_ir_press'
    toolParams = { did: device.mi_did, key_id: text }
  }

  const result = await cliBridge.run('sandbox-mi-cli', action, toolParams)
  return {
    status: result.status,
    error: result.status === 'error' ? result.error : undefined,
    message: result.status === 'error' ? result.message : undefined,
    tool: 'sandbox-mi-cli',
    action,
    params: toolParams,
    result: result.status === 'success' ? result.data : result.data ?? null,
    real_device_id: device.id,
  }
}

function normalizeSandboxAdbParams(action: string, params: SandboxExecuteBody['params']): Record<string, unknown> {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return params as Record<string, unknown>
  }
  const text = paramsToText(params)
  if (action === 'launch_app') return { package: text }
  if (action === 'wait') return { seconds: Number(text || 0) }
  if (action === 'list_packages') return text ? { keyword: text } : {}
  return {}
}

function paramsToText(params: SandboxExecuteBody['params']): string {
  if (params == null) return ''
  if (typeof params === 'string') return params
  if (Array.isArray(params)) return params.map((item) => String(item)).join(',')
  if ('text' in params && params.text != null) return String(params.text)
  if ('package' in params && params.package != null) return String(params.package)
  if ('key_id' in params && params.key_id != null) return String(params.key_id)
  return JSON.stringify(params)
}

function paramsToArray(params: SandboxExecuteBody['params']): unknown[] {
  if (params == null || params === '') return []
  return Array.isArray(params) ? params : [params]
}

function loadVirtualHomeSandbox(): Record<string, unknown> {
  const shadow = loadVirtualHomeShadowState()
  try {
    return buildRealBackedVirtualHomeSandbox(shadow)
  } catch (err) {
    return {
      ...shadow,
      schema_version: 2,
      projection: {
        mode: 'shadow-file-fallback',
        error: (err as Error).message,
        path: VIRTUAL_HOME_STATE_PATH,
      },
    }
  }
}

function loadVirtualHomeShadowState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(VIRTUAL_HOME_STATE_PATH, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    return {
      schema_version: 0,
      error: (err as Error).message,
      path: VIRTUAL_HOME_STATE_PATH,
    }
  }
}

function buildRealBackedVirtualHomeSandbox(shadow: Record<string, unknown>): Record<string, unknown> {
  const db = getDb()
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY name ASC').all() as RealRoomRow[]
  const devices = db.prepare(`
    SELECT d.*, r.name AS room_name
    FROM user_devices d
    LEFT JOIN rooms r ON r.id = d.room_id
    ORDER BY COALESCE(r.name, ''), d.created_at DESC
  `).all() as RealDeviceRow[]
  const capabilityRows = db.prepare('SELECT * FROM device_capabilities').all() as CapabilityCacheRow[]
  const appRows = db.prepare('SELECT * FROM device_apps').all() as AppCacheRow[]

  const capabilityByDid = new Map(capabilityRows.map((row) => [row.mi_did, row]))
  const appsByAdbIp = new Map(appRows.map((row) => [row.adb_ip, row]))
  const shadowDevices = Array.isArray(shadow.devices) ? shadow.devices as Array<Record<string, unknown>> : []

  const projectedDevices = devices.map((device) => projectRealDevice(device, capabilityByDid, appsByAdbIp, shadowDevices))

  return {
    schema_version: 3,
    home: {
      id: 'sandbox-home',
      name: '真实设备沙箱家庭',
      timezone: 'Asia/Shanghai',
    },
    projection: {
      mode: 'real-backed-shadow',
      source: 'sqlite:user_devices',
      state_path: VIRTUAL_HOME_STATE_PATH,
      generated_at: new Date().toISOString(),
      real_device_count: devices.length,
      shadow_device_count: shadowDevices.length,
    },
    rooms: rooms.map((room) => ({
      id: `room:${room.id}`,
      real_room_id: room.id,
      name: room.name,
      created_at: room.created_at,
      updated_at: room.updated_at,
    })),
    devices: projectedDevices,
    registry_summary: summarizeSandboxRegistry(projectedDevices),
    timeline: Array.isArray(shadow.timeline) ? shadow.timeline : [],
    shadow_state: {
      schema_version: shadow.schema_version ?? 0,
      adb: shadow.adb ?? null,
      ir: shadow.ir ?? null,
    },
  }
}

function buildSandboxRegistry(): Record<string, unknown> {
  const sandbox = loadVirtualHomeSandbox()
  const devices = Array.isArray(sandbox.devices) ? sandbox.devices as Array<Record<string, unknown>> : []
  return {
    mode: 'real-backed-shadow',
    generated_at: new Date().toISOString(),
    source: 'sqlite:user_devices',
    devices: devices.map((device) => ({
      id: device.id,
      real_device_id: device.real_device_id,
      name: device.name,
      device_type: device.device_type,
      room_name: device.room_name,
      sources: device.sources,
      sandbox_capabilities: device.sandbox_capabilities ?? [],
    })),
    summary: summarizeSandboxRegistry(devices),
  }
}

function summarizeSandboxRegistry(devices: Array<Record<string, unknown>>): Record<string, unknown> {
  const capabilities = devices.flatMap((device) =>
    Array.isArray(device.sandbox_capabilities) ? device.sandbox_capabilities as Array<Record<string, unknown>> : [])
  return {
    device_count: devices.length,
    capability_count: capabilities.length,
    executable_capability_count: capabilities.filter((cap) => cap.sandbox_supported === true).length,
    tools: Array.from(new Set(capabilities.map((cap) => cap.sandbox_tool).filter(Boolean))),
  }
}

function projectRealDevice(
  device: RealDeviceRow,
  capabilityByDid: Map<string, CapabilityCacheRow>,
  appsByAdbIp: Map<string, AppCacheRow>,
  shadowDevices: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const shadow = findDeviceShadow(device, shadowDevices)
  const capabilityRow = device.mi_did ? capabilityByDid.get(device.mi_did) : undefined
  const appRow = device.adb_ip ? appsByAdbIp.get(device.adb_ip) : undefined
  const capabilityData = capabilityRow ? parseJsonObject(capabilityRow.capabilities_json) : null
  const irKeysData = capabilityRow ? parseJsonObject(capabilityRow.ir_keys_json) : null
  const apps = appRow ? parseJsonArray(appRow.apps_json) : []
  const miCapabilities = Array.isArray(capabilityData?.capabilities) ? capabilityData.capabilities : []
  const adbDefinitions = device.adb_ip ? getAdbCapabilities(device.device_type) : []
  const adbCapabilities = device.adb_ip ? getAdbCapabilitiesForCache(device.device_type) : []
  const capabilities = [...adbCapabilities, ...miCapabilities]
  const sandboxCapabilities = [
    ...adbDefinitions.map((definition) => ({
      capability_id: `adb.${definition.adbAction}`,
      name: definition.name,
      kind: definition.kind,
      source: 'adb',
      sandbox_tool: 'sandbox-adb-cli',
      sandbox_action: definition.adbAction,
      sandbox_supported: SANDBOX_ADB_SUPPORTED_ACTIONS.has(definition.adbAction),
      input_schema: definition.input,
      output_schema: definition.output,
    })),
    ...miCapabilities.map((capability) => {
      const name = typeof capability.name === 'string' ? capability.name : String(capability.name ?? '')
      const action = resolveSandboxMiAction(name)
      return {
        capability_id: `mi.${name || 'unknown'}`,
        name,
        kind: capability.kind ?? 'action',
        source: 'mi',
        sandbox_tool: 'sandbox-mi-cli',
        sandbox_action: action,
        sandbox_supported: true,
        input_schema: null,
        output_schema: null,
      }
    }),
  ]
  const irKeys = Array.isArray(irKeysData?.keys) ? irKeysData.keys : []
  const card = buildDeviceCardProjection(device)

  return {
    id: `user-device:${device.id}`,
    real_device_id: device.id,
    name: device.name,
    device_type: device.device_type,
    room_id: card.room.id == null ? null : `room:${card.room.id}`,
    real_room_id: card.room.id,
    room_name: card.room.name || null,
    sources: card.sources,
    bindings: card.bindings,
    card,
    capabilities,
    sandbox_capabilities: sandboxCapabilities,
    capability_count: capabilities.length,
    capability_cache: {
      status: capabilityRow ? 'cached' : 'missing',
      updated_at: capabilityRow?.updated_at ?? null,
    },
    ir_keys: irKeys,
    ir_key_count: irKeys.length,
    apps,
    app_count: apps.length,
    app_cache: {
      status: appRow ? 'cached' : device.adb_ip ? 'missing' : 'not_applicable',
      updated_at: appRow?.updated_at ?? null,
    },
    shadow: {
      status: 'sandbox_only',
      power: typeof shadow?.power === 'boolean' ? shadow.power : null,
      adb: shadow?.adb ?? null,
    },
    created_at: device.created_at,
    updated_at: device.updated_at,
  }
}

function resolveSandboxMiAction(capabilityName: string): string {
  if (capabilityName === '执行文本命令' || capabilityName === 'execute_text') return 'speaker_execute'
  if (capabilityName === '播放文本' || capabilityName === 'play_text') return 'speaker_play'
  if (capabilityName.includes('遥控') || capabilityName === 'device_ir_press') return 'device_ir_press'
  return 'device_action'
}

function findDeviceShadow(
  device: RealDeviceRow,
  shadowDevices: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return shadowDevices.find((shadow) => shadow.real_device_id === device.id)
    ?? shadowDevices.find((shadow) => shadow.name === device.name)
    ?? shadowDevices.find((shadow) => shadow.device_type === device.device_type)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
