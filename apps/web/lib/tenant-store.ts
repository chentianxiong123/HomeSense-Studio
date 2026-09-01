// HomeSense v3 — 多租户数据模型
//
// 物理隔离：每个租户一个独立 SQLite 文件（与 ARCHITECTURE.md §10.2 + CLOUD-EDGE-BLUEPRINT.md §5.3 一致）。
//
//   data/
//     tenants.db                 ← 索引库（仅元数据,不含业务数据）
//       ├─ tenants(全局)            租户清单(id, name, db_path, created_at, owner_user_id)
//       └─ tenant_users(全局)       全局唯一登录凭据(username, password_hash, tenant_id, user_id)
//     <tenant-id>.db            ← 租户库,只存本租户数据
//       ├─ users                    租户成员(id, username, display_name, role, created_at, last_seen_at)
//       ├─ messages                 单一永续时间线(原 timeline.db schema 不变)
//       ├─ timeline_meta            key-value 元数据
//       └─ tenant_meta              租户级设置(后续 home/device 等业务表加在这里)
//
// username 全局唯一(username → tenant_id + user_id 来自 tenants.db.tenant_users),
// 登录只需查索引库,不需扫所有租户库。

import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const DATA_ROOT = path.resolve(
  process.env.HOMESENSE_DATA_ROOT || process.cwd(),
  "data",
)

const LEGACY_DB_PATH = path.join(DATA_ROOT, "homesense-timeline.db")
const INDEX_DB_PATH = process.env.HOMESENSE_INDEX_DB_PATH
  || path.join(DATA_ROOT, "tenants.db")

const DEFAULT_TENANT_ID = "default"
const DEFAULT_TENANT_NAME = "我的家"

const SCHEMA_VERSION = 1

export interface TenantRecord {
  id: string
  name: string
  dbPath: string
  createdAt: string
  ownerUserId: string | null
  activeSessionId: string | null
  /** 该租户云大脑 gateway 的端口与 pico token（每租户独立进程）。 */
  gatewayPort: number | null
  gatewayToken: string | null
}

export interface TenantUserRecord {
  tenantId: string
  userId: string
  username: string
  passwordHash: string
  passwordSalt: string
  createdAt: string
}

export interface TenantUserView {
  tenantId: string
  userId: string
  username: string
  displayName: string
  role: string
}

let indexDb: DatabaseSync | null = null
const tenantDbCache = new Map<string, DatabaseSync>()

export function getIndexDb(): DatabaseSync {
  if (indexDb) return indexDb

  fs.mkdirSync(DATA_ROOT, { recursive: true })
  indexDb = new DatabaseSync(INDEX_DB_PATH)
  indexDb.exec("PRAGMA journal_mode = WAL")
  indexDb.exec("PRAGMA busy_timeout = 5000")
  applyIndexSchema(indexDb)
  return indexDb
}

function applyIndexSchema(target: DatabaseSync): void {
  target.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      db_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      owner_user_id TEXT,
      active_session_id TEXT,
      gateway_port INTEGER,
      gateway_token TEXT
    )
  `)
  // 兼容老 schema(没有 active_session_id 列的旧库)
  try {
    target.exec(`ALTER TABLE tenants ADD COLUMN active_session_id TEXT`)
  } catch {
    /* 列已存在 */
  }
  // v5 每租户独立云大脑进程
  try {
    target.exec(`ALTER TABLE tenants ADD COLUMN gateway_port INTEGER`)
  } catch {
    /* 列已存在 */
  }
  try {
    target.exec(`ALTER TABLE tenants ADD COLUMN gateway_token TEXT`)
  } catch {
    /* 列已存在 */
  }
  target.exec(`
    CREATE TABLE IF NOT EXISTS tenant_users (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id)
    )
  `)
  target.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

function applyTenantSchema(target: DatabaseSync): void {
  target.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    )
  `)
  target.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts TEXT NOT NULL,
      model TEXT,
      engine_id TEXT UNIQUE
    )
  `)
  target.exec(`
    CREATE TABLE IF NOT EXISTS timeline_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  target.exec(`
    CREATE TABLE IF NOT EXISTS tenant_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
  target.exec(`
    INSERT OR IGNORE INTO tenant_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
  `)
}

export function getTenantDb(tenantId: string): DatabaseSync {
  const cached = tenantDbCache.get(tenantId)
  if (cached) return cached

  const tenant = getTenant(tenantId)
  if (!tenant) throw new Error(`租户不存在: ${tenantId}`)

  fs.mkdirSync(path.dirname(tenant.dbPath), { recursive: true })
  const db = new DatabaseSync(tenant.dbPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  applyTenantSchema(db)
  tenantDbCache.set(tenantId, db)
  return db
}

export function listTenants(): TenantRecord[] {
  return getIndexDb()
    .prepare(
      `SELECT id, name, db_path AS dbPath, created_at AS createdAt, owner_user_id AS ownerUserId,
              active_session_id AS activeSessionId,
              gateway_port AS gatewayPort, gateway_token AS gatewayToken
       FROM tenants ORDER BY created_at ASC`,
    )
    .all() as unknown as TenantRecord[]
}

export function getTenant(tenantId: string): TenantRecord | null {
  const row = getIndexDb()
    .prepare(
      `SELECT id, name, db_path AS dbPath, created_at AS createdAt, owner_user_id AS ownerUserId,
              active_session_id AS activeSessionId,
              gateway_port AS gatewayPort, gateway_token AS gatewayToken
       FROM tenants WHERE id = ?`,
    )
    .get(tenantId) as TenantRecord | undefined
  return row ?? null
}

export function findUserByUsername(username: string): TenantUserRecord | null {
  const row = getIndexDb()
    .prepare(
      `SELECT tenant_id AS tenantId, user_id AS userId, username,
              password_hash AS passwordHash, password_salt AS passwordSalt,
              created_at AS createdAt
       FROM tenant_users WHERE username = ?`,
    )
    .get(username) as TenantUserRecord | undefined
  return row ?? null
}

export interface CreateTenantInput {
  name: string
  ownerUsername: string
  password: string
  displayName?: string
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? crypto.randomBytes(16).toString("base64url")
  const hash = crypto.scryptSync(password, useSalt, 64).toString("base64url")
  return { hash, salt: useSalt }
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt)
  const a = Buffer.from(hash)
  const b = Buffer.from(expectedHash)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`
}

