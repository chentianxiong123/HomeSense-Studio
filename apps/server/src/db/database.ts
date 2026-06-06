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
]

const indexes = [
  `CREATE INDEX IF NOT EXISTS idx_devices_room_id ON devices(json_extract(props, '$.room_id'))`,
  `CREATE INDEX IF NOT EXISTS idx_devices_mi_did ON devices(json_extract(props, '$.mi_did'))`,
  `CREATE INDEX IF NOT EXISTS idx_devices_adb_ip ON devices(json_extract(props, '$.adb_ip'))`,
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
  for (const sql of indexes) target.exec(sql)
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
