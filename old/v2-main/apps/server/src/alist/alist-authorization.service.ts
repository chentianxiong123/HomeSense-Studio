import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import { implementedStorageDrivers } from '../storage/storage-protocols'
import type {
  AlistAuthorizationPrivateRecord,
  AlistAuthorizationRecord,
  CreateAlistAuthorizationInput,
  UpdateAlistAuthorizationInput,
} from './alist.types'

interface AlistAuthorizationRow {
  id: number
  name: string
  driver: string
  endpoint: string
  username: string | null
  secret_json: string
  props_json: string
  created_at: string
  updated_at: string
}

@Injectable()
export class AlistAuthorizationService {
  list(): { authorizations: AlistAuthorizationRecord[] } {
    const rows = getDb()
      .prepare(
        `SELECT id, name, driver, endpoint, username, secret_json, props_json, created_at, updated_at
         FROM alist_authorizations
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as AlistAuthorizationRow[]
    return { authorizations: rows.map(rowToPublicRecord) }
  }

  get(id: number): AlistAuthorizationRecord {
    return rowToPublicRecord(this.getRow(id))
  }

  getPrivate(id: number): AlistAuthorizationPrivateRecord {
    const row = this.getRow(id)
    return {
      ...rowToPublicRecord(row),
      secret: safeParseRecord(row.secret_json),
    }
  }

  create(input: CreateAlistAuthorizationInput): { authorization: AlistAuthorizationRecord } {
    const normalized = normalizeInput(input, true)
    const result = getDb()
      .prepare(
        `INSERT INTO alist_authorizations (name, driver, endpoint, username, secret_json, props_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        normalized.name,
        normalized.driver,
        normalized.endpoint,
        normalized.username ?? null,
        JSON.stringify(normalized.secret),
        JSON.stringify(normalized.props),
      )
    return { authorization: this.get(Number(result.lastInsertRowid)) }
  }

  update(id: number, input: UpdateAlistAuthorizationInput): { authorization: AlistAuthorizationRecord } {
    const current = this.getRow(id)
    const normalized = normalizeInput(input, false, current)
    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException('No fields to update')
    }

    const sets: string[] = []
    const params: unknown[] = []
    if (normalized.name !== undefined) {
      sets.push('name = ?')
      params.push(normalized.name)
    }
    if (normalized.driver !== undefined) {
      sets.push('driver = ?')
      params.push(normalized.driver)
    }
    if (normalized.endpoint !== undefined) {
      sets.push('endpoint = ?')
      params.push(normalized.endpoint)
    }
    if (normalized.username !== undefined) {
      sets.push('username = ?')
      params.push(normalized.username || null)
    }
    if (normalized.secret !== undefined) {
      sets.push('secret_json = ?')
      params.push(JSON.stringify(normalized.secret))
    }
    if (normalized.props !== undefined) {
      sets.push('props_json = ?')
      params.push(JSON.stringify(normalized.props))
    }
    sets.push("updated_at = datetime('now')")
    params.push(id)
    getDb().prepare(`UPDATE alist_authorizations SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { authorization: this.get(id) }
  }

  remove(id: number): { status: 'deleted'; id: number } {
    this.getRow(id)
    getDb().prepare('DELETE FROM alist_authorizations WHERE id = ?').run(id)
    return { status: 'deleted', id }
  }

  private getRow(id: number): AlistAuthorizationRow {
    const row = getDb()
      .prepare(
        `SELECT id, name, driver, endpoint, username, secret_json, props_json, created_at, updated_at
         FROM alist_authorizations
         WHERE id = ?`,
      )
      .get(id) as AlistAuthorizationRow | undefined
    if (!row) throw new NotFoundException(`AList authorization not found: ${id}`)
    return row
  }
}

function normalizeInput(
  input: CreateAlistAuthorizationInput | UpdateAlistAuthorizationInput,
  creating: boolean,
  current?: AlistAuthorizationRow,
): Partial<{
  name: string
  driver: string
  endpoint: string
  username: string
  secret: Record<string, unknown>
  props: Record<string, unknown>
}> {
  const normalized: Partial<{
    name: string
    driver: string
    endpoint: string
    username: string
    secret: Record<string, unknown>
    props: Record<string, unknown>
  }> = {}

  const driver = normalizeDriver(input.driver ?? current?.driver)

  if (creating && (!input.name || !input.name.trim())) throw new BadRequestException('name is required')
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new BadRequestException('name is required')
    normalized.name = name
  }

  if (input.driver !== undefined || creating) {
    normalized.driver = driver
  }

  if (input.endpoint !== undefined || creating) {
    const endpoint = normalizeEndpoint(input.endpoint, input.props, driver)
    if (creating && !endpoint) throw new BadRequestException('endpoint is required')
    if (endpoint !== undefined) normalized.endpoint = endpoint
  } else if (input.props !== undefined && driver === 'local') {
    const endpoint = normalizeEndpoint(undefined, input.props, driver)
    if (endpoint !== undefined) normalized.endpoint = endpoint
  }

  if (input.username !== undefined) {
    normalized.username = input.username.trim()
  }

  if (input.password !== undefined || input.secret !== undefined) {
    const secret = isRecord(input.secret) ? { ...input.secret } : {}
    if (input.password !== undefined) secret.password = input.password
    normalized.secret = secret
  } else if (creating) {
    normalized.secret = {}
  }

  if (input.props !== undefined) {
    if (!isRecord(input.props)) throw new BadRequestException('props must be an object')
    normalized.props = { ...input.props }
  } else if (creating) {
    normalized.props = {}
  }

  return normalized
}

function normalizeEndpoint(propsEndpoint: unknown, props: unknown, driver: string): string | undefined {
  const rawEndpoint = typeof propsEndpoint === 'string' ? propsEndpoint.trim() : ''
  if (driver === 'baidu_netdisk') {
    return rawEndpoint || 'baidu://netdisk'
  }

  if (driver === 'local') {
    const rootPath = isRecord(props) && typeof props.root_path === 'string' ? props.root_path.trim() : ''
    const endpoint = rawEndpoint || rootPath
    if (!endpoint) return undefined
    return endpoint
  }

  if (driver === 'sftp' || driver === 'adb') {
    if (!rawEndpoint) return undefined
    return rawEndpoint.replace(/\/+$/, '')
  }

  if (!rawEndpoint) return undefined
  const endpoint = rawEndpoint.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(endpoint)) throw new BadRequestException('endpoint must start with http:// or https://')
  return endpoint
}

function normalizeDriver(value: unknown): string {
  const driver = String(value || 'webdav').trim().toLowerCase()
  const normalized = driver === 'web_dav' ? 'webdav' : driver === 'ssh' ? 'sftp' : driver || 'webdav'
  if (!implementedStorageDrivers().has(normalized)) {
    throw new BadRequestException(`storage protocol is not implemented: ${normalized}`)
  }
  return normalized
}

function rowToPublicRecord(row: AlistAuthorizationRow): AlistAuthorizationRecord {
  const secret = safeParseRecord(row.secret_json)
  return {
    id: row.id,
    name: row.name,
    driver: row.driver,
    endpoint: row.endpoint,
    ...(row.username ? { username: row.username } : {}),
    props: safeParseRecord(row.props_json),
    has_secret: Object.keys(secret).length > 0,
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
