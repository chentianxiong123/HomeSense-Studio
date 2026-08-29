// HomeSense v3 — pi 引擎与 PicoClaw chat store 的桥接层
//
// PicoClaw 的聊天组件只认 chatAtom(ChatMessage[]) + sendMessage。
// 原始版本用自家 gateway WebSocket；这里把底层换成 pi 的 REST + SSE：
//   - 发送:   POST /api/agent/new {cwd, type:"prompt", message}   (首条)
//   - 发送:   POST /api/agent/[id]  {type:"prompt", message}        (后续)
//   - 回流:   EventSource GET /api/agent/[id]/events                (SSE)
//   - 历史:   GET /api/sessions/[id]                                (灌入 chatAtom)
//
// 对组件层完全透明：仍暴露 connectChat / sendChatMessage /
// switchChatSession / newChatSession / disconnectChat 等旧接口。

import { toast } from "sonner"

import i18n from "@pico/i18n"

import type {
  ChatAttachment,
  ChatMessage,
  ChatToolCall,
  ContextUsage,
} from "@pico/store/chat"
import {
  getChatState,
  updateChatStore,
} from "@pico/store/chat"

const DEFAULT_CWD = "/home/a1/HomeSense-Studio-v3"

let activeSessionId = ""
let isConnecting = false
let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let shouldMaintainConnection = false
let initialized = false

interface PiSseEvent {
  type: string
  sessionId?: string
  isStreaming?: boolean
  message?: PiMessage
  assistantMessageEvent?: Record<string, unknown>
  toolCallId?: string
  toolName?: string
  errorMessage?: string
  [key: string]: unknown
}

interface PiMessage {
  role?: string
  content?:
    | string
    | (
        | { type: "text"; text?: string }
        | { type: "thinking"; thinking?: string }
        | { type: "toolCall"; toolCallId?: string; toolName?: string; input?: unknown }
        | { type: string; [key: string]: unknown }
      )[]
  timestamp?: number
  model?: string
  provider?: string
}

function newId(prefix = "msg"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function textOfMessage(msg: PiMessage | undefined): string {
  if (!msg) return ""
  const content = msg.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return ""
        if ((block as { type?: string }).type === "text") {
          return (block as { text?: string }).text ?? ""
        }
        if ((block as { type?: string }).type === "thinking") {
          return (block as { thinking?: string }).thinking ?? ""
        }
        return ""
      })
      .join("")
  }
  return ""
}

function toolCallsOfMessage(msg: PiMessage | undefined): ChatToolCall[] | undefined {
  if (!msg || !Array.isArray(msg.content)) return undefined
  const calls: ChatToolCall[] = []
  for (const block of msg.content) {
    if (block && (block as { type?: string }).type === "toolCall") {
      const b = block as { toolCallId?: string; toolName?: string; input?: unknown }
      calls.push({
        id: b.toolCallId,
        type: "function",
        function: {
          name: b.toolName,
          arguments:
            typeof b.input === "string"
              ? b.input
              : JSON.stringify(b.input ?? {}),
        },
      })
    }
  }
  return calls.length > 0 ? calls : undefined
}

function kindOfMessage(msg: PiMessage | undefined): "normal" | "thought" | "tool_calls" | undefined {
  if (!msg || !Array.isArray(msg.content)) return undefined
  const blocks = msg.content as { type?: string }[]
  if (blocks.some((b) => b.type === "toolCall")) return "tool_calls"
  if (blocks.some((b) => b.type === "thinking")) return "thought"
  return "normal"
}

/** 把 pi 历史/快照消息规范化成 PicoClaw ChatMessage */
export function toChatMessage(
  msg: PiMessage,
  fallbackId?: string,
): ChatMessage {
  const content = textOfMessage(msg)
  const toolCalls = toolCallsOfMessage(msg)
  const kind = kindOfMessage(msg)
  return {
    id: fallbackId ?? newId(),
    role: msg.role === "user" ? "user" : "assistant",
    content,
    kind: msg.role === "assistant" ? kind ?? "normal" : undefined,
    modelName: msg.model,
    toolCalls: kind === "tool_calls" ? toolCalls : undefined,
    timestamp: msg.timestamp ?? Date.now(),
  }
}

// ---------------------------------------------------------------------------
// SSE 事件 → PicoClaw 消息合并
// ---------------------------------------------------------------------------

const streamingMessageState = new Map<string, string>()

