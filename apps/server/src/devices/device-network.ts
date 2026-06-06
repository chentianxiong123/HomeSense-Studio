import { execFile } from 'node:child_process'
import { getDb } from '../db/database'

export function pingHost(ip: string): Promise<boolean> {
  const target = ip.trim()
  if (!target) return Promise.resolve(false)

  const args = process.platform === 'win32'
    ? ['-n', '1', '-w', '2000', target]
    : ['-c', '1', '-W', '2', target]

  return new Promise((resolve) => {
    execFile('ping', args, (error) => resolve(!error))
  })
}

export async function pingAllDevices(): Promise<Record<number, boolean>> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, ip_address, adb_ip
    FROM user_devices
    WHERE ip_address != '' OR adb_ip != ''
  `).all() as Array<{ id: number; ip_address: string; adb_ip: string }>

  const results: Record<number, boolean> = {}
  await Promise.all(rows.map(async (device) => {
    const target = getPingTarget(device)
    if (target) results[device.id] = await pingHost(target)
  }))
  return results
}

export async function checkDeviceOnline(device: {
  ip_address?: string | null
  adb_ip?: string | null
}): Promise<{
  checked: boolean
  online: boolean | null
  target: string | null
  method: 'ping' | 'none'
}> {
  const target = getPingTarget(device)
  if (!target) return { checked: false, online: null, target: null, method: 'none' }
  return { checked: true, online: await pingHost(target), target, method: 'ping' }
}

function getPingTarget(device: { ip_address?: string | null; adb_ip?: string | null }): string | null {
  return (device.ip_address || device.adb_ip || '').split(':')[0].trim() || null
}

