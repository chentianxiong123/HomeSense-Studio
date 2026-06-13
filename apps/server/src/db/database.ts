import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DB_PATH = path.resolve(__dirname, '../../../../data/homesense-v2.db')
const DB_PATH = process.env.HOMESENSE_DB_PATH || process.env.DB_PATH || DEFAULT_DB_PATH

let db: Database.Database | null = null

const tables = [
  `CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      props TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS devices (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      props TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS device_groups (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      member_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS terminal_targets (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS media_playlist_items (
      id INTEGER NOT NULL,
      item_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      cover TEXT,
      duration_sec INTEGER,
      upstream_id TEXT,
      upstream_url TEXT,
      stream_url TEXT,
      mime_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS media_source_sites (
      id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'generic',
      kind TEXT NOT NULL DEFAULT 'page',
      tags_json TEXT NOT NULL DEFAULT '[]',
      last_sniffed_at TEXT,
      last_candidates_count INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS media_bookmarks (
      id INTEGER NOT NULL,
      item_id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      cover TEXT,
      duration_sec INTEGER,
      upstream_id TEXT,
      upstream_url TEXT,
      stream_url TEXT,
      mime_type TEXT,
      stream_kind TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      favorite INTEGER NOT NULL DEFAULT 0,
      play_count INTEGER NOT NULL DEFAULT 0,
      last_played_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS resource_sources (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'html',
      enabled INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL DEFAULT '{}',
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS alist_authorizations (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      driver TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      username TEXT,
      secret_json TEXT NOT NULL DEFAULT '{}',
      props_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS storage_mounts (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      virtual_path TEXT NOT NULL UNIQUE,
      driver TEXT NOT NULL,
      authorization_id INTEGER NOT NULL,
      readonly INTEGER NOT NULL DEFAULT 0,
      props_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS storage_tasks (
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      error TEXT,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      PRIMARY KEY (id)
    )`,
  `CREATE TABLE IF NOT EXISTS runtime_snapshots (
      key TEXT NOT NULL,
      value_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (key)
    )`,
]

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_devices_room_id ON devices(json_extract(props, '$.room_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_devices_mi_did ON devices(json_extract(props, '$.mi_did'))`,
  `CREATE INDEX IF NOT EXISTS idx_devices_adb_ip ON devices(json_extract(props, '$.adb_ip'))`,
  `CREATE INDEX IF NOT EXISTS idx_devices_group_id ON devices(json_extract(props, '$.group_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_media_playlist_sort ON media_playlist_items(sort_order, id)`,
  `CREATE INDEX IF NOT EXISTS idx_media_source_sites_kind ON media_source_sites(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_media_source_sites_provider ON media_source_sites(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_media_bookmarks_source ON media_bookmarks(source)`,
  `CREATE INDEX IF NOT EXISTS idx_media_bookmarks_favorite ON media_bookmarks(favorite)`,
  `CREATE INDEX IF NOT EXISTS idx_media_bookmarks_updated ON media_bookmarks(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_sources_kind ON resource_sources(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_sources_enabled ON resource_sources(enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_alist_authorizations_driver ON alist_authorizations(driver)`,
  `CREATE INDEX IF NOT EXISTS idx_storage_mounts_authorization ON storage_mounts(authorization_id)`,
  `CREATE INDEX IF NOT EXISTS idx_storage_mounts_driver ON storage_mounts(driver)`,
  `CREATE INDEX IF NOT EXISTS idx_storage_tasks_status ON storage_tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_storage_tasks_created ON storage_tasks(created_at)`,
]

export function initDb(): Database.Database {
  if (db) return db

  const resolvedPath = path.resolve(DB_PATH)
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })

  db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  migrateLegacyToDevices(db)
  return db
}

export function getDb(): Database.Database {
  return db ?? initDb()
}

export function applySchema(target: Database.Database): void {
  for (const sql of tables) target.exec(sql)
  applyCompatibilityMigrations(target)
  for (const sql of indexes) target.exec(sql)
}

function applyCompatibilityMigrations(target: Database.Database): void {
  ensureColumn(target, 'alist_authorizations', 'username', 'TEXT')
  ensureColumn(target, 'alist_authorizations', 'secret_json', "TEXT DEFAULT '{}'")
  ensureColumn(target, 'alist_authorizations', 'props_json', "TEXT DEFAULT '{}'")
  ensureColumn(target, 'alist_authorizations', 'created_at', 'TEXT')
  ensureColumn(target, 'alist_authorizations', 'updated_at', 'TEXT')
  target.exec(`
    UPDATE alist_authorizations
    SET
      secret_json = COALESCE(secret_json, '{}'),
      props_json = COALESCE(props_json, '{}'),
      created_at = COALESCE(created_at, datetime('now')),
      updated_at = COALESCE(updated_at, datetime('now'))
  `)
}

function ensureColumn(target: Database.Database, table: string, column: string, definition: string): void {
  const columns = target.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((item) => item.name === column)) return
  target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function migrateLegacyToDevices(target: Database.Database): void {
  const hasLegacy = target
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_devices'")
    .get()
  if (!hasLegacy) return

  const legacyRows = target
    .prepare(
      `SELECT d.id, d.name, d.device_type, d.room_id, d.mi_did, d.adb_ip, d.ip_address,
              d.created_at, d.updated_at
       FROM user_devices d`,
    )
    .all() as Array<Record<string, unknown>>

  const capRows = target
    .prepare('SELECT mi_did, capabilities_json FROM device_capabilities')
    .all() as Array<{ mi_did: string; capabilities_json: string }>
  const capsByDid = new Map(capRows.map((r) => [r.mi_did, r.capabilities_json]))

  const appRows = target
    .prepare('SELECT adb_ip, apps_json FROM device_apps')
    .all() as Array<{ adb_ip: string; apps_json: string }>
  const appsByIp = new Map(appRows.map((r) => [r.adb_ip, r.apps_json]))

  const insert = target.prepare(
    `INSERT INTO devices (id, name, props, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )

  const tx = target.transaction((rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const props: Record<string, unknown> = {}
      if (row.device_type) props.device_type = row.device_type
      if (row.room_id != null) props.room_id = row.room_id
      if (row.mi_did) props.mi_did = row.mi_did
      if (row.adb_ip) props.adb_ip = row.adb_ip
      if (row.ip_address) props.ip_address = row.ip_address

      const miDid = row.mi_did as string | null
      if (miDid && capsByDid.has(miDid)) {
        try {
          props.capabilities = JSON.parse(capsByDid.get(miDid)!)?.capabilities ?? []
        } catch {}
      }

      const adbIp = row.adb_ip as string | null
      if (adbIp && appsByIp.has(adbIp)) {
        try {
          props.apps = JSON.parse(appsByIp.get(adbIp)!)?.apps ?? []
        } catch {}
      }

      insert.run(
        row.id,
        row.name,
        JSON.stringify(props),
        row.created_at,
        row.updated_at,
      )
    }
  })
  tx(legacyRows)

  target.exec('DROP TABLE IF EXISTS user_devices')
  target.exec('DROP TABLE IF EXISTS device_capabilities')
  target.exec('DROP TABLE IF EXISTS device_apps')

  console.log(
    `[migrate] moved ${legacyRows.length} devices to props JSON; dropped user_devices, device_capabilities, device_apps`,
  )
}
