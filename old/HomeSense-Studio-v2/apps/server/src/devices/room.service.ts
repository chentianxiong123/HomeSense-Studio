import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import type { RoomRecord } from './device.types'

@Injectable()
export class RoomService {
  list(): RoomRecord[] {
    const rows = getDb().prepare('SELECT id, name, props, created_at, updated_at FROM rooms ORDER BY created_at DESC, id DESC').all() as Array<{
      id: number
      name: string
      props: string
      created_at: string
      updated_at: string
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      props: safeParseProps(r.props),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
  }

  get(id: number): RoomRecord {
    const row = getDb().prepare('SELECT id, name, props, created_at, updated_at FROM rooms WHERE id = ?').get(id) as {
      id: number
      name: string
      props: string
      created_at: string
      updated_at: string
    } | undefined
    if (!row) throw new NotFoundException(`Room not found: ${id}`)
    return {
      id: row.id,
      name: row.name,
      props: safeParseProps(row.props),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  create(input: { name: string; props?: Record<string, unknown> }) {
    const name = input?.name?.trim()
    if (!name) throw new BadRequestException('name is required')
    const props = input.props ?? {}
    const result = getDb().prepare('INSERT INTO rooms (name, props) VALUES (?, ?)').run(name, JSON.stringify(props))
    return { status: 'success', data: { room: this.get(Number(result.lastInsertRowid)) } }
  }

  update(id: number, input: { name?: string; props?: Record<string, unknown> }) {
    const existing = this.get(id)
    const name = input?.name?.trim() ?? existing.name
    if (!name) throw new BadRequestException('name is required')
    const props = input.props ?? existing.props
    getDb().prepare("UPDATE rooms SET name = ?, props = ?, updated_at = datetime('now') WHERE id = ?").run(name, JSON.stringify(props), id)
    return { status: 'success', data: { room: this.get(id) } }
  }

  remove(id: number) {
    const existing = this.get(id)
    getDb().prepare('DELETE FROM rooms WHERE id = ?').run(existing.id)
    return { status: 'success' }
  }
}

function safeParseProps(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) ?? {}
  } catch {
    return {}
  }
}
