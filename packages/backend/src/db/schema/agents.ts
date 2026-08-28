import type Database from 'better-sqlite3'

/**
 * Schema module: agents
 * Agent instances (profile / surface / status).
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy agents into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS agent_instances (
      id INTEGER NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
      profile TEXT NOT NULL CHECK (profile IN ('entertainment','productivity','maintainer','remote_bot')) DEFAULT 'entertainment',
      surface TEXT NOT NULL CHECK (surface IN ('chat','studio','scheduler','remote')) DEFAULT 'chat',
      memory_scope TEXT NOT NULL DEFAULT 'home',
      tool_scope_json TEXT NOT NULL DEFAULT '[]', permissions_json TEXT NOT NULL DEFAULT '{}',
      default_channel TEXT NOT NULL DEFAULT 'web',
      status TEXT NOT NULL CHECK (status IN ('active','paused','archived')) DEFAULT 'active',
      extra_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT), UNIQUE (slug)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_agent_instances_profile ON agent_instances(profile)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_instances_surface ON agent_instances(surface)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for agents.
}
