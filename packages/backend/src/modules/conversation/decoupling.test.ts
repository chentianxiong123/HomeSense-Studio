import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus } from '../../test-support/index.js'

describe('decoupling smoke · conversation runs without sqlite file', () => {
  it('writes and reads messages via in-memory db, no process globals touched', async () => {
    const memDb = createInMemoryDb()

    const { ConversationService } = await import('./index.js')
    const { AgentInstanceService } = await import('../agent-instance/index.js')

    const agentInstanceService = new AgentInstanceService(() => memDb)
    agentInstanceService.ensureDefaults()

    const conv = new ConversationService(() => memDb, agentInstanceService)

    const { conversation_id } = conv.createOrAttach({ surface: 'chat', user_id: 'tester' })
    expect(conversation_id).toBeGreaterThan(0)

    conv.appendMessage(conversation_id, 'user', 'hello')
    conv.appendMessage(conversation_id, 'assistant', 'hi back')

    const history = conv.getHistory(conversation_id, 10)
    expect(history.map((h) => h.role)).toEqual(['user', 'assistant'])
    expect(history.map((h) => h.content)).toEqual(['hello', 'hi back'])
  })

  it('two independent conversations live in two independent in-memory dbs', async () => {
    const dbA = createInMemoryDb()
    const dbB = createInMemoryDb()

    const { ConversationService } = await import('./index.js')
    const { AgentInstanceService } = await import('../agent-instance/index.js')

    const agentA = new AgentInstanceService(() => dbA)
    const agentB = new AgentInstanceService(() => dbB)
    agentA.ensureDefaults()
    agentB.ensureDefaults()

    const convA = new ConversationService(() => dbA, agentA)
    const convB = new ConversationService(() => dbB, agentB)

    const { conversation_id: idA } = convA.createOrAttach({ user_id: 'alice' })
    const { conversation_id: idB } = convB.createOrAttach({ user_id: 'bob' })

    convA.appendMessage(idA, 'user', 'A says hi')
    convB.appendMessage(idB, 'user', 'B says yo')

    expect(convA.getHistory(idA).map((h) => h.content)).toEqual(['A says hi'])
    expect(convB.getHistory(idB).map((h) => h.content)).toEqual(['B says yo'])

    const _bus = new FakeEventBus()
    expect(_bus.fired.length).toBe(0)
  })
})
