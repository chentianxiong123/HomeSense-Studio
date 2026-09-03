// HomeSense v3 — 永续时间线存储（SQLite,多租户）
//
// 单一会话：UI 永远是一条时间线，聊天永不结束。
// - messages 是唯一真相的 append-only 时间线，绝不物理删除。
// - pi 引擎的 jsonl 只是临时执行窗口；引擎压缩/分裂产生的旧 jsonl 剪裁
//   不影响 SQLite 里的完整时间线（这正是 jsonl 无法"永远聊下去"的解法）。
// - content LIKE 全文子串检索提供远古消息召回（前端搜索 / 后续 agent 工具
//   复用）。中文子串在 SQLite 内置 FTS5 tokenizer 下不可靠，单品家庭对话
//   量级下 LIKE 全表扫描足够快；将来量级大了再换分词。
//
// 驱动：Node 22.5+ 内置 node:sqlite（零 native 依赖）。
//
// 多租户(Phase 1.2):getTimelineDb(tenantId) 必传,内部走 per-tenant db 文件。
// 调用方负责解析 request ctx(详见 lib/auth-resolve.ts),不允许走 default 兜底。
// 详见 lib/tenant-store.ts + docs/v3/CLOUD-EDGE-BLUEPRINT.md §5.3。

import type { DatabaseSync } from "node:sqlite"
import { createHash } from "node:crypto"
import { getTenantDb } from "./tenant-store"

const ACTIVE_ENGINE_SESSION_KEY = "active_engine_session"
const TIMELINE_TITLE_KEY = "timeline_title"

export interface TimelineMessage {
  id: number
  role: "user" | "assistant"
  content: string
  ts: string
  model?: string | null
  engineId: string | null
}

/** per-tenant 时间线 db。tenantId 必传,绝不兜底 default。 */
export function getTimelineDb(tenantId: string): DatabaseSync {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("getTimelineDb: tenantId is required")
  }
  return getTenantDb(tenantId)
}

/** 幂等追加一条消息。engineId 相同则跳过（返回既有行 id）。 */
export function appendTimelineMessage(
  tenantId: string,
  input: {
    role: "user" | "assistant"
    content: string
    ts?: string | number
    model?: string
    engineId?: string
  },
): number {
  const target = getTimelineDb(tenantId)
  const ts =
    typeof input.ts === "number"
      ? new Date(input.ts < 1e12 ? input.ts * 1000 : input.ts).toISOString()
      : input.ts || new Date().toISOString()
  const engineId = input.engineId ? hashEngineId(input.engineId) : null

  if (engineId) {
    const existing = target
      .prepare("SELECT id FROM messages WHERE engine_id = ?")
      .get(engineId) as { id: number } | undefined
    if (existing) return existing.id
  }

  const stmt = target.prepare(
    "INSERT INTO messages (role, content, ts, model, engine_id) VALUES (?, ?, ?, ?, ?)",
  )
  const result = stmt.run(
    input.role,
    input.content,
    ts,
    input.model ?? null,
    engineId,
  )
  return Number(result.lastInsertRowid)
}

function hashEngineId(engineId: string): string {
  return createHash("sha256").update(engineId).digest("base64url").slice(0, 32)
}

