import type { ContextCompletionResult } from '../context-completer/index.js'
import { llmService as defaultLlmService } from '../llm-provider/service.js'
import { memoryKernel as defaultMemoryKernel, type SearchResult } from '../memory-kernel/index.js'
import { planLibrary as defaultPlanLibrary, type CompiledPlanDefinition, type PlanStepDefinition } from '../plan-library/index.js'
import { rerankService as defaultRerankService } from '../rerank-service/index.js'

export interface CandidatePlanEvidence {
  source: 'context' | 'plan_library' | 'compiled_knowledge' | 'memory_observation' | 'search'
  ref: string
  score?: number
  note?: string
}

export interface ObservationForAdjustment {
  success_count: number
  failure_count: number
  last_action?: string
}

export interface CandidatePlan {
  id: string
  title: string
  source: 'plan_library' | 'compiled_knowledge'
  candidate_kind: 'compiled_plan' | 'workflow_candidate'
  confidence: number
  goal: string
  entities: string[]
  steps: PlanStepDefinition[]
  assumptions: string[]
  risks: string[]
  evidence: CandidatePlanEvidence[]
  plan_id?: string
  compiled_knowledge_id?: number
  intent?: string
}

class CandidatePlanService {
  constructor(
    private readonly memoryKernel = defaultMemoryKernel,
    private readonly llmService = defaultLlmService,
    private readonly planLibrary = defaultPlanLibrary,
    private readonly rerankService = defaultRerankService,
  ) {}

  /** 从所有源收集候选 plan：matchedPlan → context → lexical hits → semantic hits */
  async collectCandidates(params: {
    query: string
    completion?: ContextCompletionResult
    matchedPlan?: CompiledPlanDefinition
    searchHits?: SearchResult[]
  }): Promise<CandidatePlan[]> {
    const candidates = new Map<string, CandidatePlan>()
    const completion = params.completion
    const lexicalHits = params.searchHits ?? this.memoryKernel.search(params.query).slice(0, 8)
    let semanticHits: SearchResult[] = []
    try {
      semanticHits = await this.memoryKernel.semanticSearch(params.query, 8)
    } catch {}
    const searchHits = this.mergeSearchHits(lexicalHits, semanticHits)

    if (params.matchedPlan) {
      const exact = this.fromPlanLibrary(params.matchedPlan, 0.99, [
        {
          source: 'plan_library',
          ref: params.matchedPlan.id,
          score: 0.99,
          note: params.matchedPlan.name,
        },
      ])
      candidates.set(exact.id, exact)
    }

    for (const hit of searchHits) {
      const candidate = this.fromSearchHit(hit)
      if (!candidate) continue
      const existing = candidates.get(candidate.id)
      if (!existing || existing.confidence < candidate.confidence) {
        candidates.set(candidate.id, candidate)
      }
    }

    return Array.from(candidates.values())
  }

  /** 对候选 plan 执行 rerank + merge + strategy 排序 */
  async rankCandidates(query: string, candidates: CandidatePlan[]): Promise<CandidatePlan[]> {
    if (candidates.length === 0) return []

    const docs = candidates.map((candidate) => ({
      id: candidate.id,
      text: [
        candidate.title,
        candidate.goal,
        candidate.intent ?? '',
        candidate.steps.map((step) => `${step.tool}.${step.action}`).join(' '),
        candidate.entities.join(' '),
      ].join('\n'),
      base_score: candidate.confidence,
      metadata: {
        title: candidate.title,
        goal: candidate.goal,
        intent: candidate.intent ?? '',
      },
    }))

    let rankedPlans = candidates
    try {
      const providerResult = await this.llmService.rerank({
        query,
        documents: docs.map((document) => document.text),
      })
      rankedPlans = mergeProviderRerankScores(
        candidates,
        providerResult.results,
      )
    } catch {
      const ranked = await this.rerankService.rankDocuments({
        query,
        documents: docs,
      })
      rankedPlans = ranked
        .map((rank) => {
          const plan = candidates.find((c) => c.id === rank.id)
          if (!plan) return null
          return { ...plan, confidence: Math.min(0.99, Math.max(plan.confidence, rank.score)) }
        })
        .filter((plan): plan is CandidatePlan => plan !== null)
    }

    return applyCandidateKindStrategy(query, mergeDuplicateCandidates(rankedPlans)).slice(0, 5)
  }

  async resolve(params: {
    query: string
    completion?: ContextCompletionResult
    matchedPlan?: CompiledPlanDefinition
    searchHits?: SearchResult[]
    observations?: ObservationForAdjustment[]
  }): Promise<CandidatePlan[]> {
    const candidates = await this.collectCandidates(params)
    const ranked = await this.rankCandidates(params.query, candidates)
    if (params.observations && params.observations.length > 0) {
      return applyObservationAdjustment(ranked, params.observations)
    }
    return ranked
  }

