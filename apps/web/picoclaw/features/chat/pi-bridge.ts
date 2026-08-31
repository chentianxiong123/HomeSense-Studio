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
import { writeStoredSessionId } from "@pico/features/chat/state"

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
        return ""
      })
      .join("")
  }
  return ""
}

function thinkingOfMessage(msg: PiMessage | undefined): string {
  if (!msg || !Array.isArray(msg.content)) return ""
  return msg.content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      if ((block as { type?: string }).type === "thinking") {
        return (block as { thinking?: string }).thinking ?? ""
      }
      return ""
    })
    .join("")
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
  const blocks = msg.content as { type?: string; text?: string; thinking?: string }[]
  if (blocks.some((b) => b.type === "toolCall")) return "tool_calls"
  const hasText = blocks.some(
    (b) => b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0,
  )
  // 有正文时按 normal 渲染(思考单独折叠展示),只有思考块(工具轮中间步骤)才标 thought。
  if (hasText) return "normal"
  if (blocks.some((b) => b.type === "thinking")) return "thought"
  return "normal"
}

/** 把 pi 历史/快照消息规范化成 PicoClaw ChatMessage */
export function toChatMessage(
  msg: PiMessage,
  fallbackId?: string,
): ChatMessage {
  const content = textOfMessage(msg)
  const thinking = thinkingOfMessage(msg)
  const toolCalls = toolCallsOfMessage(msg)
  const kind = kindOfMessage(msg)
  return {
    id: fallbackId ?? newId(),
    role: msg.role === "user" ? "user" : "assistant",
    content,
    thinking: thinking || undefined,
    kind: msg.role === "assistant" ? kind ?? "normal" : undefined,
    modelName: msg.model,
    toolCalls: kind === "tool_calls" ? toolCalls : undefined,
    timestamp: msg.timestamp ?? Date.now(),
  }
}

// ---------------------------------------------------------------------------
// SSE 事件 → PicoClaw 消息合并
// ---------------------------------------------------------------------------

