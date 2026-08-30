import { getDb as defaultGetDb } from '../../db/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface CompilerEntityRow {
  id: string
  name: string
  type: string
  wing: string
  room: string
  properties_json: string
  updated_at: string
}

export interface CompilerExperienceRow {
  id: number
  category: string
  title: string
  file_path: string
  importance: number
}

export interface CompilerWorkflowRow {
  id: number
  name: string
  description: string
  graph_json: string
  trigger_type: string
  published: number
  updated_at: string
}

export interface CompilerExperiencePathRow {
  id: string
  title: string
  summary: string
  intent_pattern: string | null
  steps_json: string | null
  confidence: number
  source: string
  metadata_json: string
  success_count: number
  failure_count: number
  updated_at: string
}

export interface KnowledgeCompilerRepository {
  listAllEntities(): CompilerEntityRow[]
  listAttributesForEntity(entityId: string): Array<{ key: string; value: string }>
  listTriplesForEntity(entityId: string, limit: number): Array<{ predicate: string; subject_name: string; object_name: string }>
  listAllExperiencesByImportance(): CompilerExperienceRow[]
  listExperiencesAboveImportance(threshold: number): CompilerExperienceRow[]
  listAllWorkflows(): CompilerWorkflowRow[]
  listActiveExperiencePaths(limit: number): CompilerExperiencePathRow[]
}

export class SqlKnowledgeCompilerRepository implements KnowledgeCompilerRepository {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  listAllEntities(): CompilerEntityRow[] {
    return this.getDb()
      .prepare('SELECT * FROM memory_entities ORDER BY updated_at DESC')
      .all() as CompilerEntityRow[]
  }

  listAttributesForEntity(entityId: string): Array<{ key: string; value: string }> {
    return this.getDb()
      .prepare(
        'SELECT key, value FROM memory_attributes WHERE entity_id = ? AND valid_to IS NULL ORDER BY key ASC',
      )
      .all(entityId) as Array<{ key: string; value: string }>
  }

  listTriplesForEntity(entityId: string, limit: number) {
    return this.getDb()
      .prepare(
        `SELECT t.predicate, s.name AS subject_name, o.name AS object_name
         FROM memory_triples t
         JOIN memory_entities s ON s.id = t.subject
         JOIN memory_entities o ON o.id = t.object
         WHERE (t.subject = ? OR t.object = ?) AND t.valid_to IS NULL
         ORDER BY t.confidence DESC
         LIMIT ?`,
      )
      .all(entityId, entityId, limit) as Array<{ predicate: string; subject_name: string; object_name: string }>
  }

  listAllExperiencesByImportance(): CompilerExperienceRow[] {
    return this.getDb()
      .prepare('SELECT * FROM experiences ORDER BY importance DESC, created_at DESC')
      .all() as CompilerExperienceRow[]
  }

  listExperiencesAboveImportance(threshold: number): CompilerExperienceRow[] {
    return this.getDb()
      .prepare('SELECT * FROM experiences WHERE importance >= ? ORDER BY importance DESC, created_at DESC')
      .all(threshold) as CompilerExperienceRow[]
  }

  listAllWorkflows(): CompilerWorkflowRow[] {
    return this.getDb()
      .prepare('SELECT * FROM workflows ORDER BY published DESC, updated_at DESC')
      .all() as CompilerWorkflowRow[]
  }

  listActiveExperiencePaths(limit: number): CompilerExperiencePathRow[] {
    return this.getDb()
      .prepare(`
        SELECT m.id, m.title, m.summary, m.confidence, m.source, m.metadata_json, m.updated_at,
               p.intent_pattern, p.steps_json, p.success_count, p.failure_count
        FROM memory_items m
        JOIN memory_experience_paths p ON p.memory_item_id = m.id
        WHERE m.kind = 'experience_path' AND m.status = 'active'
        ORDER BY p.success_count DESC, m.confidence DESC, m.updated_at DESC
        LIMIT ?
      `)
      .all(limit) as CompilerExperiencePathRow[]
  }
}
