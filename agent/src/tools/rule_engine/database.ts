import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, 'rule_engine.db')

let db: Database.Database | null = null

export function initDatabase(): Database.Database {
  if (db) return db

  db = new Database(DB_PATH)

  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger TEXT NOT NULL UNIQUE,
      response TEXT NOT NULL,
      actions TEXT,
      enabled INTEGER DEFAULT 1,
      hit_count INTEGER DEFAULT 0,
      last_matched_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  ensureRuleSchema(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS synonyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      synonym TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(word, synonym)
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_synonyms_word ON synonyms(word)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rules_trigger ON rules(trigger)`)

  insertDefaultData(db)

  return db
}

function ensureRuleSchema(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(rules)').all() as Array<{ name: string }>
  const names = new Set(columns.map(column => column.name))
  if (!names.has('actions')) db.exec('ALTER TABLE rules ADD COLUMN actions TEXT')
  if (!names.has('enabled')) db.exec('ALTER TABLE rules ADD COLUMN enabled INTEGER DEFAULT 1')
  if (!names.has('hit_count')) db.exec('ALTER TABLE rules ADD COLUMN hit_count INTEGER DEFAULT 0')
  if (!names.has('last_matched_at')) db.exec('ALTER TABLE rules ADD COLUMN last_matched_at DATETIME')
}

function insertDefaultData(db: Database.Database) {
  const rules = [
    ['打开乐视电视', '好的，打开乐视电视'],
    ['打开乐视电视机', '好的，打开乐视电视'],
    ['打开电视', '好的，打开乐视电视'],
    ['打开机顶盒', '好的，打开机顶盒'],
    ['小爱音箱放歌', '好的，小爱音箱开始播放'],
    ['小爱音响放歌', '好的，小爱音箱开始播放'],
    ['返回', '好的，返回上一页'],
    ['主页', '好的，返回主页'],
  ]

  const insertRule = db.prepare('INSERT OR IGNORE INTO rules (trigger, response, actions) VALUES (?, ?, ?)')
  for (const [trigger, response] of rules) {
    insertRule.run(trigger, response, null)
  }

  const synonyms = [
    ['打开', '开启'],
    ['打开', '启动'],
    ['打开', '开一下'],
    ['关闭', '关掉'],
    ['关闭', '关一下'],
    ['乐视电视', '乐视电视机'],
    ['乐视电视', '电视'],
    ['小爱音箱', '小爱音响'],
  ]

  const insertSyn = db.prepare('INSERT OR IGNORE INTO synonyms (word, synonym) VALUES (?, ?)')
  for (const [word, synonym] of synonyms) {
    insertSyn.run(word, synonym)
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase()
  }
  return db
}

export function upsertRule(trigger: string, response: string, actions?: unknown): { inserted: boolean } {
  const database = getDatabase()
  const existing = database.prepare('SELECT id, enabled, hit_count, last_matched_at FROM rules WHERE trigger = ?').get(trigger) as { id: number; enabled?: number; hit_count?: number; last_matched_at?: string | null } | undefined
  const actionsJson = actions ? JSON.stringify(actions) : null
  database.prepare('INSERT OR REPLACE INTO rules (trigger, response, actions, enabled, hit_count, last_matched_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    trigger,
    response,
    actionsJson,
    existing?.enabled ?? 1,
    existing?.hit_count ?? 0,
    existing?.last_matched_at ?? null,
  )
  return { inserted: !existing }
}

export function setRuleEnabled(trigger: string, enabled: boolean) {
  const database = getDatabase()
  database.prepare('UPDATE rules SET enabled = ? WHERE trigger = ?').run(enabled ? 1 : 0, trigger)
}

export function deleteRule(trigger: string) {
  const database = getDatabase()
  database.prepare('DELETE FROM rules WHERE trigger = ?').run(trigger)
}

export function recordRuleHit(trigger: string) {
  const database = getDatabase()
  database.prepare('UPDATE rules SET hit_count = COALESCE(hit_count, 0) + 1, last_matched_at = CURRENT_TIMESTAMP WHERE trigger = ?').run(trigger)
}

export function listRules() {
  const database = getDatabase()
  return database.prepare('SELECT id, trigger, response, actions, enabled, hit_count, last_matched_at, created_at FROM rules ORDER BY hit_count DESC, id DESC').all() as Array<Record<string, unknown>>
}
