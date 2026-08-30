import { beforeEach, describe, expect, it } from 'vitest'
import { RuleEngine, type Rule, type RuleAction } from './index.js'

interface PreparedStatement {
  all(...args: unknown[]): unknown[]
  run(...args: unknown[]): { lastInsertRowid: unknown }
}

interface FakeDb {
  prepare(sql: string): PreparedStatement
}

interface FakeServiceRegistry {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
}

interface RecordedEvent {
  event: string
  data?: unknown
}

class FakeEventBus {
  fired: RecordedEvent[] = []

  fire(event: string, data?: unknown): void {
    this.fired.push({ event, data })
  }

  countOf(event: string): number {
    return this.fired.filter((item) => item.event === event).length
  }

  lastOf(event: string): RecordedEvent | undefined {
    return this.fired.filter((item) => item.event === event).at(-1)
  }
}

class InMemoryRuleDb {
  private rules: Array<{ id: number; trigger_pattern: string; priority: number; enabled: number }> = []
  private actions: Array<{ rule_id: number; tool: string; action: string; params_json: string; order: number }> = []
  private nextId = 1

  asDb(): FakeDb {
    return {
      prepare: (sql: string): PreparedStatement => ({
        all: (...args: unknown[]) => this.all(sql, args),
        run: (...args: unknown[]) => this.run(sql, args),
      }),
    }
  }

  private all(sql: string, args: unknown[]): unknown[] {
    if (sql.includes('SELECT * FROM rules')) {
      return this.rules
        .filter((rule) => rule.enabled === 1)
        .sort((left, right) => right.priority - left.priority)
    }
    if (sql.includes('SELECT * FROM rule_actions')) {
      const ruleId = Number(args[0])
      return this.actions
        .filter((action) => action.rule_id === ruleId)
        .sort((left, right) => left.order - right.order)
    }
    return []
  }

  private run(sql: string, args: unknown[]): { lastInsertRowid: unknown } {
    if (sql.includes('INSERT INTO rules')) {
      const id = this.nextId
      this.nextId += 1
      this.rules.push({
        id,
        trigger_pattern: String(args[0]),
        priority: Number(args[1]),
        enabled: Number(args[2]),
      })
      return { lastInsertRowid: id }
    }

    if (sql.includes('DELETE FROM rule_actions')) {
      const ruleId = Number(args[0])
      this.actions = this.actions.filter((action) => action.rule_id !== ruleId)
      return { lastInsertRowid: 0 }
    }

    if (sql.includes('INSERT INTO rule_actions')) {
      this.actions.push({
        rule_id: Number(args[0]),
        tool: String(args[1]),
        action: String(args[2]),
        params_json: String(args[3]),
        order: Number(args[4]),
      })
      return { lastInsertRowid: this.actions.length }
    }

    if (sql.includes('DELETE FROM rules')) {
      const ruleId = Number(args[0])
      this.rules = this.rules.filter((rule) => rule.id !== ruleId)
      this.actions = this.actions.filter((action) => action.rule_id !== ruleId)
      return { lastInsertRowid: 0 }
    }

    return { lastInsertRowid: 0 }
  }
}

function createRule(overrides: Partial<Rule> = {}): Omit<Rule, 'actions'> & { actions: RuleAction[] } {
  return {
    id: 0,
    trigger_pattern: '打开电视',
    priority: 1,
    enabled: true,
    actions: [],
    ...overrides,
  }
}

function makeEngine(serviceRegistry: FakeServiceRegistry = { call: async (_name: string, _params: Record<string, unknown>) => undefined }) {
  const db = new InMemoryRuleDb()
  const bus = new FakeEventBus()
  const engine = new RuleEngine(
    () => db.asDb() as any,
    bus as any,
    serviceRegistry,
  )
  return { engine, bus }
}

