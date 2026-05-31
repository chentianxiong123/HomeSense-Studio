import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { L1_REFLEX_POLICY, shouldAttemptL1Reflex } from './l1-reflex-policy.js'

// ── Preset stopwords ──
const PRESET_STOPWORDS = [
  '帮我', '我来', '帮我来', '给', '给我', '请', '麻烦',
  '一下', '一下呗', '呗', '吧', '呢', '嘛', '啊', '呀', '哦',
  '把', '将', '用', '去', '来',
  '那个', '这个', '那', '这',
  '你', '您',
  '点儿', '一点点',
  '的', '了', '过',
]

// ── Preset IR key aliases (auto-generated for all IR devices) ──
const IR_KEY_ALIAS_PRESETS: Record<string, string[]> = {
  'POWER': ['电源', '开关', '开机', '关机', '开', '关', '打开', '关闭'],
  'VOL+': ['大声', '音量加', '大点声', '大声点', '音量加一', '声音大一点'],
  'VOL-': ['小声', '音量减', '小点声', '小声点', '音量减一', '声音小一点'],
  'CH+': ['下一个台', '下一台', '换台', '台加'],
  'CH-': ['上一个台', '上一台', '台减'],
  'MUTE': ['静音', '闭音', '消音'],
  'OK': ['确认', '确定', 'ok', '好', '选中'],
  'NAVIGATE_UP': ['上', '向上', '上面', '往上'],
  'NAVIGATE_DOWN': ['下', '向下', '下面', '往下'],
  'NAVIGATE_LEFT': ['左', '向左', '左边', '往左'],
  'NAVIGATE_RIGHT': ['右', '向右', '右边', '往右'],
  'MENU': ['菜单', '设置'],
  'BACK': ['返回', '退出', '回去'],
  'HOME': ['主页', '首页', '桌面'],
  'PLAY': ['播放', '放', '继续播放', '继续'],
  'PAUSE': ['暂停', '停'],
  'STOP': ['停止'],
  'REWIND': ['快退', '倒退'],
  'FAST_FORWARD': ['快进'],
  'PREVIOUS': ['上一个', '上一首'],
  'NEXT': ['下一个', '下一首'],
  'INPUT': ['输入源', '信号源', '切换输入'],
  'EXIT': ['退出', '返回主页'],
  'LAST': ['返回上一个', '回看'],
  'GUIDE': ['节目单', '节目指南', '指南'],
  'INFO': ['信息', '节目信息'],
  'PROGRAM_LIST': ['节目列表', '频道列表'],
  'PROGRAM_SCHEDULE': ['节目表', '节目预告'],
}

// ── Preset ADB capability aliases ──
const ADB_CAP_ALIAS_PRESETS: Record<string, string[]> = {
  '电源': ['电源', '开关', '开机', '关机', '开', '关', '打开', '关闭'],
  '音量+': ['大声', '音量加', '大点声', '大声点'],
  '音量-': ['小声', '音量减', '小点声', '小声点'],
  '返回': ['返回', '退出', '回去'],
  '主页': ['主页', '首页', '桌面'],
  '确认': ['确认', '确定', 'ok', '好'],
  '唤醒': ['唤醒', '亮屏', '解锁'],
  '启动应用': ['打开应用', '启动', '打开'],
}