export function createTenant(input: CreateTenantInput): {
  tenant: TenantRecord
  user: TenantUserView
} {
  const { name, ownerUsername, password, displayName } = input

  if (findUserByUsername(ownerUsername)) {
    throw new Error("用户名已存在")
  }

  const tenantId = newId("ten")
  const userId = newId("usr")
  // v3 一户一session: 注册时直接生成 activeSessionId,绑定到 tenants 表。
  // 前端永远从 server 拿这个 id(通过 /api/auth/me 一起返回),
  // 不存 localStorage,避免 404 重试。
  // pi engine 第一次发消息时按 sessionId + tenantId 落到 per-tenant 路径
  // (data/<tenantId>/.homesense/agent/sessions/<cwd>/<iso>_<sessionId>.jsonl)。
  const activeSessionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const dbPath = path.join(DATA_ROOT, `${tenantId}.db`)
  const { hash, salt } = hashPassword(password)

  const db = getIndexDb()
  db.exec("BEGIN")
  try {
    db.prepare(
      `INSERT INTO tenants (id, name, db_path, created_at, owner_user_id, active_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(tenantId, name.trim() || "新家庭", dbPath, now, userId, activeSessionId)

    db.prepare(
      `INSERT INTO tenant_users (tenant_id, user_id, username, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(tenantId, userId, ownerUsername, hash, salt, now)

    db.prepare(
      `INSERT OR REPLACE INTO index_meta (key, value) VALUES ('last_owner_setup_at', ?)`,
    ).run(now)
    db.exec("COMMIT")
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }

  // 初始化租户库(包含 users/messages/timeline_meta/tenant_meta)
  const tenantDb = getTenantDb(tenantId)
  tenantDb.prepare(
    `INSERT INTO users (id, username, display_name, role, created_at)
     VALUES (?, ?, ?, 'owner', ?)`,
  ).run(userId, ownerUsername, displayName?.trim() || ownerUsername, now)

  return {
    tenant: {
      id: tenantId,
      name: name.trim() || "新家庭",
      dbPath,
      createdAt: now,
      ownerUserId: userId,
      activeSessionId,
      gatewayPort: null,
      gatewayToken: null,
    },
    user: {
      tenantId,
      userId,
      username: ownerUsername,
      displayName: displayName?.trim() || ownerUsername,
      role: "owner",
    },
  }
}

/**
 * 首次启动时,把现存的 homesense-timeline.db 当作默认租户("我的家")。
 * 默认租户用文件名作 id(default),db_path 指向现有文件,不动原数据。
 * 这样历史 67 条消息自动归属默认租户,既有用户不受影响。
 */
export function ensureDefaultTenant(): TenantRecord | null {
  const existing = getTenant(DEFAULT_TENANT_ID)
  if (existing) {
    // 老 default 库没有 activeSessionId(向前兼容),补一个
    if (!existing.activeSessionId) {
      const sid = crypto.randomUUID()
      getIndexDb().prepare(
        `UPDATE tenants SET active_session_id = ? WHERE id = ?`,
      ).run(sid, DEFAULT_TENANT_ID)
      existing.activeSessionId = sid
    }
    return existing
  }

  // 检查 legacy db 是否存在数据
  if (!fs.existsSync(LEGACY_DB_PATH)) return null

  const now = new Date().toISOString()
  const activeSessionId = crypto.randomUUID()
  const db = getIndexDb()
  db.prepare(
    `INSERT OR IGNORE INTO tenants (id, name, db_path, created_at, owner_user_id, active_session_id)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME, LEGACY_DB_PATH, now, activeSessionId)

  // 触发租户库 schema 升级(在 legacy db 上加 users/tenant_meta 表;messages/timeline_meta 保持不动)
  getTenantDb(DEFAULT_TENANT_ID)

  return getTenant(DEFAULT_TENANT_ID)
}

export function getUserView(tenantId: string, userId: string): TenantUserView | null {
  const row = getTenantDb(tenantId)
    .prepare(
      `SELECT id AS userId, username, display_name AS displayName, role
       FROM users WHERE id = ?`,
    )
    .get(userId) as { userId: string; username: string; displayName: string | null; role: string } | undefined
  if (!row) return null
  return {
    tenantId,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName ?? row.username,
    role: row.role,
  }
}

export function touchUserLastSeen(tenantId: string, userId: string): void {
  getTenantDb(tenantId)
    .prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), userId)
}

export function getDataRoot(): string {
  return DATA_ROOT
}

export function getLegacyDbPath(): string {
  return LEGACY_DB_PATH
}

export function getIndexDbPath(): string {
  return INDEX_DB_PATH
}

export { DEFAULT_TENANT_ID }
