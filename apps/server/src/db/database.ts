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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS user_devices (
      id INTEGER NOT NULL,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL CHECK (device_type IN ('television','stb','speaker','router','outlet','phone','tv_box','tablet','computer','other')) DEFAULT 'other',
      room_id INTEGER NULL REFERENCES rooms(id) ON DELETE SET NULL,
      mi_did TEXT NULL,
      adb_ip TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS device_capabilities (
      mi_did TEXT NOT NULL,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      ir_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (mi_did)
    )`,
  `CREATE TABLE IF NOT EXISTS device_apps (
      adb_ip TEXT NOT NULL,
      apps_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (adb_ip)
    )`,
]

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_user_devices_room ON user_devices(room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_devices_mi_did ON user_devices(mi_did)`,
]

export function initDb(): Database.Database {
  if (db) return db

  const resolvedPath = path.resolve(DB_PATH)
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })

  db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  applySchema(db)
  return db
}

export function getDb(): Database.Database {
  return db ?? initDb()
}

export function applySchema(target: Database.Database): void {
  for (const sql of tables) target.exec(sql)
  for (const sql of indexes) target.exec(sql)
}