// ── Ensure tables exist (runtime, for existing DBs) ──
function ensureTables() {
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS stopwords (
    id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL UNIQUE,
    is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0,1))
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS capability_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_type TEXT NOT NULL DEFAULT '',
    device_id INTEGER NULL REFERENCES user_devices(id) ON DELETE CASCADE,
    capability TEXT NOT NULL, ir_key TEXT NOT NULL DEFAULT '',
    alias TEXT NOT NULL, is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0,1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
  )`)
}

// ── Seed preset stopwords ──
function seedStopwords() {
  const db = getDb()
  const stmt = db.prepare('INSERT OR IGNORE INTO stopwords (word, is_custom) VALUES (?, 0)')
  for (const w of PRESET_STOPWORDS) stmt.run(w)
}

// ── Seed alias templates by device_type ──
export function seedAliasTemplates(deviceType: string) {
  const db = getDb()
  // Check if templates already exist for this type
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM capability_aliases WHERE device_type = ? AND device_id IS NULL').get(deviceType) as { cnt: number }
  if (existing.cnt > 0) return

  const stmt = db.prepare('INSERT INTO capability_aliases (device_type, device_id, capability, ir_key, alias, is_custom, enabled) VALUES (?, NULL, ?, ?, ?, 0, 1)')

  // IR key aliases for television/stb types
  if (deviceType === 'television' || deviceType === 'stb') {
    const irKeysRow = db.prepare('SELECT ir_keys_json FROM device_capabilities WHERE mi_did IN (SELECT mi_did FROM user_devices WHERE device_type = ? AND mi_did IS NOT NULL LIMIT 1)').get(deviceType) as { ir_keys_json?: string } | undefined
    if (irKeysRow?.ir_keys_json) {
      try {
        const parsed = JSON.parse(irKeysRow.ir_keys_json)
        const irKeys: Array<{ key_id: number; name: string }> = Array.isArray(parsed) ? parsed : (parsed.keys ?? [])
        for (const k of irKeys) {
          const aliases = IR_KEY_ALIAS_PRESETS[k.name]
          if (aliases) {
            for (const a of aliases) stmt.run(deviceType, '遥控按键', k.name, a)
          }
        }
      } catch {}
    }
  }

  // ADB cap aliases for types that have adb
  const adbTypes = ['phone', 'tv_box', 'stb', 'tablet', 'computer']
  if (adbTypes.includes(deviceType)) {
    const adbCaps = ['电源', '音量+', '音量-', '返回', '主页', '确认', '唤醒', '启动应用']
    for (const cap of adbCaps) {
      const aliases = ADB_CAP_ALIAS_PRESETS[cap]
      if (aliases) {
        for (const a of aliases) stmt.run(deviceType, cap, '', a)
      }
    }
  }
}

// ── Seed all device types that exist in user_devices ──
export function seedAllAliasTemplates() {
  const db = getDb()
  const types = db.prepare('SELECT DISTINCT device_type FROM user_devices').all() as { device_type: string }[]
  for (const t of types) seedAliasTemplates(t.device_type)
}

// ── Match pipeline ──
import { CONTEXT_TTL_MS } from './constants.js'
import { getActiveContextValue, parseContextUpdatedAt, type RuntimeContextWindow } from '../runtime-context/index.js'

const CONTEXT_REQUIRED_ALIASES = new Set([
  '好', 'ok', 'OK',
  '上', '下', '左', '右',
  '返回', '退出', '确认', '确定',
  '播放', '暂停', '继续', '停',
])

export function matchCommand(input: string, runtimeContext?: RuntimeContextWindow): {
  matched: boolean
  device_id: number | null
  capability: string
  ir_key: string
  alias: string
  stripped_input: string
  mentioned_device: string | null
} | null {
  const db = getDb()

  // Step 1: strip stopwords (longest first, skip if input is already short)
  let stripped = input.trim()
  if (stripped.length > 2) {
    const stopwords = db.prepare('SELECT word FROM stopwords ORDER BY length(word) DESC').all() as { word: string }[]
    for (const sw of stopwords) {
      stripped = stripped.split(sw.word).join('')
    }
    stripped = stripped.trim()
  }
  if (!stripped) return null

  // Step 2: check if input mentions a device name
  // "机顶盒大声" → "客厅机顶盒" contains "机顶盒" → match
  // "客厅电视大声" → input contains "客厅电视" → match
  const devices = db.prepare('SELECT id, name FROM user_devices').all() as { id: number; name: string }[]
  let mentionedDeviceId: number | null = null
  let mentionedDeviceName: string | null = null
  const sortedDevices = [...devices].sort((a, b) => b.name.length - a.name.length)
  for (const d of sortedDevices) {
    // Check if input contains the full device name
    if (input.includes(d.name)) {
      mentionedDeviceId = d.id
      mentionedDeviceName = d.name
      break
    }
    // Check if device name contains a substring from input (e.g. "机顶盒" in "客厅机顶盒")
    for (let len = d.name.length; len >= 2; len--) {
      for (let start = 0; start <= d.name.length - len; start++) {
        const sub = d.name.substring(start, start + len)
        if (input.includes(sub)) {
          mentionedDeviceId = d.id
          mentionedDeviceName = d.name
          break
        }
      }
      if (mentionedDeviceId) break
    }
    if (mentionedDeviceId) break
  }

  // Step 3: resolve target device — mentioned > context (with TTL check)
  let targetDeviceId: number | null = null
  if (mentionedDeviceId) {
    targetDeviceId = mentionedDeviceId
    // Update context: user mentioned a device, switch to it
    db.prepare(`INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(String(mentionedDeviceId), new Date().toISOString())
  } else {
    const runtimeDeviceId = getActiveContextValue(runtimeContext, 'current_device')
    if (runtimeDeviceId) {
      targetDeviceId = Number(runtimeDeviceId)
    }
    // Use context device if not expired
    const ctx = targetDeviceId ? undefined : db.prepare("SELECT value, updated_at FROM user_context WHERE key = 'current_device'").get() as { value: string; updated_at: string } | undefined
    if (!targetDeviceId && ctx?.value) {
      const lastUpdate = parseContextUpdatedAt(ctx.updated_at)
      const now = Date.now()
      if (now - lastUpdate < CONTEXT_TTL_MS) {
        targetDeviceId = Number(ctx.value)
      }
    }
  }

  // Step 4: match alias — try target device first, then all devices
  // Use contains matching: "电视开" contains "开" → matches POWER alias
  const aliasStmt = db.prepare(
    'SELECT device_id, capability, ir_key, alias FROM capability_aliases WHERE device_id = ? AND enabled = 1'
  )
  const aliasTypeStmt = db.prepare(
    'SELECT device_id, capability, ir_key, alias FROM capability_aliases WHERE device_type = ? AND device_id IS NULL AND enabled = 1'
  )
  function findBest(candidates: Array<{ device_id: number | null; capability: string; ir_key: string; alias: string }>) {
    let best: typeof candidates[0] | null = null
    let bestLen = 0
    for (const row of candidates) {
      if (!aliasAllowed(row.alias, Boolean(targetDeviceId || mentionedDeviceId))) continue
      if (stripped.includes(row.alias) && row.alias.length > bestLen) {
        best = row
        bestLen = row.alias.length
      }
    }
    return best
  }

  if (targetDeviceId) {
    // Priority 1: device-level overrides
    const deviceRows = aliasStmt.all(targetDeviceId) as Array<{ device_id: number; capability: string; ir_key: string; alias: string }>
    const deviceHit = findBest(deviceRows)
    if (deviceHit) return { ...deviceHit, matched: true, stripped_input: stripped, mentioned_device: mentionedDeviceName }

    // Priority 2: device_type templates
    const device = db.prepare('SELECT device_type FROM user_devices WHERE id = ?').get(targetDeviceId) as { device_type: string } | undefined
    if (device?.device_type) {
      const typeRows = aliasTypeStmt.all(device.device_type) as Array<{ device_id: number | null; capability: string; ir_key: string; alias: string }>
      const typeHit = findBest(typeRows)
      if (typeHit) return { ...typeHit, device_id: targetDeviceId, matched: true, stripped_input: stripped, mentioned_device: mentionedDeviceName }
    }
  }

  // No active device context: do not globally match capability aliases.
  // This keeps casual text like "你好" from becoming "好 -> OK" without a target device.

  return null
}

