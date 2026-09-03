import type Database from 'better-sqlite3'

/**
 * Schema module: knowledge
 * Experiences, memory_experience_paths, compiled knowledge items and embeddings. Includes FTS.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy knowledge into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS compiled_knowledge_embeddings (
      knowledge_id INTEGER NOT NULL REFERENCES compiled_knowledge_items(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL REFERENCES embedding_profiles(profile_name) ON DELETE CASCADE,
      dimensions INTEGER NOT NULL DEFAULT 0,
      embedding_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (knowledge_id, profile_name)
    )`,
  `CREATE TABLE IF NOT EXISTS compiled_knowledge_items (
      id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('wiki_page','compiled_plan','experience_note','skill_candidate','rule_candidate','workflow_candidate')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      wing TEXT NOT NULL DEFAULT '',
      room TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      embedding_profile TEXT NULL REFERENCES embedding_profiles(profile_name) ON DELETE SET NULL,
      rank_score REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      file_path TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS memory_experience_paths (
      memory_item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      intent_pattern TEXT NOT NULL DEFAULT '',
      preconditions_json TEXT NOT NULL DEFAULT '{}',
      steps_json TEXT NOT NULL DEFAULT '[]',
      success_criteria_json TEXT NOT NULL DEFAULT '{}',
      failure_recovery_json TEXT NOT NULL DEFAULT '[]',
      origin_trace_id TEXT NOT NULL DEFAULT '',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT NULL, skill_refs_json TEXT NOT NULL DEFAULT '[]', device_refs_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (memory_item_id)
    )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS compiled_knowledge_fts USING fts5(title, body, kind, wing, room, source_ref)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(title, content, category)`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_embeddings_profile ON compiled_knowledge_embeddings(profile_name)`,
  `CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_kind ON compiled_knowledge_items(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_source ON compiled_knowledge_items(source_type, source_ref)`,
  `CREATE UNIQUE INDEX idx_compiled_knowledge_unique ON compiled_knowledge_items(kind, source_type, source_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_wing_room ON compiled_knowledge_items(wing, room)`,
  `CREATE INDEX IF NOT EXISTS idx_experiences_category ON experiences(category)`,
  `CREATE UNIQUE INDEX idx_experiences_content_hash ON experiences(content_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_experiences_importance ON experiences(importance)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_experience_paths_intent ON memory_experience_paths(intent_pattern)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for knowledge.
}