  private fromPlanLibrary(
    plan: CompiledPlanDefinition,
    confidence: number,
    evidence: CandidatePlanEvidence[],
  ): CandidatePlan {
    return {
      id: `plan:${plan.id}`,
      title: plan.name,
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence,
      goal: plan.description || plan.intent || plan.name,
      entities: this.extractEntities(plan),
      steps: plan.steps,
      assumptions: ['device_state_available', 'executor_registered'],
      risks: ['device_offline', 'infrared_missed', 'adb_unavailable'],
      evidence,
      plan_id: plan.id,
      intent: plan.intent,
    }
  }

  private fromSearchHit(hit: SearchResult): CandidatePlan | null {
    if (hit.source !== 'compiled' && hit.source !== 'semantic') return null
    if (!hit.id.startsWith('compiled_')) return null

    const rowId = Number(hit.id.slice('compiled_'.length))
    if (!Number.isFinite(rowId)) return null

    const item = this.memoryKernel.getCompiledKnowledgeItem(rowId)
    if (!item || (item.kind !== 'compiled_plan' && item.kind !== 'workflow_candidate')) return null

    const metadata = item.metadata
    const planId = typeof metadata.plan_id === 'string' ? metadata.plan_id : undefined
    const name = typeof metadata.name === 'string' ? metadata.name : item.title.replace(/^Plan:\s*/i, '')
    const intent = typeof metadata.intent === 'string' ? metadata.intent : undefined
    const goal = typeof metadata.goal === 'string'
      ? metadata.goal
      : intent || name
    const steps = this.extractSteps(metadata.steps)
    const entities = this.extractEntitiesFromText(item.body)
    const assumptions = this.readStringArray(metadata.assumptions, ['context_completed'])
    const risks = this.readStringArray(metadata.risks, ['device_state_drift'])
    const confidence = Math.min(0.98, Math.max(0.55, (hit.score * 0.6) + (item.rank_score * 0.4)))

    return {
      id: `compiled:${item.id}`,
      title: name,
      source: planId ? 'plan_library' : 'compiled_knowledge',
      candidate_kind: item.kind === 'workflow_candidate' ? 'workflow_candidate' : 'compiled_plan',
      confidence,
      goal,
      entities,
      steps,
      assumptions,
      risks,
      evidence: [
        {
          source: 'compiled_knowledge',
          ref: String(item.id),
          score: confidence,
          note: item.source_ref,
        },
      ],
      plan_id: planId,
      compiled_knowledge_id: item.id,
      intent,
    }
  }

  private extractSteps(raw: unknown): PlanStepDefinition[] {
    if (!Array.isArray(raw)) return []
    return raw
      .map((step) => {
        if (!step || typeof step !== 'object') return null
        const record = step as Record<string, unknown>
        if (typeof record.tool !== 'string' || typeof record.action !== 'string') return null
        return {
          tool: record.tool,
          action: record.action,
          params: record.params && typeof record.params === 'object'
            ? record.params as Record<string, unknown>
            : {},
        }
      })
      .filter((step): step is PlanStepDefinition => step !== null)
  }

  private extractEntities(plan: CompiledPlanDefinition): string[] {
    const entities = new Set<string>()
    for (const step of plan.steps) {
      for (const value of Object.values(step.params)) {
        if (typeof value !== 'string') continue
        if (/toshiba|东芝/i.test(value)) entities.add('toshiba_tv')
        if (/letv|乐视/i.test(value)) entities.add('letv_tv')
        if (/bili|xiaodianshi/i.test(value)) entities.add('bilibili')
        if (/stb|机顶盒/i.test(value)) entities.add('stb')
      }
    }
    return Array.from(entities)
  }

  private extractEntitiesFromText(value: string): string[] {
    const entities = new Set<string>()
    if (/toshiba|东芝/i.test(value)) entities.add('toshiba_tv')
    if (/letv|乐视/i.test(value)) entities.add('letv_tv')
    if (/bili|哔哩|小电视/i.test(value)) entities.add('bilibili')
    if (/stb|机顶盒/i.test(value)) entities.add('stb')
    return Array.from(entities)
  }

  private readStringArray(value: unknown, fallback: string[]): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value as string[]
      : fallback
  }

  private mergeSearchHits(primary: SearchResult[], semantic: SearchResult[]): SearchResult[] {
    const merged = new Map<string, SearchResult>()
    for (const hit of [...primary, ...semantic]) {
      const existing = merged.get(hit.id)
      if (!existing || existing.score < hit.score) {
        merged.set(hit.id, hit)
      }
    }
    return Array.from(merged.values())
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
  }
}

