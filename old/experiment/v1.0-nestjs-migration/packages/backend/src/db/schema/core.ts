import type Database from 'better-sqlite3'

/**
 * Schema module: core
 * Settings, rooms, and per-user context.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy core into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT 'null',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (key)
    )`,
  `CREATE TABLE IF NOT EXISTS user_context (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
]

export const indexes: string[] = []

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for core.
}
