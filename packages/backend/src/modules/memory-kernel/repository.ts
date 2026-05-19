import { getDb as defaultGetDb } from '../../db/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface MemoryEntityRow {
  id: string
  name: string
  type: string
  wing: string
  room: string
  properties_json: string
  created_at: string
  updated_at: string
}

export interface MemoryAttributeRow {
  entity_id: string
  key: string
  value: string
  valid_from: string
  valid_to: string | null
}

export interface MemoryTripleRow {
  id: number
  subject: string
  predicate: string
  object: string
  valid_from: string
  valid_to: string | null
  confidence: number
  source: string
  source_file: string
  created_at: string
}

export interface CompiledKnowledgeRow {
  id: number
  kind: string
  title: string
  body: string
  wing: string
  room: string
  source_type: string
  source_ref: string
  tags_json: string
  metadata_json: string
  embedding_profile: string | null
  rank_score: number
  created_at: string
  updated_at: string
}

export interface EmbeddingProfileRow {
  profile_name: string
  slot_name: string
  provider_type: string
  api_base: string
  model_name: string
  dimensions: number | null
  is_canonical: number
  notes: string
  created_at: string
  updated_at: string
}

export interface MemoryRepository {
  // entities
  upsertEntity(input: {
    id: string
    name: string
    type: string
    wing: string
    room: string
    propertiesJson: string
  }): void
  getEntityById(id: string): MemoryEntityRow | undefined
  countEntities(): number
  countEntitiesByWing(wing: string): number
  listEntities(filters: { wing?: string; room?: string; limit?: number }): MemoryEntityRow[]
  searchEntitiesByLike(keywords: string[], limit: number): MemoryEntityRow[]
  searchObservationEntitiesByName(keywords: string[], limit: number): MemoryEntityRow[]

  // attributes
  upsertAttribute(input: { entityId: string; key: string; value: string }): void
  getCurrentAttribute(entityId: string, key: string): MemoryAttributeRow | undefined
  listCurrentAttributesByEntity(entityId: string): MemoryAttributeRow[]

  // triples
  insertTriple(input: {
    subject: string
    predicate: string
    object: string
    confidence: number
    source: string
    sourceFile: string
  }): void
  listCurrentTriplesByEntity(entityId: string): Array<MemoryTripleRow & { subject_name?: string; object_name?: string }>
  searchTriplesByPredicateLike(keyword: string, limit: number): Array<MemoryTripleRow & { subject_name: string; object_name: string }>
  listAllCurrentTriples(): MemoryTripleRow[]

  // compiled knowledge
  upsertCompiledKnowledge(input: {
    kind: string
    title: string
    body: string
    wing: string
    room: string
    sourceType: string
    sourceRef: string
    tagsJson: string
    metadataJson: string
    embeddingProfile: string | null
    rankScore: number
  }): number
  getCompiledKnowledgeBySource(kind: string, sourceType: string, sourceRef: string): CompiledKnowledgeRow | undefined
  getCompiledKnowledgeById(id: number): CompiledKnowledgeRow | undefined
  listCompiledKnowledge(filters: { kind?: string; wing?: string; room?: string; limit?: number }): CompiledKnowledgeRow[]
  listCompiledKnowledgeForRebuild(limit: number): CompiledKnowledgeRow[]
  countCompiledKnowledge(): number
  deleteCompiledKnowledgeFts(rowid: number): void
  insertCompiledKnowledgeFts(input: {
    rowid: number
    title: string
    body: string
    kind: string
    wing: string
    room: string
    sourceRef: string
  }): void

  // FTS searches
  searchCompiledKnowledgeFts(query: string, limit: number): Array<{
    rowid: number
    title: string
    body: string
    kind: string
    wing: string
    room: string
    source_ref: string
    rank: number
  }>
  searchExperienceFts(query: string, limit: number): Array<{
    rowid: number
    title: string
    content: string
    category: string
    rank: number
  }>
  insertExperienceFts(input: { title: string; content: string; category: string }): void

  // embeddings
  upsertCompiledKnowledgeEmbedding(input: {
    knowledgeId: number
    profileName: string
    dimensions: number
    embeddingJson: string
  }): void
  listCompiledKnowledgeEmbeddingsWithItems(profileName: string): Array<{
    knowledge_id: number
    profile_name: string
    dimensions: number
    embedding_json: string
    title: string
    body: string
    kind: string
    wing: string
    room: string
  }>

