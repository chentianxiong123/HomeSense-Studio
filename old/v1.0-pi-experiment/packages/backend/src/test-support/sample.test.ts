import { describe, it, expect } from 'vitest'
import { createDbProvider, FakeEventBus, FakeCliBridge, FakeLlmService } from './index.js'

describe('test-support · sample composition', () => {
  it('FakeEventBus records fires', () => {
    const bus = new FakeEventBus()
    bus.fire('experience_written', { id: 1, importance: 0.8 })
    bus.fire('skill_registered', { name: 'foo' })

    expect(bus.firedNames()).toEqual(['experience_written', 'skill_registered'])
    expect(bus.countOf('experience_written')).toBe(1)
    expect(bus.lastOf('experience_written')?.data).toEqual({ id: 1, importance: 0.8 })
  })

  it('FakeCliBridge records calls and returns canned responses', async () => {
    const cli = new FakeCliBridge()
    cli.setResponder('mi-cli.set_prop', () => ({ status: 'success', data: { applied: true } }))

    const result = await cli.run('mi-cli', 'set_prop', { did: 'a', siid: 2, piid: 1, value: true })

    expect(result.status).toBe('success')
    expect(cli.callsOf('mi-cli', 'set_prop')).toHaveLength(1)
    expect(cli.callsOf('mi-cli', 'set_prop')[0].params).toEqual({ did: 'a', siid: 2, piid: 1, value: true })
  })

  it('FakeLlmService produces deterministic embeddings', async () => {
    const llm = new FakeLlmService()
    llm.setEmbedDimensions(8)

    const a1 = await llm.embed({ input: 'turn on the lamp' })
    const a2 = await llm.embed({ input: 'turn on the lamp' })

    expect(a1.data[0].embedding).toEqual(a2.data[0].embedding)
    expect(a1.data[0].embedding.length).toBe(8)
  })

  it('createDbProvider returns the same db on repeated calls', () => {
    const getDb = createDbProvider()

    const db1 = getDb()
    const db2 = getDb()

    expect(db1).toBe(db2)
  })

  it('full composition: db + bus + cli wire up cleanly without sqlite file', () => {
    const getDb = createDbProvider()
    const bus = new FakeEventBus()
    const cli = new FakeCliBridge()

    getDb().prepare("INSERT INTO conversations DEFAULT VALUES").run()
    bus.fire('conversation_created', {})

    expect(bus.countOf('conversation_created')).toBe(1)
    expect(cli.calls.length).toBe(0)
  })
})
