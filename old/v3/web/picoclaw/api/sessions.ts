import { launcherFetch } from "@pico/api/http"

// HomeSense v3 — pi 引擎会话桥。
//
// PicoClaw 前端期望的会话列表/历史结构,由 pi-web 的 REST API 提供:
//   GET /api/sessions          → { sessions: SessionInfo[], runningSessionIds }
//   GET /api/sessions/:id      → { context: { messages: AgentMessage[] }, ... }
// 这里做一次形状适配,组件层零改动。

export interface SessionSummary {
  id: string
  title: string
  preview: string
  message_count: number
  created: string
  updated: string
}

interface PiSessionInfo {
  id?: string
  path?: string
  cwd?: string
  name?: string
  created?: string
  modified?: string
  messageCount?: number
  firstMessage?: string
}

interface PiMessageLike {
  role?: string
  content?:
    | string
    | (
        | { type: "text"; text?: string }
        | { type: string; [key: string]: unknown }
      )[]
  timestamp?: number
  model?: string
}

export interface SessionDetail {
  id: string
  messages: {
    role: "user" | "assistant"
    content: string
    created_at?: string
    kind?: "normal" | "thought" | "tool_calls"
    model_name?: string
    media?: string[]
    attachments?: {
      type?: "image" | "audio" | "video" | "file"
      url: string
      filename?: string
      content_type?: string
    }[]
    tool_calls?: {
      id?: string
      type?: string
      function?: {
        name?: string
        arguments?: string
      }
      extra_content?: {
        tool_feedback_explanation?: string
      }
    }[]
  }[]
  summary: string
  created: string
  updated: string
}

function textOfBlock(block: unknown): string {
  if (!block || typeof block !== "object") return ""
  const b = block as { type?: string }
  if (b.type === "text") return (block as { text?: string }).text ?? ""
  if (b.type === "thinking") return (block as { thinking?: string }).thinking ?? ""
  return ""
}

function contentOf(content: PiMessageLike["content"]): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map(textOfBlock).join("")
  return ""
}

function kindOf(msg: PiMessageLike): "normal" | "thought" | "tool_calls" | undefined {
  if (!Array.isArray(msg.content)) return undefined
  const blocks = msg.content as { type?: string }[]
  if (blocks.some((b) => b.type === "toolCall")) return "tool_calls"
  if (blocks.some((b) => b.type === "thinking")) return "thought"
  return "normal"
}

function toSummary(info: PiSessionInfo): SessionSummary {
  const id = info.id || info.path || ""
  return {
    id,
    title: info.name || info.firstMessage?.slice(0, 40) || "新会话",
    preview: info.firstMessage ?? "",
    message_count: info.messageCount ?? 0,
    created: info.created ?? "",
    updated: info.modified ?? info.created ?? "",
  }
}

export async function getSessions(
  offset: number = 0,
  limit: number = 20,
): Promise<SessionSummary[]> {
  const res = await launcherFetch("/api/sessions")
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions: ${res.status}`)
  }
  const data = await res.json() as { sessions?: PiSessionInfo[] } | PiSessionInfo[]
  const list = Array.isArray(data) ? data : (data.sessions ?? [])
  const summaries = list
    .filter((s) => s.id || s.path)
    .map(toSummary)
    .sort((a, b) => (a.updated < b.updated ? 1 : -1))
  return summaries.slice(offset, offset + limit)
}

export async function getSessionHistory(id: string): Promise<SessionDetail> {
  const res = await launcherFetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (res.status === 404) {
    throw new Error(`Session not found: ${id}`)
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch session ${id}: ${res.status}`)
  }
  const data = await res.json() as {
    context?: { messages?: PiMessageLike[]; firstUserEntry?: unknown }
    filePath?: string
    sessionName?: string
    modified?: string
    created?: string
    [key: string]: unknown
  }

  const messages = (data.context?.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m, index) => {
      const content = contentOf(m.content)
      const kind = kindOf(m)
      const attachments =
        m.role === "user"
          ? extractUserAttachments(m)
          : undefined
      return {
        role: m.role as "user" | "assistant",
        content,
        created_at:
          m.timestamp != null
            ? String(m.timestamp)
            : undefined,
        kind,
        model_name: m.role === "assistant" ? m.model : undefined,
        ...(attachments ? { attachments } : {}),
      }
    })
    .map((m, index) => ({
      ...m,
      tool_calls: undefined,
    }))

  return {
    id,
    messages,
    summary: "",
    created: data.created ?? "",
    updated: data.modified ?? data.created ?? "",
  }
}

function extractUserAttachments(
  m: PiMessageLike,
): SessionDetail["messages"][number]["attachments"] {
  const content = m.content as unknown
  if (!Array.isArray(content)) return undefined
  const images: SessionDetail["messages"][number]["attachments"] = []
  for (const block of content) {
    const b = block as { type?: string; data?: string; mimeType?: string }
    if (b.type === "image" && b.data) {
      images.push({
        type: "image",
        url: `data:${b.mimeType ?? "image/png"};base64,${b.data}`,
      })
    }
  }
  return images.length > 0 ? images : undefined
}

export async function deleteSession(id: string): Promise<void> {
  const res = await launcherFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete session ${id}: ${res.status}`)
  }
}