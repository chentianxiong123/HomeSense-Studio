import fs from 'fs'
import type { ContextCompletionResult } from '../context-completer/index.js'

export interface PlanStepDefinition {
  tool: string
  action: string
  params: Record<string, unknown>
  delay_ms?: number
  wait_condition?: {
    condition: 'app_foreground' | 'ui_element_visible' | 'device_online'
    expected: string
    timeout_ms?: number
  }
}

export interface CompiledPlanDefinition {
  id: string
  name: string
  description: string
  intent: string
  input: string
  steps: PlanStepDefinition[]
  aliases: string[]
  source: 'legacy_success_path' | 'manual'
}

interface LegacyPathRow {
  id?: string
  name?: string
  description?: string
  intent?: string
  input?: string
  actions?: Array<{
    tool?: string
    action?: string
    params?: Record<string, unknown>
  }>
}

const DEFAULT_LEGACY_PATH = 'D:\\files\\HomeSense\\agent\\dist\\tools\\success_paths\\data\\paths.json'

class PlanLibraryService {
  private plans = new Map<string, CompiledPlanDefinition>()

  loadLegacyPlans(filePath: string = process.env.LEGACY_SUCCESS_PATHS_FILE || DEFAULT_LEGACY_PATH): number {
    if (!fs.existsSync(filePath)) return 0

    let loaded = 0
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as LegacyPathRow[]

      for (const row of parsed) {
        const normalized = this.normalizeLegacyPath(row)
        if (!normalized) continue
        this.plans.set(normalized.id, normalized)
        loaded += 1
      }
    } catch {
      return loaded
    }

    return loaded
  }

  listPlans(): CompiledPlanDefinition[] {
    return Array.from(this.plans.values()).sort((left, right) => left.name.localeCompare(right.name))
  }

  getPlan(id: string): CompiledPlanDefinition | undefined {
    return this.plans.get(id)
  }

  matchPlan(message: string): CompiledPlanDefinition | undefined {
    const normalizedMessage = this.normalizeText(message)
    if (!normalizedMessage) return undefined

    let bestPlan: CompiledPlanDefinition | undefined
    let bestScore = 0

    for (const plan of this.plans.values()) {
      const score = this.scorePlan(plan, normalizedMessage)
      if (score > bestScore) {
        bestScore = score
        bestPlan = plan
      }
    }

    return bestScore >= 2 ? bestPlan : undefined
  }

  resolveByContext(_completion: Pick<ContextCompletionResult, 'target_device_id' | 'target_device_type' | 'matched_media_app'>): CompiledPlanDefinition | undefined {
    return undefined
  }

  private normalizeLegacyPath(row: LegacyPathRow): CompiledPlanDefinition | null {
    const id = String(row.id ?? '').trim()
    const name = String(row.name ?? '').trim()
    if (!id || !name) return null

    const steps: PlanStepDefinition[] = (row.actions ?? [])
      .filter((action) => action.tool && action.action)
      .map((action) => ({
        tool: String(action.tool),
        action: String(action.action),
        params: action.params ?? {},
      }))

    return {
      id,
      name,
      description: String(row.description ?? ''),
      intent: String(row.intent ?? ''),
      input: String(row.input ?? ''),
      steps,
      aliases: this.deriveAliases({
        id,
        name,
        description: String(row.description ?? ''),
        intent: String(row.intent ?? ''),
        input: String(row.input ?? ''),
        steps,
        aliases: [],
        source: 'legacy_success_path',
      }),
      source: 'legacy_success_path',
    }
  }

  private scorePlan(plan: CompiledPlanDefinition, normalizedMessage: string): number {
    const input = this.normalizeText(plan.input)
    const intent = this.normalizeText(plan.intent)
    const name = this.normalizeText(plan.name)
    const description = this.normalizeText(plan.description)
    const aliases = plan.aliases.map((alias) => this.normalizeText(alias)).filter(Boolean)

    if (input && normalizedMessage === input) return 10
    if (input && normalizedMessage.includes(input)) return 8
    if (name && normalizedMessage.includes(name)) return 6
    if (intent && normalizedMessage.includes(intent)) return 5

    let score = 0
    for (const keyword of this.extractKeywords([input, intent, name, description, ...aliases])) {
      if (normalizedMessage.includes(keyword)) {
        score += keyword.length >= 4 ? 2 : 1
      }
    }

    return score
  }

  private extractKeywords(values: string[]): string[] {
    const keywords = new Set<string>()
    for (const value of values) {
      for (const chunk of value.split(/[\s,./|:_-]+/)) {
        const trimmed = chunk.trim()
        if (trimmed.length >= 2) {
          keywords.add(trimmed)
        }
      }
    }
    return Array.from(keywords)
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '')
  }

  private deriveAliases(plan: CompiledPlanDefinition): string[] {
    const aliases = new Set<string>()
    const sourceValues = [plan.id, plan.name, plan.intent, plan.input, plan.description]

    for (const value of sourceValues) {
      if (/bili/i.test(value)) {
        aliases.add('bilibili')
        aliases.add('bili')
        aliases.add('b站')
      }
      if (/watch/i.test(value) || /看/.test(value)) {
        aliases.add('看电视')
      }
    }

    for (const step of plan.steps) {
      for (const rawValue of Object.values(step.params)) {
        if (typeof rawValue !== 'string') continue
        if (/xiaodianshi/i.test(rawValue)) {
          aliases.add('小电视')
          aliases.add('xiaodianshi')
        }
        if (/bili/i.test(rawValue)) {
          aliases.add('bilibili')
          aliases.add('bili')
          aliases.add('b站')
        }
      }
    }

    return Array.from(aliases)
  }
}

export const planLibrary = new PlanLibraryService()
