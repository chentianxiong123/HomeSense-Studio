import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import type {
  CreateDeviceGroupInput,
  DeviceGroup,
  UpdateDeviceGroupInput,
} from './device.types'

const GROUP_ID_KEY = 'group_id'
const GROUP_NAME_KEY = 'group_name'

@Injectable()
export class DeviceGroupService {
  list(): DeviceGroup[] {
    const rows = getDb()
      .prepare(
        'SELECT id, name, member_ids, created_at, updated_at FROM device_groups ORDER BY created_at DESC, id DESC',
      )
      .all() as Array<{
        id: number
        name: string
        member_ids: string
        created_at: string
        updated_at: string
      }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      member_ids: parseMemberIds(r.member_ids),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
  }

  get(id: number): DeviceGroup {
    const row = getDb()
      .prepare('SELECT id, name, member_ids, created_at, updated_at FROM device_groups WHERE id = ?')
      .get(id) as
      | {
          id: number
          name: string
          member_ids: string
          created_at: string
          updated_at: string
        }
      | undefined
    if (!row) throw new NotFoundException(`Device group not found: ${id}`)
    return {
      id: row.id,
      name: row.name,
      member_ids: parseMemberIds(row.member_ids),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  create(input: CreateDeviceGroupInput): DeviceGroup {
    const name = (input?.name ?? '').trim()
    if (!name) throw new BadRequestException('name is required')
    const deviceIds = sanitizeIds(input.device_ids)
    if (deviceIds.length === 0) {
      throw new BadRequestException('device_ids must contain at least one device')
    }
    const result = getDb()
      .prepare('INSERT INTO device_groups (name, member_ids) VALUES (?, ?)')
      .run(name, JSON.stringify(deviceIds))
    const group = this.get(Number(result.lastInsertRowid))
    this.applyMembersToDevices(group.id, group.name, deviceIds)
    return group
  }

  update(id: number, input: UpdateDeviceGroupInput): DeviceGroup {
    const existing = this.get(id)
    const name = (input?.name ?? existing.name).trim()
    if (!name) throw new BadRequestException('name is required')
    const deviceIds =
      input.device_ids !== undefined ? sanitizeIds(input.device_ids) : existing.member_ids
    getDb()
      .prepare(
        "UPDATE device_groups SET name = ?, member_ids = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(name, JSON.stringify(deviceIds), id)
    this.applyMembersToDevices(id, name, deviceIds)
    return this.get(id)
  }

  remove(id: number): { status: 'deleted'; id: number } {
    const existing = this.get(id)
    const db = getDb()
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM device_groups WHERE id = ?').run(existing.id)
      const stmt = db.prepare(
        `UPDATE devices SET props = json_set(
            json_remove(props, '$.group_id'),
            '$.group_name',
            json_extract(props, '$.group_name')
          ),
          updated_at = datetime('now')
         WHERE json_extract(props, '$.group_id') = ?`,
      )
      stmt.run(existing.id)
    })
    tx()
    return { status: 'deleted', id: existing.id }
  }

  private applyMembersToDevices(groupId: number, groupName: string, memberIds: number[]) {
    if (memberIds.length === 0) return
    const db = getDb()
    const update = db.prepare(
      `UPDATE devices SET props = json_set(
          json_set(props, '$.group_id', ?),
          '$.group_name', ?
        ),
        updated_at = datetime('now')
       WHERE id = ?`,
    )
    const tx = db.transaction((ids: number[]) => {
      for (const id of ids) {
        const exists = db.prepare('SELECT id FROM devices WHERE id = ?').get(id)
        if (exists) update.run(groupId, groupName, id)
      }
    })
    tx(memberIds)
  }
}

function parseMemberIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    }
  } catch {}
  return []
}

function sanitizeIds(ids: number[] | undefined): number[] {
  if (!Array.isArray(ids)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of ids) {
    if (typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

export const __testing = { GROUP_ID_KEY, GROUP_NAME_KEY, sanitizeIds, parseMemberIds }