function aliasAllowed(alias: string, hasDeviceContext: boolean): boolean {
  if (!CONTEXT_REQUIRED_ALIASES.has(alias)) return true
  return hasDeviceContext
}

// ── Routes ──
export async function commandRoutes(app: FastifyInstance) {
  ensureTables()
  seedStopwords()
  seedAllAliasTemplates()

  // ── Match command ──
  app.post('/api/command/match', async (request) => {
    const body = request.body as { input: string }
    if (!body.input) return { matched: false }
    const result = matchCommand(body.input)
    return result ?? { matched: false }
  })

  app.get('/api/command/l1-policy', async () => {
    return {
      policy: L1_REFLEX_POLICY,
    }
  })

  app.post('/api/command/l1-policy/check', async (request) => {
    const body = request.body as { input?: string }
    return shouldAttemptL1Reflex(body.input ?? '')
  })

  // ── Stopwords CRUD ──
  app.get('/api/command/stopwords', async () => {
    const rows = getDb().prepare('SELECT * FROM stopwords ORDER BY id ASC').all()
    return { stopwords: rows }
  })

  app.post('/api/command/stopwords', async (request) => {
    const body = request.body as { word: string }
    if (!body.word?.trim()) return { status: 'error', message: 'word required' }
    const db = getDb()
    try {
      db.prepare('INSERT INTO stopwords (word, is_custom) VALUES (?, 1)').run(body.word.trim())
      return { status: 'ok' }
    } catch { return { status: 'error', message: 'already exists' } }
  })

  app.delete('/api/command/stopwords/:id', async (request) => {
    const { id } = request.params as { id: string }
    getDb().prepare('DELETE FROM stopwords WHERE id = ? AND is_custom = 1').run(Number(id))
    return { status: 'ok' }
  })

  // ── Aliases CRUD ──
  app.get('/api/command/aliases', async (request) => {
    const q = request.query as { device_id?: string; device_type?: string }
    let rows
    if (q.device_id) {
      // Return both device-level overrides AND type templates
      const device = getDb().prepare('SELECT device_type FROM user_devices WHERE id = ?').get(Number(q.device_id)) as { device_type: string } | undefined
      rows = getDb().prepare(
        'SELECT * FROM capability_aliases WHERE (device_id = ? OR (device_type = ? AND device_id IS NULL)) AND enabled = 1 ORDER BY device_id DESC, capability, ir_key, alias'
      ).all(Number(q.device_id), device?.device_type ?? '')
    } else if (q.device_type) {
      rows = getDb().prepare('SELECT * FROM capability_aliases WHERE device_type = ? ORDER BY capability, ir_key, alias').all(q.device_type)
    } else {
      rows = getDb().prepare('SELECT * FROM capability_aliases ORDER BY device_type, device_id, capability, ir_key, alias').all()
    }
    return { aliases: rows }
  })

  app.post('/api/command/aliases', async (request) => {
    const body = request.body as { device_id?: number; device_type?: string; capability: string; ir_key?: string; alias: string }
    if (!body.capability || !body.alias?.trim()) return { status: 'error', message: 'missing fields' }
    if (!body.device_id && !body.device_type) return { status: 'error', message: 'device_id or device_type required' }
    const db = getDb()
    try {
      db.prepare('INSERT INTO capability_aliases (device_type, device_id, capability, ir_key, alias, is_custom, enabled) VALUES (?, ?, ?, ?, ?, 1, 1)').run(body.device_type ?? '', body.device_id ?? null, body.capability, body.ir_key ?? '', body.alias.trim())
      return { status: 'ok' }
    } catch { return { status: 'error', message: 'already exists' } }
  })

  app.delete('/api/command/aliases/:id', async (request) => {
    const { id } = request.params as { id: string }
    getDb().prepare('DELETE FROM capability_aliases WHERE id = ? AND is_custom = 1').run(Number(id))
    return { status: 'ok' }
  })

  // ── Reseed alias templates ──
  app.post('/api/command/aliases/seed', async (request) => {
    const body = request.body as { device_type?: string }
    if (body.device_type) {
      seedAliasTemplates(body.device_type)
    } else {
      seedAllAliasTemplates()
    }
    return { status: 'ok' }
  })
}
