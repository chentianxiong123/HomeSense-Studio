import { exec } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FastifyInstance } from 'fastify'
import { cliBridge, type CLIResult } from '../cli-bridge/index.js'
import { getDb } from '../../db/index.js'

const HISTORY_LOG = join('data', 'capability-usage.log')

// ─── Ping ──────────────────────────────────────────────────────────────
function pingHost(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w 2000 ${ip}`, (err) => { resolve(!err) })
  })
}

async function pingAllDevices(): Promise<Record<number, boolean>> {
  const db = getDb()
  const devices = db.prepare('SELECT id, ip_address FROM user_devices WHERE ip_address != ?').all('') as { id: number; ip_address: string }[]
  const results: Record<number, boolean> = {}
  await Promise.all(devices.map(async (d) => { results[d.id] = await pingHost(d.ip_address) }))
  return results
}

// ─── ADB device capability sets (fixed per device type) ──────────────────
interface AdbCapDef {
  name: string
  name_en: string
  kind: 'action' | 'property'
  source: string
  adbAction: string
  /** If null, no input parameters needed. Otherwise maps param name → schema. */
  input: Record<string, { type: string; description: string }> | null
  /** If null, only status matters (pure action). Otherwise maps output field → schema. */
  output: Record<string, { type: string; description: string }> | null
}

const ADB_CAPS_PHONE: AdbCapDef[] = [
  { name: '返回', name_en: 'Back', kind: 'action', source: 'adb', adbAction: 'back', input: null, output: null },
  { name: '主页', name_en: 'Home', kind: 'action', source: 'adb', adbAction: 'home', input: null, output: null },
  { name: '确认', name_en: 'Enter', kind: 'action', source: 'adb', adbAction: 'enter', input: null, output: null },
  { name: '音量+', name_en: 'Volume Up', kind: 'action', source: 'adb', adbAction: 'volume_up', input: null, output: null },
  { name: '音量-', name_en: 'Volume Down', kind: 'action', source: 'adb', adbAction: 'volume_down', input: null, output: null },
  { name: '电源', name_en: 'Power', kind: 'action', source: 'adb', adbAction: 'power', input: null, output: null },
  { name: '唤醒', name_en: 'Wake', kind: 'action', source: 'adb', adbAction: 'wake', input: null, output: null },
  { name: '点击坐标', name_en: 'Tap XY', kind: 'action', source: 'adb', adbAction: 'tap',
    input: { x: { type: 'integer', description: 'X 坐标（像素）' }, y: { type: 'integer', description: 'Y 坐标（像素）' } },
    output: { x: { type: 'integer', description: '点击的 X 坐标' }, y: { type: 'integer', description: '点击的 Y 坐标' } } },
  { name: '输入文本', name_en: 'Input Text', kind: 'action', source: 'adb', adbAction: 'input_text',
    input: { text: { type: 'string', description: '要输入的文本内容' } }, output: null },
  { name: '启动应用', name_en: 'Launch App', kind: 'action', source: 'adb', adbAction: 'launch_app',
    input: { package: { type: 'string', description: '应用包名（如 com.example.app）' } },
    output: { package: { type: 'string', description: '被启动的应用包名' }, component: { type: 'string', description: '启动的 Activity 组件名' } } },
  { name: '截屏', name_en: 'Screenshot', kind: 'property', source: 'adb', adbAction: 'screenshot', input: null,
    output: { path: { type: 'string', description: '截图文件路径' }, width: { type: 'integer', description: '图片宽度' }, height: { type: 'integer', description: '图片高度' }, size_bytes: { type: 'integer', description: '文件大小（字节）' } } },
  { name: '当前应用', name_en: 'Current App', kind: 'property', source: 'adb', adbAction: 'current_app', input: null,
    output: { current_app: { type: 'string', description: '前台应用包名' }, activity: { type: 'string', description: '当前 Activity 全名' }, raw_line: { type: 'string', description: '原始 dumpsys 行' } } },
  { name: '界面元素', name_en: 'UI Tree', kind: 'property', source: 'adb', adbAction: 'ui_tree', input: null,
    output: { elements: { type: 'array', description: '界面元素列表（index, text, bounds, clickable）' }, count: { type: 'integer', description: '元素总数' }, formatted: { type: 'string', description: '格式化文本列表' } } },
]

const ADB_CAPS_TV_BOX: AdbCapDef[] = [
  ...ADB_CAPS_PHONE,
  { name: '按索引点击', name_en: 'Tap by Index', kind: 'action', source: 'adb', adbAction: 'tap_element',
    input: { text: { type: 'string', description: '要点击的元素的文本内容（可选，与 index 二选一）' }, index: { type: 'integer', description: '要点击的元素索引（可选，与 text 二选一）' } },
    output: { element: { type: 'object', description: '被点击的元素信息（index, text, center）' } } },
  { name: '滑动', name_en: 'Swipe', kind: 'action', source: 'adb', adbAction: 'swipe',
    input: { start_x: { type: 'integer', description: '起点 X' }, start_y: { type: 'integer', description: '起点 Y' }, end_x: { type: 'integer', description: '终点 X' }, end_y: { type: 'integer', description: '终点 Y' }, duration: { type: 'integer', description: '滑动时长毫秒（可选）' } },
    output: { start: { type: 'object', description: '起点坐标 { x, y }' }, end: { type: 'object', description: '终点坐标 { x, y }' }, duration: { type: 'integer', description: '实际执行时长' } } },
]

function getAdbCapabilities(deviceType: string): AdbCapDef[] {
  return deviceType === 'tv_box' ? ADB_CAPS_TV_BOX : ADB_CAPS_PHONE
}

/** Lightweight shape returned in the capabilities cache for frontend/LLM. */
function getAdbCapabilitiesForCache(deviceType: string): Array<{ name: string; kind: string; type?: string; source: string; output?: Record<string, { type: string; description: string }> | null }> {
  return getAdbCapabilities(deviceType).map(c => ({
    name: c.name,
    kind: c.kind,
    type: c.input ? 'string' : undefined,
    source: c.source,
    output: c.output,
  }))
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

  // Get device capabilities — MI devices use DB cache, ADB devices use fixed capability sets
  app.get('/api/user-devices/:id/capabilities', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null; adb_ip?: string; name?: string; device_type?: string; room_name?: string | null } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }

    const cacheData: CacheData = {
      did: device.mi_did || `adb:${id}`,
      name: device.name || '',
      device_type: device.device_type || 'other',
      room: device.room_name || '',
      capabilities: [],
    }

    // Collect capabilities from all available sources
    // ADB
    if (device.adb_ip && device.adb_ip.trim()) {
      cacheData.capabilities.push(...getAdbCapabilitiesForCache(device.device_type || 'phone'))
    }

    // MI
    if (device.mi_did) {
      let miCaps: Array<{ name: string; kind: string; type?: string; source?: string }> = []
      if (!forceRefresh) {
        const cached = readCapabilitiesFromDb(device.mi_did)
        if (cached && Array.isArray(cached.capabilities)) {
          miCaps = cached.capabilities
        }
      }

      if (miCaps.length === 0) {
        const result = await cliBridge.run('mi-cli', 'device_capabilities', { did: device.mi_did })
        if (result.status === 'success') {
          const miData = result.data as CacheData
          writeCapabilitiesToDb(device.mi_did, miData)
          miCaps = miData.capabilities ?? []
        }
      }

      cacheData.capabilities.push(...miCaps)
    }

    if (cacheData.capabilities.length === 0) {
      return { status: 'error', error: 'NO_CAPABILITIES', message: 'Device has no available capabilities' }
    }

    return { status: 'success', data: cacheData }
  })

  // MI capability name → English key mapping
  const CN_CAPABILITY_TO_KEY: Record<string, string> = {
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
  }

  // Execute capability — routes MI to mi-cli, ADB to adb-cli
  app.post('/api/user-devices/:id/capabilities/execute', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { capability: string; params?: string }
    if (!body.capability) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'capability is required' }
    }

    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null; adb_ip?: string; name?: string; device_type?: string } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }

    // ── ADB device ──
    if (device.adb_ip) {
      const caps = getAdbCapabilities(device.device_type || 'phone')
      const capDef = caps.find(c => c.name === body.capability)
      if (!capDef) {
        return {
          status: 'error', error: 'UNKNOWN_CAPABILITY',
          message: `Unknown ADB capability: ${body.capability}`,
          known_capabilities: caps.map(c => c.name),
        }
      }

      const connResult = await cliBridge.run('adb-cli', 'ensure_connected', { device: device.adb_ip })
      if (connResult.status !== 'success') {
        return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB 设备未连接: ${device.adb_ip}` }
      }

      const adbParams: Record<string, unknown> = { device: device.adb_ip }

      if (capDef.adbAction === 'input_text') {
        if (!body.params) return { status: 'error', error: 'INVALID_PARAMS', message: 'text is required for 输入文本' }
        adbParams.text = body.params
      } else if (capDef.adbAction === 'launch_app') {
        if (!body.params) return { status: 'error', error: 'INVALID_PARAMS', message: 'package name is required for 启动应用' }
        adbParams.package = body.params
      } else if (capDef.adbAction === 'tap_element') {
        if (!body.params) return { status: 'error', error: 'INVALID_PARAMS', message: 'index or text required for 按索引点击' }
        if (body.params.startsWith('index:')) {
          adbParams.index = parseInt(body.params.slice(6), 10)
        } else {
          adbParams.text = body.params
        }
      } else if (capDef.adbAction === 'swipe') {
        const parts = body.params?.split(',').map(Number)
        if (parts && parts.length >= 4) {
          adbParams.start_x = parts[0]; adbParams.start_y = parts[1]
          adbParams.end_x = parts[2]; adbParams.end_y = parts[3]
          if (parts[4]) adbParams.duration = parts[4]
        } else {
          return { status: 'error', error: 'INVALID_PARAMS', message: 'swipe requires params: start_x,start_y,end_x,end_y' }
        }
      } else if (capDef.adbAction === 'press_key') {
        const KEY_MAP: Record<string, string> = {
          '音量+': 'volume_up', '音量-': 'volume_down',
          '电源': 'power',
        }
        const keyName = KEY_MAP[body.capability]
        if (!keyName) return { status: 'error', error: 'INVALID_PARAMS', message: 'Unknown key for press_key' }
        adbParams.key = keyName
      } else if (capDef.adbAction === 'wake') {
        adbParams.key = 'wake'
      } else if (capDef.adbAction === 'tap') {
        // params: "x,y"
        if (!body.params) return { status: 'error', error: 'INVALID_PARAMS', message: '坐标 required: x,y' }
        const parts = body.params.split(',').map(Number)
        if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          return { status: 'error', error: 'INVALID_PARAMS', message: '坐标格式: x,y，例如 540,960' }
        }
        adbParams.x = parts[0]
        adbParams.y = parts[1]
      } else if (capDef.adbAction === 'ui_tree') {
        // ui_tree is a read-only property, just pass device param
      } else if (capDef.adbAction === 'screenshot') {
        // screenshot is a read-only property, just pass device param
      } else if (capDef.adbAction === 'current_app') {
        // current_app is a read-only property, just pass device param
      }

      const result = await cliBridge.run('adb-cli', capDef.adbAction, adbParams)
      if (result.status !== 'success') {
        return { status: 'error', error: result.error, message: result.message || 'ADB execution failed' }
      }
      logUsage(Number(id), body.capability, body.params, 'ok', result.data)
      return {
        status: 'success',
        data: {
          capability: body.capability,
          kind: capDef.kind,
          output: result.data ?? null,
        },
      }
    }

    // ── MI device ──
    const miDid = device.mi_did
    if (!miDid) {
      return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no MI or ADB binding' }
    }

    const capabilityKey = CN_CAPABILITY_TO_KEY[body.capability]
    if (!capabilityKey) {
      return {
        status: 'error', error: 'UNKNOWN_CAPABILITY',
        message: `Unknown capability: ${body.capability}`,
        known_capabilities: Object.keys(CN_CAPABILITY_TO_KEY),
      }
    }

    const params = body.params
    let result: CLIResult

    if (capabilityKey === 'execute_text') {
      if (!params) return { status: 'error', error: 'INVALID_PARAMS', message: 'text is required for execute_text' }
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: params })
    } else if (capabilityKey === 'play_text') {
      if (!params) return { status: 'error', error: 'INVALID_PARAMS', message: 'text is required for play_text' }
      result = await cliBridge.run('mi-cli', 'speaker_play', { did: miDid, text: params })
    } else if (capabilityKey === 'volume_up') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '音量增加' })
    } else if (capabilityKey === 'volume_down') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '音量减小' })
    } else if (capabilityKey === 'play_music') {
      result = params
        ? await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: `播放${params}` })
        : await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '播放音乐' })
    } else if (capabilityKey === 'shutdown') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '关机' })
    } else if (capabilityKey === 'pause') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '暂停播放' })
    } else {
      const inParams = params ? [params] : []
      result = await cliBridge.run('mi-cli', 'device_action', {
        did: miDid,
        capability: capabilityKey,
        params: inParams,
      })
    }

    if (result.status !== 'success') {
      return { status: 'error', error: result.error, message: result.message || 'Failed to execute capability' }
    }

    logUsage(Number(id), body.capability, body.params, 'ok', result.data)
    return { status: 'success', data: { capability: body.capability, kind: 'action', output: result.data } }
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