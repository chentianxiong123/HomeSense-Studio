import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus as defaultEventBus } from '../event-bus/index.js'
import { serviceRegistry as defaultServiceRegistry } from '../service-registry/index.js'
import type { EventBusInstance } from '../../composition.js'

interface ServiceRegistryInstance {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
}

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export type { GetDbFn }

export interface RuleAction {
  tool: string
  action: string
  params: Record<string, unknown>
  order: number
}

export interface Rule {
  id: number
  trigger_pattern: string
  priority: number
  enabled: boolean
  actions: RuleAction[]
}

export interface RuleMatch {
  rule_id: number
  trigger_pattern: string
  actions: RuleAction[]
  confidence: number
}

export class RuleEngine {
  private rules = new Map<number, Rule>()

  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly serviceRegistry: ServiceRegistryInstance = defaultServiceRegistry,
  ) {}

  loadFromDb(): void {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC').all() as Array<{
      id: number
      trigger_pattern: string
      priority: number
      enabled: number
    }>

    for (const row of rows) {
      const actions = db.prepare('SELECT * FROM rule_actions WHERE rule_id = ? ORDER BY "order" ASC').all(row.id) as Array<{
        tool: string
        action: string
        params_json: string
        order: number
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

  addRule(rule: Omit<Rule, 'actions'> & { actions: RuleAction[] }): void {
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
        matched = true
        confidence = 1.0
      } else if (trimmed.includes(pattern)) {
        matched = true
        confidence = 0.9
      } else if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try {
          const regex = new RegExp(pattern.slice(1, -1))
          if (regex.test(trimmed)) {
            matched = true
            confidence = 0.8
          }
        } catch {}
      } else if (!/\s/.test(pattern)) {
        const ratio = countCharacterOverlap(pattern, trimmed)
        if (ratio >= 0.7) {
          matched = true
          confidence = ratio * 0.7
        }
      }

      if (matched) {
        const bestPriority = bestMatch ? this.rules.get(bestMatch.rule_id)?.priority ?? 0 : 0
        if (!bestMatch || confidence > bestMatch.confidence || (confidence === bestMatch.confidence && rule.priority > bestPriority)) {
          bestMatch = {
            rule_id: rule.id,
            trigger_pattern: rule.trigger_pattern,
            actions: rule.actions,
            confidence,
          }
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

function countCharacterOverlap(pattern: string, input: string): number {
  if (!pattern) return 0
  const remaining = [...input]
  let matchCount = 0

  for (const ch of pattern) {
    const index = remaining.indexOf(ch)
    if (index === -1) continue
    matchCount += 1
    remaining.splice(index, 1)
  }

  return matchCount / [...pattern].length
}

export const ruleEngine = new RuleEngine()
