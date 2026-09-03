import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { llmService as defaultLlmService } from '../llm-provider/service.js'
import { skillsService as defaultSkillsService } from '../skills-system/index.js'
import { SqlMemoryRepository, type MemoryRepository } from './kernel-repository.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface LLMServiceInstance {
  embed(opts: { model_id?: number; input: string | string[] }): Promise<{ data: Array<{ index: number; embedding: number[] }> }>
  getDefaultModel(category: string): { id: number; provider_id: number; model_name: string; category: string; is_default: boolean; enabled: boolean }
}

interface SkillsServiceInstance {
  getSkill(name: string): { name: string; prompt_template: string; description: string } | undefined
}

export interface MemoryMetadata {
  type: 'person' | 'device' | 'room' | 'concept' | 'skill'
  wing: string
  room: string
  confidence?: number
  source?: string
  source_file?: string
  valid_from?: string
  valid_to?: string
}

export interface MemoryItem {
  id: string
  content: string
  type: string
  wing: string
  room: string
  relevance: number
  source: string
}

export interface MemoryStack {
  l0: string
  l1: MemoryItem[]
}

export interface RecallResult {
  entity: Record<string, unknown>
  attributes: Array<Record<string, unknown>>
  triples: Array<Record<string, unknown>>
}

export interface SearchResult {
  id: string
  content: string
  type: string
  wing: string
  room: string
  score: number
  fts_score: number
  graph_score: number
  source: string
  metadata?: Record<string, unknown>
}

interface StoredEmbeddingRow {
  knowledge_id: number
  profile_name: string
  dimensions: number
  embedding_json: string
}

export interface PalaceNode {
  id: string
  name: string
  type: string
  wing: string
  room: string
  properties: Record<string, unknown>
}

export interface PalaceEdge {
  source: string
  predicate: string
  target: string
  confidence: number
}

export interface PalaceGraph {
  nodes: PalaceNode[]
  edges: PalaceEdge[]
}

