// HomeSense v5 — Go 云大脑(gateway) 与 PicoClaw chat store 的桥接层
//
// PicoClaw 的聊天组件只认 chatAtom(ChatMessage[]) + sendMessage。
// 这里把底层接到 v5 Go 云大脑的 pico WebSocket 协议：
//   - 发送:   ws 发 {type:"message.send", payload:{content}}
//   - 回流:   ws 收 message.create / message.update / typing.* / error
//   - 历史:   GET /api/timeline  (SaaS 时间线, 与执行端无关)
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
import {
  type PicoMessage,
  handlePicoMessage,
} from "@pico/features/chat/protocol"

// ---------------------------------------------------------------------------
// Go 云大脑地址
// ---------------------------------------------------------------------------
// 浏览器直连 Go gateway (CORS 全开放, 带 token 鉴权)。
const PICO_WS_URL =
  process.env.NEXT_PUBLIC_PICO_WS_URL ??
  "ws://127.0.0.1:18790/pico/ws?token=hs-brain-dev-token"

const DEFAULT_CWD = "/home/a1/HomeSense-Studio-v3"

let activeSessionId = ""
let isConnecting = false
let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let shouldMaintainConnection = false
let initialized = false
let msgIdCounter = 0

function newId(prefix = "msg"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// WebSocket 连接管理 (对接 Go 云大脑 pico 协议)
// ---------------------------------------------------------------------------

function wsUrl(sessionId: string): string {
  const sep = PICO_WS_URL.includes("?") ? "&" : "?"
  return `${PICO_WS_URL}${sep}session_id=${encodeURIComponent(sessionId)}`
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect() {
  clearReconnectTimer()
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
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  isConnecting = true
  clearReconnectTimer()
  updateChatStore({ connectionState: "connecting" })

  try {
    const socket = new WebSocket(wsUrl(activeSessionId))
    ws = socket

    socket.onopen = () => {
      if (ws !== socket) return
      isConnecting = false
      reconnectAttempts = 0
      updateChatStore({ connectionState: "connected" })
    }

    socket.onmessage = (event) => {
      if (ws !== socket) return
      try {
        const message = JSON.parse(event.data as string) as PicoMessage
        // Go 云大脑返回的 session_id 就是连接时传入的那个
        handlePicoMessage(message, activeSessionId)
      } catch {
        console.warn("Non-JSON message from pico:", event.data)
      }
    }

    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      isConnecting = false
      updateChatStore({ connectionState: "disconnected", isTyping: false })
      if (shouldMaintainConnection) {
        scheduleReconnect()
      }
    }

    socket.onerror = () => {
      if (ws !== socket) return
      isConnecting = false
      updateChatStore({ connectionState: "error" })
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
  if (ws) {
    ws.onclose = null
    ws.onerror = null
    ws.close()
    ws = null
  }
  updateChatStore({ connectionState: "disconnected" })
}

function sendRaw(msg: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  ws.send(JSON.stringify(msg))
  return true
}

// ---------------------------------------------------------------------------
// 会话读写
// ---------------------------------------------------------------------------

async function ensureSessionAndFetchHistory(sessionId: string): Promise<ChatMessage[]> {
  void sessionId
  return []
}

export async function hydrateActiveSession() {
  if (!activeSessionId) return
  updateChatStore({
    isTyping: false,
    connectionState: "connected",
  })
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

  const id = `msg-${++msgIdCounter}-${Date.now()}`
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

  // 无 session 时先生成一个（Go 云大脑按 session_id 建会话上下文）
  if (!activeSessionId) {
    activeSessionId = newId("sess")
    updateChatStore({ activeSessionId })
  }
  shouldMaintainConnection = true
  void connectChat()

  const ok = sendRaw({
    type: "message.send",
    id,
    payload: {
      content: normalizedContent,
      media: attachments.map((a) => a.url),
    },
  })

  if (!ok) {
    updateChatStore((prev) => ({
      messages: prev.messages.filter((m) => m.id !== id),
      isTyping: false,
    }))
    toast.error(i18n.t("chat.sendFailed", "发送失败：云大脑未连接"))
  }
  return true
}

export async function switchChatSession(sessionId: string) {
  if (sessionId === activeSessionId) return
  disconnectChat()
  activeSessionId = sessionId
  updateChatStore({ activeSessionId: sessionId, messages: [], isTyping: false })
  shouldMaintainConnection = true
  void connectChat()
}

export async function newChatSession() {
  disconnectChat()
  activeSessionId = newId("sess")
  updateChatStore({
    activeSessionId,
    messages: [],
    isTyping: false,
    hasHydratedActiveSession: true,
    connectionState: "connected",
  })
  shouldMaintainConnection = true
  void connectChat()
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

  // Go 云大脑常驻:连接状态直接 connected,输入框可用
  updateChatStore({
    connectionState: "connected",
    isTyping: false,
    hasHydratedActiveSession: true,
  })

  void (async () => {
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
  void writeStoredSessionId
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