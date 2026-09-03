// HomeSense v3 — 持久精炼记忆（MEMORY.md / USER.md）
//
// 借鉴 hermes 的 memory_tool：agent 通过 memory 工具维护两个文件，
// 作为跨会话的持久记忆。会话启动时冻结快照注入 system prompt。
// 存成普通 Markdown 文件,用户可直接编辑。
//
// Phase 1.3: per-tenant 隔离。MEMORY.md / USER.md 按 tenantId 分目录,
// 防止多用户共用 server 时互相看到对方的笔记 / 画像。
// 路径: data/<tenantId>/.homesense/agent/memories/{MEMORY,USER}.md
// (跟 pi 引擎的 getAgentDir() 推到 ~/.homesense/agent 的派生方式对齐,
//  保持跟 v2 单机部署的 mental model 一致。)

import fs from "node:fs"
import path from "node:path"

import { getTenantMemoryDir, getTenantMemoryFile, getTenantUserFile } from "./tenant-paths"
import { ensureTenantData } from "./tenant-bootstrap"

export type MemoryTarget = "memory" | "user"

const MEMORY_BLOCK_HEADERS: Record<MemoryTarget, string> = {
  memory: "MEMORY (agent 的持久笔记)",
  user: "USER PROFILE (用户画像)",
}

/** § 分隔条目,允许多行(同 hermes) */
export const ENTRY_DELIMITER = "\n§\n"
export const MEMORY_CHAR_LIMIT = 6000

/** 记忆根目录。tenantId 必传: data/tenants/<tenantId>/.homesense/agent/memories */
export function getMemoriesDir(tenantId: string): string {
  if (!tenantId) throw new Error("getMemoriesDir: tenantId is required")
  return getTenantMemoryDir(tenantId)
}

function memoryFilePath(tenantId: string, target: MemoryTarget): string {
  return target === "memory" ? getTenantMemoryFile(tenantId) : getTenantUserFile(tenantId)
}

export function readMemoryEntries(tenantId: string, target: MemoryTarget): string[] {
  if (!tenantId) throw new Error("readMemoryEntries: tenantId is required")
  ensureTenantData(tenantId)
  const filePath = memoryFilePath(tenantId, target)
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, "utf8").trim()
  if (!raw) return []
  return raw
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function writeMemoryEntries(tenantId: string, target: MemoryTarget, entries: string[]): void {
  if (!tenantId) throw new Error("writeMemoryEntries: tenantId is required")
  ensureTenantData(tenantId)
  const filePath = memoryFilePath(tenantId, target)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const content = entries.filter(Boolean).join(ENTRY_DELIMITER)
  // 原子写,避免中途崩溃损坏
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, `${content}\n`, "utf8")
  fs.renameSync(tmp, filePath)
}

export function memoryCharCount(tenantId: string, target: MemoryTarget): number {
  return readMemoryEntries(tenantId, target).join(ENTRY_DELIMITER).length
}

export function isMemoryFull(tenantId: string, target: MemoryTarget): boolean {
  return memoryCharCount(tenantId, target) >= MEMORY_CHAR_LIMIT
}

/** memory 工具核心:add / replace / remove,基于短唯一子串匹配。 */
export function memoryAction(
  tenantId: string,
  input: {
    action: "add" | "replace" | "remove"
    target: MemoryTarget
    content: string
  },
): { ok: boolean; message: string } {
  if (!tenantId) {
    return { ok: false, message: "memoryAction: tenantId is required" }
  }
  const { action, target } = input
  const content = (input.content ?? "").trim()
  if (!content) return { ok: false, message: "content 不能为空" }

  const entries = readMemoryEntries(tenantId, target)

  switch (action) {
    case "add": {
      if (entries.some((entry) => entry.includes(content))) {
        return { ok: false, message: "该记忆已存在,无需重复添加" }
      }
      if (memoryCharCount(tenantId, target) + content.length > MEMORY_CHAR_LIMIT) {
        return { ok: false, message: `记忆已满(${MEMORY_CHAR_LIMIT} 字符)。请先 remove 或 replace 精简。` }
      }
      entries.push(content)
      writeMemoryEntries(tenantId, target, entries)
      return { ok: true, message: `已添加到 ${MEMORY_BLOCK_HEADERS[target]} (共 ${entries.length} 条)` }
    }
    case "replace": {
      const match = entries.find((entry) => entry.includes(content.slice(0, 40)))
      if (!match) {
        return { ok: false, message: "未找到要替换的记忆(用内容唯一子串指定)" }
      }
      const next = entries.map((entry) => (entry === match ? content : entry))
      writeMemoryEntries(tenantId, target, next)
      return { ok: true, message: `已替换 1 条 ${MEMORY_BLOCK_HEADERS[target]} 记忆` }
    }
    case "remove": {
      const match = entries.find((entry) => entry.includes(content))
      if (!match) {
        return { ok: false, message: "未找到要删除的记忆(用内容唯一子串指定)" }
      }
      const next = entries.filter((entry) => entry !== match)
      writeMemoryEntries(tenantId, target, next)
      return { ok: true, message: `已删除 1 条 ${MEMORY_BLOCK_HEADERS[target]} 记忆` }
    }
    default:
      return { ok: false, message: `未知 action: ${String(action)}` }
  }
}

/** 会话启动时的冻结快照,注入 system prompt。 */
export function buildMemorySnapshot(tenantId: string): string {
  if (!tenantId) return ""
  const blocks: string[] = []
  for (const target of ["memory", "user"] as const) {
    const entries = readMemoryEntries(tenantId, target)
    if (entries.length === 0) continue
    blocks.push(`${MEMORY_BLOCK_HEADERS[target]}:\n${entries.join(ENTRY_DELIMITER)}`)
  }
  if (blocks.length === 0) return ""
  return [
    "以下是你跨会话的持久记忆,由你通过 memory 工具维护。它们是关于用户和环境的稳定事实。",
    blocks.join("\n\n"),
  ].join("\n\n")
}
