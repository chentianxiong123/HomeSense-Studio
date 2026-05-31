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

function createTables(db: Database.Database) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      graph_json TEXT NOT NULL DEFAULT '{}',
      graph_hash TEXT NOT NULL DEFAULT '',
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','cron','chat')) DEFAULT 'manual',
      cron_expression TEXT NULL, published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      graph_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS workflow_nodes (
      id INTEGER NOT NULL, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('start','schedule','device_control','xiaoai','ir_control','scene_execute','device_capability','llm','if_else','delay','parallel','code','answer','executor_call','subflow','knowledge_retrieve','candidate_plan_resolve','rerank_score','agent_dispatch')),
      position_json TEXT NOT NULL DEFAULT '{}', config_json TEXT NOT NULL DEFAULT '{}', label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS workflow_edges (
      id INTEGER NOT NULL, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      source_node_id INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
      target_node_id INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
      source_port TEXT NOT NULL DEFAULT 'out', target_port TEXT NOT NULL DEFAULT 'in',
      condition_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER NOT NULL, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed')) DEFAULT 'pending',
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual','cron','chat')),
      started_at TEXT NULL, finished_at TEXT NULL, result_json TEXT NOT NULL DEFAULT '{}',
      graph_hash TEXT NOT NULL DEFAULT '',
      trace_json TEXT NOT NULL DEFAULT '[]',
      events_json TEXT NOT NULL DEFAULT '[]',
      inputs_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS skills (
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', prompt_template TEXT NOT NULL DEFAULT '',
      allowed_tools_json TEXT NOT NULL DEFAULT '[]', action_schema_json TEXT NOT NULL DEFAULT '[]',
      context_mode TEXT NOT NULL CHECK (context_mode IN ('inline','fork')) DEFAULT 'inline',
      source TEXT NOT NULL CHECK (source IN ('builtin','disk','converted')) DEFAULT 'builtin',
      skill_root TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (name)
    )`,
    `CREATE TABLE IF NOT EXISTS experiences (
      id INTEGER NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      file_path TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '',
      importance REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS rules (
      id INTEGER NOT NULL, trigger_pattern TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS rule_actions (
      id INTEGER NOT NULL, rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      tool TEXT NOT NULL, action TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id AUTOINCREMENT)
    )`,
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
    `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
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
    `CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER NOT NULL, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL DEFAULT '', tool_calls_json TEXT NULL, tool_result_json TEXT NULL,
      tool_call_id TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS llm_providers (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      api_base TEXT NOT NULL DEFAULT '', api_key TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat','embedding','rerank','vision')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      extra_config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS llm_models (
      id INTEGER NOT NULL,
      provider_id INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'chat' CHECK (category IN ('chat', 'embedding', 'rerank', 'vision')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
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
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL, value_json TEXT NOT NULL DEFAULT 'null',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (key)
    )`,
    `CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS user_context (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS stopwords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0,1))
    )`,
    `CREATE TABLE IF NOT EXISTS capability_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_type TEXT NOT NULL DEFAULT '',
      device_id INTEGER NULL REFERENCES user_devices(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      ir_key TEXT NOT NULL DEFAULT '',
      alias TEXT NOT NULL,
      is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0,1)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
    )`,
    `CREATE TABLE IF NOT EXISTS user_devices (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK (device_type IN ('television','stb','speaker','router','outlet','phone','tv_box','tablet','computer','other')) DEFAULT 'other',
      room_id INTEGER NULL REFERENCES rooms(id) ON DELETE SET NULL,
      mi_did TEXT NULL,
      adb_ip TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS compensation_tasks (
      id INTEGER NOT NULL, type TEXT NOT NULL, params_json TEXT NOT NULL DEFAULT '{}',
      retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
      next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
      state TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed')) DEFAULT 'pending',
      error_message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('person','device','room','concept','skill')),
      wing TEXT NOT NULL DEFAULT '', room TEXT NOT NULL DEFAULT '',
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    )`,
    `CREATE TABLE IF NOT EXISTS memory_triples (
      id INTEGER NOT NULL, subject TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      predicate TEXT NOT NULL, object TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT NULL,
      confidence REAL NOT NULL DEFAULT 1.0, source TEXT NOT NULL DEFAULT '', source_file TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (id AUTOINCREMENT)
    )`,
    `CREATE TABLE IF NOT EXISTS memory_attributes (
      entity_id TEXT NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
      key TEXT NOT NULL, value TEXT NOT NULL,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT NULL,
      PRIMARY KEY (entity_id, key, valid_from)
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
    `CREATE TABLE IF NOT EXISTS memory_experience_paths (
      memory_item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
      intent_pattern TEXT NOT NULL DEFAULT '',
      preconditions_json TEXT NOT NULL DEFAULT '{}',
      steps_json TEXT NOT NULL DEFAULT '[]',
      skill_refs_json TEXT NOT NULL DEFAULT '[]',
      device_refs_json TEXT NOT NULL DEFAULT '[]',
      success_criteria_json TEXT NOT NULL DEFAULT '{}',
      failure_recovery_json TEXT NOT NULL DEFAULT '[]',
      origin_trace_id TEXT NOT NULL DEFAULT '',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_success_at TEXT NULL,
      PRIMARY KEY (memory_item_id)
    )`,
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
    `CREATE TABLE IF NOT EXISTS compiled_knowledge_embeddings (
      knowledge_id INTEGER NOT NULL REFERENCES compiled_knowledge_items(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL REFERENCES embedding_profiles(profile_name) ON DELETE CASCADE,
      dimensions INTEGER NOT NULL DEFAULT 0,
      embedding_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (knowledge_id, profile_name)
    )`,
    `CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      embedding_ref TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    )`,
    `CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER NOT NULL,
      from_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      valid_from TEXT NOT NULL DEFAULT (datetime('now')),
      valid_to TEXT NULL,
      source_type TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (from_node_id, to_node_id, relation)
    )`,
  ]

  for (const sql of tables) {
    db.exec(sql)
  }

  runMigrations(db)
  createIndexes(db)
  createFts(db)
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
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_user_devices_mi_did ON user_devices(mi_did)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_trigger_type ON workflows(trigger_type)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_published ON workflows(published)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_graph_hash ON workflows(graph_hash)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow_id ON workflow_edges(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_edges_source ON workflow_edges(source_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_edges_target ON workflow_edges(target_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_runs_graph_hash ON workflow_runs(workflow_id, graph_hash)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at ON workflow_runs(started_at)',
    'CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)',
    'CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_category ON experiences(category)',
    'CREATE INDEX IF NOT EXISTS idx_experiences_importance ON experiences(importance)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_experiences_content_hash ON experiences(content_hash)',
    'CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority)',
    'CREATE INDEX IF NOT EXISTS idx_rule_actions_rule_id ON rule_actions(rule_id)',
    'CREATE INDEX IF NOT EXISTS idx_agent_instances_profile ON agent_instances(profile)',
    'CREATE INDEX IF NOT EXISTS idx_agent_instances_surface ON agent_instances(surface)',
    'CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_sessions_agent ON conversation_sessions(agent_instance_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_sessions_channel ON conversation_sessions(channel)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_sessions_expires_at ON conversation_sessions(expires_at)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_id ON conversation_messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at ON conversation_messages(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_llm_providers_enabled ON llm_providers(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_llm_models_provider_id ON llm_models(provider_id)',
    'CREATE INDEX IF NOT EXISTS idx_llm_models_category ON llm_models(category)',
    'CREATE INDEX IF NOT EXISTS idx_llm_model_slots_enabled ON llm_model_slots(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_compensation_tasks_state ON compensation_tasks(state)',
    'CREATE INDEX IF NOT EXISTS idx_compensation_tasks_next_retry ON compensation_tasks(next_retry_at)',
    'CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(type)',
    'CREATE INDEX IF NOT EXISTS idx_memory_entities_wing_room ON memory_entities(wing, room)',
    'CREATE INDEX IF NOT EXISTS idx_memory_triples_subject ON memory_triples(subject)',
    'CREATE INDEX IF NOT EXISTS idx_memory_triples_object ON memory_triples(object)',
    'CREATE INDEX IF NOT EXISTS idx_memory_triples_predicate ON memory_triples(predicate)',
    'CREATE INDEX IF NOT EXISTS idx_memory_triples_valid ON memory_triples(subject, predicate, object, valid_from)',
    'CREATE INDEX IF NOT EXISTS idx_memory_attributes_entity_id ON memory_attributes(entity_id)',
    'CREATE INDEX IF NOT EXISTS idx_memory_attributes_key ON memory_attributes(key)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_kind ON memory_items(kind)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_scope ON memory_items(scope, room_id, device_id, conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_status ON memory_items(status)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_source ON memory_items(source)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_priority ON memory_items(priority DESC, confidence DESC)',
    'CREATE INDEX IF NOT EXISTS idx_memory_items_last_used ON memory_items(last_used_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_memory_experience_paths_intent ON memory_experience_paths(intent_pattern)',
    'CREATE INDEX IF NOT EXISTS idx_embedding_profiles_slot ON embedding_profiles(slot_name)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_profiles_canonical ON embedding_profiles(is_canonical) WHERE is_canonical = 1',
    'CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_kind ON compiled_knowledge_items(kind)',
    'CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_wing_room ON compiled_knowledge_items(wing, room)',
    'CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_source ON compiled_knowledge_items(source_type, source_ref)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_compiled_knowledge_unique ON compiled_knowledge_items(kind, source_type, source_ref)',
    'CREATE INDEX IF NOT EXISTS idx_compiled_knowledge_embeddings_profile ON compiled_knowledge_embeddings(profile_name)',
    'CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type)',
    'CREATE INDEX IF NOT EXISTS idx_graph_nodes_scope ON graph_nodes(scope)',
    'CREATE INDEX IF NOT EXISTS idx_graph_nodes_label ON graph_nodes(label)',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_node_id)',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation)',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_valid ON graph_edges(valid_from, valid_to)',
    'CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_type, source_ref)',
    'CREATE INDEX IF NOT EXISTS idx_stopwords_word ON stopwords(word)',
    'CREATE INDEX IF NOT EXISTS idx_aliases_device ON capability_aliases(device_id)',
    'CREATE INDEX IF NOT EXISTS idx_aliases_alias ON capability_aliases(alias)',
  ]

  for (const sql of indexes) {
    db.exec(sql)
  }
}

function createFts(db: Database.Database) {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(title, content, category)`)
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS compiled_knowledge_fts USING fts5(title, body, kind, wing, room, source_ref)`)
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(id UNINDEXED, title, summary, search_text, kind, source)`)
}
