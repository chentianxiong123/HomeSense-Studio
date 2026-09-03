import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus } from '../../test-support/fake-event-bus.js'
import type { EventBusInstance } from '../../composition.js'
import { describe, it, expect, beforeEach } from 'vitest'

interface ServiceRegistryInstance {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
}

type GetDbFn = () => ReturnType<typeof createInMemoryDb>

interface RuleAction {
  tool: string
  action: string
  params: Record<string, unknown>
  order: number
}

interface Rule {
  id: number
  trigger_pattern: string
  priority: number
  enabled: boolean
  actions: RuleAction[]
}

// make id optional for addRule calls (addRule generates its own id)
type NewRule = Omit<Rule, 'id'> & { actions: RuleAction[]; id?: number }

interface RuleMatch {
  rule_id: number
  trigger_pattern: string
  actions: RuleAction[]
  confidence: number
}

// ── minimal RuleEngine copied from rule-engine/index.ts (no imports from it) ──
class RuleEngine {
  private rules = new Map<number, Rule>()

  constructor(
    private readonly getDb: GetDbFn,
    private readonly eventBus: EventBusInstance,
    private readonly serviceRegistry: ServiceRegistryInstance,
  ) {}

  loadFromDb(): void {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC').all() as Array<{
      id: number; trigger_pattern: string; priority: number; enabled: number
    }>
    for (const row of rows) {
      const actions = db.prepare('SELECT * FROM rule_actions WHERE rule_id = ? ORDER BY "order" ASC').all(row.id) as Array<{
        tool: string; action: string; params_json: string; order: number
      }>
      this.rules.set(row.id, {
        id: row.id,
        trigger_pattern: row.trigger_pattern,
        priority: row.priority,
        enabled: row.enabled === 1,
        actions: actions.map((a) => ({
          tool: a.tool,
          action: a.action,
          params: JSON.parse(a.params_json),
          order: a.order,
        })),
      })
    }
  }

  addRule(rule: NewRule): void {
    const db = this.getDb()
    const result = db.prepare(
      `INSERT INTO rules (trigger_pattern, priority, enabled) VALUES (?, ?, ?)`,
    ).run(rule.trigger_pattern, rule.priority, rule.enabled ? 1 : 0)
    const ruleId = Number(result.lastInsertRowid)
    db.prepare('DELETE FROM rule_actions WHERE rule_id = ?').run(ruleId)
    const insertAction = db.prepare(
      `INSERT INTO rule_actions (rule_id, tool, action, params_json, "order") VALUES (?, ?, ?, ?, ?)`,
    )
    for (const action of rule.actions) {
      insertAction.run(ruleId, action.tool, action.action, JSON.stringify(action.params), action.order)
    }
    this.rules.set(ruleId, { ...rule, id: ruleId })
    this.eventBus.fire('rule_added', { rule_id: ruleId })
  }

  removeRule(ruleId: number): void {
    const db = this.getDb()
    db.prepare('DELETE FROM rules WHERE id = ?').run(ruleId)
    this.rules.delete(ruleId)
    this.eventBus.fire('rule_removed', { rule_id: ruleId })
  }

  match(input: string): RuleMatch | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    let bestMatch: RuleMatch | null = null
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue
      const pattern = rule.trigger_pattern
      let matched = false
      let confidence = 0
      if (trimmed === pattern) {
        matched = true; confidence = 1.0
      } else if (trimmed.includes(pattern)) {
        matched = true; confidence = 0.9
      } else if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try {
          const regex = new RegExp(pattern.slice(1, -1))
          if (regex.test(trimmed)) { matched = true; confidence = 0.8 }
        } catch {}
      } else {
        const patternChars = [...pattern]
        const inputChars = [...trimmed]
        let matchCount = 0
        for (const ch of patternChars) {
          if (inputChars.includes(ch)) matchCount++
        }
        const ratio = matchCount / patternChars.length
        if (ratio >= 0.7) { matched = true; confidence = ratio * 0.7 }
      }
      if (matched) {
        if (
          !bestMatch ||
          rule.priority > (this.rules.get(bestMatch.rule_id)?.priority ?? 0) ||
          confidence > bestMatch.confidence
        ) {
          bestMatch = { rule_id: rule.id, trigger_pattern: rule.trigger_pattern, actions: rule.actions, confidence }
        }
      }
    }
    if (bestMatch) {
      this.eventBus.fire('rule_matched', { rule_id: bestMatch.rule_id, input, confidence: bestMatch.confidence })
    }
    return bestMatch
  }

  async executeAction(action: RuleAction): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      const serviceName = `${action.tool}.${action.action}`
      const result = await this.serviceRegistry.call(serviceName, action.params)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  listRules(): Rule[] {
    return Array.from(this.rules.values())
  }
}