describe('RuleEngine', () => {
  it('matches exact input with confidence 1.0', () => {
    const { engine, bus } = makeEngine()
    engine.addRule(createRule())

    const result = engine.match('打开电视')

    expect(result?.confidence).toBe(1)
    expect(result?.trigger_pattern).toBe('打开电视')
    expect(bus.countOf('rule_matched')).toBe(1)
  })

  it('matches substring input with confidence 0.9', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '电视' }))

    expect(engine.match('我想打开电视')?.confidence).toBe(0.9)
  })

  it('matches slash-delimited regular expressions with confidence 0.8', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '/^播放第\\d+集$/' }))

    expect(engine.match('播放第3集')?.confidence).toBe(0.8)
    expect(engine.match('播放第三集')).toBeNull()
  })

  it('uses character overlap only as the last fuzzy fallback', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '打开电视' }))

    expect(engine.match('电视打开')?.confidence).toBeCloseTo(0.7, 2)
    expect(engine.match('打开')).toBeNull()
  })

  it('counts repeated characters by available input characters', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '看看看' }))

    expect(engine.match('看看')).toBeNull()
  })

  it('does not fuzzy-match patterns that contain whitespace', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '打开 电视' }))

    expect(engine.match('打开 电视')?.confidence).toBe(1)
    expect(engine.match('打开电视')).toBeNull()
  })

  it('prefers higher confidence before priority', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '打开电视', priority: 1 }))
    engine.addRule(createRule({ trigger_pattern: '电视', priority: 99 }))

    const result = engine.match('打开电视')

    expect(result?.confidence).toBe(1)
    expect(result?.trigger_pattern).toBe('打开电视')
  })

  it('uses priority as a tie-breaker for equal confidence', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '电视', priority: 1, actions: [{ tool: 'low', action: 'run', params: {}, order: 0 }] }))
    engine.addRule(createRule({ trigger_pattern: '电视', priority: 5, actions: [{ tool: 'high', action: 'run', params: {}, order: 0 }] }))

    const result = engine.match('打开电视')

    expect(result?.actions[0].tool).toBe('high')
  })

  it('skips disabled rules', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '隐藏规则', enabled: false }))

    expect(engine.match('隐藏规则')).toBeNull()
  })

  it('loads enabled rules and actions from db-backed addRule', () => {
    const { engine } = makeEngine()
    engine.addRule(createRule({
      actions: [{ tool: 'mi', action: 'set_prop', params: { value: true }, order: 0 }],
    }))

    const reloaded = makeEngine().engine
    expect(reloaded.listRules()).toHaveLength(0)
    expect(engine.match('打开电视')?.actions).toEqual([
      { tool: 'mi', action: 'set_prop', params: { value: true }, order: 0 },
    ])
  })

  it('removes rules from memory and db', () => {
    const { engine, bus } = makeEngine()
    engine.addRule(createRule({ trigger_pattern: '删除我' }))
    const id = engine.listRules()[0].id

    engine.removeRule(id)

    expect(engine.match('删除我')).toBeNull()
    expect(engine.listRules()).toHaveLength(0)
    expect(bus.lastOf('rule_removed')?.data).toMatchObject({ rule_id: id })
  })

  it('executes actions through service registry', async () => {
    let capturedName = ''
    let capturedParams: Record<string, unknown> = {}
    const { engine } = makeEngine({
      call: async (name: string, params: Record<string, unknown>) => {
        capturedName = name
        capturedParams = params
        return { ok: true }
      },
    })

    const result = await engine.executeAction({
      tool: 'mi',
      action: 'set_prop',
      params: { did: 'tv-1' },
      order: 0,
    })

    expect(result).toEqual({ success: true, data: { ok: true } })
    expect(capturedName).toBe('mi.set_prop')
    expect(capturedParams).toEqual({ did: 'tv-1' })
  })

  it('returns a structured error when action execution fails', async () => {
    const { engine } = makeEngine({
      call: async () => {
        throw new Error('service not found')
      },
    })

    await expect(engine.executeAction({ tool: 'x', action: 'y', params: {}, order: 0 })).resolves.toEqual({
      success: false,
      error: 'service not found',
    })
  })
})
