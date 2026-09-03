// 一次性脚本:把 admin/123456 插进 tenants.db + 建独立租户库 + role='admin'。
// 跑了就幂等(先删再建)。
// 用法: cd apps/web && node scripts/seed-admin.mjs
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const DATA_ROOT = path.resolve(process.cwd(), "data")
const INDEX_DB = path.join(DATA_ROOT, "tenants.db")
const ADMIN_TENANT_ID = "ten_admin"
const ADMIN_USER_ID = "usr_admin0000000"
const ADMIN_USERNAME = "admin"
const ADMIN_PASSWORD = "123456"

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("base64url")
}

const index = new DatabaseSync(INDEX_DB)
index.exec("PRAGMA journal_mode = WAL")

// 清掉旧 admin 记录
index.prepare(`DELETE FROM tenant_users WHERE username = ?`).run(ADMIN_USERNAME)
index.prepare(`DELETE FROM tenants WHERE id = ?`).run(ADMIN_TENANT_ID)

// 建独立租户
const now = new Date().toISOString()
const activeSessionId = crypto.randomUUID()
const salt = crypto.randomBytes(16).toString("base64url")
const hash = hashPassword(ADMIN_PASSWORD, salt)
const dbPath = path.join(DATA_ROOT, `${ADMIN_TENANT_ID}.db`)

index.prepare(
  `INSERT INTO tenants (id, name, db_path, created_at, owner_user_id, active_session_id)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(ADMIN_TENANT_ID, "管理后台", dbPath, now, ADMIN_USER_ID, activeSessionId)

index.prepare(
  `INSERT INTO tenant_users (tenant_id, user_id, username, password_hash, password_salt, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(ADMIN_TENANT_ID, ADMIN_USER_ID, ADMIN_USERNAME, hash, salt, now)

console.log("[seed-admin] inserted tenant + tenant_user")

// 建租户库 + role='admin'
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
db.exec("PRAGMA journal_mode = WAL")
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  )
`)
db.prepare(
  `INSERT INTO users (id, username, display_name, role, created_at)
   VALUES (?, ?, ?, 'admin', ?)`,
).run(ADMIN_USER_ID, ADMIN_USERNAME, "管理员", now)

console.log(`[seed-admin] done. login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD} → tenantId=${ADMIN_TENANT_ID} role=admin`)
