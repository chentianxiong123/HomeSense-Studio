import { execFile } from 'child_process'
import { getDb } from '../../db/index.js'

export function pingHost(ip: string): Promise<boolean> {
  const target = ip.trim()
  if (!target) return Promise.resolve(false)

  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '2000', target], (err) => {
      resolve(!err)
    })
  })
}

export async function pingAllDevices(): Promise<Record<number, boolean>> {
  const db = getDb()
  const devices = db.prepare('SELECT id, ip_address FROM user_devices WHERE ip_address != ?').all('') as { id: number; ip_address: string }[]
  const results: Record<number, boolean> = {}
  await Promise.all(devices.map(async (device) => {
    results[device.id] = await pingHost(device.ip_address)
  }))
  return results
}

export async function checkDeviceOnline(device: { ip_address?: string | null; adb_ip?: string | null }): Promise<{
  checked: boolean
  online: boolean | null
  target: string | null
  method: 'ping' | 'none'
}> {
  const target = (device.ip_address || device.adb_ip || '').split(':')[0].trim()
  if (!target) {
    return { checked: false, online: null, target: null, method: 'none' }
  }

  return {
    checked: true,
    online: await pingHost(target),
    target,
    method: 'ping',
  }
}
