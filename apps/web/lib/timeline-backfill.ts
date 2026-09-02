// HomeSense v3 — 旧 pi 会话一次性回填到时间线
//
// 时间线 SQLite 只镜像"实现之后"的新消息。老用户升级后,之前存在
// ~/.homesense/agent/sessions/<cwd>/*.jsonl 的历史从未进过 SQLite,
// 导致 UI 看不到以前的对话。本模块在首次启动时把这些旧会话按时间
// 顺序回填进时间线,之后用 meta 标记跳过,保证幂等。
//
// 回填范围:HomeSense 引擎自己的会话目录(getAgentDir()/sessions),
// 不碰其他项目(~/.pi)的会话。

import fs from "node:fs"
import path from "node:path"
import {
  appendTimelineMessage,
  getTimelineMeta,
  setTimelineMeta,
} from "./timeline-db"
import { getTenantSessionsDir } from "./tenant-paths"

const BACKFILL_META_KEY = "legacy_backfill_done"
const BACKFILL_VERSION = "1"

interface LegacyMessageRecord {
  role: "user" | "assistant"
  content: string
  timestamp: number
  model?: string
  engineId: string
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      const b = block as { type?: string }
      if (b.type === "text") return (block as { text?: string }).text ?? ""
      if (b.type === "thinking") return (block as { thinking?: string }).thinking ?? ""
      return ""
    })
    .join("")
}

function parseUnix(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return n < 1e12 ? n * 1000 : n
}

function collectSessionMessages(filePath: string): LegacyMessageRecord[] {
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)
  const records: LegacyMessageRecord[] = []
  let sessionId = ""

  for (const line of lines) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (!entry || typeof entry !== "object") continue
    if (entry.type === "session") {
      sessionId = typeof entry.id === "string" ? entry.id : ""
      continue
    }
    if (entry.type !== "message") continue

    const message = entry.message as { role?: string; content?: unknown; model?: string; timestamp?: unknown } | undefined
    if (!message) continue
    if (message.role !== "user" && message.role !== "assistant") continue

    const content = textOfContent(message.content).trim()
    if (!content) continue

    const ts = parseUnix(message.timestamp)
    const entryId = typeof entry.id === "string" ? entry.id : ""
    records.push({
      role: message.role,
      content,
      timestamp: ts ?? 0,
      model: typeof message.model === "string" ? message.model : undefined,
      engineId: `${sessionId}:${entryId}`,
    })
  }

  return records
}

/** 把单个旧会话文件的消息追加进时间线(按文件内顺序)。 */
function importSessionFile(tenantId: string, filePath: string): number {
  const records = collectSessionMessages(filePath)
  let imported = 0
  for (const record of records) {
    try {
      appendTimelineMessage(tenantId, {
        role: record.role,
        content: record.content,
        ts: record.timestamp || undefined,
        model: record.model,
        engineId: record.engineId,
      })
      imported += 1
    } catch {
      // 单条失败不阻断整体回填
    }
  }
  return imported
}

/**
 * 幂等回填:仅在未标记完成时执行一次。
 * 顺序:按会话目录的 mtime 从旧到新,每条消息按时间线插入(时间线本身按 id 排序,
 * 这里顺序即为时间顺序)。
 *
 * Phase 1.2: tenantId 必传,只回填到当前租户自己的 db。
 */
export function backfillLegacySessionsIfNeeded(
  tenantId: string,
): { imported: number; scanned: number } {
  if (!tenantId) throw new Error("backfillLegacySessionsIfNeeded: tenantId is required")
  const doneKey = `${BACKFILL_META_KEY}:${BACKFILL_VERSION}`
  if (getTimelineMeta(tenantId, doneKey)) {
    return { imported: 0, scanned: 0 }
  }

  const sessionDir = getTenantSessionsDir(tenantId)
  if (!fs.existsSync(sessionDir)) {
    setTimelineMeta(tenantId, doneKey, new Date().toISOString())
    return { imported: 0, scanned: 0 }
  }

  const files: string[] = []
  const cwdDirs = fs.readdirSync(sessionDir)
  for (const cwdName of cwdDirs) {
    const cwdPath = path.join(sessionDir, cwdName)
    if (!fs.statSync(cwdPath).isDirectory()) continue
    for (const name of fs.readdirSync(cwdPath)) {
      if (name.endsWith(".jsonl")) files.push(path.join(cwdPath, name))
    }
  }

  // 按文件修改时间从旧到新导入,保证时间线大致有序
  files.sort((a, b) => {
    try {
      return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs
    } catch {
      return 0
    }
  })

  let imported = 0
  let scanned = 0
  for (const file of files) {
    try {
      imported += importSessionFile(tenantId, file)
      scanned += 1
    } catch (error) {
      console.error("[timeline] backfill failed for", file, error instanceof Error ? error.message : error)
    }
  }

  setTimelineMeta(tenantId, doneKey, new Date().toISOString())
  console.log(`[timeline] legacy backfill[${tenantId}]: scanned ${scanned} sessions, imported ${imported} messages`)
  return { imported, scanned }
}