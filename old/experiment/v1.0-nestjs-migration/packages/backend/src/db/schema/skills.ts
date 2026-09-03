import type Database from 'better-sqlite3'

/**
 * Schema module: skills
 * Skills (md-based playbooks) and MCP server registry.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy skills into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('stdio','http','sse','websocket')) DEFAULT 'stdio',
      endpoint TEXT NOT NULL DEFAULT '',
      command TEXT NOT NULL DEFAULT '',
      args_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      tools_json TEXT NOT NULL DEFAULT '[]',
      auth_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (name)
    )`,
  `CREATE TABLE IF NOT EXISTS skills (
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', prompt_template TEXT NOT NULL DEFAULT '',
      allowed_tools_json TEXT NOT NULL DEFAULT '[]', action_schema_json TEXT NOT NULL DEFAULT '[]',
      context_mode TEXT NOT NULL CHECK (context_mode IN ('inline','fork')) DEFAULT 'inline',
      source TEXT NOT NULL CHECK (source IN ('builtin','disk','converted')) DEFAULT 'builtin',
      skill_root TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (name)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_servers_transport ON mcp_servers(transport)`,
  `CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for skills.
}
