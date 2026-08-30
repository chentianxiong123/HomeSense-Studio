// HomeSense v3 — 持久精炼记忆（MEMORY.md / USER.md）
//
// 借鉴 hermes 的 memory_tool：agent 通过 memory 工具维护两个文件，
// 作为跨会话的持久记忆。会话启动时冻结快照注入 system prompt。
// 存成普通 Markdown 文件,用户可直接编辑。

import fs from "node:fs"
import path from "node:path"
import { getAgentDir } from "@earendil-works/pi-coding-agent"

export type MemoryTarget = "memory" | "user"

const MEMORY_BLOCK_HEADERS: Record<MemoryTarget, string> = {
  memory: "MEMORY (agent 的持久笔记)",
  user: "USER PROFILE (用户画像)",
}

/** § 分隔条目,允许多行(同 hermes) */
export const ENTRY_DELIMITER = "\n§\n"
export const MEMORY_CHAR_LIMIT = 6000

export function getMemoriesDir(): string {
  return path.join(getAgentDir(), "memories")
}

function memoryFilePath(target: MemoryTarget): string {
  return path.join(getMemoriesDir(), target === "memory" ? "MEMORY.md" : "USER.md")
}

export function readMemoryEntries(target: MemoryTarget): string[] {
  const filePath = memoryFilePath(target)
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, "utf8").trim()
  if (!raw) return []
  return raw
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function writeMemoryEntries(target: MemoryTarget, entries: string[]): void {
  const filePath = memoryFilePath(target)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const content = entries.filter(Boolean).join(ENTRY_DELIMITER)
  // 原子写,避免中途崩溃损坏
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, `${content}\n`, "utf8")
  fs.renameSync(tmp, filePath)
}

export function memoryCharCount(target: MemoryTarget): number {
  return readMemoryEntries(target).join(ENTRY_DELIMITER).length
}

export function isMemoryFull(target: MemoryTarget): boolean {
  return memoryCharCount(target) >= MEMORY_CHAR_LIMIT
}

/** memory 工具核心:add / replace / remove,基于短唯一子串匹配。 */
export function memoryAction(input: {
  action: "add" | "replace" | "remove"
  target: MemoryTarget
  content: string
}): { ok: boolean; message: string } {
  const { action, target } = input
  const content = (input.content ?? "").trim()
  if (!content) return { ok: false, message: "content 不能为空" }

  const entries = readMemoryEntries(target)

  switch (action) {
    case "add": {
      if (entries.some((entry) => entry.includes(content))) {
        return { ok: false, message: "该记忆已存在,无需重复添加" }
      }
      if (memoryCharCount(target) + content.length > MEMORY_CHAR_LIMIT) {
        return { ok: false, message: `记忆已满(${MEMORY_CHAR_LIMIT} 字符)。请先 remove 或 replace 精简。` }
      }
      entries.push(content)
      writeMemoryEntries(target, entries)
      return { ok: true, message: `已添加到 ${MEMORY_BLOCK_HEADERS[target]} (共 ${entries.length} 条)` }
    }
    case "replace": {
      const match = entries.find((entry) => entry.includes(content.slice(0, 40)))
      if (!match) {
        return { ok: false, message: "未找到要替换的记忆(用内容唯一子串指定)" }
      }
      const next = entries.map((entry) => (entry === match ? content : entry))
      writeMemoryEntries(target, next)
      return { ok: true, message: `已替换 1 条 ${MEMORY_BLOCK_HEADERS[target]} 记忆` }
    }
    case "remove": {
      const match = entries.find((entry) => entry.includes(content))
      if (!match) {
        return { ok: false, message: "未找到要删除的记忆(用内容唯一子串指定)" }
      }
      const next = entries.filter((entry) => entry !== match)
      writeMemoryEntries(target, next)
      return { ok: true, message: `已删除 1 条 ${MEMORY_BLOCK_HEADERS[target]} 记忆` }
    }
    default:
      return { ok: false, message: `未知 action: ${String(action)}` }
  }
}

/** 会话启动时的冻结快照,注入 system prompt。 */
export function buildMemorySnapshot(): string {
  const blocks: string[] = []
  for (const target of ["memory", "user"] as const) {
    const entries = readMemoryEntries(target)
    if (entries.length === 0) continue
    blocks.push(`${MEMORY_BLOCK_HEADERS[target]}:\n${entries.join(ENTRY_DELIMITER)}`)
  }
  if (blocks.length === 0) return ""
  return [
    "以下是你跨会话的持久记忆,由你通过 memory 工具维护。它们是关于用户和环境的稳定事实。",
    blocks.join("\n\n"),
  ].join("\n\n")
}