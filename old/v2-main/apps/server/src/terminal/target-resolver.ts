import { NotFoundException } from '@nestjs/common'
import { DeviceService } from '../devices/device.service'
import { ProtocolTarget } from './protocols/protocol.interface'
import { getDb } from '../db/database'
import { TerminalTargetService } from './terminal-target.service'

/**
 * Translate a device id into a ProtocolTarget.
 * Reads device_type and props from the device record; loads auth material
 * (SSH key) from KeyStore by name — never returns secrets to the caller.
 *
 * Conventions:
 *   - A device can bind an SSH terminal target by ssh_target_id.
 *   - A device can bind a unified authorization center SSH/SFTP source by ssh_authorization_id.
 *   - Legacy devices with ssh_host + ssh_user still become an SSH target.
 *   - Any device with adb_serial or adb_ip becomes an ADB target.
 *   - windows_pc without SSH falls back to a local terminal.
 *   - Anything else is not terminal-capable.
 */
export function resolveDeviceTarget(
  deviceService: DeviceService,
  deviceId: number,
): { target: ProtocolTarget; label: string } {
  const device = deviceService.get(deviceId)
  const props = (device.props ?? {}) as Record<string, unknown>
  const deviceType = typeof props.device_type === 'string' ? props.device_type : ''
  const sshTargetId = readNumber(props, 'ssh_target_id')
  const sshAuthorizationId = readNumber(props, 'ssh_authorization_id')
  const sshHost = readString(props, 'ssh_host')
  const sshUser = readString(props, 'ssh_user')
  const adbSerial = readString(props, 'adb_serial') || readString(props, 'adb_ip')

  if (sshTargetId) {
    const configured = TerminalTargetService.get(sshTargetId)
    if (!configured) throw new Error(`SSH terminal target not found: ${sshTargetId}`)
    if (configured.kind !== 'ssh') throw new Error(`terminal target ${sshTargetId} is not SSH`)
    return {
      target: { ...(configured.target as Record<string, unknown>), kind: 'ssh' } as ProtocolTarget,
      label: configured.name || `SSH · target ${sshTargetId}`,
    }
  }

  if (sshAuthorizationId) {
    const resolved = resolveSshAuthorizationTarget(sshAuthorizationId)
    return {
      target: resolved.target,
      label: resolved.label,
    }
  }

  if (sshHost && sshUser) {
    const port = typeof props.ssh_port === 'number' ? props.ssh_port : 22
    const keyName = readString(props, 'ssh_key_name') || undefined
    const password = readString(props, 'ssh_password') || undefined

    if (keyName) {
      return { target: { kind: 'ssh', host: sshHost, port, user: sshUser, auth: 'key', keyName }, label: `SSH · ${sshUser}@${sshHost}` }
    }
    if (password) {
      return { target: { kind: 'ssh', host: sshHost, port, user: sshUser, auth: 'password', password }, label: `SSH · ${sshUser}@${sshHost}` }
    }
    throw new Error(`device ${deviceId} has ssh_host/ssh_user but no ssh_key_name or ssh_password`)
  }

  if (adbSerial) {
    return { target: { kind: 'adb', serial: adbSerial }, label: `ADB · ${adbSerial}` }
  }

  if (deviceType === 'windows_pc') {
    return { target: { kind: 'local' }, label: `Local · ${device.name}` }
  }

  throw new NotFoundException(`Device type "${deviceType}" is not terminal-capable`)
}

function readString(props: Record<string, unknown>, key: string): string {
  const v = props[key]
  return typeof v === 'string' ? v.trim() : ''
}

function readNumber(props: Record<string, unknown>, key: string): number | null {
  const value = props[key]
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

function resolveSshAuthorizationTarget(id: number): { target: Extract<ProtocolTarget, { kind: 'ssh' }>; label: string } {
  const row = getDb()
    .prepare(
      `SELECT id, name, driver, endpoint, username, secret_json, props_json
       FROM alist_authorizations
       WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number
        name: string
        driver: string
        endpoint: string
        username: string | null
        secret_json: string
        props_json: string
      }
    | undefined

  if (!row) throw new Error(`SSH authorization not found: ${id}`)
  const driver = String(row.driver || '').toLowerCase()
  if (driver !== 'sftp' && driver !== 'ssh') throw new Error(`authorization ${id} is not SSH/SFTP`)

  const endpoint = parseSshEndpoint(row.endpoint)
  const user = (row.username || endpoint.user || '').trim()
  if (!endpoint.host || !user) throw new Error(`SSH authorization ${id} missing host or user`)

  const secret = safeParseRecord(row.secret_json)
  const props = safeParseRecord(row.props_json)
  const password = readSecretString(secret, 'password')
  const keyName = readSecretString(props, 'key_name') || readSecretString(secret, 'key_name')

  if (password) {
    return {
      target: { kind: 'ssh', host: endpoint.host, port: endpoint.port, user, auth: 'password', password },
      label: row.name || `SSH · ${user}@${endpoint.host}`,
    }
  }
  if (keyName) {
    return {
      target: { kind: 'ssh', host: endpoint.host, port: endpoint.port, user, auth: 'key', keyName },
      label: row.name || `SSH · ${user}@${endpoint.host}`,
    }
  }
  throw new Error(`SSH authorization ${id} requires password or key_name`)
}

function parseSshEndpoint(endpoint: string): { host: string; port: number; user?: string } {
  const raw = String(endpoint || '').trim()
  if (!raw) return { host: '', port: 22 }
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`sftp://${raw}`)
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 22,
      user: decodeURIComponent(url.username || ''),
    }
  } catch {
    const withoutScheme = raw.replace(/^[a-z]+:\/\//i, '')
    const [hostPart] = withoutScheme.split('/')
    const [host, port] = hostPart.split(':')
    return { host: host || raw, port: port ? Number(port) || 22 : 22 }
  }
}

function safeParseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readSecretString(source: Record<string, unknown>, key: string): string {
  const value = source[key]
  return typeof value === 'string' ? value.trim() : ''
}
