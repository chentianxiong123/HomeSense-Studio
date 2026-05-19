import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { ConversationService } from './index.js'
import { SqlConversationRepository, type ConversationRepository } from './repository.js'
import { AgentInstanceService } from '../agent-instance/index.js'
import type { ConversationSessionRecord, ConversationMessageRecord } from './index.js'

describe('ConversationService · integration with in-memory sqlite', () => {
  it('writes and reads messages via SqlConversationRepository', () => {
    const memDb = createInMemoryDb()
    const repo = new SqlConversationRepository(() => memDb)
    const agents = new AgentInstanceService(() => memDb)
    agents.ensureDefaults()

    const conv = new ConversationService(repo, agents)

    const { conversation_id } = conv.createOrAttach({ surface: 'chat', user_id: 'tester' })
    expect(conversation_id).toBeGreaterThan(0)

    conv.appendMessage(conversation_id, 'user', 'hello')
    conv.appendMessage(conversation_id, 'assistant', 'hi back')

    const history = conv.getHistory(conversation_id, 10)
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant'])
    expect(history.map((h) => h.content)).toEqual(['hello', 'hi back'])
  })

  it('two independent conversations live in two independent in-memory dbs', () => {
    const dbA = createInMemoryDb()
    const dbB = createInMemoryDb()
    const repoA = new SqlConversationRepository(() => dbA)
    const repoB = new SqlConversationRepository(() => dbB)
    const agentA = new AgentInstanceService(() => dbA)
    const agentB = new AgentInstanceService(() => dbB)
    agentA.ensureDefaults()
    agentB.ensureDefaults()

    const convA = new ConversationService(repoA, agentA)
    const convB = new ConversationService(repoB, agentB)

    const { conversation_id: idA } = convA.createOrAttach({ user_id: 'alice' })
    const { conversation_id: idB } = convB.createOrAttach({ user_id: 'bob' })

    convA.appendMessage(idA, 'user', 'A says hi')
    convB.appendMessage(idB, 'user', 'B says yo')

    expect(convA.getHistory(idA).map((h) => h.content)).toEqual(['A says hi'])
    expect(convB.getHistory(idB).map((h) => h.content)).toEqual(['B says yo'])
  })
})

describe('ConversationService · pure fake repository (zero db)', () => {
  it('runs end to end with no sqlite involvement at all', () => {
    const repo = new InMemoryFakeRepo()

    const fakeAgent = {
      getById: () => ({ id: 1, default_channel: 'web' }),
      getDefaultForSurface: () => ({ id: 1, default_channel: 'web' }),
    }
    const conv = new ConversationService(repo, fakeAgent)

    const { conversation_id } = conv.createOrAttach({ user_id: 'no_db_user' })
    conv.appendMessage(conversation_id, 'user', 'pure fake')

    expect(conv.getHistory(conversation_id).map((h) => h.content)).toEqual(['pure fake'])
    expect(repo.messages.length).toBe(1)
    expect(repo.touched).toContain(conversation_id)
  })
})

class InMemoryFakeRepo implements ConversationRepository {
  private nextId = 1
  private nextMsgId = 1
  readonly sessions = new Map<number, ConversationSessionRecord>()
  readonly messages: Array<ConversationMessageRecord & { tool_call_id: string | null }> = []
  readonly touched: number[] = []

  insertConversation(): number {
    return this.nextId++
  }

  getSession(conversationId: number) {
    return this.sessions.get(conversationId)
  }

  insertSession(input: {
    conversationId: number
    channel: string
    userId: string
    agentInstanceId: number | null
    workingContextJson: string
    expiresAt: string | null
  }): void {
    this.sessions.set(input.conversationId, {
      conversation_id: input.conversationId,
      channel: input.channel,
      user_id: input.userId,
      agent_instance_id: input.agentInstanceId,
      working_context_json: input.workingContextJson,
      pending_task_id: null,
      last_intent: '',
      last_plan_id: null,
      last_trace_id: null,
      summary: '',
      expires_at: input.expiresAt,
      created_at: 'fake',
      updated_at: 'fake',
    })
  }

  updateSession(): void {
    // not needed for this test
  }

  insertMessage(input: {
    conversationId: number
    role: ConversationMessageRecord['role']
    content: string
    toolCallsJson: string | null
    toolResultJson: string | null
    toolCallId: string | null
  }): void {
    this.messages.push({
      id: this.nextMsgId++,
      conversation_id: input.conversationId,
      role: input.role,
      content: input.content,
      tool_calls_json: input.toolCallsJson,
      tool_result_json: input.toolResultJson,
      tool_call_id: input.toolCallId,
      created_at: 'fake',
    })
  }

  touchConversation(conversationId: number): void {
    this.touched.push(conversationId)
  }

  listMessageHistory(conversationId: number, limit: number) {
    return this.messages
      .filter((m) => m.conversation_id === conversationId)
      .slice(-limit)
      .map((m) => ({
        role: m.role,
        content: m.content,
        tool_calls_json: m.tool_calls_json,
        tool_result_json: m.tool_result_json,
        tool_call_id: m.tool_call_id,
      }))
  }

  listAllMessages(conversationId: number): ConversationMessageRecord[] {
    return this.messages.filter((m) => m.conversation_id === conversationId)
  }

  listConversationsWithAgent(): Array<Record<string, unknown>> {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      id,
      ...s,
    }))
  }
}
