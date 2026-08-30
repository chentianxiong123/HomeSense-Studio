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
  const rows = db
    .prepare(
      `SELECT id, props FROM devices
       WHERE json_extract(props, '$.ip_address') IS NOT NULL
          OR json_extract(props, '$.adb_ip') IS NOT NULL`,
    )
    .all() as Array<{ id: number; props: string }>

  const results: Record<number, boolean> = {}
  await Promise.all(
    rows.map(async (row) => {
      const props = safeParseProps(row.props)
      const target = getPingTarget(props)
      if (target) results[row.id] = await pingHost(target)
    }),
  )
  return results
}

export async function checkDeviceOnline(device: {
  props?: Record<string, unknown>
}): Promise<{
  checked: boolean
  online: boolean | null
  target: string | null
  method: 'ping' | 'none'
}> {
  const target = getPingTarget(device.props ?? {})
  if (!target) return { checked: false, online: null, target: null, method: 'none' }
  return { checked: true, online: await pingHost(target), target, method: 'ping' }
}

function getPingTarget(props: Record<string, unknown>): string | null {
  const ip = typeof props.ip_address === 'string' ? props.ip_address : ''
  const adb = typeof props.adb_ip === 'string' ? props.adb_ip : ''
  return (ip || adb || '').split(':')[0].trim() || null
}

function safeParseProps(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) ?? {}
  } catch {
    return {}
  }
}
