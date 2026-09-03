// HomeSense v3 — pi 引擎事件 → SQLite 时间线镜像
//
// 挂在 AgentSessionWrapper.start() 的 subscribe 里（服务端常驻进程），
// 把引擎每个回合落定的 user / assistant 消息同步进 timeline-db。
// 镜像在服务端事件流做，刷新页面不丢消息。

import {
  appendTimelineMessage,
  setActiveEngineSession,
} from "./timeline-db"
import type { AgentEvent } from "./rpc-manager"

type MessageLike = {
  role?: string
  content?:
    | string
    | Array<
        | { type: string; text?: string; thinking?: string }
        | { type: string; [key: string]: unknown }
      >
  timestamp?: number
  model?: string
  provider?: string
}

function textOfMessage(msg: MessageLike | undefined): string {
  if (!msg) return ""
  const content = msg.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return ""
      if (block.type === "text") return block.text ?? ""
      if (block.type === "thinking") return block.thinking ?? ""
      return ""
    })
    .join("")
}

function isUserOrAssistant(msg: MessageLike | undefined): msg is MessageLike & { role: "user" | "assistant" } {
  return Boolean(msg) && (msg?.role === "user" || msg?.role === "assistant")
}

function timeOfMessage(msg: MessageLike): number {
  const ts = msg.timestamp
  if (typeof ts === "number") return ts
  return Date.now()
}

function messageSignature(
  engineSessionId: string,
  msg: MessageLike,
): string {
  // 事件没有稳定消息 id；用 会话+角色+时间戳+内容 组合做防御性去重。
  return `${engineSessionId}:${msg.role}:${timeOfMessage(msg)}:${textOfMessage(msg).length}`
}

/**
 * 把引擎事件镜像进时间线。只在 message_end（最终内容）落库；
 * 中间 message_start/message_update 不写，避免流式增量污染。
 *
 * Phase 1.2: tenantId 必传,写 per-tenant db。无 tenantId → 抛错(防止
 * default 库污染,新数据必须走调用方 ctx 解析出来的 tenant)。
 */
export function mirrorAgentEventToTimeline(
  tenantId: string,
  engineSessionId: string,
  event: AgentEvent,
): void {
  if (!tenantId) {
    console.error("[timeline] mirrorAgentEventToTimeline: missing tenantId, dropping event", event.type)
    return
  }
  try {
    if (event.type === "message_end") {
      const msg = event.message as MessageLike | undefined
      if (!isUserOrAssistant(msg)) return
      appendTimelineMessage(tenantId, {
        role: msg.role,
        content: textOfMessage(msg),
        ts: timeOfMessage(msg),
        model: msg.model,
        engineId: messageSignature(engineSessionId, msg),
      })
      setActiveEngineSession(tenantId, engineSessionId)
    }
  } catch (error) {
    // 镜像失败不阻断 chat（时间线是尽力而为的补充存储）。
    console.error("[timeline] mirror failed:", error instanceof Error ? error.message : error)
  }
}