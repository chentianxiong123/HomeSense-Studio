import { getDb } from '../../db/index.js'
import { agentInstanceService, type AgentSurface } from '../agent-instance/index.js'

export interface ConversationSessionRecord {
  conversation_id: number
  channel: string
  user_id: string
  agent_instance_id: number | null
  working_context_json: string
  pending_task_id: string | null
  last_intent: string
  last_plan_id: string | null
  last_trace_id: string | null
  summary: string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface ConversationMessageRecord {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls_json: string | null
  tool_result_json: string | null
  created_at: string
}

export interface StartConversationInput {
  conversation_id?: number
  channel?: string
  user_id?: string
  agent_instance_id?: number | null
  surface?: AgentSurface
  working_context?: Record<string, unknown>
  expires_at?: string | null
}

export type HistoryItem = {
  role: ConversationMessageRecord['role']
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface ConversationContextRecord {
  conversation_id: number
  session: ConversationSessionRecord
  history: HistoryItem[]
}

class ConversationService {
  createOrAttach(input: StartConversationInput = {}): { conversation_id: number; session: ConversationSessionRecord } {
    const db = getDb()

    let conversationId = input.conversation_id
    if (!conversationId) {
      const result = db.prepare('INSERT INTO conversations DEFAULT VALUES').run()
      conversationId = Number(result.lastInsertRowid)
    }

    const session = this.ensureSession(conversationId, input)
    return { conversation_id: conversationId, session }
  }

  ensureSession(conversationId: number, input: StartConversationInput = {}): ConversationSessionRecord {
    const db = getDb()
    const existing = db.prepare(
      `SELECT * FROM conversation_sessions WHERE conversation_id = ?`,
    ).get(conversationId) as ConversationSessionRecord | undefined

    if (existing) {
      if (input.working_context) {
        this.updateSession(conversationId, { working_context: input.working_context })
        return this.getSession(conversationId)
      }
      return existing
    }

    const agentInstanceId = input.agent_instance_id ?? agentInstanceService.getDefaultForSurface(input.surface ?? 'chat').id
    const agent = agentInstanceService.getById(agentInstanceId)

    db.prepare(
      `INSERT INTO conversation_sessions (
        conversation_id, channel, user_id, agent_instance_id, working_context_json, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      conversationId,
      input.channel ?? agent?.default_channel ?? 'web',
      input.user_id ?? 'local',
      agentInstanceId,
      JSON.stringify(input.working_context ?? {}),
      input.expires_at ?? null,
    )

    return this.getSession(conversationId)
  }

  getSession(conversationId: number): ConversationSessionRecord {
    const db = getDb()
    const session = db.prepare(
      `SELECT * FROM conversation_sessions WHERE conversation_id = ?`,
    ).get(conversationId) as ConversationSessionRecord | undefined

    if (!session) {
      throw new Error(`Conversation session not found: ${conversationId}`)
    }

    return session
  }

  appendMessage(
    conversationId: number,
    role: ConversationMessageRecord['role'],
    content: string,
    extra?: { tool_calls?: unknown; tool_result?: unknown; tool_call_id?: string; name?: string },
  ): void {
    const db = getDb()
    // Store name inside tool_result_json for tool role messages
    const toolResult = extra?.tool_result ?? (extra?.name ? { name: extra.name } : undefined)
    db.prepare(
      `INSERT INTO conversation_messages (conversation_id, role, content, tool_calls_json, tool_result_json, tool_call_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      conversationId,
      role,
      content,
      extra?.tool_calls != null ? JSON.stringify(extra.tool_calls) : null,
      toolResult != null ? JSON.stringify(toolResult) : null,
      extra?.tool_call_id ?? null,
    )

    this.touchConversation(conversationId)
  }

  getHistory(conversationId: number, limit = 20): HistoryItem[] {
    const db = getDb()
    const rows = db.prepare(
      `SELECT role, content, tool_calls_json, tool_result_json, tool_call_id
       FROM conversation_messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    ).all(conversationId, limit).reverse() as Array<{
      role: string
      content: string
      tool_calls_json: string | null
      tool_result_json: string | null
      tool_call_id: string | null
    }>

    return rows.map((row) => {
      const item: HistoryItem = { role: row.role as HistoryItem['role'], content: row.content }
      if (row.role === 'assistant' && row.tool_calls_json) {
        try {
          item.tool_calls = JSON.parse(row.tool_calls_json) as HistoryItem['tool_calls']
        } catch {}
      }
      if (row.role === 'tool') {
        item.tool_call_id = row.tool_call_id ?? undefined
      }
      return item
    })
  }

  getMessages(conversationId: number): ConversationMessageRecord[] {
    const db = getDb()
    return db.prepare(
      `SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(conversationId) as ConversationMessageRecord[]
  }

  getContext(conversationId: number, limit = 20): ConversationContextRecord {
    const session = this.ensureSession(conversationId)
    const history = this.getHistory(conversationId, limit)
    return { conversation_id: conversationId, session, history }
  }

  listConversations(limit = 20): Array<Record<string, unknown>> {
    const db = getDb()
    return db.prepare(
      `SELECT
        c.id,
        c.created_at,
        c.updated_at,
        s.channel,
        s.user_id,
        s.agent_instance_id,
        s.summary,
        a.slug AS agent_slug,
        a.name AS agent_name
       FROM conversations c
       LEFT JOIN conversation_sessions s ON s.conversation_id = c.id
       LEFT JOIN agent_instances a ON a.id = s.agent_instance_id
       ORDER BY c.updated_at DESC
       LIMIT ?`,
    ).all(limit) as Array<Record<string, unknown>>
  }

  updateSession(
    conversationId: number,
    patch: {
      working_context?: Record<string, unknown>
      pending_task_id?: string | null
      last_intent?: string
      last_plan_id?: string | null
      last_trace_id?: string | null
      summary?: string
      expires_at?: string | null
    },
  ): void {
    const session = this.ensureSession(conversationId)
    const workingContext = patch.working_context ?? this.parseJson(session.working_context_json, {})

    getDb().prepare(
      `UPDATE conversation_sessions SET
        working_context_json = ?,
        pending_task_id = ?,
        last_intent = ?,
        last_plan_id = ?,
        last_trace_id = ?,
        summary = ?,
        expires_at = ?,
        updated_at = datetime('now')
       WHERE conversation_id = ?`,
    ).run(
      JSON.stringify(workingContext),
      patch.pending_task_id ?? session.pending_task_id,
      patch.last_intent ?? session.last_intent,
      patch.last_plan_id ?? session.last_plan_id,
      patch.last_trace_id ?? session.last_trace_id,
      patch.summary ?? session.summary,
      patch.expires_at ?? session.expires_at,
      conversationId,
    )
  }

  private touchConversation(conversationId: number): void {
    getDb().prepare(
      `UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`,
    ).run(conversationId)
  }

  private parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
}

export const conversationService = new ConversationService()