export function mergeProviderRerankScores(
  candidates: CandidatePlan[],
  results: Array<{ index: number; relevance_score: number }>,
): CandidatePlan[] {
  return candidates
    .map((candidate, index) => {
      const rerank = results.find((item) => item.index === index)
      const providerScore = rerank?.relevance_score ?? 0
      const mergedScore = rerank
        ? (candidate.confidence * 0.25) + (providerScore * 0.75)
        : candidate.confidence
      return {
        ...candidate,
        confidence: Math.min(0.99, Math.max(0, mergedScore)),
      }
    })
    .sort((left, right) => right.confidence - left.confidence)
}

export function mergeDuplicateCandidates(candidates: CandidatePlan[]): CandidatePlan[] {
  const merged = new Map<string, CandidatePlan>()

  for (const candidate of candidates) {
    const key = candidate.plan_id ?? candidate.id
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...candidate,
        assumptions: Array.from(new Set(candidate.assumptions)),
        risks: Array.from(new Set(candidate.risks)),
        evidence: uniqueEvidence(candidate.evidence),
      })
      continue
    }

    const preferred =
      existing.source === 'plan_library'
        ? existing
        : candidate.source === 'plan_library'
          ? candidate
          : (existing.confidence >= candidate.confidence ? existing : candidate)
    const secondary = preferred === existing ? candidate : existing

    merged.set(key, {
      ...preferred,
      confidence: Math.max(existing.confidence, candidate.confidence),
      assumptions: Array.from(new Set([...existing.assumptions, ...candidate.assumptions])),
      risks: Array.from(new Set([...existing.risks, ...candidate.risks])),
      evidence: uniqueEvidence([...existing.evidence, ...candidate.evidence]),
      compiled_knowledge_id: preferred.compiled_knowledge_id ?? secondary.compiled_knowledge_id,
      plan_id: preferred.plan_id ?? secondary.plan_id,
      entities: Array.from(new Set([...existing.entities, ...candidate.entities])),
      steps: preferred.steps.length > 0 ? preferred.steps : secondary.steps,
    })
  }

  return Array.from(merged.values()).sort((left, right) => right.confidence - left.confidence)
}

export function applyCandidateKindStrategy(query: string, candidates: CandidatePlan[]): CandidatePlan[] {
  const compact = query.trim().toLowerCase().replace(/\s+/g, '')
  const workflowIntent = /(workflow|studio|graph|node|automation|orchestrate|编排|工作流)/.test(compact)
  const directActionIntent = /(watch|open|launch|play|turnon|poweron|看|打开|播放|开机|启动)/.test(compact)

  const boosted = candidates.map((candidate) => {
    let boost = 0
    if (workflowIntent && candidate.candidate_kind === 'workflow_candidate') boost += 0.08
    if (directActionIntent && candidate.candidate_kind === 'compiled_plan') boost += 0.08
    if (directActionIntent && candidate.candidate_kind === 'workflow_candidate') boost -= 0.03
    if (workflowIntent && candidate.candidate_kind === 'compiled_plan') boost -= 0.02

    return {
      ...candidate,
      confidence: Math.max(0, Math.min(0.99, candidate.confidence + boost)),
    }
  })

  return boosted.sort((left, right) => right.confidence - left.confidence)
}

export function applyObservationAdjustment(
  candidates: CandidatePlan[],
  observations: ObservationForAdjustment[],
): CandidatePlan[] {
  if (candidates.length === 0 || observations.length === 0) return candidates
  const obsByAction = new Map<string, { success_rate: number }>()
  for (const obs of observations) {
    if (!obs.last_action) continue
    const total = obs.success_count + obs.failure_count
    if (total < 2) continue
    obsByAction.set(obs.last_action, { success_rate: obs.success_count / total })
  }
  if (obsByAction.size === 0) return candidates
  const BASE_DELTA = 0.05
  const adjusted = candidates.map((candidate) => {
    let totalDelta = 0
    for (const step of candidate.steps) {
      const actionKey = `${step.tool}.${step.action}`
      const match = obsByAction.get(actionKey)
      if (!match) continue
      const delta = BASE_DELTA * (match.success_rate - 0.5) * 2
      totalDelta += delta
    }
    if (totalDelta === 0) return candidate
    return { ...candidate, confidence: Math.max(0, Math.min(0.99, candidate.confidence + totalDelta)) }
  })
  return adjusted.sort((a, b) => b.confidence - a.confidence)
}

function uniqueEvidence(evidence: CandidatePlanEvidence[]): CandidatePlanEvidence[] {
  const seen = new Set<string>()
  const output: CandidatePlanEvidence[] = []

  for (const item of evidence) {
    const key = `${item.source}:${item.ref}:${item.note ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

export const candidatePlanService = new CandidatePlanService()