/** 分页读最近消息（QQ 式上拉加载更早历史）。beforeId 为空时取最新。 */
export function listTimelineMessages(
  tenantId: string,
  options: {
    beforeId?: number
    limit?: number
  },
): { messages: TimelineMessage[]; hasMore: boolean } {
  const target = getTimelineDb(tenantId)
  const limit = Math.max(1, Math.min(200, options.limit ?? 30))

  let rows: Array<{
    id: number
    role: string
    content: string
    ts: string
    model: string | null
    engine_id: string | null
  }>
  if (options.beforeId) {
    rows = target
      .prepare(
        `SELECT id, role, content, ts, model, engine_id
         FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?`,
      )
      .all(options.beforeId, limit) as typeof rows
  } else {
    rows = target
      .prepare(
        `SELECT id, role, content, ts, model, engine_id
         FROM messages ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as typeof rows
  }

  const messages = rows
    .reverse()
    .map((row) => ({
      id: Number(row.id),
      role: row.role as "user" | "assistant",
      content: row.content,
      ts: row.ts,
      model: row.model,
      engineId: row.engine_id,
    }))

  const hasMore =
    messages.length > 0 &&
    (() => {
      const oldest = messages[0].id
      const probe = target
        .prepare("SELECT 1 AS one FROM messages WHERE id < ? LIMIT 1")
        .get(oldest) as { one: number } | undefined
      return Boolean(probe)
    })()

  return { messages, hasMore }
}

export interface TimelineSearchResult {
  id: number
  role: "user" | "assistant"
  content: string
  ts: string
  model: string | null
  snippet: string
}

/** 子串全文检索（LIKE）。按时间倒序返回命中。 */
export function searchTimelineMessages(
  tenantId: string,
  query: string,
  limit = 10,
): TimelineSearchResult[] {
  const target = getTimelineDb(tenantId)
  const cleaned = query.trim().slice(0, 200)
  if (!cleaned) return []

  const rows = target
    .prepare(
      `SELECT id, role, content, ts, model
       FROM messages WHERE content LIKE ? ORDER BY id DESC LIMIT ?`,
    )
    .all(`%${cleaned}%`, Math.max(1, Math.min(50, limit))) as Array<{
    id: number
    role: string
    content: string
    ts: string
    model: string | null
  }>

  const snippetOf = (content: string, needle: string): string => {
    const idx = content.toLowerCase().indexOf(needle.toLowerCase())
    if (idx < 0) return content.slice(0, 48)
    const start = Math.max(0, idx - 12)
    const end = Math.min(content.length, idx + needle.length + 36)
    const prefix = start > 0 ? "…" : ""
    const suffix = end < content.length ? "…" : ""
    return `${prefix}${content.slice(start, end)}${suffix}`
  }

  return rows.map((row) => ({
    id: Number(row.id),
    role: row.role as "user" | "assistant",
    content: row.content,
    ts: row.ts,
    model: row.model,
    snippet: snippetOf(row.content, cleaned),
  }))
}

export function getTimelineMeta(tenantId: string, key: string): string | null {
  const row = getTimelineDb(tenantId)
    .prepare("SELECT value FROM timeline_meta WHERE key = ?")
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setTimelineMeta(tenantId: string, key: string, value: string): void {
  getTimelineDb(tenantId)
    .prepare(
      "INSERT INTO timeline_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value)
}

/** 当前 pi 引擎会话 id（min hui恢复/压缩分裂时跟随最新）。 */
export function getActiveEngineSession(tenantId: string): string | null {
  return getTimelineMeta(tenantId, ACTIVE_ENGINE_SESSION_KEY)
}

export function setActiveEngineSession(tenantId: string, sessionId: string): void {
  setTimelineMeta(tenantId, ACTIVE_ENGINE_SESSION_KEY, sessionId)
}

/** 自动标题（首条 user 消息摘取，空则用占位）。 */
export function getTimelineTitle(tenantId: string): string {
  const stored = getTimelineMeta(tenantId, TIMELINE_TITLE_KEY)
  if (stored) return stored
  const first = getTimelineDb(tenantId)
    .prepare(
      "SELECT content FROM messages WHERE role = 'user' ORDER BY id ASC LIMIT 1",
    )
    .get() as { content: string } | undefined
  if (!first) return "家庭对话"
  const title = first.content.trim().slice(0, 24)
  setTimelineMeta(tenantId, TIMELINE_TITLE_KEY, title)
  return title
}

export function statsTimeline(tenantId: string): { count: number; lastId: number | null } {
  const row = getTimelineDb(tenantId)
    .prepare("SELECT COUNT(*) AS count, MAX(id) AS last_id FROM messages")
    .get() as { count: number; last_id: number | null }
  return { count: Number(row.count), lastId: row.last_id == null ? null : Number(row.last_id) }
}

export { ACTIVE_ENGINE_SESSION_KEY, TIMELINE_TITLE_KEY }
