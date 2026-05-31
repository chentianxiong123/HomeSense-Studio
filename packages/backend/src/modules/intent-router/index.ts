import { candidatePlanService as defaultCandidatePlanService, type CandidatePlan } from '../candidate-plan/index.js'
import { contextCompleter as defaultContextCompleter, type ContextCompletionResult, type ContextCompleterInput } from '../context-completer/index.js'
import { memoryAssetsService as defaultMemoryAssetsService } from '../memory-assets/index.js'
import { memoryKernel as defaultMemoryKernel, type SearchResult } from '../memory-kernel/index.js'
import { planLibrary as defaultPlanLibrary, type CompiledPlanDefinition } from '../plan-library/index.js'
import { ruleEngine as defaultRuleEngine, type RuleMatch } from '../rule-engine/index.js'
import { skillsService as defaultSkillsService } from '../skills-system/index.js'

export interface IntentEvidence {
  source: 'context' | 'plan_library' | 'rule_engine' | 'skill' | 'compiled_knowledge' | 'memory' | 'memory_observation' | 'search'
  ref: string
  score?: number
  note?: string
}

export type RoutedCandidatePlan = CandidatePlan

export interface RoutedObservation {
  id: string
  name: string
  type: string
  success_count: number
  failure_count: number
  last_seen?: string
  last_action?: string
  last_error?: string
  score: number
}

export interface IntentRouterResult {
  original_message: string
  routing_message: string
  normalized_intent: string
  route_level: 1 | 2 | 3
  confidence: number
  reason: string
  completion: ContextCompletionResult
  matched_plan?: CompiledPlanDefinition
  matched_rule?: RuleMatch
  matched_skill?: string
  candidate_plans: RoutedCandidatePlan[]
  observations: RoutedObservation[]
  search_hits: SearchResult[]
  evidence: IntentEvidence[]
  allow_tool_calls: boolean
}

export class IntentRouterService {
  constructor(
    private readonly candidatePlanService = defaultCandidatePlanService,
    private readonly contextCompleter = defaultContextCompleter,
    private readonly memoryKernel = defaultMemoryKernel,
    private readonly planLibrary = defaultPlanLibrary,
    private readonly ruleEngine = defaultRuleEngine,
    private readonly skillsService = defaultSkillsService,
    private readonly memoryAssetsService = defaultMemoryAssetsService,
  ) {}

  /** Step 1: 收集所有证据（context → plan → rule → skill → memory → search → candidatePlans） */
  async gatherEvidence(input: ContextCompleterInput): Promise<{
    completion: ContextCompletionResult
    routingMessage: string
    matchedPlan?: CompiledPlanDefinition
    matchedRule?: RuleMatch
    matchedSkill?: string
    observations: RoutedObservation[]
    searchHits: SearchResult[]
    evidence: IntentEvidence[]
    directActionIntent: boolean
  }> {
    const completion = this.contextCompleter.complete(input)
    const routingMessage = input.working_context?.use_original_query === true
      ? input.message
      : completion.completed_message || input.message
    const evidence: IntentEvidence[] = []
    const directActionIntent = shouldUseDirectActionRouting(input.message, routingMessage, completion)

    if (completion.target_device_id) {
      evidence.push({
        source: 'context',
        ref: completion.target_device_id,
        score: completion.device_weights[0]?.score,
        note: completion.target_device_label,
      })
    }

    if (completion.matched_media_app) {
      evidence.push({
        source: 'context',
        ref: completion.matched_media_app,
        note: 'matched_media_app',
      })
    }

    const matchedPlan = directActionIntent
      ? (
          this.planLibrary.resolveByContext(completion)
          ?? this.planLibrary.matchPlan(routingMessage)
          ?? this.planLibrary.matchPlan(input.message)
        )
      : undefined
    if (matchedPlan) {
      evidence.push({ source: 'plan_library', ref: matchedPlan.id, score: 1, note: matchedPlan.name })
    }

    const matchedRule = directActionIntent && !matchedPlan
      ? (this.ruleEngine.match(routingMessage) ?? undefined)
      : undefined
    if (matchedRule) {
      evidence.push({ source: 'rule_engine', ref: String(matchedRule.rule_id), score: matchedRule.confidence, note: matchedRule.trigger_pattern })
    }

    const matchedSkill = directActionIntent && !matchedPlan && !matchedRule
      ? (this.matchSkill(routingMessage) ?? undefined)
      : undefined
    if (matchedSkill) {
      evidence.push({ source: 'skill', ref: matchedSkill, score: 0.85 })
    }

    const observations = directActionIntent ? this.memoryKernel.recallObservations(routingMessage, 5) : []
    for (const observation of observations.slice(0, 3)) {
      evidence.push({ source: 'memory_observation', ref: observation.id, score: observation.score, note: observation.last_action })
    }

    const searchHits = directActionIntent
      ? [
          ...this.memoryKernel.search(routingMessage).slice(0, 8),
          ...this.memoryAssetsService.searchExperiencePaths(routingMessage, 8),
        ]
      : []
    for (const hit of searchHits.slice(0, 3)) {
      evidence.push({ source: toEvidenceSource(hit.source), ref: hit.id, score: hit.score, note: hit.type })
    }

    return { completion, routingMessage, matchedPlan, matchedRule, matchedSkill, observations, searchHits, evidence, directActionIntent }
  }

