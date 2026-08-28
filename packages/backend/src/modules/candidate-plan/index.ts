import type { ContextCompletionResult } from '../context-completer/index.js'
import { llmService as defaultLlmService } from '../llm-provider/service.js'
import { memoryAssetsService as defaultMemoryAssetsService } from '../memory-assets/index.js'
import { memoryKernel as defaultMemoryKernel, type SearchResult } from '../memory-kernel/index.js'
import { planLibrary as defaultPlanLibrary, type CompiledPlanDefinition, type PlanStepDefinition } from '../plan-library/index.js'
import { rerankService as defaultRerankService } from '../rerank-service/index.js'
import { buildFingerprintFromCompletion, buildFingerprintFromSteps, fingerprintMatchScore } from '../intent-fingerprint/index.js'

export interface CandidatePlanEvidence {
  source: 'context' | 'plan_library' | 'compiled_knowledge' | 'memory' | 'memory_observation' | 'search'
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
  source: 'plan_library' | 'compiled_knowledge' | 'memory'
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
  device_refs?: string[]
  skill_refs?: Array<{ kind: string; id: string; label?: string }>
  workflow_id?: number
  workflow_inputs?: Record<string, unknown>
  workflow_graph_hash?: string
  success_count?: number
  failure_count?: number
  evidence_status?: 'untested' | 'proven' | 'regressed' | 'failing' | 'running'
  reuse_score?: number
}

export class CandidatePlanService {
  constructor(
    private readonly memoryKernel = defaultMemoryKernel,
    private readonly memoryAssetsService = defaultMemoryAssetsService,
    private readonly llmService = defaultLlmService,
    private readonly planLibrary = defaultPlanLibrary,
    private readonly rerankService = defaultRerankService,
  ) {}

