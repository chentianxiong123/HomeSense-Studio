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

// ─── DB-backed caching ─────────────────────────────────────────────────
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

function logUsage(deviceId: number, capability: string, params: string | undefined, status: string): void {
  const line = `${new Date().toISOString()}|${deviceId}|${capability}|${params ?? ''}|${status}\n`
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

    const db = getDb()
    const result = db.prepare(`
      INSERT INTO user_devices (name, device_type, room_id, mi_did, adb_ip, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      body.name, body.device_type || 'other', body.room_id ?? null,
      body.mi_did || null, body.adb_ip || '', body.ip_address || '',
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
    if (body.adb_ip !== undefined) { sets.push('adb_ip = ?'); vals.push(body.adb_ip) }
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

  // Get device capabilities (from DB cache or mi-cli)
  app.get('/api/user-devices/:id/capabilities', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }
    if (!device.mi_did) return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no MI binding' }

    if (!forceRefresh) {
      const cached = readCapabilitiesFromDb(device.mi_did)
      if (cached) return { status: 'success', data: cached }
    }

    const result = await cliBridge.run('mi-cli', 'device_capabilities', { did: device.mi_did })
    if (result.status === 'success') {
      writeCapabilitiesToDb(device.mi_did, result.data as CacheData)
      return { status: 'success', data: result.data }
    }
    return { status: 'error', error: result.error, message: result.message }
  })

  // 用于单条能力路由注册
  const CN_CAPABILITY_TO_KEY: Record<string, string> = {
  '开机': 'turn_on',
  '关机': 'turn_off',
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
  '关机': 'shutdown',
  '暂停播放': 'pause',
}

  // Execute capability — routes to appropriate mi-cli handler
  app.post('/api/user-devices/:id/capabilities/execute', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { capability: string; params?: string }
    if (!body.capability) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'capability is required' }
    }

    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(Number(id)) as { mi_did?: string | null } | undefined
    if (!device) {
      return { status: 'error', error: 'NOT_FOUND', message: 'Device not found' }
    }
    const miDid = device.mi_did
    if (!miDid) {
      return { status: 'error', error: 'NO_MI_BINDING', message: 'Device has no MI binding' }
    }

    // Map Chinese capability name to English key
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

    // Speaker capabilities: route through speaker_execute/speaker_play (Mina API)
    // instead of generic device_action (MIoT spec), since speaker MIoT specs
    // often lack these action entries.
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
      if (params) {
        result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: `播放${params}` })
      } else {
        result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '播放音乐' })
      }
    } else if (capabilityKey === 'shutdown') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '关机' })
    } else if (capabilityKey === 'pause') {
      result = await cliBridge.run('mi-cli', 'speaker_execute', { did: miDid, text: '暂停播放' })
    } else {
      // Default: generic MIoT action
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

    logUsage(Number(id), body.capability, body.params, 'ok')
    return { status: 'success', data: { capability: body.capability, result: result.data } }
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
      .map(l => { const [time, deviceId, capability, params, status] = l.split('|'); return { time, deviceId, capability, params, status } })
      .filter(e => e.deviceId === id)
      .slice(-100)
    return { history: entries }
  })

  // MI device candidates (for binding dropdown)
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