import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import type Database from 'better-sqlite3'
import { getDb } from '../../../db/index.js'

export interface RoomRecord {
  id: number
  name: string
  created_at: string
  updated_at: string
}

@Injectable()
export class RoomService {
  private database?: Database.Database

  withDb(database: Database.Database): this {
    this.database = database
    return this
  }

  private get db() {
    return this.database ?? getDb()
  }

  list(): RoomRecord[] {
    return this.db.prepare('SELECT * FROM rooms ORDER BY created_at DESC, id DESC').all() as RoomRecord[]
  }

  get(id: number): RoomRecord {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRecord | undefined
    if (!row) {
      throw new NotFoundException(`Room not found: ${id}`)
    }
    return row
  }

  create(input: { name: string }): RoomRecord {
    const name = input?.name?.trim()
    if (!name) {
      throw new BadRequestException('name is required')
    }
    const result = this.db.prepare('INSERT INTO rooms (name) VALUES (?)').run(name)
    return this.get(Number(result.lastInsertRowid))
  }

  update(id: number, input: { name?: string }): RoomRecord {
    const existing = this.get(id)
    const name = input?.name?.trim() ?? existing.name
    if (!name) {
      throw new BadRequestException('name is required')
    }
    this.db.prepare("UPDATE rooms SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id)
    return this.get(id)
  }

  remove(id: number): { status: 'deleted'; id: number } {
    const existing = this.get(id)
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(existing.id)
    return { status: 'deleted', id: existing.id }
  }
}
