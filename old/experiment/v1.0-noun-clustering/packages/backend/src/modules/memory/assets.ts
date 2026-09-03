import { manifestRegistry, type UnifiedExecutorManifest } from '../registry/index.js'
import { executorGateway } from '../executor-gateway/index.js'
import type { CompiledPlanDefinition } from '../plan/index.js'
import type { SearchResult } from './kernel.js'
import { getDb } from '../../db/index.js'
import type Database from 'better-sqlite3'
import { createHash } from 'crypto'

export type MemoryAssetKind =
  | 'experience_path'
  | 'user_feedback'
  | 'device_preference'
  | 'spatial_map'
  | 'long_term_knowledge'

type MemoryEvidenceStatus = 'untested' | 'proven' | 'regressed' | 'failing' | 'running'

export interface MemorySkillRef {
  kind: 'device_skill' | 'general_skill'
  id: string
  label?: string
}

export interface MemoryAssetRecord {
  id: string
  kind: MemoryAssetKind
  title: string
  summary: string
  status: 'active' | 'planned' | 'legacy'
  source: 'manifest' | 'plan' | 'runtime' | 'user' | 'imported' | 'system' | 'placeholder'
  retrieval_hint: string
  skill_refs: MemorySkillRef[]
  device_refs: string[]
  metadata: Record<string, unknown>
}

export interface ExperiencePathStep {
  tool: string
  action: string
  params?: Record<string, unknown>
  params_schema?: Record<string, unknown>
}

export interface RecordExperiencePathInput {
  id?: string
  title: string
  summary?: string
  intent_pattern?: string
  preconditions?: Record<string, unknown>
  steps: ExperiencePathStep[]
  skill_refs?: MemorySkillRef[]
  device_refs?: string[]
  success_criteria?: Record<string, unknown>
  failure_recovery?: unknown[]
  origin_trace_id?: string
  conversation_id?: number
  source?: 'runtime' | 'user' | 'imported' | 'system'
  status?: 'active' | 'draft'
  confidence?: number
  priority?: number
  metadata?: Record<string, unknown>
}

export interface RecordExperiencePathFailureInput extends RecordExperiencePathInput {
  error?: string
}

export interface MemoryAssetSummary {
  total: number
  by_kind: Record<MemoryAssetKind, number>
  migrated_legacy_count: number
}

type MemoryItemRow = {
  id: string
  kind: 'experience_path' | 'feedback' | 'device_preference' | 'spatial_node' | 'spatial_edge' | 'knowledge_chunk'
  title: string
  summary: string
  source: 'user' | 'runtime' | 'imported' | 'legacy' | 'system'
  status: 'active' | 'draft' | 'archived' | 'expired'
  metadata_json: string
  intent_pattern?: string | null
  preconditions_json?: string | null
  steps_json?: string | null
  skill_refs_json: string | null
  device_refs_json: string | null
  success_criteria_json?: string | null
  failure_recovery_json?: string | null
  origin_trace_id?: string | null
  success_count?: number | null
  failure_count?: number | null
  last_success_at?: string | null
}

export class MemoryAssetsService {
  constructor(private readonly dbProvider: () => Database.Database = getDb) {}

