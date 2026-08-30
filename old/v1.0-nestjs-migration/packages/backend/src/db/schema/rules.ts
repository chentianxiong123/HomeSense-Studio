import type Database from 'better-sqlite3'

/**
 * Schema module: rules
 * Rules, rule actions, compensation tasks.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy rules into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS compensation_tasks (
      id INTEGER NOT NULL, type TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
      retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
      next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
      state TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed')) DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS rule_actions (
      id INTEGER NOT NULL, rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      tool TEXT NOT NULL, action TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS rules (
      id INTEGER NOT NULL, trigger_pattern TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_compensation_tasks_next_retry ON compensation_tasks(next_retry_at)`,
  `CREATE INDEX IF NOT EXISTS idx_compensation_tasks_state ON compensation_tasks(state)`,
  `CREATE INDEX IF NOT EXISTS idx_rule_actions_rule_id ON rule_actions(rule_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for rules.
}