  // embedding profiles
  getCanonicalEmbeddingProfile(): EmbeddingProfileRow | undefined
  upsertCanonicalEmbeddingProfile(input: {
    profileName: string
    slotName: string
    providerType: string
    apiBase: string
    modelName: string
    dimensions: number | null
    notes: string
  }): void
  updateCanonicalEmbeddingProfile(input: {
    profileName: string
    slotName: string
    providerType: string
    apiBase: string
    modelName: string
    dimensions: number | null
  }): void
  listEmbeddingProfiles(): EmbeddingProfileRow[]
}

export class SqlMemoryRepository implements MemoryRepository {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  // entities --------------------------------------------------------

  upsertEntity(input: {
    id: string
    name: string
    type: string
    wing: string
    room: string
    propertiesJson: string
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO memory_entities (id, name, type, wing, room, properties_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           type=excluded.type,
           wing=excluded.wing,
           room=excluded.room,
           properties_json=excluded.properties_json,
           updated_at=datetime('now')`,
      )
      .run(input.id, input.name, input.type, input.wing, input.room, input.propertiesJson)
  }

  getEntityById(id: string): MemoryEntityRow | undefined {
    return this.getDb().prepare('SELECT * FROM memory_entities WHERE id = ?').get(id) as MemoryEntityRow | undefined
  }

  countEntities(): number {
    const row = this.getDb().prepare('SELECT COUNT(*) AS count FROM memory_entities').get() as { count: number }
    return Number(row.count)
  }

  countEntitiesByWing(wing: string): number {
    const row = this.getDb().prepare('SELECT COUNT(*) AS count FROM memory_entities WHERE wing = ?').get(wing) as { count: number }
    return Number(row.count)
  }

  listEntities(filters: { wing?: string; room?: string; limit?: number }): MemoryEntityRow[] {
    let sql = 'SELECT * FROM memory_entities'
    const params: unknown[] = []
    const conds: string[] = []
    if (filters.wing) {
      conds.push('wing = ?')
      params.push(filters.wing)
    }
    if (filters.room) {
      conds.push('room = ?')
      params.push(filters.room)
    }
    if (conds.length > 0) sql += ' WHERE ' + conds.join(' AND ')
    sql += ' ORDER BY updated_at DESC LIMIT ?'
    params.push(filters.limit ?? 50)
    return this.getDb().prepare(sql).all(...params) as MemoryEntityRow[]
  }

  searchEntitiesByLike(keywords: string[], limit: number): MemoryEntityRow[] {
    if (keywords.length === 0) return []
    const conds = keywords.map(() => '(name LIKE ? OR wing LIKE ? OR room LIKE ?)').join(' OR ')
    const params: unknown[] = []
    for (const k of keywords) params.push(`%${k}%`, `%${k}%`, `%${k}%`)
    params.push(limit)
    return this.getDb().prepare(`SELECT * FROM memory_entities WHERE ${conds} LIMIT ?`).all(...params) as MemoryEntityRow[]
  }

  searchObservationEntitiesByName(keywords: string[], limit: number): MemoryEntityRow[] {
    if (keywords.length === 0) return []
    const likes = keywords.map(() => 'name LIKE ?').join(' OR ')
    const params: unknown[] = keywords.map((k) => `%${k}%`)
    params.push(limit)
    return this.getDb()
      .prepare(`SELECT * FROM memory_entities WHERE wing = 'runtime_observations' AND (${likes}) ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as MemoryEntityRow[]
  }

  // attributes ------------------------------------------------------

  upsertAttribute(input: { entityId: string; key: string; value: string }): void {
    this.getDb()
      .prepare(
        `INSERT INTO memory_attributes (entity_id, key, value)
         VALUES (?, ?, ?)
         ON CONFLICT(entity_id, key, valid_from) DO UPDATE SET value=excluded.value`,
      )
      .run(input.entityId, input.key, input.value)
  }

  getCurrentAttribute(entityId: string, key: string): MemoryAttributeRow | undefined {
    return this.getDb()
      .prepare('SELECT * FROM memory_attributes WHERE entity_id = ? AND key = ? AND valid_to IS NULL LIMIT 1')
      .get(entityId, key) as MemoryAttributeRow | undefined
  }

  listCurrentAttributesByEntity(entityId: string): MemoryAttributeRow[] {
    return this.getDb()
      .prepare('SELECT * FROM memory_attributes WHERE entity_id = ? AND valid_to IS NULL')
      .all(entityId) as MemoryAttributeRow[]
  }

  // triples ---------------------------------------------------------

  insertTriple(input: {
    subject: string
    predicate: string
    object: string
    confidence: number
    source: string
    sourceFile: string
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO memory_triples (subject, predicate, object, confidence, source, source_file)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.subject, input.predicate, input.object, input.confidence, input.source, input.sourceFile)
  }

  listCurrentTriplesByEntity(entityId: string): Array<MemoryTripleRow & { subject_name?: string; object_name?: string }> {
    return this.getDb()
      .prepare(
        `SELECT * FROM memory_triples
         WHERE (subject = ? OR object = ?) AND valid_to IS NULL
         ORDER BY confidence DESC`,
      )
      .all(entityId, entityId) as Array<MemoryTripleRow>
  }

  searchTriplesByPredicateLike(
    keyword: string,
    limit: number,
  ): Array<MemoryTripleRow & { subject_name: string; object_name: string }> {
    return this.getDb()
      .prepare(
        `SELECT t.*, s.name AS subject_name, o.name AS object_name
         FROM memory_triples t
         JOIN memory_entities s ON t.subject = s.id
         JOIN memory_entities o ON t.object = o.id
         WHERE t.predicate LIKE ? AND t.valid_to IS NULL
         LIMIT ?`,
      )
      .all(`%${keyword}%`, limit) as Array<MemoryTripleRow & { subject_name: string; object_name: string }>
  }

  listAllCurrentTriples(): MemoryTripleRow[] {
    return this.getDb()
      .prepare('SELECT * FROM memory_triples WHERE valid_to IS NULL')
      .all() as MemoryTripleRow[]
  }

  // compiled knowledge ---------------------------------------------

  upsertCompiledKnowledge(input: {
    kind: string
    title: string
    body: string
    wing: string
    room: string
    sourceType: string
    sourceRef: string
    tagsJson: string
    metadataJson: string
    embeddingProfile: string | null
    rankScore: number
  }): number {
    this.getDb()
      .prepare(
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
      )
      .run(
        input.kind,
        input.title,
        input.body,
        input.wing,
        input.room,
        input.sourceType,
        input.sourceRef,
        input.tagsJson,
        input.metadataJson,
        input.embeddingProfile,
        input.rankScore,
      )

    const row = this.getCompiledKnowledgeBySource(input.kind, input.sourceType, input.sourceRef)
    return row ? Number(row.id) : 0
  }

  getCompiledKnowledgeBySource(kind: string, sourceType: string, sourceRef: string): CompiledKnowledgeRow | undefined {
    return this.getDb()
      .prepare('SELECT * FROM compiled_knowledge_items WHERE kind = ? AND source_type = ? AND source_ref = ?')
      .get(kind, sourceType, sourceRef) as CompiledKnowledgeRow | undefined
  }

  getCompiledKnowledgeById(id: number): CompiledKnowledgeRow | undefined {
    return this.getDb()
      .prepare('SELECT * FROM compiled_knowledge_items WHERE id = ? LIMIT 1')
      .get(id) as CompiledKnowledgeRow | undefined
  }

  listCompiledKnowledge(filters: { kind?: string; wing?: string; room?: string; limit?: number }): CompiledKnowledgeRow[] {
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
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(filters.limit ?? 50)
    return this.getDb()
      .prepare(`SELECT * FROM compiled_knowledge_items ${where} ORDER BY rank_score DESC, updated_at DESC LIMIT ?`)
      .all(...params) as CompiledKnowledgeRow[]
  }

  listCompiledKnowledgeForRebuild(limit: number): CompiledKnowledgeRow[] {
    return this.getDb()
      .prepare('SELECT * FROM compiled_knowledge_items ORDER BY rank_score DESC, updated_at DESC LIMIT ?')
      .all(limit) as CompiledKnowledgeRow[]
  }

  countCompiledKnowledge(): number {
    const row = this.getDb().prepare('SELECT COUNT(*) AS count FROM compiled_knowledge_items').get() as { count: number }
    return Number(row.count)
  }

  deleteCompiledKnowledgeFts(rowid: number): void {
    try {
      this.getDb().prepare('DELETE FROM compiled_knowledge_fts WHERE rowid = ?').run(rowid)
    } catch {}
  }

  insertCompiledKnowledgeFts(input: {
    rowid: number
    title: string
    body: string
    kind: string
    wing: string
    room: string
    sourceRef: string
  }): void {
    try {
      this.getDb()
        .prepare(
          'INSERT INTO compiled_knowledge_fts(rowid, title, body, kind, wing, room, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(input.rowid, input.title, input.body, input.kind, input.wing, input.room, input.sourceRef)
    } catch {}
  }

  // FTS -------------------------------------------------------------

  searchCompiledKnowledgeFts(query: string, limit: number) {
    try {
      return this.getDb()
        .prepare(
          `SELECT rowid, title, body, kind, wing, room, source_ref, rank
           FROM compiled_knowledge_fts
           WHERE compiled_knowledge_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{
        rowid: number
        title: string
        body: string
        kind: string
        wing: string
        room: string
        source_ref: string
        rank: number
      }>
    } catch {
      return []
    }
  }

  searchExperienceFts(query: string, limit: number) {
    try {
      return this.getDb()
        .prepare(
          `SELECT rowid, title, content, category, rank
           FROM experiences_fts
           WHERE experiences_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{ rowid: number; title: string; content: string; category: string; rank: number }>
    } catch {
      return []
    }
  }

  insertExperienceFts(input: { title: string; content: string; category: string }): void {
    try {
      this.getDb()
        .prepare('INSERT INTO experiences_fts (title, content, category) VALUES (?, ?, ?)')
        .run(input.title, input.content, input.category)
    } catch {}
  }

  // embeddings ------------------------------------------------------

  upsertCompiledKnowledgeEmbedding(input: {
    knowledgeId: number
    profileName: string
    dimensions: number
    embeddingJson: string
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO compiled_knowledge_embeddings (
          knowledge_id, profile_name, dimensions, embedding_json
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(knowledge_id, profile_name) DO UPDATE SET
          dimensions=excluded.dimensions,
          embedding_json=excluded.embedding_json,
          updated_at=datetime('now')`,
      )
      .run(input.knowledgeId, input.profileName, input.dimensions, input.embeddingJson)
  }

  listCompiledKnowledgeEmbeddingsWithItems(profileName: string) {
    return this.getDb()
      .prepare(
        `SELECT e.knowledge_id, e.profile_name, e.dimensions, e.embedding_json,
                c.title, c.body, c.kind, c.wing, c.room
         FROM compiled_knowledge_embeddings e
         JOIN compiled_knowledge_items c ON c.id = e.knowledge_id
         WHERE e.profile_name = ?`,
      )
      .all(profileName) as Array<{
      knowledge_id: number
      profile_name: string
      dimensions: number
      embedding_json: string
      title: string
      body: string
      kind: string
      wing: string
      room: string
    }>
  }

  // embedding profiles ---------------------------------------------

  getCanonicalEmbeddingProfile(): EmbeddingProfileRow | undefined {
    return this.getDb()
      .prepare('SELECT * FROM embedding_profiles WHERE is_canonical = 1 LIMIT 1')
      .get() as EmbeddingProfileRow | undefined
  }

  upsertCanonicalEmbeddingProfile(input: {
    profileName: string
    slotName: string
    providerType: string
    apiBase: string
    modelName: string
    dimensions: number | null
    notes: string
  }): void {
    this.getDb()
      .prepare(
        `INSERT INTO embedding_profiles (
          profile_name, slot_name, provider_type, api_base, model_name, dimensions, is_canonical, notes
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.profileName,
        input.slotName,
        input.providerType,
        input.apiBase,
        input.modelName,
        input.dimensions,
        input.notes,
      )
  }

  updateCanonicalEmbeddingProfile(input: {
    profileName: string
    slotName: string
    providerType: string
    apiBase: string
    modelName: string
    dimensions: number | null
  }): void {
    this.getDb()
      .prepare(
        `UPDATE embedding_profiles
         SET slot_name = ?, provider_type = ?, api_base = ?, model_name = ?, dimensions = ?, updated_at = datetime('now')
         WHERE profile_name = ?`,
      )
      .run(input.slotName, input.providerType, input.apiBase, input.modelName, input.dimensions, input.profileName)
  }

  listEmbeddingProfiles(): EmbeddingProfileRow[] {
    return this.getDb()
      .prepare('SELECT * FROM embedding_profiles ORDER BY is_canonical DESC, profile_name ASC')
      .all() as EmbeddingProfileRow[]
  }
}
