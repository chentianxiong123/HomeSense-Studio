import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const statePath = path.resolve(__dirname, 'virtual-home-state.json')

export function loadState() {
  if (!fs.existsSync(statePath)) {
    const initial = createInitialState()
    saveState(initial)
    return initial
  }

  try {
    return normalizeState(JSON.parse(fs.readFileSync(statePath, 'utf-8')))
  } catch {
    const initial = createInitialState()
    saveState(initial)
    return initial
  }
}

export function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(syncLegacyFields(normalizeState(state)), null, 2))
}

export function createInitialState() {
  return syncLegacyFields({
    schema_version: 2,
    home: {
      id: 'sandbox-home',
      name: '虚拟沙箱家庭',
      timezone: 'Asia/Shanghai',
    },
    rooms: [
      { id: 'living_room', name: '客厅' },
      { id: 'mobile_room', name: '不固定' },
    ],
    devices: [
      {
        id: 'virtual-toshiba-tv',
        legacy_ir_id: 'tvs_toshiba',
        name: '虚拟东芝电视',
        device_type: 'television',
        room_id: 'living_room',
        sources: ['ir'],
        power: false,
      },
      {
        id: 'virtual-stb',
        legacy_ir_id: 'stb',
        name: '虚拟客厅机顶盒',
        device_type: 'stb',
        room_id: 'living_room',
        sources: ['ir', 'adb'],
        power: false,
        adb: {
          device_id: 'virtual-android-tv',
          connected: false,
          connection_attempts: 0,
          active_package: null,
          last_launch_at: null,
          packages: [
            'com.xiaodianshi.tv.yst',
            'tv.danmaku.bili',
            'com.dangbei.tvlauncher',
          ],
        },
      },
    ],
    timeline: [],
  })
}

export function recordEvent(state, event) {
  state.timeline = Array.isArray(state.timeline) ? state.timeline : []
  state.timeline.push({
    at: new Date().toISOString(),
    ...event,
  })
  state.timeline = state.timeline.slice(-100)
}

export function buildStateProjection(state) {
  const normalized = syncLegacyFields(normalizeState(state))
  return {
    home: normalized.home,
    devices: (normalized.devices ?? []).map((device) => ({
      id: device.id,
      name: device.name,
      device_type: device.device_type,
      room_id: device.room_id,
      sources: device.sources ?? [],
      power: typeof device.power === 'boolean' ? device.power : null,
      adb: device.adb
        ? {
            connected: Boolean(device.adb.connected),
            active_package: device.adb.active_package ?? null,
            connection_attempts: device.adb.connection_attempts ?? 0,
          }
        : null,
    })),
    adb: {
      connected: Boolean(normalized.adb?.connected),
      active_package: normalized.adb?.active_package ?? null,
      connection_attempts: normalized.adb?.connection_attempts ?? 0,
    },
    ir: {
      tvs_toshiba: Boolean(normalized.ir?.tvs_toshiba),
      stb: Boolean(normalized.ir?.stb),
      last_device: normalized.ir?.last_device ?? null,
      last_command: normalized.ir?.last_command ?? null,
    },
  }
}

export function attachProjection(result, before, after, action) {
  if (!result || result.status !== 'success') return result
  const changedFields = diffProjection(before, after)
  return {
    ...result,
    data: {
      ...(result.data ?? {}),
      before,
      after,
      changed_fields: changedFields,
      effect_summary: summarizeProjectionEffect(action, changedFields),
    },
  }
}

function summarizeProjectionEffect(action, changedFields) {
  if (changedFields.length === 0) return `Sandbox ${action} completed without projected state changes.`
  const fields = changedFields.slice(0, 4).map((field) => field.path).join(', ')
  const suffix = changedFields.length > 4 ? ` and ${changedFields.length - 4} more` : ''
  return `Sandbox ${action} changed ${fields}${suffix}.`
}

function diffProjection(before, after) {
  const changes = []
  walkDiff('', before, after, changes)
  return changes
}

function walkDiff(pathPrefix, before, after, changes) {
  if (Object.is(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      changes.push({
        path: pathPrefix || '$',
        before,
        after,
      })
      return
    }
    for (let index = 0; index < before.length; index += 1) {
      const nextPath = `${pathPrefix || '$'}[${index}]`
      walkDiff(nextPath, before[index], after[index], changes)
    }
    return
  }
  if (!isPlainObject(before) || !isPlainObject(after)) {
    changes.push({
      path: pathPrefix || '$',
      before,
      after,
    })
    return
  }

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  for (const key of keys) {
    const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key
    walkDiff(nextPath, before[key], after[key], changes)
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeState(raw) {
  const base = createInitialState()
  const state = raw && typeof raw === 'object' ? raw : {}
  if (state.schema_version === 2 && Array.isArray(state.devices)) {
    return syncLegacyFields({
      ...base,
      ...state,
      rooms: Array.isArray(state.rooms) ? state.rooms : base.rooms,
      devices: state.devices,
      timeline: Array.isArray(state.timeline) ? state.timeline : [],
    })
  }

  const migrated = createInitialState()
  if (state.adb && typeof state.adb === 'object') {
    const stb = migrated.devices.find((device) => device.id === 'virtual-stb')
    if (stb) {
      stb.adb = {
        ...stb.adb,
        ...state.adb,
      }
    }
  }
  if (state.ir && typeof state.ir === 'object') {
    for (const device of migrated.devices) {
      if (device.legacy_ir_id && typeof state.ir[device.legacy_ir_id] === 'boolean') {
        device.power = state.ir[device.legacy_ir_id]
      }
    }
    migrated.ir = {
      ...migrated.ir,
      ...state.ir,
    }
  }
  return syncLegacyFields(migrated)
}

function syncLegacyFields(state) {
  const stb = state.devices?.find((device) => device.id === 'virtual-stb') ?? {}
  const tv = state.devices?.find((device) => device.id === 'virtual-toshiba-tv') ?? {}
  if (state.adb && typeof state.adb === 'object' && stb) {
    stb.adb = {
      ...(stb.adb ?? {}),
      ...state.adb,
    }
  }
  if (state.ir && typeof state.ir === 'object') {
    if (typeof state.ir.tvs_toshiba === 'boolean' && tv) tv.power = state.ir.tvs_toshiba
    if (typeof state.ir.stb === 'boolean' && stb) stb.power = state.ir.stb
  }
  state.adb = {
    device_id: 'virtual-android-tv',
    connected: false,
    connection_attempts: 0,
    active_package: null,
    last_launch_at: null,
    packages: ['com.xiaodianshi.tv.yst', 'tv.danmaku.bili', 'com.dangbei.tvlauncher'],
    ...(stb.adb ?? {}),
  }
  state.ir = {
    tvs_toshiba: Boolean(tv.power),
    stb: Boolean(stb.power),
    last_device: state.ir?.last_device ?? null,
    last_command: state.ir?.last_command ?? null,
    last_command_at: state.ir?.last_command_at ?? null,
  }
  return state
}
