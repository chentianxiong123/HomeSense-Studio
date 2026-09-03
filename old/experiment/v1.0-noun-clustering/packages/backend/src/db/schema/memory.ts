import type Database from 'better-sqlite3'

/**
 * Schema module: memory
 * Memory entities, triples, attributes, items. Includes items FTS.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy memory into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS memory_attributes (
      entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      key TEXT NOT NULL, value TEXT NOT NULL,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT NULL,
      PRIMARY KEY (entity_id, key, valid_from)
    )`,
  `CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('person','device','room','concept','skill')),
      wing TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '',
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    )`,
  `CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('experience_path','feedback','device_preference','spatial_node','spatial_edge','knowledge_chunk')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL CHECK (scope IN ('global','room','device','conversation','user')) DEFAULT 'global',
      room_id INTEGER NULL REFERENCES rooms(id) ON DELETE SET NULL,
      device_id INTEGER NULL REFERENCES user_devices(id) ON DELETE SET NULL,
      conversation_id INTEGER NULL REFERENCES conversations(id) ON DELETE SET NULL,
      source TEXT NOT NULL CHECK (source IN ('user','runtime','imported','legacy','system')) DEFAULT 'runtime',
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL CHECK (status IN ('active','draft','archived','expired')) DEFAULT 'active',
      priority REAL NOT NULL DEFAULT 0.5,
      expires_at TEXT NULL,
      last_used_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id)
    )`,
  `CREATE TABLE IF NOT EXISTS memory_triples (
      id INTEGER NOT NULL, subject TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL, object TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT NULL,
      confidence REAL NOT NULL DEFAULT 1.0, source TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(id UNINDEXED, title, summary, search_text, kind, source)`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_memory_attributes_entity_id ON memory_attributes(entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_attributes_key ON memory_attributes(key)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(type)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_entities_wing_room ON memory_entities(wing, room)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_kind ON memory_items(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_last_used ON memory_items(last_used_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_priority ON memory_items(priority DESC, confidence DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_scope ON memory_items(scope, room_id, device_id, conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_source ON memory_items(source)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_triples_object ON memory_triples(object)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_triples_predicate ON memory_triples(predicate)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_triples_subject ON memory_triples(subject)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_triples_valid ON memory_triples(subject, predicate, object, valid_from)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for memory.
}
