import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.CHAT2_DB_PATH || './data/chat.db'

export interface MessageRow {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  payload_json: string
  created_at: string
}

export interface PageInfo {
  oldestCursorId: number | null
  newestCursorId: number | null
  hasOlder: boolean
  hasNewer: boolean
}

export interface ChatRepository {
  addMessage(role: string, content: string, payloadJson?: string): number
  getMessage(id: number): MessageRow | undefined
  listMessages(cursorId?: number, limit?: number, direction?: string): { messages: MessageRow[]; pageInfo: PageInfo }
  listAllMessages(): MessageRow[]
  // Conversations
  ensureConversation(id: number): void
  createConversation(): number
  listConversations(limit?: number): Array<{ id: number; summary: string; created_at: string; updated_at: string }>
  addConversationMessage(conversationId: number, role: string, content: string): number
  getConversationMessages(conversationId: number, cursor?: number, limit?: number): { messages: Array<{ id: number; role: string; content: string; created_at: string }>; hasMore: boolean }
  // Usage log
  recordUsage(opts: { provider_name: string; model_name: string; category: string; success: boolean; input_tokens: number; output_tokens: number }): void
  queryUsageTotals(): { total_input: number; total_output: number; total_success: number; total_fail: number; daily: Array<any>; by_provider: Array<any>; by_model: Array<any>; by_category: Array<any> }
}

export class SqlChatRepository implements ChatRepository {
  private db: Database.Database

  constructor(dbPath?: string) {
    const resolvedPath = path.resolve(dbPath || DB_PATH)
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.initTable()
  }

