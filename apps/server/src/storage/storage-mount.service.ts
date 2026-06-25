import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import { AlistAuthorizationService } from '../alist/alist-authorization.service'
import { implementedStorageDrivers } from './storage-protocols'
import type { CreateStorageMountInput, StorageMountRecord, UpdateStorageMountInput } from './storage.types'
import { TerminalTargetService } from '../terminal/terminal-target.service'

interface StorageMountRow {
  id: number
  name: string
  virtual_path: string
  driver: string
  authorization_id: number
  readonly: number
  props_json: string
  created_at: string
  updated_at: string
}

@Injectable()
export class StorageMountService {
  constructor(private readonly authorizations: AlistAuthorizationService) {}

  list(): { mounts: StorageMountRecord[] } {
    const rows = getDb()
      .prepare(
        `SELECT id, name, virtual_path, driver, authorization_id, readonly, props_json, created_at, updated_at
         FROM storage_mounts
         ORDER BY virtual_path ASC, id ASC`,
      )
      .all() as StorageMountRow[]
    return { mounts: rows.map(rowToRecord) }
  }

  get(id: number): StorageMountRecord {
    return rowToRecord(this.getRow(id))
  }

  create(input: CreateStorageMountInput): { mount: StorageMountRecord } {
    const normalized = normalizeInput(input, true)
    this.authorizations.get(normalized.authorization_id!)
    this.ensurePathAvailable(normalized.virtual_path!)
    const result = getDb()
      .prepare(
        `INSERT INTO storage_mounts (name, virtual_path, driver, authorization_id, readonly, props_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized.name,
        normalized.virtual_path,
        normalized.driver,
        normalized.authorization_id,
        normalized.readonly ? 1 : 0,
        JSON.stringify(normalized.props ?? {}),
      )
    return { mount: this.get(Number(result.lastInsertRowid)) }
  }

  update(id: number, input: UpdateStorageMountInput): { mount: StorageMountRecord } {
    this.getRow(id)
    const normalized = normalizeInput(input, false)
    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException('No fields to update')
    }
    if (normalized.authorization_id !== undefined) {
      this.authorizations.get(normalized.authorization_id)
    }
    if (normalized.virtual_path !== undefined) {
      this.ensurePathAvailable(normalized.virtual_path, id)
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (normalized.name !== undefined) {
      sets.push('name = ?')
      params.push(normalized.name)
    }
    if (normalized.virtual_path !== undefined) {
      sets.push('virtual_path = ?')
      params.push(normalized.virtual_path)
    }
    if (normalized.driver !== undefined) {
      sets.push('driver = ?')
      params.push(normalized.driver)
    }
    if (normalized.authorization_id !== undefined) {
      sets.push('authorization_id = ?')
      params.push(normalized.authorization_id)
    }
    if (normalized.readonly !== undefined) {
      sets.push('readonly = ?')
      params.push(normalized.readonly ? 1 : 0)
    }
    if (normalized.props !== undefined) {
      sets.push('props_json = ?')
      params.push(JSON.stringify(normalized.props))
    }
    sets.push("updated_at = datetime('now')")
    params.push(id)
    getDb().prepare(`UPDATE storage_mounts SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { mount: this.get(id) }
  }

  remove(id: number): { status: 'deleted'; id: number } {
    this.getRow(id)
    getDb().prepare('DELETE FROM storage_mounts WHERE id = ?').run(id)
    return { status: 'deleted', id }
  }

  ensureDeviceSftpMount(input: { deviceId: number; deviceName: string; props: Record<string, unknown> }): { mount: StorageMountRecord } {
    const existing = this.findDeviceMount(input.deviceId, 'sftp')
    if (existing) return { mount: existing }

    const authorizationId = readPositiveInt(input.props.ssh_authorization_id)
    if (authorizationId) {
      const auth = this.authorizations.get(authorizationId)
      const virtualPath = deviceVirtualPath(input.deviceId, input.deviceName)
      const result = this.create({
        name: `${input.deviceName} SSH/SFTP`,
        virtual_path: virtualPath,
        driver: 'sftp',
        authorization_id: authorizationId,
        readonly: false,
        props: {
          source: 'device',
          device_id: input.deviceId,
          root_path: readString(auth.props.root_path) || '/',
        },
      })
      return result
    }

    const targetId = readPositiveInt(input.props.ssh_target_id)
    if (targetId) {
      const target = TerminalTargetService.get(targetId)
      if (!target) throw new BadRequestException(`SSH terminal target not found: ${targetId}`)
      if (target.kind !== 'ssh') throw new BadRequestException(`terminal target ${targetId} is not SSH`)
      const authorization = this.ensureAuthorizationForSshTarget(targetId, target.name, target.target)
      const virtualPath = deviceVirtualPath(input.deviceId, input.deviceName)
      return this.create({
        name: `${input.deviceName} SSH/SFTP`,
        virtual_path: virtualPath,
        driver: 'sftp',
        authorization_id: authorization.id,
        readonly: false,
        props: {
          source: 'device',
          device_id: input.deviceId,
          ssh_target_id: targetId,
          root_path: '/',
        },
      })
    }

    throw new BadRequestException('device has no SSH/SFTP source bound')
  }

  ensureDeviceAdbMount(input: { deviceId: number; deviceName: string; props: Record<string, unknown> }): { mount: StorageMountRecord } {
    const existing = this.findDeviceMount(input.deviceId, 'adb')
    if (existing) return { mount: existing }

    const authorizationId = readPositiveInt(input.props.adb_authorization_id)
    if (authorizationId) {
      const auth = this.authorizations.get(authorizationId)
      const virtualPath = deviceVirtualPath(input.deviceId, input.deviceName)
      return this.create({
        name: `${input.deviceName} ADB`,
        virtual_path: virtualPath,
        driver: 'adb',
        authorization_id: authorizationId,
        readonly: false,
        props: {
          source: 'device',
          device_id: input.deviceId,
          device: readString(input.props.adb_serial) || readString(input.props.adb_ip) || auth.endpoint,
          root_path: readString(auth.props.root_path) || '/sdcard/',
        },
      })
    }

    const endpoint = readString(input.props.adb_serial) || readString(input.props.adb_ip)
    if (!endpoint) throw new BadRequestException('device has no ADB source bound')
    const authorization = this.ensureAuthorizationForAdbDevice(input.deviceId, input.deviceName, endpoint)
    const virtualPath = deviceVirtualPath(input.deviceId, input.deviceName)
    return this.create({
      name: `${input.deviceName} ADB`,
      virtual_path: virtualPath,
      driver: 'adb',
      authorization_id: authorization.id,
      readonly: false,
      props: {
        source: 'device',
        device_id: input.deviceId,
        device: endpoint,
        root_path: '/sdcard/',
      },
    })
  }

  private getRow(id: number): StorageMountRow {
    const row = getDb()
      .prepare(
        `SELECT id, name, virtual_path, driver, authorization_id, readonly, props_json, created_at, updated_at
         FROM storage_mounts
         WHERE id = ?`,
      )
      .get(id) as StorageMountRow | undefined
    if (!row) throw new NotFoundException(`Storage mount not found: ${id}`)
    return row
  }

  private ensurePathAvailable(virtualPath: string, exceptId?: number): void {
    const row = getDb()
      .prepare('SELECT id FROM storage_mounts WHERE virtual_path = ?')
      .get(virtualPath) as { id: number } | undefined
    if (row && row.id !== exceptId) {
      throw new BadRequestException(`storage mount path already exists: ${virtualPath}`)
    }
  }

  private findDeviceMount(deviceId: number, driver: string): StorageMountRecord | null {
    const rows = this.list().mounts
    return rows.find((mount) => (
      normalizeDriver(mount.driver) === normalizeDriver(driver) &&
      Number(mount.props.device_id) === deviceId
    )) ?? null
  }

  private ensureAuthorizationForSshTarget(targetId: number, targetName: string, target: Record<string, unknown>): { id: number } {
    const existing = getDb()
      .prepare(
        `SELECT id
         FROM alist_authorizations
         WHERE lower(driver) = 'sftp'
           AND json_extract(props_json, '$.ssh_target_id') = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(targetId) as { id: number } | undefined
    if (existing) return existing

    const host = readString(target.host)
    const port = readPositiveInt(target.port) || 22
    const username = readString(target.user)
    if (!host || !username) throw new BadRequestException(`SSH terminal target ${targetId} missing host or user`)
    const secret: Record<string, unknown> = {}
    if (readString(target.password)) secret.password = readString(target.password)
    if (readString(target.keyName)) secret.key_name = readString(target.keyName)
    if (!secret.password && !secret.key_name) throw new BadRequestException(`SSH terminal target ${targetId} missing password or keyName`)

    const result = getDb()
      .prepare(
        `INSERT INTO alist_authorizations (name, driver, endpoint, username, secret_json, props_json)
         VALUES (?, 'sftp', ?, ?, ?, ?)`,
      )
      .run(
        `${targetName || `SSH ${targetId}`} SSH/SFTP`,
        `sftp://${host}:${port}`,
        username,
        JSON.stringify(secret),
        JSON.stringify({ ssh_target_id: targetId, root_path: '/' }),
      )
    return { id: Number(result.lastInsertRowid) }
  }

  private ensureAuthorizationForAdbDevice(deviceId: number, deviceName: string, endpoint: string): { id: number } {
    const existing = getDb()
      .prepare(
        `SELECT id
         FROM alist_authorizations
         WHERE lower(driver) = 'adb'
           AND json_extract(props_json, '$.device_id') = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(deviceId) as { id: number } | undefined
    if (existing) return existing

    const result = getDb()
      .prepare(
        `INSERT INTO alist_authorizations (name, driver, endpoint, username, secret_json, props_json)
         VALUES (?, 'adb', ?, '', '{}', ?)`,
      )
      .run(
        `${deviceName || `Device ${deviceId}`} ADB`,
        endpoint,
        JSON.stringify({ source: 'device', device_id: deviceId, root_path: '/sdcard/' }),
      )
    return { id: Number(result.lastInsertRowid) }
  }
}

function normalizeInput(
  input: CreateStorageMountInput | UpdateStorageMountInput,
  creating: boolean,
): Partial<{
  name: string
  virtual_path: string
  driver: string
  authorization_id: number
  readonly: boolean
  props: Record<string, unknown>
}> {
  const normalized: Partial<{
    name: string
    virtual_path: string
    driver: string
    authorization_id: number
    readonly: boolean
    props: Record<string, unknown>
  }> = {}

  if (creating && (!input.name || !input.name.trim())) throw new BadRequestException('name is required')
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new BadRequestException('name is required')
    normalized.name = name
  }

  if (creating && (!input.virtual_path || !input.virtual_path.trim())) throw new BadRequestException('virtual_path is required')
  if (input.virtual_path !== undefined) {
    normalized.virtual_path = normalizeVirtualPath(input.virtual_path)
  }

  if (creating && input.authorization_id == null) throw new BadRequestException('authorization_id is required')
  if (input.authorization_id !== undefined) {
    const id = Number(input.authorization_id)
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('authorization_id must be a positive integer')
    normalized.authorization_id = id
  }

  if (input.driver !== undefined || creating) {
    normalized.driver = normalizeDriver(input.driver)
  }

  if (input.readonly !== undefined) {
    normalized.readonly = Boolean(input.readonly)
  } else if (creating) {
    normalized.readonly = false
  }

  if (input.props !== undefined) {
    if (!isRecord(input.props)) throw new BadRequestException('props must be an object')
    normalized.props = { ...input.props }
  } else if (creating) {
    normalized.props = {}
  }

  return normalized
}

function normalizeVirtualPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const clean = withSlash.replace(/\/+$/, '') || '/'
  if (clean === '/') throw new BadRequestException('virtual_path cannot be root')
  for (const part of clean.split('/').filter(Boolean)) {
    if (part === '.' || part === '..') throw new BadRequestException('virtual_path cannot contain . or ..')
  }
  return clean
}

function normalizeDriver(value: unknown): string {
  const driver = String(value || 'webdav').trim().toLowerCase()
  const normalized = driver === 'web_dav' ? 'webdav' : driver === 'ssh' ? 'sftp' : driver || 'webdav'
  if (!implementedStorageDrivers().has(normalized)) {
    throw new BadRequestException(`storage protocol is not implemented: ${normalized}`)
  }
  return normalized
}

function rowToRecord(row: StorageMountRow): StorageMountRecord {
  return {
    id: row.id,
    name: row.name,
    virtual_path: row.virtual_path,
    driver: row.driver,
    authorization_id: row.authorization_id,
    readonly: row.readonly === 1,
    props: safeParseRecord(row.props_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function safeParseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function deviceVirtualPath(deviceId: number, deviceName: string): string {
  const safeName = deviceName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return `/devices/${deviceId}-${safeName || 'device'}`
}
