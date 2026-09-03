import type Database from 'better-sqlite3'

/**
 * Schema module: llm
 * LLM providers, models, model slots, embedding profiles.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy llm into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS embedding_profiles (
      profile_name TEXT NOT NULL,
      slot_name TEXT NOT NULL DEFAULT 'embedding',
      provider_type TEXT NOT NULL CHECK (provider_type IN ('openai','deepseek','ollama','mimo','custom','disabled')) DEFAULT 'openai',
      api_base TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NULL,
      is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0,1)),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (profile_name)
    )`,
  `CREATE TABLE IF NOT EXISTS llm_model_slots (
      slot_name TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK (provider_type IN ('openai','deepseek','ollama','mimo','custom','disabled')) DEFAULT 'openai',
      api_base TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      dimensions INTEGER NULL,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      extra_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (slot_name)
    )`,
  `CREATE TABLE IF NOT EXISTS "llm_models" (
        id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        model_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat', 'embedding', 'rerank', 'vision')),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (id AUTOINCREMENT)
      )`,
  `CREATE TABLE IF NOT EXISTS "llm_providers" (
        id INTEGER NOT NULL, name TEXT NOT NULL,
        api_base TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat','embedding','rerank','vision')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        extra_config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (id AUTOINCREMENT)
      )`,
  `CREATE TABLE IF NOT EXISTS llm_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER,
      provider_id INTEGER,
      provider_name TEXT NOT NULL DEFAULT '',
      model_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'chat',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
]

export const indexes: string[] = [
  `CREATE UNIQUE INDEX idx_embedding_profiles_canonical ON embedding_profiles(is_canonical) WHERE is_canonical = 1`,
  `CREATE INDEX IF NOT EXISTS idx_embedding_profiles_slot ON embedding_profiles(slot_name)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_model_slots_enabled ON llm_model_slots(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_models_category ON llm_models(category)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_models_provider_id ON llm_models(provider_id)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON llm_providers(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_usage_log_created_at ON llm_usage_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_llm_usage_log_provider_id ON llm_usage_log(provider_id)`
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for llm.
}
