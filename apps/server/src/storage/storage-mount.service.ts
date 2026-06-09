import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import { AlistAuthorizationService } from '../alist/alist-authorization.service'
import type { CreateStorageMountInput, StorageMountRecord, UpdateStorageMountInput } from './storage.types'

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
  if (!driver) return 'webdav'
  if (driver === 'web_dav') return 'webdav'
  return driver
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
