import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { cliBridge } from '../cli/cli-bridge'
import { readRuntimeSnapshot, writeRuntimeSnapshot } from '../db/runtime-snapshot'
import { DeviceService } from './device.service'
import type { CreateUserDeviceInput, LegacyCapabilityExecuteBody, UpdateUserDeviceInput, UserDevice } from './device.types'

type DeviceCapabilityExecuteResult =
  | { status: 'success'; data: Record<string, unknown> }
  | { status: 'error'; error: string; message?: string; data?: Record<string, unknown> }

const MI_DEVICE_CANDIDATES_SNAPSHOT = 'mi.devices.candidates'

@Controller('user-devices')
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  list() {
    return { devices: this.devices.list() }
  }

  @Get('cards')
  listCards(@Query('online') online?: string) {
    return this.devices.listCards(online === 'true' || online === '1')
  }

  @Get('ping-all')
  pingAll() {
    return this.devices.pingAll()
  }

  @Get('runtime-manifest')
  runtimeManifest(
    @Query('online') online?: string,
    @Query('capabilities') capabilities?: string,
    @Query('limit') limit?: string,
  ) {
    return this.devices.runtimeManifest({
      online: isTruthyQuery(online),
      capabilities: parseCapabilityMode(capabilities),
      limit: parsePositiveInt(limit),
    })
  }

  @Get('mi-candidates')
  async miCandidates(@Query('refresh') refresh?: string) {
    const forceRefresh = isTruthyQuery(refresh)
    if (!forceRefresh) {
      const snapshot = readRuntimeSnapshot<Record<string, unknown>>(MI_DEVICE_CANDIDATES_SNAPSHOT)
      if (snapshot) return snapshot
    }
    const result = await cliBridge.run('mi-cli', 'discover', {
      summary_only: true,
      renew: forceRefresh,
    })
    if (result.status === 'error') {
      const snapshot = readRuntimeSnapshot<Record<string, unknown>>(MI_DEVICE_CANDIDATES_SNAPSHOT)
      if (snapshot) return { ...snapshot, source: 'backend-snapshot-stale', warning: result.error, message: result.message }
      return { devices: [], source: 'mi-cli', error: result.error, message: result.message }
    }
    const data = isRecord(result.data) ? result.data : {}
    const summary = Array.isArray(data.summary) ? data.summary : []
    const response = {
      devices: summary.map((item) => {
        const row = isRecord(item) ? item : {}
        return {
          did: stringField(row.did),
          name: stringField(row.name),
          model: stringField(row.model),
          device_type: stringField(row.device_type),
          room_name: stringField(row.room_name || row.room),
          home_name: stringField(row.home_name || row.home),
        }
      }).filter((item) => item.did),
      source: data.stale ? 'mi-cli-cache-stale' : 'mi-cli',
      updated_at: new Date().toISOString(),
    }
    writeRuntimeSnapshot(MI_DEVICE_CANDIDATES_SNAPSHOT, response)
    return response
  }

  @Get(':id/capabilities')
  async capabilities(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    const device = this.devices.get(id)
    const miDid = stringField(device.props.mi_did)
    const adbIp = stringField(device.props.adb_ip)
    const deviceType = stringField(device.props.device_type) || 'other'
    const snapshot = Array.isArray(device.props.capabilities)
      ? (device.props.capabilities as Array<Record<string, unknown>>)
      : []
    const capabilities: Array<Record<string, unknown>> = []
    const warnings: string[] = []

    const forceRefresh = isTruthyQuery(refresh)
    if (!forceRefresh && snapshot.length > 0) {
      return {
        status: 'success',
        data: {
          did: miDid,
          name: device.name,
          device_type: deviceType,
          room: stringField(device.props.room_name),
          capabilities: snapshot,
        },
        source: 'device-props-snapshot',
      }
    }

    if (miDid) {
      const result = await cliBridge.run('mi-cli', 'device_capabilities', { did: miDid, renew: forceRefresh })
      if (result.status === 'success') {
        capabilities.push(...readCapabilities(result.data, 'mi'))
      } else {
        warnings.push(`mi-cli:${result.error}`)
      }
    }

    if (adbIp) {
      const result = await cliBridge.run('adb-cli', 'capabilities', { device_type: deviceType })
      if (result.status === 'success') {
        capabilities.push(...readCapabilities(result.data, 'adb'))
      } else {
        warnings.push(`adb-cli:${result.error}`)
      }
    }

    const merged = mergeCapabilities(capabilities)
    if (merged.length > 0) {
      this.devices.update(id, { props: { ...device.props, capabilities: merged } })
      const payload = {
        did: miDid,
        name: device.name,
        device_type: deviceType,
        room: stringField(device.props.room_name),
        capabilities: merged,
      }
      return {
        status: 'success',
        data: payload,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    }

    if (snapshot.length > 0) {
      return {
        status: 'success',
        data: {
          did: miDid,
          name: device.name,
          device_type: deviceType,
          room: stringField(device.props.room_name),
          capabilities: snapshot,
        },
        warnings: warnings.length > 0 ? warnings : ['capabilities:snapshot'],
      }
    }

    return {
      status: 'error',
      error: miDid || adbIp ? 'CAPABILITIES_UNAVAILABLE' : 'NO_CAPABILITY_SOURCE',
      message: miDid || adbIp
        ? 'No capabilities returned by bound sources'
        : 'Device has no Mi or ADB capability source',
      warnings,
    }
  }

  @Post(':id/capabilities/execute')
  async executeCapability(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LegacyCapabilityExecuteBody,
  ) {
    const device = this.devices.get(id)
    const capabilityId = stringField(body.capability_id)
    const capabilityName = stringField(body.capability)
    const args = isRecord(body.arguments) ? body.arguments : parseLegacyArguments(body)
    if (!capabilityId && !capabilityName) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'capability_id or capability is required' }
    }

    let result: DeviceCapabilityExecuteResult
    try {
      result = await runDeviceCapability(device, capabilityId, capabilityName, args)
    } catch (error) {
      result = {
        status: 'error',
        error: 'INVALID_PARAMS',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    const capabilityForHistory = capabilityId || capabilityName
    this.devices.recordCapabilityUsage({
      deviceId: id,
      capability: capabilityForHistory,
      params: JSON.stringify(args),
      status: result.status === 'success' ? 'ok' : result.error,
      result: result.status === 'success' ? result.data : { error: result.error, message: result.message, data: result.data },
    })
    return result
  }

  @Get(':id/ir-keys')
  async irKeys(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    const device = this.devices.get(id)
    const miDid = stringField(device.props.mi_did)
    if (!miDid) return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no Mi binding' }
    const forceRefresh = isTruthyQuery(refresh)
    const snapshot = normalizeIrRemoteProfile(device.props.ir_remote_profile)
    if (!forceRefresh && snapshot.keys.length > 0) {
      return { status: 'success', data: snapshot, source: 'device-props-snapshot' }
    }
    const result = await cliBridge.run('mi-cli', 'device_ir_keys', { did: miDid, renew: forceRefresh })
    if (result.status === 'success') {
      const profile = normalizeIrRemoteProfile(result.data)
      if (profile.keys.length > 0) {
        this.devices.update(id, { props: { ...device.props, ir_remote_profile: profile } })
      }
      return { status: 'success', data: profile }
    }
    if (snapshot.keys.length > 0) {
      return {
        status: 'success',
        data: snapshot,
        warnings: [`mi-cli:${result.error}`],
      }
    }
    return { status: 'error', error: result.error, message: result.message, data: result.data }
  }

  @Post(':id/ir-press')
  async irPress(@Param('id', ParseIntPipe) id: number, @Body() body: { key_id?: string }) {
    const keyId = stringField(body?.key_id)
    if (!keyId) return { status: 'error', error: 'INVALID_PARAMS', message: 'key_id is required' }
    const device = this.devices.get(id)
    const result = await runDeviceCapability(device, 'mi.ir_key', '遥控按键', { key_id: keyId })
    this.devices.recordCapabilityUsage({
      deviceId: id,
      capability: 'mi.ir_key',
      params: JSON.stringify({ key_id: keyId }),
      status: result.status === 'success' ? 'ok' : result.error,
      result: result.status === 'success' ? result.data : { error: result.error, message: result.message, data: result.data },
    })
    return result.status === 'success'
      ? { status: 'success', data: { key_id: keyId, result: result.data } }
      : result
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return { device: this.devices.get(id) }
  }

  @Post()
  create(@Body() body: CreateUserDeviceInput) {
    return { status: 'success', data: { device: this.devices.create(body) } }
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateUserDeviceInput) {
    return { status: 'success', data: { device: this.devices.update(id, body) } }
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.devices.remove(id)
    return { status: 'success' }
  }

  @Get(':id/capabilities/history')
  getCapabilityHistory(@Param('id') id: string) {
    return this.devices.getCapabilityHistory(id)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function isTruthyQuery(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

function parseCapabilityMode(value: string | undefined): 'none' | 'summary' | 'full' {
  return value === 'summary' || value === 'full' ? value : 'none'
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function readCapabilities(data: unknown, source: 'mi' | 'adb'): Array<Record<string, unknown>> {
  const payload = isRecord(data) ? data : {}
  const raw = Array.isArray(payload.capabilities) ? payload.capabilities : []
  return raw
    .filter(isRecord)
    .map((cap) => ({ ...cap, source: stringField(cap.source) || source }))
}

function mergeCapabilities(capabilities: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>()
  const merged: Array<Record<string, unknown>> = []
  for (const cap of capabilities) {
    const key = stringField(cap.capability_id) || `${stringField(cap.source)}:${stringField(cap.name)}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(cap)
  }
  return merged
}

function normalizeIrRemoteProfile(value: unknown): Record<string, unknown> & { keys: Array<Record<string, unknown>> } {
  const payload = isRecord(value) ? value : {}
  const keys = Array.isArray(payload.keys) ? payload.keys : []
  const normalizedKeys = keys
    .filter(isRecord)
    .map((key) => ({
      key_id: stringField(key.key_id),
      name: stringField(key.name),
      ...(stringField(key.raw_name) ? { raw_name: stringField(key.raw_name) } : {}),
      ...(stringField(key.type) ? { type: stringField(key.type) } : {}),
      ...(stringField(key.normalized) ? { normalized: stringField(key.normalized) } : {}),
      ...(stringField(key.zone) ? { zone: stringField(key.zone) } : {}),
      ...(stringField(key.position) ? { position: stringField(key.position) } : {}),
    }))
    .filter((key) => key.key_id && key.name)
  return {
    controller_id: stringField(payload.controller_id),
    name: stringField(payload.name),
    type: stringField(payload.type),
    source: stringField(payload.source) || 'mi',
    keys: normalizedKeys,
    ...(isRecord(payload.layout) ? { layout: payload.layout } : {}),
    updated_at: new Date().toISOString(),
  }
}

async function runDeviceCapability(
  device: UserDevice,
  capabilityId: string,
  capabilityName: string,
  args: Record<string, unknown>,
): Promise<DeviceCapabilityExecuteResult> {
  if (capabilityId.startsWith('adb.')) {
    return runAdbCapability(device, capabilityId, args)
  }
  if (capabilityId.startsWith('mi.') || capabilityName) {
    return runMiCapability(device, capabilityId, capabilityName, args)
  }
  return { status: 'error', error: 'INVALID_PARAMS', message: 'Unsupported capability source' }
}

async function runMiCapability(
  device: UserDevice,
  capabilityId: string,
  capabilityName: string,
  args: Record<string, unknown>,
): Promise<DeviceCapabilityExecuteResult> {
  const miDid = stringField(device.props.mi_did)
  if (!miDid) return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no Mi binding' }
  const capability = resolveMiCapabilityKey(capabilityId, capabilityName)
  if (!capability) {
    return { status: 'error', error: 'UNKNOWN_CAPABILITY', message: `Unknown Mi capability: ${capabilityName || capabilityId}` }
  }

  let cliResult
  if (capability === 'ir_key' || capability === 'ir_keys') {
    cliResult = await cliBridge.run('mi-cli', 'device_ir_press', { did: miDid, key_id: stringField(args.key_id ?? args.value) })
  } else if (capability === 'execute_text') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: requiredString(args, 'text', 'value') })
  } else if (capability === 'play_text') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_play', { did: miDid, text: requiredString(args, 'text', 'value') })
  } else if (capability === 'play_music') {
    const text = stringField(args.text ?? args.value)
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: text ? `播放${text}` : '播放音乐' })
  } else if (capability === 'volume_up') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '音量增加' })
  } else if (capability === 'volume_down') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '音量减小' })
  } else if (capability === 'shutdown') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '关机' })
  } else if (capability === 'pause') {
    cliResult = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '暂停播放' })
  } else if (MI_PROPERTY_KEYS.has(capability)) {
    cliResult = await cliBridge.run('mi-cli', 'device_prop', { did: miDid, capability, value: args.value })
  } else {
    cliResult = await cliBridge.run('mi-cli', 'device_action', {
      did: miDid,
      capability,
      params: args.value !== undefined ? [args.value] : [],
    })
  }

  return toCapabilityResult(cliResult, {
    device_id: device.id,
    capability_id: `mi.${capability}`,
    capability: capabilityName || capability,
    source: 'mi',
    arguments: args,
  })
}

async function runAdbCapability(
  device: UserDevice,
  capabilityId: string,
  args: Record<string, unknown>,
): Promise<DeviceCapabilityExecuteResult> {
  const adbIp = stringField(device.props.adb_ip)
  if (!adbIp) return { status: 'error', error: 'NO_ADB_BINDING', message: 'Device has no ADB binding' }
  const action = capabilityId.slice(4)
  const params: Record<string, unknown> = { device: adbIp }
  if (action === 'tap') {
    params.x = requiredNumber(args, 'x')
    params.y = requiredNumber(args, 'y')
  } else if (action === 'input_text') {
    params.text = requiredString(args, 'text', 'value')
  } else if (action === 'launch_app') {
    params.package = requiredString(args, 'package', 'value')
  } else if (action === 'tap_element') {
    if (args.index !== undefined) params.index = requiredNumber(args, 'index')
    if (args.text !== undefined) params.text = requiredString(args, 'text')
    if (params.index === undefined && params.text === undefined) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'tap_element requires index or text' }
    }
  } else if (action === 'swipe') {
    params.start_x = requiredNumber(args, 'start_x')
    params.start_y = requiredNumber(args, 'start_y')
    params.end_x = requiredNumber(args, 'end_x')
    params.end_y = requiredNumber(args, 'end_y')
    if (args.duration !== undefined) params.duration = requiredNumber(args, 'duration')
  }
  const cliResult = await cliBridge.run('adb-cli', action, params)
  return toCapabilityResult(cliResult, {
    device_id: device.id,
    capability_id: capabilityId,
    capability: capabilityId,
    source: 'adb',
    arguments: args,
  })
}

function toCapabilityResult(
  cliResult: Awaited<ReturnType<typeof cliBridge.run>>,
  metadata: Record<string, unknown>,
): DeviceCapabilityExecuteResult {
  if (cliResult.status === 'success') {
    return {
      status: 'success',
      data: {
        ...metadata,
        output: cliResult.data,
      },
    }
  }
  return {
    status: 'error',
    error: cliResult.error,
    message: cliResult.message,
    data: {
      ...metadata,
      output: cliResult.data,
    },
  }
}

const MI_PROPERTY_KEYS = new Set([
  'power',
  'brightness',
  'color_temperature',
  'target_temperature',
  'mode',
  'fan_speed',
  'cover_position',
  'pm2_5',
  'temperature',
  'humidity',
  'download_speed',
  'upload_speed',
  'connected_devices',
])

const MI_NAME_TO_KEY: Record<string, string> = {
  电源开关: 'power',
  翻转: 'toggle',
  亮度: 'brightness',
  色温: 'color_temperature',
  目标温度: 'target_temperature',
  模式: 'mode',
  风速: 'fan_speed',
  窗帘位置: 'cover_position',
  'PM2.5': 'pm2_5',
  温度: 'temperature',
  湿度: 'humidity',
  遥控按键: 'ir_key',
  播放音乐: 'play_music',
  执行文本命令: 'execute_text',
  播放文本: 'play_text',
  开机: 'turn_on',
  关机: 'shutdown',
  音量增加: 'volume_up',
  音量减小: 'volume_down',
  暂停播放: 'pause',
}

function resolveMiCapabilityKey(capabilityId: string, capabilityName: string): string {
  if (capabilityId.startsWith('mi.')) return capabilityId.slice(3)
  return MI_NAME_TO_KEY[capabilityName] ?? capabilityName
}

function parseLegacyArguments(body: LegacyCapabilityExecuteBody): Record<string, unknown> {
  const params = stringField(body.params).trim()
  if (!params) return {}
  try {
    const parsed = JSON.parse(params) as unknown
    if (isRecord(parsed)) return parsed
  } catch {}
  const capabilityId = stringField(body.capability_id)
  const capabilityName = stringField(body.capability)
  if (capabilityId === 'adb.tap' || capabilityName === '点击坐标') {
    const [x, y] = params.split(',').map((part) => Number(part.trim()))
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { value: params }
  }
  if (capabilityId === 'adb.swipe' || capabilityName === '滑动') {
    const [start_x, start_y, end_x, end_y, duration] = params.split(',').map((part) => Number(part.trim()))
    if ([start_x, start_y, end_x, end_y].every(Number.isFinite)) {
      return { start_x, start_y, end_x, end_y, ...(Number.isFinite(duration) ? { duration } : {}) }
    }
    return { value: params }
  }
  if (capabilityId === 'adb.tap_element' || capabilityName === '按索引点击') {
    if (params.startsWith('index:')) return { index: Number(params.slice(6).trim()) }
    const index = Number(params)
    return Number.isFinite(index) ? { index } : { text: params }
  }
  if (capabilityId === 'adb.launch_app' || capabilityName === '启动应用') return { package: params }
  if (capabilityId === 'adb.input_text' || capabilityId === 'mi.execute_text' || capabilityId === 'mi.play_text') {
    return { text: params }
  }
  if (capabilityId === 'mi.play_music') return { value: params }
  if (capabilityId === 'mi.ir_key' || capabilityId === 'mi.ir_keys' || capabilityName === '遥控按键') return { key_id: params }
  return { value: coerceValue(params) }
}

function requiredString(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'boolean') return String(value)
  }
  throw new Error(`Missing required string: ${keys.join('/')}`)
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key])
  if (Number.isFinite(value)) return value
  throw new Error(`Missing required number: ${key}`)
}

function coerceValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}
