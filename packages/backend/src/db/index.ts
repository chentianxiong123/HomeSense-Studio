import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { computeWorkflowGraphHash } from '../modules/workflow/graph-version.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB_PATH = path.resolve(MODULE_DIR, '../../../../data/homesense.db')
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function initDb(): Database.Database {
  if (db) return db

  const resolvedPath = path.resolve(DB_PATH)
  const dir = path.dirname(resolvedPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  applySchema(db)

  return db
}

export function applySchema(target: Database.Database): void {
  createTables(target)
}

export function createInMemoryDb(): Database.Database {
  const memoryDb = new Database(':memory:')
  memoryDb.pragma('foreign_keys = ON')
  applySchema(memoryDb)
  return memoryDb
}

import * as Agents from './schema/agents.js'
import * as Chat from './schema/chat.js'
import * as Core from './schema/core.js'
import * as Devices from './schema/devices.js'
import * as Graph from './schema/graph.js'
import * as Integrations from './schema/integrations.js'
import * as Knowledge from './schema/knowledge.js'
import * as LLM from './schema/llm.js'
import * as Memory from './schema/memory.js'
import * as Rules from './schema/rules.js'
import * as Skills from './schema/skills.js'
import * as Workflow from './schema/workflow.js'

const SCHEMAS = [Agents, Chat, Core, Devices, Graph, Integrations, Knowledge, LLM, Memory, Rules, Skills, Workflow]
function createTables(db: Database.Database) {
  for (const schema of SCHEMAS) {
    for (const sql of schema.tables) db.exec(sql)
  }
}
function runMigrations(db: Database.Database) {
  ensureColumns(db, 'memory_entities', [
    { name: 'wing', sql: "ALTER TABLE memory_entities ADD COLUMN wing TEXT NOT NULL DEFAULT ''" },
    { name: 'room', sql: "ALTER TABLE memory_entities ADD COLUMN room TEXT NOT NULL DEFAULT ''" },
  ])
  ensureColumns(db, 'conversation_messages', [
    { name: 'tool_call_id', sql: "ALTER TABLE conversation_messages ADD COLUMN tool_call_id TEXT NULL" },
  ])
  ensureColumns(db, 'workflows', [
    { name: 'graph_updated_at', sql: "ALTER TABLE workflows ADD COLUMN graph_updated_at TEXT NOT NULL DEFAULT ''" },
    { name: 'graph_hash', sql: "ALTER TABLE workflows ADD COLUMN graph_hash TEXT NOT NULL DEFAULT ''" },
  ])
  db.exec(`
    UPDATE workflows
    SET graph_updated_at = COALESCE(NULLIF(graph_updated_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''), datetime('now'))
    WHERE graph_updated_at = ''
  `)
  migrateWorkflowGraphHashes(db)
  ensureColumns(db, 'workflow_runs', [
    { name: 'inputs_json', sql: "ALTER TABLE workflow_runs ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '{}'" },
    { name: 'graph_hash', sql: "ALTER TABLE workflow_runs ADD COLUMN graph_hash TEXT NOT NULL DEFAULT ''" },
    { name: 'trace_json', sql: "ALTER TABLE workflow_runs ADD COLUMN trace_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'events_json', sql: "ALTER TABLE workflow_runs ADD COLUMN events_json TEXT NOT NULL DEFAULT '[]'" },
  ])
  ensureColumns(db, 'memory_experience_paths', [
    { name: 'skill_refs_json', sql: "ALTER TABLE memory_experience_paths ADD COLUMN skill_refs_json TEXT NOT NULL DEFAULT '[]'" },
    { name: 'device_refs_json', sql: "ALTER TABLE memory_experience_paths ADD COLUMN device_refs_json TEXT NOT NULL DEFAULT '[]'" },
  ])
  ensureColumns(db, 'llm_providers', [
    { name: 'category', sql: "ALTER TABLE llm_providers ADD COLUMN category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat', 'embedding', 'rerank', 'vision'))" },
  ])
  ensureColumns(db, 'graph_edges', [
    { name: 'confidence', sql: "ALTER TABLE graph_edges ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0" },
    { name: 'valid_from', sql: "ALTER TABLE graph_edges ADD COLUMN valid_from TEXT NOT NULL DEFAULT ''" },
    { name: 'valid_to', sql: "ALTER TABLE graph_edges ADD COLUMN valid_to TEXT NULL" },
    { name: 'source_type', sql: "ALTER TABLE graph_edges ADD COLUMN source_type TEXT NOT NULL DEFAULT ''" },
    { name: 'source_ref', sql: "ALTER TABLE graph_edges ADD COLUMN source_ref TEXT NOT NULL DEFAULT ''" },
  ])
  migrateWorkflowNodesTable(db)
  migrateLlmSlotsCheckConstraint(db)
  migrateLlmProvidersToNewSchema(db)
  migrateLlmProviderCategoryCheckConstraint(db)
  migrateDropDeprecatedTables(db)
  migrateDeviceCapabilities(db)
  migrateDeviceApps(db)
  migrateAppMap(db)
}

function migrateAppMap(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_map_screens (
      id INTEGER NOT NULL,
      package_name TEXT NOT NULL,
      screen_id TEXT NOT NULL DEFAULT '',
      activity TEXT NOT NULL DEFAULT '',
      screenshot_path TEXT NOT NULL DEFAULT '',
      resolution TEXT NOT NULL DEFAULT '',
      embedding_json TEXT NOT NULL DEFAULT '[]',
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (package_name, screen_id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_map_elements (
      id INTEGER NOT NULL,
      screen_id INTEGER NOT NULL REFERENCES app_map_screens(id) ON DELETE CASCADE,
      element_name TEXT NOT NULL,
      element_type TEXT NOT NULL DEFAULT 'button',
      bounds_json TEXT NOT NULL DEFAULT '{}',
      template_path TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'vision' CHECK (source IN ('vision','ui_tree','manual')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_app_map_screens_package ON app_map_screens(package_name)')
  ensureColumns(db, 'app_map_screens', [
    { name: 'embedding_json', sql: "ALTER TABLE app_map_screens ADD COLUMN embedding_json TEXT NOT NULL DEFAULT '[]'" },
  ])
  db.exec('CREATE INDEX IF NOT EXISTS idx_app_map_elements_screen ON app_map_elements(screen_id)')

  db.exec(`
    CREATE TABLE IF NOT EXISTS opencv_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_name TEXT NOT NULL,
      element_name TEXT NOT NULL,
      template_hash TEXT NOT NULL UNIQUE,
      template_path TEXT NOT NULL,
      bounds_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL DEFAULT 0.8,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_matched_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_opencv_templates_package ON opencv_templates(package_name)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_opencv_templates_element ON opencv_templates(element_name)')
}

function ensureColumns(
  db: Database.Database,
  tableName: string,
  columns: Array<{ name: string; sql: string }>,
) {
  const existing = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>

  if (existing.length === 0) return

  const existingNames = new Set(existing.map((column) => column.name))
  for (const column of columns) {
    if (!existingNames.has(column.name)) {
      db.exec(column.sql)
    }
  }
}

function migrateEntitiesTable(db: Database.Database) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entities'",
  ).get() as { sql?: string } | undefined
  const tableSql = row?.sql

  const requiredCapabilities = [
    'power','toggle','brightness','color_temperature','target_temperature',
    'mode','fan_speed','cover_position','pm2_5','temperature','humidity',
    'ir_keys','execute_directive',
  ]

  if (!tableSql || requiredCapabilities.every((capability) => tableSql.includes(`'${capability}'`))) return

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE entities_new (
        entity_id TEXT NOT NULL,
        device_did TEXT NOT NULL REFERENCES devices(did) ON DELETE CASCADE,
        domain TEXT NOT NULL CHECK (domain IN ('switch','sensor','select','remote','xiaoai','climate','light','fan','cover')),
        capability TEXT NOT NULL CHECK (capability IN ('power','toggle','brightness','color_temperature','target_temperature','mode','fan_speed','cover_position','pm2_5','temperature','humidity','ir_keys','execute_directive')),
        feature_id INTEGER NULL REFERENCES device_features(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        PRIMARY KEY (entity_id)
      )
    `)
    db.exec(`
      INSERT INTO entities_new (entity_id, device_did, domain, capability, feature_id, name, icon, enabled)
      SELECT entity_id, device_did, domain, capability, feature_id, name, icon, enabled
      FROM entities
    `)
    db.exec('DROP TABLE entities')
    db.exec('ALTER TABLE entities_new RENAME TO entities')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function migrateDropDeprecatedTables(db: Database.Database) {
  // Drop deprecated mi-cli cache tables that were never populated
  const deprecated = [
    'state_history',
    'entity_states',
    'entities',
    'device_features',
    'devices',
  ]
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const table of deprecated) {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table) as { name: string } | undefined
      if (row) {
        db.exec(`DROP TABLE IF EXISTS ${table}`)
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function migrateDeviceCapabilities(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_capabilities (
      mi_did TEXT NOT NULL,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      ir_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (mi_did)
    )
  `)
}

function migrateDeviceApps(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_apps (
      adb_ip TEXT NOT NULL,
      apps_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (adb_ip)
    )
  `)
}

function migrateWorkflowGraphHashes(db: Database.Database) {
  const rows = db.prepare(`
    SELECT id, graph_json, graph_hash
    FROM workflows
    WHERE COALESCE(graph_hash, '') = ''
  `).all() as Array<{ id: number; graph_json: string; graph_hash?: string }>

  for (const row of rows) {
    const graphHash = computeWorkflowGraphHash(row.graph_json || '{}')
    db.prepare('UPDATE workflows SET graph_hash = ? WHERE id = ?').run(graphHash, row.id)
  }
}

function migrateWorkflowNodesTable(db: Database.Database) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_nodes'",
  ).get() as { sql?: string } | undefined

  const tableSql = row?.sql
  const requiredNodeTypes = [
    'start','schedule','device_control','xiaoai','ir_control','scene_execute',
    'device_capability','llm','if_else','delay','parallel','code','answer','executor_call','subflow',
    'knowledge_retrieve','candidate_plan_resolve','rerank_score','agent_dispatch',
  ]

  if (!tableSql || requiredNodeTypes.every((type) => tableSql.includes(`'${type}'`))) return

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    db.exec(`
      CREATE TABLE workflow_nodes_new (
        id INTEGER NOT NULL,
        workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('start','schedule','device_control','xiaoai','ir_control','scene_execute','device_capability','llm','if_else','delay','parallel','code','answer','executor_call','subflow','knowledge_retrieve','candidate_plan_resolve','rerank_score','agent_dispatch')),
        position_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        label TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (id AUTOINCREMENT)
      )
    `)
    db.exec(`
      INSERT INTO workflow_nodes_new (id, workflow_id, type, position_json, config_json, label)
      SELECT id, workflow_id, type, position_json, config_json, label
      FROM workflow_nodes
    `)
    db.exec('DROP TABLE workflow_nodes')
    db.exec('ALTER TABLE workflow_nodes_new RENAME TO workflow_nodes')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function migrateLlmSlotsCheckConstraint(db: Database.Database) {
  const rows = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_model_slots'",
  ).all() as Array<{ name: string; sql: string }>

  for (const row of rows) {
    if (!row.sql.includes("'mimo'")) {
      const newSql = row.sql
        .replace(/CHECK\s*\([^)]*provider_type[^)]*\)/, (match) => {
          const fixed = match.replace(/IN\s*\([^)]+\)/, (m) =>
            m.replace(/'custom'/, "'custom','mimo'")
          )
          return fixed
        })
      db.exec(`ALTER TABLE ${row.name} RENAME TO ${row.name}_old`)
      db.exec(newSql)
      db.exec(`INSERT INTO ${row.name} SELECT * FROM ${row.name}_old`)
      db.exec(`DROP TABLE ${row.name}_old`)
    }
  }
}

function migrateLlmProvidersToNewSchema(db: Database.Database) {
  const existingCols = db.prepare("PRAGMA table_info('llm_providers')").all() as Array<{ name: string }>
  const hasProviderType = existingCols.some(c => c.name === 'provider_type')
  if (!hasProviderType) return // already migrated

  // Create new providers table
  db.exec(`ALTER TABLE llm_providers RENAME TO llm_providers_old`)
  db.exec(`CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER NOT NULL, name TEXT NOT NULL,
    api_base TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat','embedding','rerank','vision')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    extra_config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id AUTOINCREMENT)
  )`)
  db.exec(`INSERT INTO llm_providers (id, name, api_base, api_key, category, enabled, extra_config, created_at, updated_at)
    SELECT id, name, api_base, api_key, COALESCE(category, 'chat'), enabled, extra_config, created_at, updated_at FROM llm_providers_old`)

  // Create llm_models table
  db.exec(`CREATE TABLE IF NOT EXISTS llm_models (
    id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    model_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat', 'embedding', 'rerank', 'vision')),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (id AUTOINCREMENT)
  )`)

  // Migrate old rows: each old provider -> new provider + model
  const oldRows = db.prepare('SELECT id, model_name, is_default, category FROM llm_providers_old WHERE model_name != \'\'').all() as Array<{ id: number; model_name: string; is_default: number; category: string }>
  for (const row of oldRows) {
    db.prepare(
      'INSERT INTO llm_models (provider_id, model_name, category, is_default, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, datetime(\'now\'), datetime(\'now\'))'
    ).run(row.id, row.model_name, row.category, row.is_default)
  }

  db.exec(`DROP TABLE llm_providers_old`)
}

function migrateLlmProviderCategoryCheckConstraint(db: Database.Database) {
  const providerRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_providers'",
  ).get() as { sql?: string } | undefined
  const modelRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_models'",
  ).get() as { sql?: string } | undefined
  const staleProviderRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_providers_old'",
  ).get() as { sql?: string } | undefined

  const providerNeedsUpdate = providerRow?.sql && !providerRow.sql.includes("'vision'")
  const modelNeedsUpdate = modelRow?.sql && !modelRow.sql.includes("'vision'")
  if (!providerNeedsUpdate && !modelNeedsUpdate && !staleProviderRow) return

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('BEGIN')
  try {
    // Step 1: Recover residual llm_providers_old into main table if main is empty.
    if (staleProviderRow?.sql) {
      const providerCount = (db.prepare('SELECT COUNT(*) AS count FROM llm_providers').get() as { count: number }).count
      const staleProviderCount = (db.prepare('SELECT COUNT(*) AS count FROM llm_providers_old').get() as { count: number }).count
      if (providerCount === 0 && staleProviderCount > 0) {
        db.exec('DROP TABLE llm_providers')
        db.exec('ALTER TABLE llm_providers_old RENAME TO llm_providers')
      } else {
        db.exec('DROP TABLE IF EXISTS llm_providers_old')
      }
    }

    // Step 2: Rebuild llm_providers with vision CHECK constraint.
    if (providerNeedsUpdate) {
      db.exec('DROP TABLE IF EXISTS _llm_providers_new')
      db.exec(`CREATE TABLE _llm_providers_new (
        id INTEGER NOT NULL, name TEXT NOT NULL,
        api_base TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat','embedding','rerank','vision')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        extra_config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (id AUTOINCREMENT)
      )`)
      db.exec(`INSERT INTO _llm_providers_new (id, name, api_base, api_key, category, enabled, extra_config, created_at, updated_at)
        SELECT id, name, api_base, api_key,
          CASE WHEN category IN ('chat','embedding','rerank','vision') THEN category ELSE 'chat' END,
          enabled, extra_config, created_at, updated_at
        FROM llm_providers`)
      db.exec('DROP TABLE llm_providers')
      db.exec('ALTER TABLE _llm_providers_new RENAME TO llm_providers')
    }

    // Step 3: Rebuild llm_models with vision CHECK constraint.
    if (modelNeedsUpdate) {
      db.exec('DROP TABLE IF EXISTS _llm_models_new')
      db.exec(`CREATE TABLE _llm_models_new (
        id INTEGER NOT NULL,
        provider_id INTEGER NOT NULL,
        model_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat', 'embedding', 'rerank', 'vision')),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (id AUTOINCREMENT)
      )`)
      db.exec(`INSERT INTO _llm_models_new (id, provider_id, model_name, category, is_default, enabled, created_at, updated_at)
        SELECT id, provider_id, model_name,
          CASE WHEN category IN ('chat','embedding','rerank','vision') THEN category ELSE 'chat' END,
          is_default, enabled, created_at, updated_at
        FROM llm_models`)
      db.exec('DROP TABLE llm_models')
      db.exec('ALTER TABLE _llm_models_new RENAME TO llm_models')
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

function createIndexes(db: Database.Database) {
  for (const schema of SCHEMAS) {
    for (const sql of schema.indexes) db.exec(sql)
  }
}
