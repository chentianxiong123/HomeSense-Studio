import type Database from 'better-sqlite3'

/**
 * Schema module: chat
 * Conversations, sessions, messages.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy chat into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER NOT NULL, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL DEFAULT '', tool_calls_json TEXT NULL, tool_result_json TEXT NULL,
      tool_call_id TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS conversation_sessions (
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'web',
      user_id TEXT NOT NULL DEFAULT 'local',
      agent_instance_id INTEGER NULL REFERENCES agent_instances(id) ON DELETE SET NULL,
      working_context_json TEXT NOT NULL DEFAULT '{}',
      pending_task_id TEXT NULL,
      last_intent TEXT NOT NULL DEFAULT '',
      last_plan_id TEXT NULL,
      last_trace_id TEXT NULL,
      summary TEXT NOT NULL DEFAULT '',
      expires_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id)
    )`,
  `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_id ON conversation_messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_sessions_agent ON conversation_sessions(agent_instance_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_sessions_channel ON conversation_sessions(channel)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_sessions_expires_at ON conversation_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for chat.
}
