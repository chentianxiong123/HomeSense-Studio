import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'homesense.db')

// Confirmed dead tables: no code references (or only disabled devtest routes).
// `experiences` / `experiences_fts` are intentionally NOT here — they are still
// read by 4 active modules and need a real migration plan, not a hasty drop.
const DEAD_TABLES = [
  'app_map_screens',
  'app_map_elements',
  'opencv_templates',
  'device_apps',
  'llm_usage_log',
]

const INDEXES_FOR_TABLE = new Map([
  ['app_map_screens', [
    'idx_app_map_screens_package',
  ]],
  ['app_map_elements', [
    'idx_app_map_elements_screen',
  ]],
  ['opencv_templates', [
    'idx_opencv_templates_package',
    'idx_opencv_templates_element',
  ]],
])

function readSchema(db, name) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND name = ?")
    .get(name)
  return row ? String(row.sql || '') : null
}

function readRows(db, name) {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name)
  if (!exists) return { exists: false, rows: [] }
  const rows = db.prepare(`SELECT * FROM "${name}"`).all()
  return { exists: true, rows }
}

function readIndexes(db, name) {
  const rows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL")
    .all(name)
  return rows.map((r) => ({ name: r.name, sql: r.sql }))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[dead-tables] DB not found at ${DB_PATH}. Run npm run -w backend db:init first.`)
    process.exit(1)
  }

  const backupDir = path.join(ROOT, 'data', 'backups', `dead-tables-${nowStamp()}`)
  ensureDir(backupDir)
  console.log(`[dead-tables] backup folder: ${backupDir}`)

  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')

  const manifest = {
    created_at: new Date().toISOString(),
    db_path: DB_PATH,
    tables: [],
  }

  let dropped = 0
  for (const table of DEAD_TABLES) {
    const schemaSql = readSchema(db, table)
    const { exists, rows } = readRows(db, table)
    const indexes = readIndexes(db, table)
    const allIndexNames = [
      ...indexes.map((i) => i.name),
      ...(INDEXES_FOR_TABLE.get(table) ?? []),
    ]

    fs.writeFileSync(
      path.join(backupDir, `${table}.schema.sql`),
      schemaSql ? `${schemaSql};\n` : `-- table ${table} not present in sqlite_master\n`,
    )
    fs.writeFileSync(
      path.join(backupDir, `${table}.data.json`),
      JSON.stringify({ table, exists, row_count: rows.length, rows }, null, 2),
    )
    fs.writeFileSync(
      path.join(backupDir, `${table}.indexes.sql`),
      indexes.length > 0
        ? indexes.map((i) => `${i.sql};`).join('\n') + '\n'
        : `-- no indexes\n`,
    )

    manifest.tables.push({
      name: table,
      existed: exists,
      row_count: rows.length,
      index_count: indexes.length,
      backup_files: [
        `${table}.schema.sql`,
        `${table}.data.json`,
        `${table}.indexes.sql`,
      ],
    })

    if (exists) {
      db.exec(`DROP TABLE IF EXISTS "${table}"`)
      console.log(`[dead-tables] dropped ${table} (${rows.length} rows backed up)`)
      dropped += 1
    } else {
      console.log(`[dead-tables] ${table} did not exist in DB; nothing to drop`)
    }

    for (const indexName of new Set(allIndexNames)) {
      if (!indexName) continue
      db.exec(`DROP INDEX IF EXISTS "${indexName}"`)
    }
  }

  fs.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  db.close()
  console.log(`[dead-tables] done. dropped=${dropped}/${DEAD_TABLES.length}`)
}

main()
