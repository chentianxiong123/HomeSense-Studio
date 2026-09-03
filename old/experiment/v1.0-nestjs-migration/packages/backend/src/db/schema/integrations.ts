import type Database from 'better-sqlite3'

/**
 * Schema module: integrations
 * External capability sources (HTTP / CLI / local services).
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy integrations into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS external_integrations (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('http','cli','local_service','webhook')) DEFAULT 'http',
      endpoint TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      capability_ids_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (name)
    )`,
]

export const indexes: string[] = []

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for integrations.
}