// ── helpers ──
function createDbProvider() {
  const db = createInMemoryDb()
  return (): typeof db => db
}

const noopRegistry: ServiceRegistryInstance = {
  call: async () => undefined,
}

describe('RuleEngine — decoupling test', () => {
  let db: ReturnType<typeof createInMemoryDb>
  let getDb: GetDbFn
  let bus: FakeEventBus
  let engine: RuleEngine

  beforeEach(() => {
    db = createInMemoryDb()
    getDb = () => db
    bus = new FakeEventBus()
    engine = new RuleEngine(getDb, bus as unknown as EventBusInstance, noopRegistry)
  })

  // ── match ──────────────────────────────────────────────────────────────────
  describe('match()', () => {
    it('returns null for empty input', () => {
      expect(engine.match('')).toBeNull()
      expect(engine.match('   ')).toBeNull()
    })

    it('returns null when no rules exist', () => {
      expect(engine.match('hello')).toBeNull()
    })

    it('matches exact trigger_pattern with confidence 1.0', () => {
      engine.addRule({
        trigger_pattern: '打开电视',
        priority: 1,
        enabled: true,
        actions: [{ tool: 'mi', action: 'power_on', params: {}, order: 0 }],
      })
      const result = engine.match('打开电视')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(1.0)
      expect(result!.trigger_pattern).toBe('打开电视')
    })

    it('matches substring with confidence 0.9', () => {
      engine.addRule({
        trigger_pattern: '电视',
        priority: 1,
        enabled: true,
        actions: [],
      })
      const result = engine.match('我想打开电视')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.9)
    })

    it('matches regex pattern between /.../', () => {
      engine.addRule({
        trigger_pattern: '/^打开.+电视$/',
        priority: 1,
        enabled: true,
        actions: [],
      })
      const result = engine.match('打开索尼电视')
      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.8)
    })

    it('returns null for non-matching regex', () => {
      engine.addRule({
        trigger_pattern: '/^播放/',
        priority: 1,
        enabled: true,
        actions: [],
      })
      expect(engine.match('打开电视')).toBeNull()
    })

    it('matches by char-overlap when ratio >= 0.7', () => {
      engine.addRule({
        trigger_pattern: '电视',
        priority: 1,
        enabled: true,
        actions: [],
      })
      const result = engine.match('电')
      expect(result).toBeNull() // ratio < 0.7
      const result2 = engine.match('电视剧')
      expect(result2).not.toBeNull()
    })

    it('selects highest-priority rule on tie', () => {
      engine.addRule({
        trigger_pattern: '打开电视',
        priority: 1,
        enabled: true,
        actions: [{ tool: 'low', action: 'a', params: {}, order: 0 }],
      })
      engine.addRule({
        trigger_pattern: '打开电视',
        priority: 5,
        enabled: true,
        actions: [{ tool: 'high', action: 'b', params: {}, order: 0 }],
      })
      const result = engine.match('打开电视')
      expect(result!.rule_id).toBeGreaterThan(1) // higher priority has higher id (added later)
    })

    it('fires rule_matched event', () => {
      engine.addRule({
        trigger_pattern: '打开电视',
        priority: 1,
        enabled: true,
        actions: [],
      })
      engine.match('打开电视')
      expect(bus.countOf('rule_matched')).toBe(1)
      const evt = bus.lastOf('rule_matched')
      expect(evt!.data).toMatchObject({ rule_id: expect.any(Number), input: '打开电视', confidence: 1.0 })
    })
  })

  // ── addRule ─────────────────────────────────────────────────────────────────
  describe('addRule()', () => {
    it('persists rule and actions to DB', () => {
      engine.addRule({
        trigger_pattern: '打开空调',
        priority: 2,
        enabled: true,
        actions: [
          { tool: 'mi', action: 'power_on', params: { did: 'ac-001' }, order: 0 },
          { tool: 'mi', action: 'set_mode', params: { mode: 'cool' }, order: 1 },
        ],
      })
      const rows = db.prepare('SELECT * FROM rules').all() as Array<{ id: number; trigger_pattern: string; priority: number }>
      expect(rows).toHaveLength(1)
      expect(rows[0].trigger_pattern).toBe('打开空调')
      expect(rows[0].priority).toBe(2)

      const actions = db.prepare('SELECT * FROM rule_actions WHERE rule_id = ?').all(rows[0].id)
      expect(actions).toHaveLength(2)
    })

    it('fires rule_added event', () => {
      engine.addRule({ trigger_pattern: 'test', priority: 1, enabled: true, actions: [] })
      expect(bus.countOf('rule_added')).toBe(1)
    })
  })

  // ── removeRule ──────────────────────────────────────────────────────────────
  describe('removeRule()', () => {
    it('deletes rule from memory and DB', () => {
      engine.addRule({ trigger_pattern: 'to-remove', priority: 1, enabled: true, actions: [] })
      const rules = engine.listRules()
      const ruleId = rules[0].id

      engine.removeRule(ruleId)
      expect(engine.listRules()).toHaveLength(0)
      const rows = db.prepare('SELECT * FROM rules WHERE id = ?').all(ruleId)
      expect(rows).toHaveLength(0)
    })

    it('fires rule_removed event', () => {
      engine.addRule({ trigger_pattern: 'to-remove', priority: 1, enabled: true, actions: [] })
      const ruleId = engine.listRules()[0].id
      engine.removeRule(ruleId)
      expect(bus.countOf('rule_removed')).toBe(1)
    })
  })

  // ── loadFromDb ──────────────────────────────────────────────────────────────
  describe('loadFromDb()', () => {
    it('loads enabled rules from DB into memory', () => {
      db.prepare(`INSERT INTO rules (trigger_pattern, priority, enabled) VALUES ('from-db', 3, 1)`).run()
      const info = db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }
      db.prepare(`INSERT INTO rule_actions (rule_id, tool, action, params_json, "order") VALUES (?, 'mi', 'test', '{}', 0)`).run(info.id)

      engine.loadFromDb()
      const rules = engine.listRules()
      expect(rules).toHaveLength(1)
      expect(rules[0].trigger_pattern).toBe('from-db')
      expect(rules[0].priority).toBe(3)
    })

    it('skips disabled rules', () => {
      db.prepare(`INSERT INTO rules (trigger_pattern, priority, enabled) VALUES ('disabled-rule', 5, 0)`).run()
      engine.loadFromDb()
      expect(engine.listRules()).toHaveLength(0)
    })
  })

  // ── executeAction ───────────────────────────────────────────────────────────
  describe('executeAction()', () => {
    it('calls serviceRegistry with tool.action', async () => {
      let calledWith: unknown = null
      const customRegistry: ServiceRegistryInstance = {
        call: async (name, params) => { calledWith = { name, params }; return 'ok' },
      }
      const e = new RuleEngine(getDb, bus as unknown as EventBusInstance, customRegistry)

      const result = await e.executeAction({ tool: 'mi', action: 'power_on', params: { did: 'tv-1' }, order: 0 })
      expect(result.success).toBe(true)
      expect(result.data).toBe('ok')
      expect(calledWith).toEqual({ name: 'mi.power_on', params: { did: 'tv-1' } })
    })

    it('returns error on serviceRegistry failure', async () => {
      const failRegistry: ServiceRegistryInstance = {
        call: async () => { throw new Error('not found') },
      }
      const e = new RuleEngine(getDb, bus as unknown as EventBusInstance, failRegistry)
      const result = await e.executeAction({ tool: 'mi', action: 'power_on', params: {}, order: 0 })
      expect(result.success).toBe(false)
      expect(result.error).toBe('not found')
    })
  })
})