  /** Step 2: 判断路由级别并组装结果 */
  async determineRouteLevel(params: {
    input: ContextCompleterInput
    completion: ContextCompletionResult
    routingMessage: string
    matchedPlan?: CompiledPlanDefinition
    matchedRule?: RuleMatch
    matchedSkill?: string
    observations: RoutedObservation[]
    searchHits: SearchResult[]
    evidence: IntentEvidence[]
    directActionIntent: boolean
  }): Promise<IntentRouterResult> {
    const { completion, routingMessage, matchedPlan, matchedRule, matchedSkill, observations, searchHits, evidence, directActionIntent } = params

    const candidatePlans = directActionIntent
      ? await this.candidatePlanService.resolve({
          query: routingMessage,
          matchedPlan,
          completion,
          searchHits,
          observations,
        })
      : []

    if (!matchedPlan && candidatePlans.length > 0) {
      for (const plan of candidatePlans.slice(0, 3)) {
        evidence.push({
          source: plan.source === 'compiled_knowledge'
            ? 'compiled_knowledge'
            : plan.source === 'memory'
              ? 'memory'
              : 'plan_library',
          ref: plan.plan_id ?? String(plan.compiled_knowledge_id ?? plan.id),
          score: plan.confidence,
          note: plan.title,
        })
      }
    }

    if (matchedPlan || matchedRule || matchedSkill) {
      return {
        original_message: params.input.message,
        routing_message: routingMessage,
        normalized_intent: this.deriveNormalizedIntent({
          message: params.input.message,
          routingMessage,
          completion,
          matchedPlan,
          matchedRule,
          matchedSkill,
          candidatePlans,
        }),
        route_level: 1,
        confidence: matchedPlan ? 1 : matchedRule?.confidence ?? 0.85,
        reason: matchedPlan
          ? `compiled_plan:${matchedPlan.id}`
          : matchedRule
            ? `rule:${matchedRule.rule_id}`
            : `skill:${matchedSkill}`,
        completion,
        matched_plan: matchedPlan,
        matched_rule: matchedRule,
        matched_skill: matchedSkill,
        candidate_plans: candidatePlans,
        observations,
        search_hits: searchHits,
        evidence,
        allow_tool_calls: true,
      }
    }

    const routeLevel: 1 | 2 | 3 = directActionIntent && (candidatePlans.length > 0 || observations.length > 0 || searchHits.length > 0) ? 2 : 3

    return {
      original_message: params.input.message,
      routing_message: routingMessage,
      normalized_intent: this.deriveNormalizedIntent({
        message: params.input.message,
        routingMessage,
        completion,
        candidatePlans,
      }),
      route_level: routeLevel,
      confidence: routeLevel === 2 ? this.estimateL2Confidence(candidatePlans, observations, searchHits) : 0.4,
      reason: routeLevel === 2 ? 'compiled_knowledge_or_memory' : 'planner_fallback',
      completion,
      candidate_plans: candidatePlans,
      observations,
      search_hits: searchHits,
      evidence,
      allow_tool_calls: directActionIntent,
    }
  }

  async route(input: ContextCompleterInput): Promise<IntentRouterResult> {
    const gathered = await this.gatherEvidence(input)
    return this.determineRouteLevel({ input, ...gathered })
  }

