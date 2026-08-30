import { Injectable } from '@nestjs/common'
import type Database from 'better-sqlite3'
import { getDb } from '../../../db/index.js'
import {
  buildRuntimeContextWindow,
  getRuntimeContextSettings,
  saveRuntimeContextSettings,
  type RuntimeContextSettings,
  type RuntimeContextWindow,
} from '../../../modules/runtime/index.js'
import { chatService } from '../../../modules/chat/service.js'

export interface UserContextEntry {
  key: string
  value: string
  updated_at: string
}

@Injectable()
export class ContextService {
  private database?: Database.Database

  withDb(database: Database.Database): this {
    this.database = database
    return this
  }

  private get db() {
    return this.database ?? getDb()
  }

  listUserContext(): UserContextEntry[] {
    return this.db.prepare('SELECT key, value, updated_at FROM user_context ORDER BY key ASC').all() as UserContextEntry[]
  }

  setUserContext(key: string, value: string): { status: 'ok'; key: string; value: string } {
    this.db.prepare(`
      INSERT INTO user_context (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString())

    return { status: 'ok', key, value }
  }

  getRuntimeSettings(): RuntimeContextSettings {
    return getRuntimeContextSettings(this.db)
  }

  updateRuntimeSettings(input: Partial<RuntimeContextSettings>): RuntimeContextSettings {
    return saveRuntimeContextSettings(input, this.db)
  }

  getRuntimeContextWindow(conversationId = 1, limit = 50): RuntimeContextWindow {
    let messages: Array<{ role: string; content: string; created_at?: string }> = []
    try {
      messages = chatService.getConversationMessages(conversationId, undefined, limit).messages
    } catch {
      messages = []
    }

    const lastActivityAt = messages.length > 0 ? messages[messages.length - 1]?.created_at ?? null : null

    return buildRuntimeContextWindow({
      conversationId,
      messages,
      lastActivityAt,
      getDb: () => this.db,
    })
  }
}
