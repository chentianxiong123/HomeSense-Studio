import { agentInstanceService as defaultAgentInstanceService } from '../agent-instance/index.js'
import { SqlConversationRepository, type ConversationRepository } from './repository.js'

interface AgentInstanceServiceInstance {
  getById(id: number): { id: number; default_channel: string } | undefined
  getDefaultForSurface(surface: AgentSurface): { id: number; default_channel: string }
}

export type AgentSurface = 'chat' | 'studio' | 'scheduler' | 'remote'

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

export class ConversationService {
  constructor(
    private readonly repo: ConversationRepository = new SqlConversationRepository(),
    private readonly agentInstanceService: AgentInstanceServiceInstance = defaultAgentInstanceService,
  ) {}

  createOrAttach(input: StartConversationInput = {}): { conversation_id: number; session: ConversationSessionRecord } {
    const conversationId = input.conversation_id ?? this.repo.insertConversation()
    const session = this.ensureSession(conversationId, input)
    return { conversation_id: conversationId, session }
  }

  ensureSession(conversationId: number, input: StartConversationInput = {}): ConversationSessionRecord {
    const existing = this.repo.getSession(conversationId)
    if (existing) {
      if (input.working_context) {
        this.updateSession(conversationId, { working_context: input.working_context })
        return this.getSession(conversationId)
      }
      return existing
    }

    const agentInstanceId = input.agent_instance_id ?? this.agentInstanceService.getDefaultForSurface(input.surface ?? 'chat').id
    const agent = this.agentInstanceService.getById(agentInstanceId)

    this.repo.insertSession({
      conversationId,
      channel: input.channel ?? agent?.default_channel ?? 'web',
      userId: input.user_id ?? 'local',
      agentInstanceId,
      workingContextJson: JSON.stringify(input.working_context ?? {}),
      expiresAt: input.expires_at ?? null,
    })

    return this.getSession(conversationId)
  }

  getSession(conversationId: number): ConversationSessionRecord {
    const session = this.repo.getSession(conversationId)
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
    const toolResult = extra?.tool_result ?? (extra?.name ? { name: extra.name } : undefined)
    this.repo.insertMessage({
      conversationId,
      role,
      content,
      toolCallsJson: extra?.tool_calls != null ? JSON.stringify(extra.tool_calls) : null,
      toolResultJson: toolResult != null ? JSON.stringify(toolResult) : null,
      toolCallId: extra?.tool_call_id ?? null,
    })
    this.repo.touchConversation(conversationId)
  }

  getHistory(conversationId: number, limit = 20): HistoryItem[] {
    const rows = this.repo.listMessageHistory(conversationId, limit)
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
    return this.repo.listAllMessages(conversationId)
  }

  getContext(conversationId: number, limit = 20): ConversationContextRecord {
    const session = this.ensureSession(conversationId)
    const history = this.getHistory(conversationId, limit)
    return { conversation_id: conversationId, session, history }
  }

  listConversations(limit = 20): Array<Record<string, unknown>> {
    return this.repo.listConversationsWithAgent(limit)
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

    this.repo.updateSession(conversationId, {
      workingContextJson: JSON.stringify(workingContext),
      pendingTaskId: patch.pending_task_id ?? session.pending_task_id,
      lastIntent: patch.last_intent ?? session.last_intent,
      lastPlanId: patch.last_plan_id ?? session.last_plan_id,
      lastTraceId: patch.last_trace_id ?? session.last_trace_id,
      summary: patch.summary ?? session.summary,
      expiresAt: patch.expires_at ?? session.expires_at,
    })
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
