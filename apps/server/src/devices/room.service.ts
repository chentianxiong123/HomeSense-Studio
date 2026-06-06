import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { getDb } from '../db/database'
import type { RoomRecord } from './device.types'

@Injectable()
export class RoomService {
  list(): RoomRecord[] {
    return getDb().prepare('SELECT * FROM rooms ORDER BY created_at DESC, id DESC').all() as RoomRecord[]
  }

  get(id: number): RoomRecord {
    const row = getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRecord | undefined
    if (!row) throw new NotFoundException(`Room not found: ${id}`)
    return row
  }

  create(input: { name: string }) {
    const name = input?.name?.trim()
    if (!name) throw new BadRequestException('name is required')
    const result = getDb().prepare('INSERT INTO rooms (name) VALUES (?)').run(name)
    return { status: 'success', data: { room: this.get(Number(result.lastInsertRowid)) } }
  }

  update(id: number, input: { name?: string }) {
    const existing = this.get(id)
    const name = input?.name?.trim() ?? existing.name
    if (!name) throw new BadRequestException('name is required')
    getDb().prepare("UPDATE rooms SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id)
    return { status: 'success', data: { room: this.get(id) } }
  }

  remove(id: number) {
    const existing = this.get(id)
    getDb().prepare('DELETE FROM rooms WHERE id = ?').run(existing.id)
    return { status: 'success' }
  }
}