  private deriveNormalizedIntent(params: {
    message: string
    routingMessage: string
    completion: ContextCompletionResult
    matchedPlan?: CompiledPlanDefinition
    matchedRule?: RuleMatch
    matchedSkill?: string
    candidatePlans?: RoutedCandidatePlan[]
  }): string {
    if (params.completion.matched_media_app === 'bilibili' && params.completion.target_device_type === 'tv') {
      return 'media.watch.bilibili.tv'
    }

    const lowered = this.normalizeText(params.routingMessage)
    if (/(open|poweron|turnon)/.test(lowered) && params.completion.target_device_type) {
      return `device.power_on.${params.completion.target_device_type}`
    }
    if (/(volumeup|louder|soundup)/.test(lowered)) {
      return 'device.volume.up'
    }
    if (/(volumedown|quieter|sounddown)/.test(lowered)) {
      return 'device.volume.down'
    }
    if (params.matchedPlan?.intent) {
      return this.intentToSlug(params.matchedPlan.intent)
    }
    if (params.candidatePlans && params.candidatePlans.length > 0 && params.candidatePlans[0].intent) {
      return this.intentToSlug(params.candidatePlans[0].intent)
    }
    if (params.matchedRule) {
      return `rule.${params.matchedRule.rule_id}`
    }
    if (params.matchedSkill) {
      return `skill.${params.matchedSkill}`
    }

    return this.intentToSlug(params.message || params.routingMessage || 'user.request')
  }

  private estimateL2Confidence(
    candidatePlans: RoutedCandidatePlan[],
    observations: RoutedObservation[],
    searchHits: SearchResult[],
  ): number {
    const candidateScore = candidatePlans[0]?.confidence ?? 0
    const observationScore = observations[0]?.score ?? 0
    const searchScore = searchHits[0]?.score ?? 0
    return Math.max(0.5, Math.min(0.9, (candidateScore * 0.5) + (observationScore * 0.25) + (searchScore * 0.25)))
  }

  private matchSkill(message: string): string | null {
    const skills = this.skillsService.listSkills()
    for (const skill of skills) {
      if (!skill.enabled) continue
      const schemas = JSON.parse(skill.action_schema_json || '[]') as Array<{ action: string; description: string }>
      for (const schema of schemas) {
        if (message.includes(schema.action) || (schema.description && message.includes(schema.description))) {
          return skill.name
        }
      }
    }
    return null
  }

  private intentToSlug(value: string): string {
    const normalized = this.normalizeText(value).replace(/[^a-z0-9]+/g, '.')
    const compact = normalized.replace(/^\.+|\.+$/g, '').replace(/\.{2,}/g, '.')
    return compact || 'user.request'
  }

  private normalizeText(value: string): string {
    return value.trim().toLowerCase()
  }

  private compactText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '')
  }
}

export const intentRouter = new IntentRouterService()

function toEvidenceSource(source: string): IntentEvidence['source'] {
  if (source === 'compiled' || source === 'semantic') return 'compiled_knowledge'
  if (source === 'memory') return 'memory'
  return 'search'
}

export function shouldUseDirectActionRouting(
  originalMessage: string,
  routingMessage: string,
  completion: ContextCompletionResult,
): boolean {
  if (/[?？]/.test(originalMessage)) return false

  const compact = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '')
  const originalCompact = compact(originalMessage)
  const routingCompact = compact(routingMessage)

  const questionSignals = [
    'what',
    'how',
    'why',
    'explain',
    'tellme',
    '介紹',
    '介绍',
    '解释',
    '什麼',
    '什么',
    '怎么',
    '如何',
    '为什么',
    '是什麼',
    '是什么',
    '幫我看看',
    '帮我看看',
  ].map(compact)

  if (questionSignals.some((signal) => originalCompact.includes(signal))) {
    return false
  }

  const workflowSignals = [
    'workflow',
    'studio',
    'graph',
    'node',
    'orchestrate',
    'automation',
    '工作流',
    '编排',
    '节点',
    '流程',
  ].map(compact)

  if (workflowSignals.some((signal) => originalCompact.includes(signal) || routingCompact.includes(signal))) {
    return false
  }

  const actionSignals = [
    'watch',
    'open',
    'launch',
    'play',
    'turnon',
    'poweron',
    'switchto',
    'volume',
    'run',
    'start',
    '打开',
    '看',
    '播放',
    '开机',
    '开启',
    '切到',
    '调大',
    '调小',
  ].map(compact)

  if (completion.matched_media_app && completion.target_device_type === 'tv') {
    return actionSignals.some((signal) => originalCompact.includes(signal) || routingCompact.includes(signal))
  }

  return actionSignals.some((signal) => originalCompact.includes(signal) || routingCompact.includes(signal))
}
