import { getDb as defaultGetDb } from '../../db/index.js'
import type {
  ConversationSessionRecord,
  ConversationMessageRecord,
} from './index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface ConversationRepository {
  insertConversation(): number
  getSession(conversationId: number): ConversationSessionRecord | undefined
  insertSession(input: {
    conversationId: number
    channel: string
    userId: string
    agentInstanceId: number | null
    workingContextJson: string
    expiresAt: string | null
  }): void
  updateSession(
    conversationId: number,
    patch: {
      workingContextJson: string
      pendingTaskId: string | null
      lastIntent: string
      lastPlanId: string | null
      lastTraceId: string | null
      summary: string
      expiresAt: string | null
    },
  ): void
  insertMessage(input: {
    conversationId: number
    role: ConversationMessageRecord['role']
    content: string
    toolCallsJson: string | null
    toolResultJson: string | null
    toolCallId: string | null
  }): void
  touchConversation(conversationId: number): void
  listMessageHistory(
    conversationId: number,
    limit: number,
  ): Array<{
    role: string
    content: string
    tool_calls_json: string | null
    tool_result_json: string | null
    tool_call_id: string | null
  }>
  listAllMessages(conversationId: number): ConversationMessageRecord[]
  listConversationsWithAgent(limit: number): Array<Record<string, unknown>>
}

export class SqlConversationRepository implements ConversationRepository {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  insertConversation(): number {
    const result = this.getDb().prepare('INSERT INTO conversations DEFAULT VALUES').run()
    return Number(result.lastInsertRowid)
  }

  getSession(conversationId: number): ConversationSessionRecord | undefined {
    return this.getDb()
      .prepare(`SELECT * FROM conversation_sessions WHERE conversation_id = ?`)
      .get(conversationId) as ConversationSessionRecord | undefined
  }

  insertSession(input: {
    conversationId: number
    channel: string
    userId: string
    agentInstanceId: number | null
    workingContextJson: string
    expiresAt: string | null
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO conversation_sessions (
          conversation_id, channel, user_id, agent_instance_id, working_context_json, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.conversationId,
        input.channel,
        input.userId,
        input.agentInstanceId,
        input.workingContextJson,
        input.expiresAt,
      )
  }

  updateSession(
    conversationId: number,
    patch: {
      workingContextJson: string
      pendingTaskId: string | null
      lastIntent: string
      lastPlanId: string | null
      lastTraceId: string | null
      summary: string
      expiresAt: string | null
    },
  ): void {
    this.getDb()
      .prepare(
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
      )
      .run(
        patch.workingContextJson,
        patch.pendingTaskId,
        patch.lastIntent,
        patch.lastPlanId,
        patch.lastTraceId,
        patch.summary,
        patch.expiresAt,
        conversationId,
      )
  }

  insertMessage(input: {
    conversationId: number
    role: ConversationMessageRecord['role']
    content: string
    toolCallsJson: string | null
    toolResultJson: string | null
    toolCallId: string | null
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO conversation_messages (
          conversation_id, role, content, tool_calls_json, tool_result_json, tool_call_id
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.conversationId,
        input.role,
        input.content,
        input.toolCallsJson,
        input.toolResultJson,
        input.toolCallId,
      )
  }

  touchConversation(conversationId: number): void {
    this.getDb()
      .prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`)
      .run(conversationId)
  }

  listMessageHistory(
    conversationId: number,
    limit: number,
  ): Array<{
    role: string
    content: string
    tool_calls_json: string | null
    tool_result_json: string | null
    tool_call_id: string | null
  }> {
    const rows = this.getDb()
      .prepare(
        `SELECT role, content, tool_calls_json, tool_result_json, tool_call_id
         FROM conversation_messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(conversationId, limit)
      .reverse()
    return rows as Array<{
      role: string
      content: string
      tool_calls_json: string | null
      tool_result_json: string | null
      tool_call_id: string | null
    }>
  }

  listAllMessages(conversationId: number): ConversationMessageRecord[] {
    return this.getDb()
      .prepare(
        `SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(conversationId) as ConversationMessageRecord[]
  }

  listConversationsWithAgent(limit: number): Array<Record<string, unknown>> {
    return this.getDb()
      .prepare(
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
      )
      .all(limit) as Array<Record<string, unknown>>
  }
}