function handleSseEvent(event: PiSseEvent) {
  if (event.sessionId && event.sessionId !== activeSessionId) return

  switch (event.type) {
    case "connected":
      updateChatStore({ connectionState: "connected", isTyping: false })
      break

    case "agent_start":
      updateChatStore({ isTyping: true })
      break

    case "message_start": {
      const msg = event.message
      // pi 在受理 prompt 时会先把 user 消息本身经 SSE 推一次;
      // user 消息由 sendChatMessage 乐观插入,这里跳过避免重复气泡。
      if (!msg || msg.role === "user") break
      const key = newId("mid")
      streamingMessageState.set(key, textOfMessage(msg))
      updateChatStore((prev) => ({
        messages: [...prev.messages, toChatMessage(msg, key)],
        isTyping: true,
      }))
      break
    }

    case "message_update": {
      const ev = event.assistantMessageEvent
      if (!ev) break
      // 增量只针对最新一条 assistant 消息
      const messages = getChatState().messages
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
      if (!lastAssistant) break
      const key = lastAssistant.id

      let current = streamingMessageState.get(key) ?? lastAssistant.content
      const delta = ev as { type?: string; delta?: string; content?: string; text?: string }
      if (
        (delta.type === "text_delta" ||
          delta.type === "text_start" ||
          delta.type === "text_end" ||
          delta.type === "thinking_delta" ||
          delta.type === "thinking_start") &&
        typeof delta.delta === "string"
      ) {
        if (delta.type === "text_start" || delta.type === "thinking_start") {
          current = delta.delta
        } else {
          current += delta.delta
        }
      } else if (delta.type === "text_end") {
        current = delta.content ?? current
      } else if (delta.type === "thinking_end") {
        current = delta.content ?? current
      }
      streamingMessageState.set(key, current)

      updateChatStore((prev) => ({
        messages: prev.messages.map((m) =>
          m.id === key ? { ...m, content: current } : m,
        ),
      }))
      break
    }

    case "message_end": {
      const msg = event.message
      // 同 message_start:user 消息不落回 UI(乐观插入已覆盖),跳过。
      if (!msg || msg.role === "user") break
      const final = toChatMessage(msg)
      // 覆盖记忆的流式内容
      updateChatStore((prev) => {
        const index = [...prev.messages].reverse().findIndex((m) => m.role === "assistant")
        if (index === -1) {
          return { messages: [...prev.messages, final], isTyping: false }
        }
        const i = prev.messages.length - 1 - index
        streamingMessageState.delete(prev.messages[i].id)
        return {
          messages: prev.messages.map((m, idx) => (idx === i ? final : m)),
          isTyping: false,
        }
      })
      break
    }

    case "agent_end":
    case "prompt_done":
    case "agent_settled":
      updateChatStore({ isTyping: false })
      break

    case "prompt_error":
    case "startup_error": {
      const message = typeof event.errorMessage === "string" ? event.errorMessage : "请求失败"
      toast.error(message)
      updateChatStore({ isTyping: false })
      break
    }

    default:
      break
  }
}

// ---------------------------------------------------------------------------
// 连接管理层
// ---------------------------------------------------------------------------

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect() {
  if (!shouldMaintainConnection || !activeSessionId || reconnectTimer !== null) {
    return
  }
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 5000)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (shouldMaintainConnection && activeSessionId) {
      void connectChat()
    }
  }, delay)
}

export async function connectChat() {
  if (!activeSessionId || isConnecting) return
  if (eventSource && eventSource.readyState === EventSource.OPEN) return

  isConnecting = true
  clearReconnectTimer()
  updateChatStore({ connectionState: "connecting" })

  try {
    eventSource?.close()
    const url = `/api/agent/${encodeURIComponent(activeSessionId)}/events`
    const es = new EventSource(url)
    eventSource = es

    es.onopen = () => {
      if (eventSource !== es) return
      isConnecting = false
      reconnectAttempts = 0
      updateChatStore({ connectionState: "connected" })
    }

    es.onmessage = (raw) => {
      if (eventSource !== es) return
      try {
        const event = JSON.parse(raw.data) as PiSseEvent
        handleSseEvent(event)
      } catch {
        /* 忽略非 JSON 行 */
      }
    }

    es.onerror = () => {
      if (eventSource !== es) return
      isConnecting = false
      updateChatStore({ connectionState: "error" })
      es.close()
      if (eventSource === es) eventSource = null
      scheduleReconnect()
    }
  } catch {
    isConnecting = false
    updateChatStore({ connectionState: "error" })
    scheduleReconnect()
  }
}

export function disconnectChat() {
  shouldMaintainConnection = false
  clearReconnectTimer()
  isConnecting = false
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  // pi 引擎常驻:断开只是停掉 SSE,不代表离线
  updateChatStore({ connectionState: "connected" })
}

// ---------------------------------------------------------------------------
// 会话读写
// ---------------------------------------------------------------------------

async function piSend(partial: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/agent/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: DEFAULT_CWD, ...partial }),
  })
  const body = await res.json().catch(() => ({})) as {
    error?: string
    sessionId?: string
    data?: unknown
    code?: string
    accepted?: boolean
  }
  if (!res.ok || body.error) {
    const err = new Error(body.error ?? `HTTP ${res.status}`)
    ;(err as unknown as { code?: string }).code = body.code
    ;(err as unknown as { accepted?: boolean }).accepted = body.accepted
    throw err
  }
  return body
}