export interface GraphNode {
  id: string
  type: string
  label: string
  scope: string
  embedding_ref: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GraphEdge {
  id: number
  from_node_id: string
  to_node_id: string
  relation: string
  weight: number
  confidence: number
  valid_from: string
  valid_to: string | null
  source_type: string
  source_ref: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface GraphNeighbor {
  node: GraphNode
  edge: GraphEdge
  direction: 'out' | 'in'
  score: number
}

export interface EmbeddingProfile {
  profile_name: string
  slot_name: string
  provider_type: string
  api_base: string
  model_name: string
  dimensions: number | null
  is_canonical: boolean
  notes: string
  created_at: string
  updated_at: string
}

export interface CompiledKnowledgeItem {
  id: number
  kind: 'wiki_page' | 'compiled_plan' | 'experience_note' | 'skill_candidate' | 'rule_candidate' | 'workflow_candidate'
  title: string
  body: string
  wing: string
  room: string
  source_type: string
  source_ref: string
  tags: string[]
  metadata: Record<string, unknown>
  embedding_profile: string | null
  rank_score: number
  created_at: string
  updated_at: string
}

export interface MemoryKernelStatus {
  canonical_profile: EmbeddingProfile | null
  current_embedding_slot: {
    provider_type: string
    api_base: string
    model_name: string
    dimensions: number | null
    enabled: boolean
  } | null
  embedding_locked: boolean
  slot_matches_canonical: boolean
  memory_entity_count: number
  compiled_knowledge_count: number
}

export class MemoryKernelService {
  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly llmService: LLMServiceInstance = defaultLlmService,
    private readonly skillsService: SkillsServiceInstance = defaultSkillsService,
    private readonly repo: MemoryRepository = new SqlMemoryRepository(getDb),
  ) {}

  initialize(): void {
    this.ensureCanonicalEmbeddingProfile()
  }

  ensureCanonicalEmbeddingProfile(): EmbeddingProfile | null {
    const profileName = process.env.MODEL_PROFILE || 'default'
    const existing = this.getCanonicalEmbeddingProfile()
    let model: { id: number; provider_id: number; model_name: string; category: string; is_default: boolean; enabled: boolean } | null = null
    let provider: { api_base: string; name: string } | null = null
    try {
      model = this.llmService.getDefaultModel('embedding')
      const db = this.getDb()
      provider = db.prepare('SELECT api_base, name FROM llm_providers WHERE id = ?').get(model.provider_id) as { api_base: string; name: string } | undefined ?? null
    } catch {}

    if (!model || !provider) {
      return existing
    }

    if (existing) {
      const changed = existing.model_name !== model.model_name
        || existing.api_base !== provider.api_base

      if (changed) {
        this.repo.updateCanonicalEmbeddingProfile({
          profileName: existing.profile_name,
          slotName: 'embedding',
          providerType: 'openai',
          apiBase: provider.api_base,
          modelName: model.model_name,
          dimensions: null,
        })
      }

      return this.getCanonicalEmbeddingProfile()
    }

    this.repo.upsertCanonicalEmbeddingProfile({
      profileName,
      slotName: 'embedding',
      providerType: 'openai',
      apiBase: provider.api_base,
      modelName: model.model_name,
      dimensions: null,
      notes: 'Canonical embedding profile. Rebuild required before changing embedding model.',
    })

    return this.getCanonicalEmbeddingProfile()
  }

  listEmbeddingProfiles(): EmbeddingProfile[] {
    return this.repo.listEmbeddingProfiles().map((row) => this.normalizeProfile(row as unknown as Record<string, unknown>))
  }

  getCanonicalEmbeddingProfile(): EmbeddingProfile | null {
    const row = this.repo.getCanonicalEmbeddingProfile()
    return row ? this.normalizeProfile(row as unknown as Record<string, unknown>) : null
  }

  getStatus(): MemoryKernelStatus {
    const canonical = this.getCanonicalEmbeddingProfile()
    let currentEmbeddingModel: { model_name: string; api_base: string } | null = null
    try {
      const m = this.llmService.getDefaultModel('embedding')
      const db = this.getDb()
      const p = db.prepare('SELECT api_base FROM llm_providers WHERE id = ?').get(m.provider_id) as { api_base: string } | undefined
      if (p) currentEmbeddingModel = { model_name: m.model_name, api_base: p.api_base }
    } catch {}
    const memoryEntityCount = this.repo.countEntities()
    const compiledKnowledgeCount = this.repo.countCompiledKnowledge()

    return {
      canonical_profile: canonical,
      current_embedding_slot: currentEmbeddingModel
        ? { provider_type: 'openai', api_base: currentEmbeddingModel.api_base, model_name: currentEmbeddingModel.model_name, dimensions: null, enabled: true }
        : null,
      embedding_locked: canonical !== null,
      slot_matches_canonical: canonical
        ? Boolean(currentEmbeddingModel && currentEmbeddingModel.model_name === canonical.model_name)
        : false,
      memory_entity_count: memoryEntityCount,
      compiled_knowledge_count: compiledKnowledgeCount,
    }
  }

  remember(content: string, metadata: MemoryMetadata): void {
    const entityId = this.generateEntityId(metadata.type, metadata.wing, metadata.room, content)

    this.repo.upsertEntity({
      id: entityId,
      name: content.slice(0, 200),
      type: metadata.type,
      wing: metadata.wing,
      room: metadata.room,
      propertiesJson: JSON.stringify({
        content,
        source: metadata.source ?? '',
        confidence: metadata.confidence ?? 1.0,
      }),
    })

    this.extractAndWriteTriples(entityId, content, metadata)
    this.extractAndWriteAttributes(entityId, content)

    this.repo.insertExperienceFts({
      title: content.slice(0, 100),
      content,
      category: metadata.wing,
    })

    this.eventBus.fire(HeartEvent.MEMORY_REMEMBERED, { entity_id: entityId, type: metadata.type, wing: metadata.wing })
  }

  recall(wing: string, room?: string): RecallResult[] {
    const entities = this.repo.listEntities({ wing, room, limit: 50 })
    return entities.map((entity) => {
      const entityId = entity.id
      const attributes = this.repo.listCurrentAttributesByEntity(entityId)
      const triples = this.repo.listCurrentTriplesByEntity(entityId)
      return {
        entity: entity as unknown as Record<string, unknown>,
        attributes: attributes as unknown as Array<Record<string, unknown>>,
        triples: triples as unknown as Array<Record<string, unknown>>,
      }
    })
  }

  observeOutcome(params: {
    intent: string
    target_device_id?: string
    tool: string
    action: string
    success: boolean
    error?: string
  }): void {
    const name = params.target_device_id
      ? `intent:${params.intent}→${params.target_device_id}`
      : `intent:${params.intent}`
    const entityId = this.generateEntityId(
      'concept',
      'runtime_observations',
      params.tool,
      name,
    )

    this.repo.upsertEntity({
      id: entityId,
      name: name.slice(0, 200),
      type: 'concept',
      wing: 'runtime_observations',
      room: params.tool,
      propertiesJson: JSON.stringify({
        intent: params.intent,
        tool: params.tool,
        action: params.action,
        target_device_id: params.target_device_id,
      }),
    })

    const key = params.success ? 'success_count' : 'failure_count'
    const existing = this.repo.getCurrentAttribute(entityId, key)
    const nextCount = (existing ? Number(existing.value) || 0 : 0) + 1

    this.repo.upsertAttribute({ entityId, key, value: String(nextCount) })
    this.repo.upsertAttribute({ entityId, key: 'last_seen', value: new Date().toISOString() })
    this.repo.upsertAttribute({ entityId, key: 'last_action', value: `${params.tool}.${params.action}` })

    if (!params.success && params.error) {
      this.repo.upsertAttribute({ entityId, key: 'last_error', value: params.error.slice(0, 200) })
    }

    this.eventBus.fire(HeartEvent.MEMORY_OBSERVATION, {
      entity_id: entityId,
      success: params.success,
      intent: params.intent,
    })
  }

  recallObservations(query: string, topK: number = 5): Array<{
    id: string
    name: string
    type: string
    success_count: number
    failure_count: number
    last_seen?: string
    last_action?: string
    last_error?: string
    score: number
  }> {
    const keywords = query.split(/\s+/).filter((w) => w.length >= 2).slice(0, 4)
    if (keywords.length === 0) return []

    const rows = this.repo.searchObservationEntitiesByName(keywords, 20)

    const now = Date.now()
    const results = rows.map((row) => {
      const attrs = this.repo.listCurrentAttributesByEntity(row.id)
      const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]))
      const success = Number(byKey.success_count ?? 0)
      const failure = Number(byKey.failure_count ?? 0)
      const successRate = success + failure > 0 ? success / (success + failure) : 0.5
      const lastSeenMs = byKey.last_seen ? Date.parse(byKey.last_seen) : 0
      const recency = lastSeenMs ? Math.exp(-(now - lastSeenMs) / (1000 * 60 * 60 * 24 * 7)) : 0
      const score = 0.5 * successRate + 0.3 * recency + 0.2 * Math.min(1, (success + failure) / 5)

      return {
        id: row.id,
        name: row.name,
        type: row.type,
        success_count: success,
        failure_count: failure,
        last_seen: byKey.last_seen,
        last_action: byKey.last_action,
        last_error: byKey.last_error,
        score,
      }
    })

    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  search(query: string): SearchResult[] {
    const db = this.getDb()
    const results = new Map<string, SearchResult>()

    try {
      const compiledRows = db.prepare(
        `SELECT rowid, title, body, kind, wing, room, source_ref, rank
         FROM compiled_knowledge_fts
         WHERE compiled_knowledge_fts MATCH ?
         ORDER BY rank
         LIMIT 10`,
      ).all(query) as Array<{
        rowid: number
        title: string
        body: string
        kind: string
        wing: string
        room: string
        source_ref: string
        rank: number
      }>

      for (const row of compiledRows) {
        const score = Math.max(0, 1 - Math.abs(row.rank))
        results.set(`compiled_${row.rowid}`, {
          id: `compiled_${row.rowid}`,
          content: `${row.title}\n${row.body}`.trim(),
          type: row.kind,
          wing: row.wing,
          room: row.room,
          score: score + 0.1,
          fts_score: score,
          graph_score: 0,
          source: 'compiled',
        })
      }
    } catch {}

    try {
      const ftsRows = db.prepare(
        `SELECT rowid, title, content, category, rank
         FROM experiences_fts
         WHERE experiences_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
      ).all(query) as Array<{ rowid: number; title: string; content: string; category: string; rank: number }>

      for (const row of ftsRows) {
        const score = Math.max(0, 1 - Math.abs(row.rank))
        results.set(`fts_${row.rowid}`, {
          id: `fts_${row.rowid}`,
          content: row.content,
          type: 'concept',
          wing: row.category,
          room: '',
          score,
          fts_score: score,
          graph_score: 0,
          source: 'fts',
        })
      }
    } catch {}

    const keywords = query.split(/\s+/).filter((word) => word.length >= 2)
    for (const keyword of keywords.slice(0, 3)) {
      const entityRows = db.prepare(
        `SELECT * FROM memory_entities
         WHERE name LIKE ? OR wing LIKE ? OR room LIKE ?
         LIMIT 10`,
      ).all(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`) as Array<Record<string, unknown>>

      for (const entity of entityRows) {
        const entityId = entity.id as string
        if (results.has(entityId)) continue
        results.set(entityId, {
          id: entityId,
          content: this.readEntityContent(entity),
          type: entity.type as string,
          wing: entity.wing as string,
          room: entity.room as string,
          score: 0.7,
          fts_score: 0,
          graph_score: 0.7,
          source: 'entity',
        })
      }

      const tripleRows = db.prepare(
        `SELECT t.*, s.name AS subject_name, o.name AS object_name
         FROM memory_triples t
         JOIN memory_entities s ON t.subject = s.id
         JOIN memory_entities o ON t.object = o.id
         WHERE t.predicate LIKE ? AND t.valid_to IS NULL
         LIMIT 10`,
      ).all(`%${keyword}%`) as Array<Record<string, unknown>>

      for (const triple of tripleRows) {
        const tripleId = `triple_${String(triple.id)}`
        if (results.has(tripleId)) continue
        const confidence = Number(triple.confidence ?? 0.5)
        results.set(tripleId, {
          id: tripleId,
          content: `${String(triple.subject_name)} ${String(triple.predicate)} ${String(triple.object_name)}`,
          type: 'concept',
          wing: '',
          room: '',
          score: confidence * 0.6,
          fts_score: 0,
          graph_score: confidence * 0.6,
          source: 'graph',
        })
      }
    }

    const graphRows = this.repo.searchGraphNodesByLike(keywords.slice(0, 4), 12)
    for (const node of graphRows) {
      const nodeId = `graph_node_${node.id}`
      if (results.has(nodeId)) continue
      const metadata = this.parseJson<Record<string, unknown>>(node.metadata_json, {})
      const score = Number(metadata.rank_score ?? 0.65)
      results.set(nodeId, {
        id: nodeId,
        content: [node.label, node.type, node.scope].filter(Boolean).join('\n'),
        type: node.type,
        wing: node.scope,
        room: '',
        score,
        fts_score: 0,
        graph_score: score,
        source: 'graph',
      })
    }

    return Array.from(results.values()).sort((left, right) => right.score - left.score).slice(0, 20)
  }

  async semanticSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
    const canonical = this.getCanonicalEmbeddingProfile()
    if (!canonical) return []

    const queryEmbedding = await this.llmService.embed({
      input: query,
    })
    const vector = queryEmbedding.data[0]?.embedding ?? []
    if (vector.length === 0) return []

    const db = this.getDb()
    const rows = db.prepare(
      `SELECT e.knowledge_id, e.profile_name, e.dimensions, e.embedding_json, c.title, c.body, c.kind, c.wing, c.room
       FROM compiled_knowledge_embeddings e
       JOIN compiled_knowledge_items c ON c.id = e.knowledge_id
       WHERE e.profile_name = ?`,
    ).all(canonical.profile_name) as Array<StoredEmbeddingRow & {
      title: string
      body: string
      kind: string
      wing: string
      room: string
    }>

    const scored = rows
      .map((row) => {
        const embedding = this.parseJson<number[]>(row.embedding_json, [])
        const baseScore = cosineSimilarity(vector, embedding)
        const score = Math.min(0.99, Math.max(0, baseScore + semanticKindBoost(row.kind, row.wing)))
        return {
          id: `compiled_${row.knowledge_id}`,
          content: `${row.title}\n${row.body}`.trim(),
          type: row.kind,
          wing: row.wing,
          room: row.room,
          score,
          fts_score: 0,
          graph_score: score,
          source: 'semantic',
        } satisfies SearchResult
      })
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score)

    return scored.slice(0, limit)
  }

  async rebuildCompiledKnowledgeEmbeddings(limit?: number): Promise<{
    profile_name: string
    processed: number
    stored: number
    dimensions: number
  }> {
    const canonical = this.ensureCanonicalEmbeddingProfile()
    if (!canonical) {
      throw new Error('Canonical embedding profile is not configured')
    }

    const db = this.getDb()
    const rows = db.prepare(
      `SELECT * FROM compiled_knowledge_items
       ORDER BY rank_score DESC, updated_at DESC
       LIMIT ?`,
    ).all(limit ?? 200) as Array<Record<string, unknown>>

    const texts = rows.map((row) => this.composeCompiledKnowledgeText(this.normalizeCompiledItem(row)))
    const batchSize = 16
    let stored = 0

    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const sliceRows = rows.slice(offset, offset + batchSize)
      const sliceTexts = texts.slice(offset, offset + batchSize)
      const result = await this.llmService.embed({
        input: sliceTexts,
      })

      for (const item of result.data) {
        const row = sliceRows[item.index]
        if (!row) continue
        db.prepare(
          `INSERT INTO compiled_knowledge_embeddings (
            knowledge_id, profile_name, dimensions, embedding_json
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(knowledge_id, profile_name) DO UPDATE SET
            dimensions=excluded.dimensions,
            embedding_json=excluded.embedding_json,
            updated_at=datetime('now')`,
        ).run(
          Number(row.id),
          canonical.profile_name,
          item.embedding.length,
          JSON.stringify(item.embedding),
        )
        stored += 1
      }
    }

    return {
      profile_name: canonical.profile_name,
      processed: rows.length,
      stored,
      dimensions: canonical.dimensions ?? 0,
    }
  }

  wakeUp(): MemoryStack {
    const db = this.getDb()
    const identitySkill = this.skillsService.getSkill('identity')
    const l0 = identitySkill?.prompt_template || 'You are the HomeSense control agent. Prefer deterministic plans, device facts, and compiled wiki knowledge.'
    const l1: MemoryItem[] = []

    const compiledRows = db.prepare(
      `SELECT * FROM compiled_knowledge_items
       ORDER BY rank_score DESC, updated_at DESC
       LIMIT 6`,
    ).all() as Array<Record<string, unknown>>

    for (const row of compiledRows) {
      l1.push({
        id: `compiled.${String(row.id)}`,
        content: `${String(row.title)}\n${String(row.body)}`.trim(),
        type: String(row.kind),
        wing: String(row.wing ?? ''),
        room: String(row.room ?? ''),
        relevance: Number(row.rank_score ?? 0.7),
        source: 'compiled',
      })
    }

    const entityRows = db.prepare(
      `SELECT * FROM memory_entities ORDER BY updated_at DESC LIMIT 10`,
    ).all() as Array<Record<string, unknown>>
    for (const row of entityRows) {
      l1.push({
        id: String(row.id),
        content: this.readEntityContent(row),
        type: String(row.type),
        wing: String(row.wing ?? ''),
        room: String(row.room ?? ''),
        relevance: 0.75,
        source: 'memory',
      })
    }

    return { l0, l1: l1.slice(0, 16) }
  }

  buildGraph(wing?: string): PalaceGraph {
    const db = this.getDb()
    let entityQuery = 'SELECT * FROM memory_entities'
    const entityParams: unknown[] = []
    if (wing) {
      entityQuery += ' WHERE wing = ?'
      entityParams.push(wing)
    }

    const entities = db.prepare(entityQuery).all(...entityParams) as Array<Record<string, unknown>>
    const entityIds = new Set(entities.map((entity) => String(entity.id)))

    const nodes: PalaceNode[] = entities.map((entity) => ({
      id: String(entity.id),
      name: String(entity.name),
      type: String(entity.type),
      wing: String(entity.wing ?? ''),
      room: String(entity.room ?? ''),
      properties: this.parseJson<Record<string, unknown>>(entity.properties_json as string, {}),
    }))

    let tripleQuery = 'SELECT * FROM memory_triples WHERE valid_to IS NULL'
    const tripleParams: unknown[] = []
    if (wing && entities.length > 0) {
      const placeholders = entities.map(() => '?').join(',')
      tripleQuery += ` AND subject IN (${placeholders}) AND object IN (${placeholders})`
      tripleParams.push(...entityIds, ...entityIds)
    }

    const triples = db.prepare(tripleQuery).all(...tripleParams) as Array<Record<string, unknown>>
    const edges: PalaceEdge[] = triples
      .filter((triple) => entityIds.has(String(triple.subject)) && entityIds.has(String(triple.object)))
      .map((triple) => ({
        source: String(triple.subject),
        predicate: String(triple.predicate),
        target: String(triple.object),
        confidence: Number(triple.confidence ?? 1),
      }))

    return { nodes, edges }
  }

  upsertGraphNode(input: {
    id: string
    type: string
    label: string
    scope?: string
    embedding_ref?: string
    metadata?: Record<string, unknown>
  }): GraphNode {
    this.repo.upsertGraphNode({
      id: input.id,
      type: input.type,
      label: input.label,
      scope: input.scope ?? '',
      embeddingRef: input.embedding_ref ?? '',
      metadataJson: JSON.stringify(input.metadata ?? {}),
    })
    const row = this.repo.getGraphNodeById(input.id)
    if (!row) {
      throw new Error(`Graph node upsert failed: ${input.id}`)
    }
    return this.normalizeGraphNode(row as unknown as Record<string, unknown>)
  }

  upsertGraphEdge(input: {
    from_node_id: string
    to_node_id: string
    relation: string
    weight?: number
    confidence?: number
    valid_from?: string
    valid_to?: string | null
    source_type?: string
    source_ref?: string
    metadata?: Record<string, unknown>
  }): GraphEdge {
    const from = this.repo.getGraphNodeById(input.from_node_id)
    const to = this.repo.getGraphNodeById(input.to_node_id)
    if (!from) throw new Error(`Graph node not found: ${input.from_node_id}`)
    if (!to) throw new Error(`Graph node not found: ${input.to_node_id}`)

    const id = this.repo.upsertGraphEdge({
      fromNodeId: input.from_node_id,
      toNodeId: input.to_node_id,
      relation: input.relation,
      weight: input.weight ?? 1,
      confidence: input.confidence ?? 1,
      validFrom: input.valid_from ?? new Date().toISOString(),
      validTo: input.valid_to ?? null,
      sourceType: input.source_type ?? '',
      sourceRef: input.source_ref ?? '',
      metadataJson: JSON.stringify(input.metadata ?? {}),
    })

    return {
      id,
      from_node_id: input.from_node_id,
      to_node_id: input.to_node_id,
      relation: input.relation,
      weight: input.weight ?? 1,
      confidence: input.confidence ?? 1,
      valid_from: input.valid_from ?? '',
      valid_to: input.valid_to ?? null,
      source_type: input.source_type ?? '',
      source_ref: input.source_ref ?? '',
      metadata: input.metadata ?? {},
      created_at: '',
      updated_at: '',
    }
  }

  expandGraphNeighborhood(nodeId: string, limit: number = 20): GraphNeighbor[] {
    const rows = this.repo.listGraphNeighbors(nodeId, limit)
    return rows.map((row) => {
      const node = this.normalizeGraphNode({
        id: row.neighbor_id,
        type: row.neighbor_type,
        label: row.neighbor_label,
        scope: row.neighbor_scope,
        embedding_ref: '',
        metadata_json: row.neighbor_metadata_json,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      const edge = this.normalizeGraphEdge(row as unknown as Record<string, unknown>)
      return {
        node,
        edge,
        direction: row.direction,
        score: Math.max(0, Math.min(1, Number(row.weight ?? 1))),
      }
    })
  }

  searchGraph(query: string, limit: number = 10): GraphNode[] {
    const keywords = query.split(/\s+/).filter((word) => word.length >= 2).slice(0, 5)
    return this.repo.searchGraphNodesByLike(keywords, limit)
      .map((row) => this.normalizeGraphNode(row as unknown as Record<string, unknown>))
  }

  listCompiledKnowledge(filters: { kind?: CompiledKnowledgeItem['kind']; wing?: string; room?: string; limit?: number } = {}): CompiledKnowledgeItem[] {
    const db = this.getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (filters.kind) {
      conditions.push('kind = ?')
      params.push(filters.kind)
    }
    if (filters.wing) {
      conditions.push('wing = ?')
      params.push(filters.wing)
    }
    if (filters.room) {
      conditions.push('room = ?')
      params.push(filters.room)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(
      `SELECT * FROM compiled_knowledge_items
       ${whereClause}
       ORDER BY rank_score DESC, updated_at DESC
       LIMIT ?`,
    ).all(...params, filters.limit ?? 50) as Array<Record<string, unknown>>

    return rows.map((row) => this.normalizeCompiledItem(row))
  }

  getCompiledKnowledgeItem(id: number): CompiledKnowledgeItem | null {
    const db = this.getDb()
    const row = db.prepare(
      'SELECT * FROM compiled_knowledge_items WHERE id = ? LIMIT 1',
    ).get(id) as Record<string, unknown> | undefined
    return row ? this.normalizeCompiledItem(row) : null
  }

  private composeCompiledKnowledgeText(item: CompiledKnowledgeItem): string {
    return [
      item.title,
      item.body,
      item.kind,
      item.tags.join(' '),
      Object.values(item.metadata)
        .filter((value): value is string => typeof value === 'string')
        .join(' '),
    ]
      .filter(Boolean)
      .join('\n')
  }

  upsertCompiledKnowledge(input: {
    kind: CompiledKnowledgeItem['kind']
    title: string
    body: string
    wing?: string
    room?: string
    source_type: string
    source_ref: string
    tags?: string[]
    metadata?: Record<string, unknown>
    rank_score?: number
  }): number {
    const db = this.getDb()
    const canonicalProfile = this.getCanonicalEmbeddingProfile()
    db.prepare(
      `INSERT INTO compiled_knowledge_items (
        kind, title, body, wing, room, source_type, source_ref, tags_json, metadata_json, embedding_profile, rank_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(kind, source_type, source_ref) DO UPDATE SET
        title=excluded.title,
        body=excluded.body,
        wing=excluded.wing,
        room=excluded.room,
        tags_json=excluded.tags_json,
        metadata_json=excluded.metadata_json,
        embedding_profile=excluded.embedding_profile,
        rank_score=excluded.rank_score,
        updated_at=datetime('now')`,
    ).run(
      input.kind,
      input.title,
      input.body,
      input.wing ?? '',
      input.room ?? '',
      input.source_type,
      input.source_ref,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      canonicalProfile?.profile_name ?? null,
      input.rank_score ?? 0.5,
    )

    const row = db.prepare(
      `SELECT * FROM compiled_knowledge_items
       WHERE kind = ? AND source_type = ? AND source_ref = ?`,
    ).get(input.kind, input.source_type, input.source_ref) as Record<string, unknown>

    if (row) {
      db.prepare('DELETE FROM compiled_knowledge_fts WHERE rowid = ?').run(Number(row.id))
      try {
        db.prepare(
          'INSERT INTO compiled_knowledge_fts(rowid, title, body, kind, wing, room, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          Number(row.id),
          input.title,
          input.body,
          input.kind,
          input.wing ?? '',
          input.room ?? '',
          input.source_ref,
        )
      } catch {}
    }

    this.eventBus.fire(HeartEvent.COMPILED_KNOWLEDGE_UPDATED, {
      kind: input.kind,
      source_type: input.source_type,
      source_ref: input.source_ref,
    })

    return Number(row.id)
  }

  private normalizeProfile(row: Record<string, unknown>): EmbeddingProfile {
    return {
      profile_name: String(row.profile_name),
      slot_name: String(row.slot_name),
      provider_type: String(row.provider_type),
      api_base: String(row.api_base ?? ''),
      model_name: String(row.model_name ?? ''),
      dimensions: row.dimensions == null ? null : Number(row.dimensions),
      is_canonical: Number(row.is_canonical ?? 0) === 1,
      notes: String(row.notes ?? ''),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }
  }

  private normalizeCompiledItem(row: Record<string, unknown>): CompiledKnowledgeItem {
    return {
      id: Number(row.id),
      kind: row.kind as CompiledKnowledgeItem['kind'],
      title: String(row.title),
      body: String(row.body ?? ''),
      wing: String(row.wing ?? ''),
      room: String(row.room ?? ''),
      source_type: String(row.source_type ?? ''),
      source_ref: String(row.source_ref ?? ''),
      tags: this.parseJson<string[]>(row.tags_json as string, []),
      metadata: this.parseJson<Record<string, unknown>>(row.metadata_json as string, {}),
      embedding_profile: row.embedding_profile == null ? null : String(row.embedding_profile),
      rank_score: Number(row.rank_score ?? 0.5),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }
  }

  private normalizeGraphNode(row: Record<string, unknown>): GraphNode {
    return {
      id: String(row.id),
      type: String(row.type),
      label: String(row.label),
      scope: String(row.scope ?? ''),
      embedding_ref: String(row.embedding_ref ?? ''),
      metadata: this.parseJson<Record<string, unknown>>(String(row.metadata_json ?? '{}'), {}),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }
  }

  private normalizeGraphEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: Number(row.id),
      from_node_id: String(row.from_node_id),
      to_node_id: String(row.to_node_id),
      relation: String(row.relation),
      weight: Number(row.weight ?? 1),
      confidence: Number(row.confidence ?? 1),
      valid_from: String(row.valid_from ?? ''),
      valid_to: row.valid_to == null ? null : String(row.valid_to),
      source_type: String(row.source_type ?? ''),
      source_ref: String(row.source_ref ?? ''),
      metadata: this.parseJson<Record<string, unknown>>(String(row.metadata_json ?? '{}'), {}),
      created_at: String(row.created_at ?? ''),
      updated_at: String(row.updated_at ?? ''),
    }
  }

  private readEntityContent(entity: Record<string, unknown>): string {
    const properties = this.parseJson<Record<string, unknown>>(entity.properties_json as string, {})
    if (typeof properties.content === 'string' && properties.content) {
      return properties.content
    }
    return String(entity.name ?? '')
  }

  private generateEntityId(type: string, wing: string, room: string, content: string): string {
    const hash = this.simpleHash(content)
    return [type, wing, room, String(hash)].filter(Boolean).join('.')
  }

  private simpleHash(input: string): number {
    let hash = 0
    for (let index = 0; index < input.length; index += 1) {
      hash = ((hash << 5) - hash) + input.charCodeAt(index)
      hash |= 0
    }
    return Math.abs(hash) % 100000
  }

  private extractAndWriteTriples(entityId: string, content: string, metadata: MemoryMetadata): void {
    const patterns: Array<{ regex: RegExp; predicate: string; subjectIndex: number; objectIndex: number }> = [
      { regex: /(\S+)\s+(?:is in|located in)\s+(\S+)/i, predicate: 'located_in', subjectIndex: 1, objectIndex: 2 },
      { regex: /(\S+)\s+(?:belongs to|for)\s+(\S+)/i, predicate: 'belongs_to', subjectIndex: 1, objectIndex: 2 },
      { regex: /(\S+)\s+(?:connects to|paired with)\s+(\S+)/i, predicate: 'connected_to', subjectIndex: 1, objectIndex: 2 },
    ]

    for (const pattern of patterns) {
      const match = content.match(pattern.regex)
      if (!match) continue

      const subjectName = match[pattern.subjectIndex]?.trim()
      const objectName = match[pattern.objectIndex]?.trim()
      if (!subjectName || !objectName) continue

      const subjectId = this.ensureEntity(subjectName, metadata.type, metadata.wing, metadata.room)
      const objectId = this.ensureEntity(objectName, 'concept', metadata.wing, metadata.room)

      this.repo.insertTriple({
        subject: subjectId,
        predicate: pattern.predicate,
        object: objectId,
        confidence: metadata.confidence ?? 1.0,
        source: metadata.source ?? '',
        sourceFile: metadata.source_file ?? '',
      })
      break
    }

    if (content.includes('TV') || content.toLowerCase().includes('bilibili')) {
      this.repo.upsertAttribute({ entityId, key: 'media_related', value: 'true' })
    }
  }

  private extractAndWriteAttributes(entityId: string, content: string): void {
    const pairs: Array<{ key: string; test: RegExp }> = [
      { key: 'supports_power', test: /power|on\/off|turn on|turn off/i },
      { key: 'supports_remote', test: /remote|ir|infrared/i },
      { key: 'supports_adb', test: /adb|android tv|package/i },
      { key: 'supports_bilibili', test: /bilibili|b站|xiaodianshi/i },
    ]

    for (const pair of pairs) {
      if (!pair.test.test(content)) continue
      this.repo.upsertAttribute({ entityId, key: pair.key, value: 'true' })
    }
  }

  private ensureEntity(name: string, type: string, wing: string, room: string): string {
    const id = this.generateEntityId(type, wing, room, name)
    const existing = this.repo.getEntityById(id)
    if (!existing) {
      this.repo.upsertEntity({ id, name, type, wing, room, propertiesJson: '{}' })
    }
    return id
  }

  private parseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }

  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

export function semanticKindBoost(kind: string, wing: string): number {
  if (kind === 'compiled_plan') return 0.08
  if (kind === 'workflow_candidate') return 0.05
  if (kind === 'experience_note') return 0.02
  if (kind === 'wiki_page' && wing === 'runtime_observations') return -0.03
  return 0
}

export const memoryKernel = new MemoryKernelService()