  private initTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL DEFAULT '',
        tool_calls_json TEXT NULL,
        tool_result_json TEXT NULL,
        tool_call_id TEXT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_msg_cid ON conversation_messages(conversation_id)`)
    // Migrate: add missing columns if table was created by older version
    try { this.db.exec(`ALTER TABLE conversation_messages ADD COLUMN tool_calls_json TEXT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE conversation_messages ADD COLUMN tool_result_json TEXT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE conversation_messages ADD COLUMN tool_call_id TEXT NULL`) } catch {}
    try { this.db.exec(`ALTER TABLE conversations ADD COLUMN summary TEXT NOT NULL DEFAULT ''`) } catch {}
    try { this.db.exec(`ALTER TABLE conversations ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`) } catch {}
    try { this.db.exec(`ALTER TABLE conversations ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`) } catch {}
    // Backfill any empty timestamps
    try { this.db.exec(`UPDATE conversations SET updated_at = datetime('now') WHERE updated_at = ''`) } catch {}
    try { this.db.exec(`UPDATE conversations SET created_at = datetime('now') WHERE created_at = ''`) } catch {}    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage_daily (
        date TEXT NOT NULL,
        provider_name TEXT NOT NULL DEFAULT '',
        model_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'chat',
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (date, provider_name, model_name, category)
      )
    `)
  }

  addMessage(role: string, content: string, payloadJson = '{}'): number {
    const stmt = this.db.prepare(
      'INSERT INTO messages (role, content, payload_json) VALUES (?, ?, ?)'
    )
    const result = stmt.run(role, content, payloadJson)
    return Number(result.lastInsertRowid)
  }

  getMessage(id: number): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined
  }

  listMessages(
    cursorId?: number,
    limit = 20,
    direction = 'older'
  ): { messages: MessageRow[]; pageInfo: PageInfo } {
    let rows: MessageRow[]

    if (direction === 'latest') {
      rows = this.db
        .prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?')
        .all(limit) as MessageRow[]
    } else if (direction === 'older') {
      if (cursorId) {
        rows = this.db
          .prepare('SELECT * FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?')
          .all(cursorId, limit) as MessageRow[]
      } else {
        rows = this.db
          .prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?')
          .all(limit) as MessageRow[]
      }
    } else {
      if (cursorId) {
        rows = this.db
          .prepare('SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?')
          .all(cursorId, limit) as MessageRow[]
      } else {
        rows = []
      }
    }

    rows.sort((a, b) => a.id - b.id)
    const pageInfo = this.computePageInfo(rows, cursorId, direction, limit)
    return { messages: rows, pageInfo }
  }

  listAllMessages(): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM messages ORDER BY id ASC')
      .all() as MessageRow[]
  }

  // ── Conversations ──

  ensureConversation(id: number): void {
    const existing = this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(id)
    if (!existing) {
      this.db.prepare('INSERT INTO conversations (id) VALUES (?)').run(id)
    }
  }

  createConversation(): number {
    const result = this.db.prepare('INSERT INTO conversations DEFAULT VALUES').run()
    return Number(result.lastInsertRowid)
  }

  listConversations(limit = 20): Array<{ id: number; summary: string; created_at: string; updated_at: string }> {
    return this.db.prepare('SELECT id, summary, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?').all(limit) as any[]
  }

  addConversationMessage(conversationId: number, role: string, content: string, toolCallsJson: string | null = null, toolResultJson: string | null = null, toolCallId: string | null = null): number {
    const result = this.db.prepare(
      'INSERT INTO conversation_messages (conversation_id, role, content, tool_calls_json, tool_result_json, tool_call_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(conversationId, role, content, toolCallsJson, toolResultJson, toolCallId)
    this.db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversationId)
    return Number(result.lastInsertRowid)
  }

  getConversationMessages(conversationId: number, cursor?: number, limit = 30): { messages: Array<{ id: number; role: string; content: string; tool_calls_json: string | null; tool_result_json: string | null; tool_call_id: string | null; created_at: string }>; hasMore: boolean } {
    let rows: any[]
    if (cursor) {
      rows = this.db.prepare(
        'SELECT id, role, content, tool_calls_json, tool_result_json, tool_call_id, created_at FROM conversation_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all(conversationId, cursor, limit) as any[]
    } else {
      rows = this.db.prepare(
        'SELECT id, role, content, tool_calls_json, tool_result_json, tool_call_id, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
      ).all(conversationId, limit) as any[]
    }
    rows.reverse()
    return { messages: rows, hasMore: rows.length === limit }
  }

  recordUsage(opts: { provider_name: string; model_name: string; category: string; success: boolean; input_tokens: number; output_tokens: number }): void {
    const today = new Date().toISOString().slice(0, 10)
    const successDelta = opts.success ? 1 : 0
    const failDelta = opts.success ? 0 : 1
    this.db.prepare(
      `INSERT INTO llm_usage_daily (date, provider_name, model_name, category, success_count, fail_count, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, provider_name, model_name, category) DO UPDATE SET
         success_count = success_count + ?,
         fail_count = fail_count + ?,
         input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?`,
    ).run(today, opts.provider_name, opts.model_name, opts.category, successDelta, failDelta, opts.input_tokens, opts.output_tokens, successDelta, failDelta, opts.input_tokens, opts.output_tokens)
  }

  queryUsageTotals(): { total_input: number; total_output: number; total_success: number; total_fail: number; daily: Array<any>; by_provider: Array<any>; by_model: Array<any>; by_category: Array<any> } {
    const overall = this.db.prepare(
      `SELECT COALESCE(SUM(success_count),0) as total_success, COALESCE(SUM(fail_count),0) as total_fail, COALESCE(SUM(input_tokens),0) as total_input, COALESCE(SUM(output_tokens),0) as total_output FROM llm_usage_daily`,
    ).get() as any
    const daily = this.db.prepare('SELECT * FROM llm_usage_daily ORDER BY date DESC LIMIT 90').all()
    const byProvider = this.db.prepare(`SELECT provider_name, SUM(success_count) as success, SUM(fail_count) as fail, SUM(input_tokens) as input, SUM(output_tokens) as output FROM llm_usage_daily GROUP BY provider_name ORDER BY input + output DESC`).all()
    const byModel = this.db.prepare(`SELECT model_name, SUM(success_count) as success, SUM(fail_count) as fail, SUM(input_tokens) as input, SUM(output_tokens) as output FROM llm_usage_daily GROUP BY model_name ORDER BY input + output DESC`).all()
    const byCategory = this.db.prepare(`SELECT category, SUM(success_count) as success, SUM(fail_count) as fail, SUM(input_tokens) as input, SUM(output_tokens) as output FROM llm_usage_daily GROUP BY category ORDER BY input + output DESC`).all()
    return { total_input: overall.total_input, total_output: overall.total_output, total_success: overall.total_success, total_fail: overall.total_fail, daily, by_provider: byProvider, by_model: byModel, by_category: byCategory }
  }

  private computePageInfo(
    rows: MessageRow[],
    cursorId: number | undefined,
    direction: string,
    limit: number
  ): PageInfo {
    if (rows.length === 0) {
      return { oldestCursorId: null, newestCursorId: null, hasOlder: false, hasNewer: false }
    }

    const oldestCursorId = rows[0].id
    const newestCursorId = rows[rows.length - 1].id

    let hasOlder: boolean
    let hasNewer: boolean

    if (direction === 'latest') {
      const olderRow = this.db
        .prepare('SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT 1')
        .get(oldestCursorId) as MessageRow | undefined
      hasOlder = !!olderRow
      hasNewer = false
    } else if (direction === 'older') {
      hasOlder = rows.length >= limit
      const newerRow = this.db
        .prepare('SELECT id FROM messages WHERE id > ? ORDER BY id ASC LIMIT 1')
        .get(newestCursorId) as MessageRow | undefined
      hasNewer = !!newerRow
    } else {
      hasOlder = false
      const newerRow = this.db
        .prepare('SELECT id FROM messages WHERE id > ? ORDER BY id DESC LIMIT 1')
        .get(newestCursorId) as MessageRow | undefined
      hasNewer = !!newerRow
    }

    return { oldestCursorId, newestCursorId, hasOlder, hasNewer }
  }
}

export const chatRepository = new SqlChatRepository()