  /** 从所有源收集候选 plan：matchedPlan → fingerprint → context → lexical hits → semantic hits */
  async collectCandidates(params: {
    query: string
    completion?: ContextCompletionResult
    matchedPlan?: CompiledPlanDefinition
    searchHits?: SearchResult[]
  }): Promise<CandidatePlan[]> {
    const candidates = new Map<string, CandidatePlan>()
    const completion = params.completion
    const lexicalHits = params.searchHits ?? [
      ...this.memoryKernel.search(params.query).slice(0, 8),
      ...this.memoryAssetsService.searchExperiencePaths(params.query, 8),
    ]
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

    if (completion) {
      const queryFp = buildFingerprintFromCompletion(completion, params.query)
      if (queryFp) {
        for (const hit of searchHits) {
          if (hit.source !== 'memory') continue
          const metadata = hit.metadata as Record<string, unknown> | undefined
          if (!metadata?.steps || !Array.isArray(metadata.steps)) continue
          const storedFp = buildFingerprintFromSteps(metadata.steps as Array<{ tool: string; action: string; params?: Record<string, unknown> }>)
          const matchScore = fingerprintMatchScore(queryFp, storedFp)
          if (matchScore >= 0.8) {
            const candidate = this.fromSearchHit(hit)
            if (candidate) {
              candidate.confidence = Math.min(0.99, Math.max(candidate.confidence, 0.88 + matchScore * 0.1))
              candidate.evidence.push({ source: 'context', ref: 'intent_fingerprint', score: matchScore, note: queryFp })
              candidates.set(candidate.id, candidate)
            }
          }
        }
      }
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
    if (hit.source === 'memory') {
      const metadata = isRecord(hit.metadata) ? hit.metadata : {}
      const steps = this.extractSteps(metadata.steps)
      if (steps.length === 0) return null
      const title = typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title : hit.content.split('\n')[0] || 'memory path'
      const intent = typeof metadata.intent_pattern === 'string' ? metadata.intent_pattern : undefined
      const goal = typeof metadata.summary === 'string' && metadata.summary.trim()
        ? metadata.summary
        : intent || title
      const entities = this.extractEntitiesFromText([title, hit.content, intent ?? ''].join('\n'))
      const assumptions = ['device_state_available', 'device_context_verified']
      const risks = ['device_offline', 'capability_changed', 'arguments_missing']
      const successCount = readNumberMetadata(metadata.success_count)
      const failureCount = readNumberMetadata(metadata.failure_count)
      const runStatus = typeof metadata.run_status === 'string'
        ? metadata.run_status
        : metadata.saved_from === 'workflow_success'
          ? 'succeeded'
          : metadata.saved_from === 'workflow_failure'
            ? 'failed'
            : ''
      const totalRuns = successCount + failureCount
      const successRate = totalRuns > 0 ? successCount / totalRuns : 0.5
      const evidenceStatus = workflowEvidenceStatus({
        success_count: successCount,
        failure_count: failureCount,
        last_run_status: runStatus,
      })
      const explicitEvidenceStatus = readEvidenceStatusMetadata(metadata.evidence_status)
      const explicitReuseScore = readOptionalScoreMetadata(metadata.reuse_score)
      const reuseScore = explicitReuseScore ?? workflowReuseScore({
        success_count: successCount,
        failure_count: failureCount,
        last_run_status: runStatus,
      })
      const confidence = Math.min(
        0.98,
        Math.max(
          0.35,
          (hit.score * 0.68)
          + Math.min(0.16, successCount * 0.04)
          - Math.min(0.18, failureCount * 0.045)
          + ((successRate - 0.5) * 0.16),
          reuseScore,
        ),
      )
      const deviceRefs = readStringArrayMetadata(metadata.device_refs)
      const skillRefs = readSkillRefsMetadata(metadata.skill_refs)
      const workflowId = readNumberMetadata(metadata.workflow_id)
      const workflowInputs = isRecord(metadata.workflow_inputs) ? metadata.workflow_inputs : undefined
      const workflowGraphHash = readStringMetadata(metadata.workflow_graph_hash)
      const candidateKind = workflowId > 0 || metadata.saved_from === 'workflow_success' || metadata.saved_from === 'workflow_failure'
        ? 'workflow_candidate'
        : 'compiled_plan'

      return {
        id: hit.id,
        title,
        source: 'memory',
        candidate_kind: candidateKind,
        confidence,
        goal,
        entities,
        steps,
        assumptions,
        risks,
        evidence: [
          {
            source: 'memory',
            ref: hit.id,
            score: confidence,
            note: intent || title,
          },
        ],
        intent,
        device_refs: deviceRefs,
        skill_refs: skillRefs,
        ...(workflowId > 0 ? { workflow_id: workflowId } : {}),
        ...(workflowInputs ? { workflow_inputs: workflowInputs } : {}),
        ...(workflowGraphHash ? { workflow_graph_hash: workflowGraphHash } : {}),
        success_count: successCount,
        failure_count: failureCount,
        evidence_status: explicitEvidenceStatus ?? evidenceStatus,
        reuse_score: reuseScore,
      }
    }

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
      device_refs: Array.from(new Set([...(existing.device_refs ?? []), ...(candidate.device_refs ?? [])])),
      skill_refs: mergeSkillRefs(existing.skill_refs, candidate.skill_refs),
      workflow_id: preferred.workflow_id ?? secondary.workflow_id,
      workflow_inputs: preferred.workflow_inputs ?? secondary.workflow_inputs,
      workflow_graph_hash: preferred.workflow_graph_hash ?? secondary.workflow_graph_hash,
      success_count: Math.max(existing.success_count ?? 0, candidate.success_count ?? 0),
      failure_count: Math.max(existing.failure_count ?? 0, candidate.failure_count ?? 0),
      evidence_status: preferEvidenceStatus(existing.evidence_status, candidate.evidence_status),
      reuse_score: Math.max(existing.reuse_score ?? 0, candidate.reuse_score ?? 0),
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
    const baseConfidence = candidate.candidate_kind === 'workflow_candidate'
      ? Math.max(candidate.confidence, candidate.reuse_score ?? 0)
      : candidate.confidence
    if (workflowIntent && candidate.candidate_kind === 'workflow_candidate') boost += 0.08
    if (directActionIntent && candidate.candidate_kind === 'compiled_plan') boost += 0.08
    if (directActionIntent && candidate.candidate_kind === 'workflow_candidate') {
      if (candidate.evidence_status === 'proven' || (candidate.reuse_score ?? 0) >= 0.75) {
        boost += 0.04
      } else if (candidate.evidence_status === 'regressed') {
        boost -= 0.04
      } else if (candidate.evidence_status === 'failing') {
        boost -= 0.08
      } else {
        boost -= 0.03
      }
    }
    if (workflowIntent && candidate.candidate_kind === 'compiled_plan') boost -= 0.02

    return {
      ...candidate,
      confidence: Math.max(0, Math.min(0.99, baseConfidence + boost)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStringArrayMetadata(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)))
}

function readNumberMetadata(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function readStringMetadata(value: unknown): string {
  const text = String(value ?? '').trim()
  return text
}

function readOptionalScoreMetadata(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : undefined
}

function readEvidenceStatusMetadata(value: unknown): CandidatePlan['evidence_status'] | undefined {
  const status = String(value ?? '').trim()
  if (status === 'untested' || status === 'proven' || status === 'regressed' || status === 'failing' || status === 'running') {
    return status
  }
  return undefined
}

function readSkillRefsMetadata(value: unknown): Array<{ kind: string; id: string; label?: string }> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.kind === 'string' && typeof item.id === 'string')
    .map((item) => ({
      kind: String(item.kind),
      id: String(item.id),
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
    }))
}

function workflowEvidenceStatus(runStats: {
  success_count: number
  failure_count: number
  last_run_status: string
}): CandidatePlan['evidence_status'] {
  const totalRuns = runStats.success_count + runStats.failure_count
  if (totalRuns === 0 && !runStats.last_run_status) return 'untested'
  if (runStats.last_run_status === 'succeeded') return 'proven'
  if (runStats.last_run_status === 'failed') return runStats.success_count > 0 ? 'regressed' : 'failing'
  if (runStats.last_run_status === 'running' || runStats.last_run_status === 'pending') return 'running'
  if (runStats.success_count > 0 && runStats.failure_count === 0) return 'proven'
  if (runStats.success_count > 0 && runStats.failure_count > 0) return 'regressed'
  if (runStats.failure_count > 0) return 'failing'
  return 'untested'
}

function workflowReuseScore(runStats: {
  success_count: number
  failure_count: number
  last_run_status: string
}): number {
  let score = 0.48
  score += Math.min(runStats.success_count, 5) * 0.08
  score -= Math.min(runStats.failure_count, 5) * 0.06
  if (runStats.last_run_status === 'succeeded') score += 0.18
  if (runStats.last_run_status === 'failed') score -= 0.16
  if (runStats.last_run_status === 'running' || runStats.last_run_status === 'pending') score -= 0.04
  return Math.max(0.05, Math.min(0.98, Number(score.toFixed(2))))
}

function preferEvidenceStatus(
  left: CandidatePlan['evidence_status'],
  right: CandidatePlan['evidence_status'],
): CandidatePlan['evidence_status'] {
  const rank = new Map<CandidatePlan['evidence_status'], number>([
    ['proven', 5],
    ['regressed', 4],
    ['running', 3],
    ['untested', 2],
    ['failing', 1],
  ])
  return (rank.get(right) ?? 0) > (rank.get(left) ?? 0) ? right : left
}

function mergeSkillRefs(
  left: Array<{ kind: string; id: string; label?: string }> | undefined,
  right: Array<{ kind: string; id: string; label?: string }> | undefined,
): Array<{ kind: string; id: string; label?: string }> | undefined {
  const refs = [...(left ?? []), ...(right ?? [])]
  if (refs.length === 0) return undefined
  const merged = new Map<string, { kind: string; id: string; label?: string }>()
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (!merged.has(key)) merged.set(key, ref)
  }
  return Array.from(merged.values())
}

export const candidatePlanService = new CandidatePlanService()
