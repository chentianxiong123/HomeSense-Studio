import { writeFileSync } from 'fs'
import { cliBridge } from '../integration/index.js'
import { getDb } from '../../db/index.js'

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
  // Keep the existing log format so history views stay compatible during the refactor.
  writeFileSync('data/capability-usage.log', line, { flag: 'a' })
}

export class UserDeviceAppService {
  async getApps(id: number, forceRefresh: boolean) {
    const db = getDb()
    const device = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(id) as { adb_ip?: string } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()
    if (!forceRefresh) {
      const cached = readAppsFromDb(adbIp)
      if (cached) return { status: 'success', data: cached }
    }

    const connResult = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connResult.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB 设备未连接: ${adbIp}` }
    }

    const listResult = await cliBridge.run('adb-cli', 'list_packages', { device: adbIp })
    if (listResult.status !== 'success') {
      return { status: 'error', error: listResult.error || 'FAILED', message: listResult.message }
    }

    const packages: string[] = (listResult.data as { packages?: string[] })?.packages ?? []
    const apps: AppInfo[] = packages.map((pkg) => ({
      package: pkg,
      name: pkg.split('.').pop() ?? pkg,
    }))

    writeAppsToDb(adbIp, apps)
    return { status: 'success', data: { apps, updated_at: new Date().toISOString() } }
  }

  async launchApp(id: number, pkg?: string) {
    if (!pkg) return { status: 'error', error: 'INVALID_PARAMS', message: 'package is required' }

    const db = getDb()
    const device = db.prepare('SELECT adb_ip FROM user_devices WHERE id = ?').get(id) as { adb_ip?: string } | undefined
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    if (!device.adb_ip?.trim()) return { status: 'error', error: 'NO_ADB_BINDING' }

    const adbIp = device.adb_ip.trim()
    const connResult = await cliBridge.run('adb-cli', 'ensure_connected', { device: adbIp })
    if (connResult.status !== 'success') {
      return { status: 'error', error: 'DEVICE_OFFLINE', message: `ADB 设备未连接: ${adbIp}` }
    }

    const result = await cliBridge.run('adb-cli', 'launch_app', { device: adbIp, package: pkg })
    if (result.status !== 'success') {
      return { status: 'error', error: result.error || 'LAUNCH_FAILED', message: result.message }
    }

    logUsage(id, '启动应用', pkg, 'ok', result.data)
    return { status: 'success', data: result.data }
  }

  async listMiCandidates() {
    const result = await cliBridge.run('mi-cli', 'discover')
    if (result.status === 'success' && result.data) {
      const data = result.data as { devices?: Array<Record<string, unknown>> }
      const devices = (data.devices ?? []).map((device) => ({
        did: device.did,
        name: device.name,
        model: device.model,
        device_type: device.device_type,
        room_name: device.room_name,
        home_name: device.home_name,
      }))
      return { devices }
    }
    if (result.status === 'error') {
      return { devices: [], error: result.error }
    }
    return { devices: [] }
  }
}

export const userDeviceAppService = new UserDeviceAppService()