  list(): MemoryAssetRecord[] {
    this.syncLegacyExperiencePaths()
    const records = [
      ...this.listPersistedMemoryAssets(),
      ...this.listPlannedMemoryAssets(),
    ]
    return records.sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title))
  }

  summary(): MemoryAssetSummary {
    const byKind: Record<MemoryAssetKind, number> = {
      experience_path: 0,
      user_feedback: 0,
      device_preference: 0,
      spatial_map: 0,
      long_term_knowledge: 0,
    }
    const records = this.list()
    for (const record of records) {
      byKind[record.kind] += 1
    }
    return {
      total: records.length,
      by_kind: byKind,
      migrated_legacy_count: records.filter((record) => record.source !== 'placeholder').length,
    }
  }

  get(id: string): MemoryAssetRecord | null {
    this.syncLegacyExperiencePaths()
    const normalizedId = normalizeMemoryId(id)
    if (!normalizedId) return null

    const row = this.dbProvider().prepare(`
      SELECT
        memory_items.id,
        memory_items.kind,
        memory_items.title,
        memory_items.summary,
        memory_items.source,
        memory_items.status,
        memory_items.metadata_json,
        memory_experience_paths.intent_pattern,
        memory_experience_paths.preconditions_json,
        memory_experience_paths.steps_json,
        memory_experience_paths.skill_refs_json,
        memory_experience_paths.device_refs_json,
        memory_experience_paths.success_criteria_json,
        memory_experience_paths.failure_recovery_json,
        memory_experience_paths.origin_trace_id,
        memory_experience_paths.success_count,
        memory_experience_paths.failure_count,
        memory_experience_paths.last_success_at
      FROM memory_items
      LEFT JOIN memory_experience_paths
        ON memory_experience_paths.memory_item_id = memory_items.id
      WHERE memory_items.id = ?
        AND memory_items.status != 'archived'
      LIMIT 1
    `).get(normalizedId) as MemoryItemRow | undefined

    if (row) return this.fromMemoryItemRow(row)

    return this.listPlannedMemoryAssets().find((asset) => asset.id === normalizedId) ?? null
  }

  searchExperiencePaths(query: string, limit: number = 8): SearchResult[] {
    const text = String(query ?? '').trim()
    if (!text || limit <= 0) return []

    const rows = this.dbProvider().prepare(`
      SELECT
        m.id,
        m.title,
        m.summary,
        m.search_text,
        m.source,
        m.confidence,
        m.priority,
        m.metadata_json,
        p.intent_pattern,
        p.steps_json,
        p.skill_refs_json,
        p.device_refs_json,
        p.success_count,
        p.failure_count,
        w.graph_hash AS current_workflow_graph_hash
      FROM memory_items m
      JOIN memory_experience_paths p ON p.memory_item_id = m.id
      LEFT JOIN workflows w
        ON w.id = CAST(json_extract(m.metadata_json, '$.workflow_id') AS INTEGER)
      WHERE m.kind = 'experience_path'
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
      ORDER BY m.priority DESC, p.success_count DESC, m.confidence DESC, m.updated_at DESC
      LIMIT 100
    `).all() as Array<{
      id: string
      title: string
      summary: string
      search_text: string
      source: string
      confidence: number
      priority: number
      metadata_json: string
      intent_pattern: string
      steps_json: string
      skill_refs_json: string
      device_refs_json: string
      success_count: number
      failure_count: number
      current_workflow_graph_hash: string | null
    }>

    const terms = buildMemorySearchTerms(text)
    const scoredRows: Array<{
      row: (typeof rows)[number] & { metadata: Record<string, unknown>; current_workflow_graph_hash: string }
      score: number
    }> = []
    for (const row of rows) {
      const metadata = safeParseObject(row.metadata_json)
      const workflowId = normalizeCount(metadata.workflow_id)
      const storedWorkflowGraphHash = String(metadata.workflow_graph_hash ?? metadata.graph_hash ?? '').trim()
      const currentWorkflowGraphHash = String(row.current_workflow_graph_hash ?? '').trim()

      if (workflowId > 0) {
        if (!currentWorkflowGraphHash) continue
        if (storedWorkflowGraphHash && storedWorkflowGraphHash !== currentWorkflowGraphHash) continue
      }

      scoredRows.push({
        row: {
          ...row,
          metadata,
          current_workflow_graph_hash: currentWorkflowGraphHash,
        },
        score: scoreMemorySearchRow(row, terms),
      })
    }

    return scoredRows
      .filter((item) => item.score > 0)
      .sort((left, right) =>
        right.score - left.score
        || right.row.priority - left.row.priority
        || right.row.success_count - left.row.success_count
        || right.row.confidence - left.row.confidence,
      )
      .slice(0, limit)
      .map(({ row, score }) => {
        const steps = normalizeExperienceSteps(safeParseArray(row.steps_json) as ExperiencePathStep[])
        const skillRefs = readSkillRefs(row.skill_refs_json)
        const deviceRefs = normalizeDeviceRefs(readStringArray(row.device_refs_json))
        const metadata = row.metadata
        const successCount = normalizeCount(row.success_count)
        const failureCount = normalizeCount(row.failure_count)
        const evidence = buildExperienceEvidence(successCount, failureCount, metadata)
        const workflowGraphHash = String(metadata.workflow_graph_hash ?? '').trim() || row.current_workflow_graph_hash
        return {
          id: `memory:${row.id}`,
          content: [
            row.title,
            row.summary,
            row.intent_pattern,
            steps.map((step) => `${step.tool}.${step.action}`).join(' '),
            skillRefs.map((ref) => ref.label || ref.id).join(' '),
            deviceRefs.join(' '),
          ].filter(Boolean).join('\n'),
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score,
          fts_score: score,
          graph_score: 0,
          source: 'memory',
          metadata: {
            ...metadata,
            memory_item_id: row.id,
            title: row.title,
            summary: row.summary,
            intent_pattern: row.intent_pattern,
            steps,
            skill_refs: skillRefs,
            device_refs: deviceRefs,
            success_count: successCount,
            failure_count: failureCount,
            run_status: evidence.run_status,
            evidence_status: evidence.evidence_status,
            reuse_score: evidence.reuse_score,
            item_source: row.source,
            ...(workflowGraphHash ? { workflow_graph_hash: workflowGraphHash } : {}),
            ...(row.current_workflow_graph_hash ? { current_workflow_graph_hash: row.current_workflow_graph_hash } : {}),
          },
        } satisfies SearchResult
      })
  }

  recordExperiencePath(input: RecordExperiencePathInput): MemoryAssetRecord {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('title is required')

    const steps = normalizeExperienceSteps(input.steps)
    if (steps.length === 0) throw new Error('steps are required')

    const source = input.source ?? 'runtime'
    const id = normalizeMemoryId(input.id) || buildExperiencePathId(source, title, input.intent_pattern, steps)
    const existingRefs = this.readExperiencePathRefs(id)
    const skillRefs = dedupeSkillRefs([
      ...existingRefs.skill_refs,
      ...(input.skill_refs ?? inferSkillRefsFromTools(steps.flatMap((step) => [step.tool, step.action]))),
    ])
    const deviceRefs = normalizeDeviceRefs(readStringArrayFromValue([
      ...existingRefs.device_refs,
      ...(input.device_refs ?? []),
      ...inferDeviceRefsFromSteps(steps.map((step) => ({
        tool: step.tool,
        action: step.action,
        params: step.params ?? {},
      }))),
    ]))
    const summary = String(input.summary ?? input.intent_pattern ?? title).trim()
    const retrievalHint = 'Recall as a proven experience path. Validate current device, room, and capability before execution.'
    const runStatus = normalizeRunStatus(input.metadata?.run_status) || (source === 'runtime' ? 'succeeded' : '')
    const metadata = {
      ...(input.metadata ?? {}),
      source,
      ...(runStatus ? { run_status: runStatus } : {}),
      retrieval_hint: String(input.metadata?.retrieval_hint ?? retrievalHint),
      skill_refs: skillRefs,
      device_refs: deviceRefs,
    }
    const conversationId = normalizeConversationId(this.dbProvider(), input.conversation_id)
    const asset: MemoryAssetRecord = {
      id,
      kind: 'experience_path',
      title,
      summary,
      status: input.status === 'draft' ? 'planned' : 'active',
      source,
      retrieval_hint: String(metadata.retrieval_hint),
      skill_refs: skillRefs,
      device_refs: deviceRefs,
      metadata,
    }

    this.upsertExperiencePath(asset, {
      intent_pattern: String(input.intent_pattern ?? title).trim(),
      preconditions: input.preconditions ?? {},
      steps,
      skill_refs: skillRefs,
      device_refs: deviceRefs,
      success_criteria: input.success_criteria ?? { all_steps_complete: true },
      failure_recovery: input.failure_recovery ?? [],
      origin_trace_id: String(input.origin_trace_id ?? ''),
    }, {
      item_source: source,
      item_status: input.status ?? 'active',
      confidence: clamp01(input.confidence ?? 0.82),
      priority: clamp01(input.priority ?? 0.7),
      conversation_id: conversationId,
      increment_success: source === 'runtime',
    })

    const row = this.dbProvider().prepare(`
      SELECT
        memory_items.id,
        memory_items.kind,
        memory_items.title,
        memory_items.summary,
        memory_items.source,
        memory_items.status,
        memory_items.metadata_json,
        memory_experience_paths.skill_refs_json,
        memory_experience_paths.device_refs_json,
        memory_experience_paths.success_count,
        memory_experience_paths.failure_count,
        memory_experience_paths.last_success_at
      FROM memory_items
      LEFT JOIN memory_experience_paths
        ON memory_experience_paths.memory_item_id = memory_items.id
      WHERE memory_items.id = ?
    `).get(id) as MemoryItemRow | undefined

    return row ? this.fromMemoryItemRow(row) ?? asset : asset
  }

  recordExperiencePathFailure(input: RecordExperiencePathFailureInput): MemoryAssetRecord {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('title is required')

    const steps = normalizeExperienceSteps(input.steps)
    if (steps.length === 0) throw new Error('steps are required')

    const source = input.source ?? 'runtime'
    const id = normalizeMemoryId(input.id) || buildExperiencePathId(source, title, input.intent_pattern, steps)
    const existingRefs = this.readExperiencePathRefs(id)
    const existingItem = this.readMemoryItem(id)
    const skillRefs = dedupeSkillRefs([
      ...existingRefs.skill_refs,
      ...(input.skill_refs ?? inferSkillRefsFromTools(steps.flatMap((step) => [step.tool, step.action]))),
    ])
    const deviceRefs = normalizeDeviceRefs(readStringArrayFromValue([
      ...existingRefs.device_refs,
      ...(input.device_refs ?? []),
      ...inferDeviceRefsFromSteps(steps.map((step) => ({
        tool: step.tool,
        action: step.action,
        params: step.params ?? {},
      }))),
    ]))
    const summary = String(input.summary ?? input.intent_pattern ?? title).trim()
    const retrievalHint = 'Recall as a workflow failure signal. Validate the current device, room, capability, and arguments before retrying.'
    const runStatus = normalizeRunStatus(input.metadata?.run_status) || (source === 'runtime' ? 'failed' : '')
    const metadata = {
      ...(input.metadata ?? {}),
      source,
      ...(runStatus ? { run_status: runStatus } : {}),
      last_error: String(input.error ?? input.metadata?.last_error ?? '').slice(0, 500),
      retrieval_hint: String(input.metadata?.retrieval_hint ?? retrievalHint),
      skill_refs: skillRefs,
      device_refs: deviceRefs,
    }
    const conversationId = normalizeConversationId(this.dbProvider(), input.conversation_id)
    const asset: MemoryAssetRecord = {
      id,
      kind: 'experience_path',
      title,
      summary,
      status: existingItem?.status === 'active' ? 'active' : 'planned',
      source,
      retrieval_hint: String(metadata.retrieval_hint),
      skill_refs: skillRefs,
      device_refs: deviceRefs,
      metadata,
    }

    this.upsertExperiencePath(asset, {
      intent_pattern: String(input.intent_pattern ?? title).trim(),
      preconditions: input.preconditions ?? {},
      steps,
      skill_refs: skillRefs,
      device_refs: deviceRefs,
      success_criteria: input.success_criteria ?? { all_steps_complete: true },
      failure_recovery: input.failure_recovery ?? [],
      origin_trace_id: String(input.origin_trace_id ?? ''),
    }, {
      item_source: source,
      item_status: existingItem?.status ?? input.status ?? 'draft',
      confidence: clamp01(input.confidence ?? 0.55),
      priority: clamp01(input.priority ?? 0.45),
      conversation_id: conversationId,
      increment_failure: true,
    })

    const row = this.dbProvider().prepare(`
      SELECT
        memory_items.id,
        memory_items.kind,
        memory_items.title,
        memory_items.summary,
        memory_items.source,
        memory_items.status,
        memory_items.metadata_json,
        memory_experience_paths.skill_refs_json,
        memory_experience_paths.device_refs_json,
        memory_experience_paths.success_count,
        memory_experience_paths.failure_count,
        memory_experience_paths.last_success_at
      FROM memory_items
      LEFT JOIN memory_experience_paths
        ON memory_experience_paths.memory_item_id = memory_items.id
      WHERE memory_items.id = ?
    `).get(id) as MemoryItemRow | undefined

    return row ? this.fromMemoryItemRow(row) ?? asset : asset
  }

  recordOutcome(pathId: string, success: boolean): void {
    const id = normalizeMemoryId(pathId) || pathId.replace(/^memory:/, '')
    const column = success ? 'success_count' : 'failure_count'
    const db = this.dbProvider()
    db.prepare(`
      UPDATE memory_experience_paths
      SET ${column} = ${column} + 1${success ? ", last_success_at = datetime('now')" : ''}
      WHERE memory_item_id = ?
    `).run(id)
  }

  private readExperiencePathRefs(id: string): { skill_refs: MemorySkillRef[]; device_refs: string[] } {
    const row = this.dbProvider().prepare(`
      SELECT skill_refs_json, device_refs_json
      FROM memory_experience_paths
      WHERE memory_item_id = ?
    `).get(id) as { skill_refs_json: string | null; device_refs_json: string | null } | undefined

    return {
      skill_refs: readSkillRefs(row?.skill_refs_json),
      device_refs: readStringArray(row?.device_refs_json),
    }
  }

  private readMemoryItem(id: string): { status: 'active' | 'draft' | 'archived' | 'expired' } | undefined {
    return this.dbProvider().prepare(
      'SELECT status FROM memory_items WHERE id = ? LIMIT 1',
    ).get(id) as { status: 'active' | 'draft' | 'archived' | 'expired' } | undefined
  }

  private syncLegacyExperiencePaths(): void {
    for (const manifest of manifestRegistry.list()) {
      const asset = this.fromManifest(manifest)
      this.upsertExperiencePath(asset, {
        intent_pattern: manifest.display_name,
        preconditions: {
          legacy_kind: manifest.kind,
          configured: manifest.configured,
          capabilities: manifest.capabilities,
        },
        steps: manifest.actions.map((action) => ({
          tool: manifest.kind,
          action: action.name,
          params_schema: action.params_schema ?? {},
        })),
        skill_refs: asset.skill_refs,
        device_refs: [],
        success_criteria: { status: 'success' },
        failure_recovery: [],
      })
    }

    for (const plan of executorGateway.listPlans()) {
      const asset = this.fromPlan(plan)
      this.upsertExperiencePath(asset, {
        intent_pattern: plan.intent || plan.input || plan.name,
        preconditions: { source: plan.source },
        steps: plan.steps.map((step) => ({
          tool: step.tool,
          action: step.action,
          params: step.params,
        })),
        skill_refs: asset.skill_refs,
        device_refs: asset.device_refs,
        success_criteria: { all_steps_complete: true },
        failure_recovery: [],
      })
    }
  }

  private listPersistedMemoryAssets(): MemoryAssetRecord[] {
    const rows = this.dbProvider().prepare(`
      SELECT
        memory_items.id,
        memory_items.kind,
        memory_items.title,
        memory_items.summary,
        memory_items.source,
        memory_items.status,
        memory_items.metadata_json,
        memory_experience_paths.skill_refs_json,
        memory_experience_paths.device_refs_json,
        memory_experience_paths.success_count,
        memory_experience_paths.failure_count,
        memory_experience_paths.last_success_at
      FROM memory_items
      LEFT JOIN memory_experience_paths
        ON memory_experience_paths.memory_item_id = memory_items.id
      WHERE memory_items.status != 'archived'
      ORDER BY memory_items.priority DESC, memory_items.confidence DESC, memory_items.updated_at DESC
    `).all() as MemoryItemRow[]

    return rows
      .map((row) => this.fromMemoryItemRow(row))
      .filter((row): row is MemoryAssetRecord => Boolean(row))
  }

  private fromMemoryItemRow(row: MemoryItemRow): MemoryAssetRecord | null {
    const kind = toAssetKind(row.kind)
    if (!kind) return null
    const metadata = safeParseObject(row.metadata_json)
    const successCount = kind === 'experience_path' ? normalizeCount(row.success_count ?? metadata.success_count) : 0
    const failureCount = kind === 'experience_path' ? normalizeCount(row.failure_count ?? metadata.failure_count) : 0
    const evidence = kind === 'experience_path'
      ? buildExperienceEvidence(successCount, failureCount, metadata)
      : null
    const pathStats = kind === 'experience_path'
      ? {
          intent_pattern: row.intent_pattern ?? metadata.intent_pattern ?? '',
          preconditions: safeParseObject(row.preconditions_json ?? ''),
          steps: normalizeExperienceSteps(safeParseArray(row.steps_json ?? '') as ExperiencePathStep[]),
          success_criteria: safeParseObject(row.success_criteria_json ?? ''),
          failure_recovery: safeParseArray(row.failure_recovery_json ?? ''),
          origin_trace_id: row.origin_trace_id ?? metadata.origin_trace_id ?? '',
          success_count: successCount,
          failure_count: failureCount,
          last_success_at: row.last_success_at ?? metadata.last_success_at ?? null,
          run_status: evidence?.run_status ?? '',
          evidence_status: evidence?.evidence_status ?? 'untested',
          reuse_score: evidence?.reuse_score ?? 0.48,
        }
      : {}
    return {
      id: row.id,
      kind,
      title: row.title,
      summary: row.summary,
      status: row.source === 'legacy' ? 'legacy' : row.status === 'active' ? 'active' : 'planned',
      source: readSource(row.metadata_json, row.source),
      retrieval_hint: readRetrievalHint(row.metadata_json),
      skill_refs: readSkillRefs(row.skill_refs_json),
      device_refs: readStringArray(row.device_refs_json),
      metadata: { ...metadata, ...pathStats },
    }
  }

  private fromManifest(manifest: UnifiedExecutorManifest): MemoryAssetRecord {
    const skillRefs = inferSkillRefsFromTools([manifest.id, manifest.display_name, manifest.kind])
    return {
      id: `memory.experience_path.manifest.${manifest.id}`,
      kind: 'experience_path',
      title: manifest.display_name,
      summary: manifest.description || `Legacy executable manifest ${manifest.id}.`,
      status: 'legacy',
      source: 'manifest',
      retrieval_hint: 'Match when the user intent needs the same executor, channel, or script capability.',
      skill_refs: skillRefs,
      device_refs: [],
      metadata: {
        legacy_id: manifest.id,
        legacy_kind: manifest.kind,
        legacy_source: 'manifest',
        capabilities: manifest.capabilities,
        actions: manifest.actions.map((action) => action.name),
        configured: manifest.configured,
        skill_refs: skillRefs,
        device_refs: [],
        retrieval_hint: 'Match when the user intent needs the same executor, channel, or script capability.',
      },
    }
  }

  private fromPlan(plan: CompiledPlanDefinition): MemoryAssetRecord {
    const toolNames = plan.steps.flatMap((step) => [step.tool, step.action])
    const skillRefs = inferSkillRefsFromTools(toolNames)
    const deviceRefs = inferDeviceRefsFromSteps(plan.steps)
    return {
      id: `memory.experience_path.plan.${plan.id}`,
      kind: 'experience_path',
      title: plan.name,
      summary: plan.description || plan.intent || plan.input || `Legacy compiled plan ${plan.id}.`,
      status: 'legacy',
      source: 'plan',
      retrieval_hint: 'Match by intent/input first, then let the LLM validate device and parameters before execution.',
      skill_refs: skillRefs,
      device_refs: deviceRefs,
      metadata: {
        legacy_id: plan.id,
        legacy_source: 'plan',
        intent: plan.intent,
        input: plan.input,
        source: plan.source,
        skill_refs: skillRefs,
        device_refs: deviceRefs,
        steps: plan.steps.map((step) => ({
          tool: step.tool,
          action: step.action,
          params: step.params,
        })),
        retrieval_hint: 'Match by intent/input first, then let the LLM validate device and parameters before execution.',
      },
    }
  }

  private upsertExperiencePath(
    asset: MemoryAssetRecord,
    path: {
      intent_pattern: string
      preconditions: Record<string, unknown>
      steps: unknown[]
      skill_refs?: MemorySkillRef[]
      device_refs?: string[]
      success_criteria: Record<string, unknown>
      failure_recovery: unknown[]
      origin_trace_id?: string
    },
    options: {
      item_source?: 'user' | 'runtime' | 'imported' | 'legacy' | 'system'
      item_status?: 'active' | 'draft' | 'archived' | 'expired'
      confidence?: number
      priority?: number
      conversation_id?: number | null
      increment_success?: boolean
      increment_failure?: boolean
    } = {
      item_source: 'legacy',
      item_status: 'active',
      confidence: 0.75,
      priority: 0.65,
      conversation_id: null,
      increment_success: false,
      increment_failure: false,
    },
  ): void {
    const db = this.dbProvider()
    const metadataJson = JSON.stringify(asset.metadata)
    const skillRefs = path.skill_refs ?? asset.skill_refs
    const deviceRefs = path.device_refs ?? asset.device_refs
    const itemSource = options.item_source ?? 'legacy'
    const itemStatus = options.item_status ?? 'active'
    const confidence = clamp01(options.confidence ?? 0.75)
    const priority = clamp01(options.priority ?? 0.65)
    const conversationId = Number.isFinite(options.conversation_id) ? options.conversation_id : null
    const originTraceId = String(path.origin_trace_id ?? '')
    const searchText = [
      asset.title,
      asset.summary,
      path.intent_pattern,
      skillRefs.map((ref) => ref.label || ref.id).join(' '),
      deviceRefs.join(' '),
      JSON.stringify(path.steps),
    ].join('\n')

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO memory_items (
          id, kind, title, summary, search_text, scope, source, confidence,
          status, priority, conversation_id, metadata_json, updated_at
        )
        VALUES (?, 'experience_path', ?, ?, ?, 'global', ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          summary = excluded.summary,
          search_text = excluded.search_text,
          source = excluded.source,
          confidence = excluded.confidence,
          status = excluded.status,
          priority = excluded.priority,
          conversation_id = excluded.conversation_id,
          metadata_json = excluded.metadata_json,
          updated_at = datetime('now')
      `).run(asset.id, asset.title, asset.summary, searchText, itemSource, confidence, itemStatus, priority, conversationId, metadataJson)

      db.prepare(`
        INSERT INTO memory_experience_paths (
          memory_item_id, intent_pattern, preconditions_json, steps_json,
          skill_refs_json, device_refs_json, success_criteria_json, failure_recovery_json,
          origin_trace_id, success_count, failure_count, last_success_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN datetime('now') ELSE NULL END)
        ON CONFLICT(memory_item_id) DO UPDATE SET
          intent_pattern = excluded.intent_pattern,
          preconditions_json = excluded.preconditions_json,
          steps_json = excluded.steps_json,
          skill_refs_json = excluded.skill_refs_json,
          device_refs_json = excluded.device_refs_json,
          success_criteria_json = excluded.success_criteria_json,
          failure_recovery_json = excluded.failure_recovery_json,
          origin_trace_id = CASE
            WHEN excluded.origin_trace_id != '' THEN excluded.origin_trace_id
            ELSE memory_experience_paths.origin_trace_id
          END,
          success_count = memory_experience_paths.success_count + excluded.success_count,
          failure_count = memory_experience_paths.failure_count + excluded.failure_count,
          last_success_at = CASE
            WHEN excluded.success_count > 0 THEN datetime('now')
            ELSE memory_experience_paths.last_success_at
          END
      `).run(
        asset.id,
        path.intent_pattern,
        JSON.stringify(path.preconditions),
        JSON.stringify(path.steps),
        JSON.stringify(skillRefs),
        JSON.stringify(deviceRefs),
        JSON.stringify(path.success_criteria),
        JSON.stringify(path.failure_recovery),
        originTraceId,
        options.increment_success ? 1 : 0,
        options.increment_failure ? 1 : 0,
        options.increment_success ? 1 : 0,
      )

      db.prepare('DELETE FROM memory_items_fts WHERE id = ?').run(asset.id)
      db.prepare(`
        INSERT INTO memory_items_fts (id, title, summary, search_text, kind, source)
        VALUES (?, ?, ?, ?, 'experience_path', ?)
      `).run(asset.id, asset.title, asset.summary, searchText, asset.source)
    })

    tx()
  }

  private listPlannedMemoryAssets(): MemoryAssetRecord[] {
    return [
      this.planned('user_feedback', '用户反馈', 'Corrections and preferences explicitly expressed by the user.'),
      this.planned('device_preference', '设备偏好', 'Default devices, rooms, apps, and repeated usage habits.'),
      this.planned('spatial_map', '空间地图', 'Room/device/location relationships for lightweight graph and memory-palace ideas.'),
      this.planned('long_term_knowledge', '长期知识', 'External RAG, vector, document, and SQLite-backed knowledge memory.'),
    ]
  }

  private planned(kind: Exclude<MemoryAssetKind, 'experience_path'>, title: string, summary: string): MemoryAssetRecord {
    return {
      id: `memory.${kind}.planned`,
      kind,
      title,
      summary,
      status: 'planned',
      source: 'placeholder',
      retrieval_hint: 'Not connected yet.',
      skill_refs: [],
      device_refs: [],
      metadata: {},
    }
  }
}

export const memoryAssetsService = new MemoryAssetsService()

function toAssetKind(kind: MemoryItemRow['kind']): MemoryAssetKind | null {
  if (kind === 'experience_path') return 'experience_path'
  if (kind === 'feedback') return 'user_feedback'
  if (kind === 'device_preference') return 'device_preference'
  if (kind === 'spatial_node' || kind === 'spatial_edge') return 'spatial_map'
  if (kind === 'knowledge_chunk') return 'long_term_knowledge'
  return null
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function safeParseArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readSource(raw: string, itemSource: MemoryItemRow['source']): MemoryAssetRecord['source'] {
  const metadata = safeParseObject(raw)
  const source = String(metadata.legacy_source ?? '')
  if (source === 'manifest' || source === 'plan') return source
  if (itemSource === 'runtime' || itemSource === 'user' || itemSource === 'imported' || itemSource === 'system') {
    return itemSource
  }
  return 'placeholder'
}

function readRetrievalHint(raw: string): string {
  const metadata = safeParseObject(raw)
  return String(metadata.retrieval_hint ?? 'Use as a structured memory candidate when relevant.')
}

function readSkillRefs(raw: string | null | undefined): MemorySkillRef[] {
  if (!raw) return []
  try {
    return readSkillRefsFromValue(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

function readSkillRefsFromValue(value: unknown): MemorySkillRef[] {
  if (!Array.isArray(value)) return []
  const refs = value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const kind = record.kind === 'device_skill' ? 'device_skill' : record.kind === 'general_skill' ? 'general_skill' : null
      const id = String(record.id ?? '').trim()
      if (!kind || !id) return null
      const label = String(record.label ?? '').trim()
      return label ? { kind, id, label } : { kind, id }
    })
    .filter((item): item is MemorySkillRef => Boolean(item))

  return dedupeSkillRefs(refs)
}

function readStringArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    return readStringArrayFromValue(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

function readStringArrayFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)))
}

function normalizeDeviceRefs(refs: string[]): string[] {
  const normalized = new Set<string>()
  for (const ref of refs) {
    const value = ref.trim()
    if (!value) continue
    normalized.add(value.startsWith('device:') ? value : `device:${value}`)
  }
  return Array.from(normalized)
}

function buildMemorySearchTerms(query: string): string[] {
  const compact = normalizeSearchText(query)
  const terms = new Set<string>()
  if (compact.length >= 2) terms.add(compact)

  for (const match of query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const term = normalizeSearchText(match)
    if (term.length >= 2) terms.add(term)
  }

  if (compact.length >= 3 && compact.length <= 32) {
    for (let index = 0; index < compact.length - 1; index += 1) {
      terms.add(compact.slice(index, index + 2))
    }
  }

  return Array.from(terms)
}

function scoreMemorySearchRow(
  row: { title: string; summary: string; search_text: string; intent_pattern: string; success_count: number; failure_count?: number; confidence: number },
  terms: string[],
): number {
  if (terms.length === 0) return 0
  const haystack = normalizeSearchText([
    row.title,
    row.summary,
    row.search_text,
    row.intent_pattern,
  ].join('\n'))

  let score = 0
  for (const term of terms) {
    if (!term || !haystack.includes(term)) continue
    score += term.length >= 4 ? 0.28 : 0.12
  }
  if (haystack.includes(terms[0])) score += 0.35
  score += Math.min(0.2, row.success_count * 0.04)
  score -= Math.min(0.2, Number(row.failure_count ?? 0) * 0.04)
  score += Math.min(0.15, row.confidence * 0.15)
  return Math.max(0, Math.min(1, score))
}

function buildExperienceEvidence(
  successCount: number,
  failureCount: number,
  metadata: Record<string, unknown>,
): { run_status: string; evidence_status: MemoryEvidenceStatus; reuse_score: number } {
  const successes = normalizeCount(successCount)
  const failures = normalizeCount(failureCount)
  const runStatus = normalizeRunStatus(metadata.run_status)
    || normalizeRunStatus(metadata.saved_from)
    || inferRunStatusFromCounts(successes, failures)
  const evidence_status = inferEvidenceStatus(successes, failures, runStatus)
  const reuse_score = inferReuseScore(successes, failures, runStatus)
  return {
    run_status: runStatus,
    evidence_status,
    reuse_score,
  }
}

function normalizeCount(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function normalizeRunStatus(value: unknown): string {
  const status = String(value ?? '').trim()
  if (!status) return ''
  if (status === 'workflow_success') return 'succeeded'
  if (status === 'workflow_failure') return 'failed'
  if (status === 'succeeded' || status === 'failed' || status === 'running' || status === 'pending') return status
  return ''
}

function inferRunStatusFromCounts(successCount: number, failureCount: number): string {
  if (successCount > 0 && failureCount === 0) return 'succeeded'
  if (failureCount > 0 && successCount === 0) return 'failed'
  if (successCount > 0 && failureCount > 0) return 'failed'
  return ''
}

function inferEvidenceStatus(
  successCount: number,
  failureCount: number,
  runStatus: string,
): MemoryEvidenceStatus {
  const totalRuns = successCount + failureCount
  if (totalRuns === 0 && !runStatus) return 'untested'
  if (runStatus === 'succeeded') return 'proven'
  if (runStatus === 'failed') return successCount > 0 ? 'regressed' : 'failing'
  if (runStatus === 'running' || runStatus === 'pending') return 'running'
  if (successCount > 0 && failureCount === 0) return 'proven'
  if (successCount > 0 && failureCount > 0) return 'regressed'
  if (failureCount > 0) return 'failing'
  return 'untested'
}

function inferReuseScore(
  successCount: number,
  failureCount: number,
  runStatus: string,
): number {
  let score = 0.48
  score += Math.min(successCount, 5) * 0.08
  score -= Math.min(failureCount, 5) * 0.06
  if (runStatus === 'succeeded') score += 0.18
  if (runStatus === 'failed') score -= 0.16
  if (runStatus === 'running' || runStatus === 'pending') score -= 0.04
  return Math.max(0.05, Math.min(0.98, Number(score.toFixed(2))))
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim()
}

function inferSkillRefsFromTools(values: string[]): MemorySkillRef[] {
  const refs: MemorySkillRef[] = []
  const joined = values.join(' ').toLowerCase()

  if (joined.includes('sandbox-mi')) refs.push({ kind: 'general_skill', id: 'sandbox-mi-cli', label: 'Sandbox Mi CLI' })
  if (joined.includes('mi') || joined.includes('xiaoai')) refs.push({ kind: 'general_skill', id: 'mi-cli', label: 'Mi CLI' })
  if (joined.includes('adb') || joined.includes('android')) refs.push({ kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' })
  if (joined.includes('hami')) refs.push({ kind: 'general_skill', id: 'hami-cli', label: 'Hami CLI' })

  return dedupeSkillRefs(refs)
}

function inferDeviceRefsFromSteps(steps: Array<{ params?: Record<string, unknown> }>): string[] {
  const refs: string[] = []
  for (const step of steps) {
    const params = step.params
    if (!params || typeof params !== 'object' || Array.isArray(params)) continue
    for (const key of ['device_id', 'deviceId', 'target_device_id', 'targetDeviceId', 'mi_did', 'adb_ip']) {
      const value = (params as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) refs.push(value.trim())
      if (typeof value === 'number') refs.push(String(value))
    }
  }
  return Array.from(new Set(refs))
}

function dedupeSkillRefs(refs: MemorySkillRef[]): MemorySkillRef[] {
  const seen = new Set<string>()
  const result: MemorySkillRef[] = []
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(ref)
  }
  return result
}

function normalizeExperienceSteps(rawSteps: ExperiencePathStep[] | undefined): ExperiencePathStep[] {
  if (!Array.isArray(rawSteps)) return []
  const result: ExperiencePathStep[] = []
  for (const step of rawSteps) {
    const tool = String(step?.tool ?? '').trim()
    const action = String(step?.action ?? '').trim()
    if (!tool || !action) continue
    const normalized: ExperiencePathStep = {
      tool,
      action,
    }
    if (isPlainObject(step.params)) {
      normalized.params = step.params
    }
    if (isPlainObject(step.params_schema)) {
      normalized.params_schema = step.params_schema
    }
    result.push(normalized)
  }
  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMemoryId(id: string | undefined): string {
  const value = String(id ?? '').trim()
  if (!value) return ''
  return value
    .replace(/[^A-Za-z0-9._:-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 180)
}

function buildExperiencePathId(
  source: NonNullable<RecordExperiencePathInput['source']>,
  title: string,
  intentPattern: string | undefined,
  steps: ExperiencePathStep[],
): string {
  const slug = slugify(title || intentPattern || 'experience-path')
  const hash = createHash('sha1')
    .update(JSON.stringify({ title, intentPattern, steps }))
    .digest('hex')
    .slice(0, 10)
  return `memory.experience_path.${source}.${slug}.${hash}`
}

function slugify(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return ascii || 'path'
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}

function normalizeConversationId(db: Database.Database, value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const row = db.prepare('SELECT 1 AS ok FROM conversations WHERE id = ?').get(value) as { ok?: number } | undefined
  return row ? value : null
}