async function ensureSessionAndFetchHistory(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "Cache-Control": "no-cache" },
  })
  if (!res.ok || res.status === 404) {
    return []
  }
  const data = await res.json() as { context?: { messages?: PiMessage[] } }
  const messages = data.context?.messages ?? []
  const past: ChatMessage[] = []
  for (const m of messages) {
    past.push(toChatMessage(m, newId("hist")))
  }
  // 去重:同一会话重复拉取时,历史里 role=user 的消息会带 timestamp
  return past
}

export async function hydrateActiveSession() {
  if (!activeSessionId) return
  try {
    const history = await ensureSessionAndFetchHistory(activeSessionId)
    updateChatStore({
      messages: history,
      isTyping: false,
      connectionState: "connected",
    })
  } catch (error) {
    console.error("Failed to hydrate session:", error)
  }
}

// ---------------------------------------------------------------------------
// 对外命令
// ---------------------------------------------------------------------------

interface SendChatMessageInput {
  content: string
  attachments?: ChatAttachment[]
}

export function sendChatMessage({ content, attachments = [] }: SendChatMessageInput): boolean {
  const normalizedContent = content.trim()
  if (!normalizedContent) return false

  const id = newId("user")
  const userMessage: ChatMessage = {
    id,
    role: "user",
    content: normalizedContent,
    attachments: attachments.length > 0 ? attachments : undefined,
    timestamp: Date.now(),
  }

  updateChatStore((prev) => ({
    messages: [...prev.messages, userMessage],
    isTyping: true,
    connectionState: "connected",
  }))

  // 仅当已有真实 pi 会话(bridge 内部 activeSessionId 只在 pi 返回 sessionId 后才赋值)
  // 才走 POST /api/agent/[id];否则首次请求一步建会话+发消息。
  const hasSession = Boolean(activeSessionId)

  const send = hasSession
    ? fetch(`/api/agent/${encodeURIComponent(activeSessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "prompt", message: normalizedContent }),
      })
    : piSend({
        type: "prompt",
        message: normalizedContent,
      })

  send
    .then(async (body) => {
      const sid =
        typeof body === "object" && body && typeof (body as { sessionId?: string }).sessionId === "string"
          ? (body as { sessionId: string }).sessionId
          : null
      if (sid && sid !== activeSessionId) {
        activeSessionId = sid
        updateChatStore({ activeSessionId: sid })
      }
      shouldMaintainConnection = true
      if (sid || activeSessionId) void connectChat()
    })
    .catch((error) => {
      const err = error as Error & { code?: string; accepted?: boolean }
      console.error("Failed to send prompt:", err)
      updateChatStore((prev) => ({
        messages: prev.messages.filter((m) => m.id !== id),
        isTyping: false,
      }))
      if (err.code === "prompt_rejected" && err.accepted === false) {
        updateChatStore((prev) => ({
          messages: [...prev.messages, userMessage],
        }))
      } else {
        toast.error(err.message || i18n.t("chat.sendFailed", "发送失败"))
      }
    })

  return true
}

export async function switchChatSession(sessionId: string) {
  if (sessionId === activeSessionId) return

  disconnectChat()
  activeSessionId = sessionId
  updateChatStore({ activeSessionId: sessionId })

  try {
    const history = await ensureSessionAndFetchHistory(sessionId)
    updateChatStore({
      messages: history,
      isTyping: false,
      hasHydratedActiveSession: true,
      connectionState: "connected",
    })
    shouldMaintainConnection = true
    void connectChat()
  } catch (error) {
    console.error("Failed to load session:", error)
    toast.error(i18n.t("chat.historyOpenFailed", "打开会话失败"))
  }
}

export async function newChatSession() {
  if (getChatState().messages.length === 0) return
  disconnectChat()
  activeSessionId = ""
  updateChatStore({
    messages: [],
    isTyping: false,
    hasHydratedActiveSession: true,
    connectionState: "connected",
  })
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

export function initializeChatStore() {
  if (initialized) return
  initialized = true

  // pi 引擎常驻在线:gateway 恒 running,连接状态直接 connected,输入框可用
  updateChatStore({
    connectionState: "connected",
    isTyping: false,
    hasHydratedActiveSession: true,
  })

  const stored = localStorage.getItem("picoclaw:last-session-id")
  activeSessionId = stored ?? ""
  if (activeSessionId) {
    updateChatStore({ activeSessionId: activeSessionId })
    shouldMaintainConnection = true
    void hydrateActiveSession().catch(() => undefined)
    void connectChat()
  }
}

export function teardownChatStore() {
  initialized = false
  disconnectChat()
}

export function isSessionPersisted(sessionId: string): boolean {
  return Boolean(sessionId)
}

export function readActiveSessionId(): string {
  return activeSessionId
}

export function setActiveSessionIdForTesting(sessionId: string) {
  activeSessionId = sessionId
}

export function getContextUsageState(): ContextUsage | undefined {
  return getChatState().contextUsage
}