const streamingMessageState = new Map<string, { content: string; thinking: string }>()

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
      streamingMessageState.set(key, {
        content: textOfMessage(msg),
        thinking: thinkingOfMessage(msg),
      })
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

      const current = streamingMessageState.get(key) ?? {
        content: lastAssistant.content,
        thinking: lastAssistant.thinking ?? "",
      }
      const delta = ev as { type?: string; delta?: string; content?: string; text?: string }

      switch (delta.type) {
        case "text_start":
          current.content = delta.delta ?? ""
          break
        case "text_delta":
          current.content += delta.delta ?? ""
          break
        case "text_end":
          current.content = delta.content ?? current.content
          break
        case "thinking_start":
          current.thinking = delta.delta ?? ""
          break
        case "thinking_delta":
          current.thinking += delta.delta ?? ""
          break
        case "thinking_end":
          current.thinking = delta.content ?? current.thinking
          break
        default:
          break
      }
      streamingMessageState.set(key, current)

      updateChatStore((prev) => ({
        messages: prev.messages.map((m) =>
          m.id === key
            ? {
              ...m,
              content: current.content,
              thinking: current.thinking || undefined,
            }
            : m,
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
      // 持续 3 次连不上(events endpoint 404 意味着 sessionId 在 server 已不存在,
      // 比如 server 端清掉了 ~/.homesense/agent/sessions/ 后 dev 重启)。
      // 清掉本地持有的 sessionId,让用户下一次发消息触发新 session(piSend 走
      // /api/agent/new 自动 ensure_session)。避免无限 404 重试卡死 UI。
      if (reconnectAttempts >= 2) {
        const stale = activeSessionId
        activeSessionId = ""
        reconnectAttempts = 0
        clearReconnectTimer()
        if (stale) {
          updateChatStore({ activeSessionId: "" })
          console.warn(`[pi-bridge] 丢弃失效的 sessionId: ${stale.slice(0, 8)}… — 下次发消息会建新 session`)
        }
        return
      }
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

  // v3: 始终用 server 端的 activeSessionId(注册时绑定到 tenants.active_session_id)
  // 走 /api/agent/[id]。无 activeSessionId 时才退化到 /api/agent/new(注册刚完成到
  // 第一次 me 请求之间的极短窗口)。
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

interface TimelineMessageDto {
  id: number
  role: "user" | "assistant"
  content: string
  ts: string
  model: string | null
}

interface TimelinePageDto {
  messages?: TimelineMessageDto[]
  title?: string
  activeSessionId?: string | null
  stats?: { count: number; lastId: number | null }
}

async function fetchTimelinePage(beforeId?: number): Promise<TimelinePageDto> {
  const qs = beforeId ? `?before=${beforeId}` : ""
  const res = await fetch(`/api/timeline${qs}`, {
    headers: { "Cache-Control": "no-cache" },
  })
  if (!res.ok) throw new Error(`Failed to fetch timeline: ${res.status}`)
  return (await res.json()) as TimelinePageDto
}

function timelineMessageToChatMessage(dto: TimelineMessageDto): ChatMessage {
  return {
    id: `tl-${dto.id}`,
    role: dto.role,
    content: dto.content,
    modelName: dto.model ?? undefined,
    timestamp: dto.ts ? Date.parse(dto.ts) : Date.now(),
    timelineId: dto.id,
  }
}

/** 上拉加载更早的历史消息；返回是否有更早数据。 */
export async function loadEarlierTimeline(beforeId: number): Promise<ChatMessage[]> {
  const page = await fetchTimelinePage(beforeId)
  if (!page.messages) return []
  return page.messages.map(timelineMessageToChatMessage)
}

export function initializeChatStore() {
  if (initialized) return
  initialized = true

  // pi 引擎常驻在线:gateway 恒 running,连接状态直接 connected,输入框可用
  updateChatStore({
    connectionState: "connected",
    isTyping: false,
    hasHydratedActiveSession: true,
  })

  void (async () => {
    // v3: activeSessionId 由 server 绑定(注册时生成,存 tenants.db.active_session_id),
    // 前端不存 localStorage 也不自己建。直接读 /api/auth/me 拿权威值。
    let serverSessionId = ""
    try {
      const meRes = await fetch("/api/auth/me", { credentials: "same-origin" })
      if (meRes.ok) {
        const me = (await meRes.json()) as { authenticated?: boolean; activeSessionId?: string | null }
        if (me.authenticated && typeof me.activeSessionId === "string" && me.activeSessionId) {
          serverSessionId = me.activeSessionId
        }
      }
    } catch {
      /* me 不可用就走 timeline */
    }

    if (!serverSessionId) {
      // 后退:从 /api/timeline 的 activeSessionId 拿(老路径)
      try {
        const tl = await fetch("/api/timeline", { credentials: "same-origin" })
        if (tl.ok) {
          const tj = (await tl.json()) as { activeSessionId?: string | null }
          if (typeof tj.activeSessionId === "string" && tj.activeSessionId) {
            serverSessionId = tj.activeSessionId
          }
        }
      } catch { /* ignore */ }
    }

    let messages: ChatMessage[] = []
    try {
      const page = await fetchTimelinePage()
      messages = (page.messages ?? []).map(timelineMessageToChatMessage)
    } catch { /* 时间线不可用,继续 */ }

    if (serverSessionId) {
      activeSessionId = serverSessionId
      shouldMaintainConnection = true
      updateChatStore({
        activeSessionId: serverSessionId,
        messages,
        hasHydratedActiveSession: true,
        connectionState: "connected",
      })
      void connectChat()
    } else {
      // 极端:server 还没生成 sessionId(用户刚注册还没首次 prompt 前的极短窗口)。
      // 仍正常进入 chat,等用户发消息时 server 自动建。
      updateChatStore({
        activeSessionId: "",
        messages,
        hasHydratedActiveSession: true,
        connectionState: "connected",
      })
    }
  })()
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