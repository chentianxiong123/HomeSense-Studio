import type { DisplayMessage, ToolCallState } from '../../composables/useChat'
import { parseAppDate } from '../../utils/chinaTime'

export interface PersistedChatRow {
  id: number
  role: string
  content: string
  tool_calls_json?: string | null
  tool_call_id?: string | null
  created_at?: string | null
}

export function normalizePersistedMessages(rows: PersistedChatRow[]): DisplayMessage[] {
  const displayMessages: DisplayMessage[] = []
  const toolCallIndex = new Map<string, ToolCallState>()

  for (const row of rows) {
    if (row.role === 'tool') {
      const callId = String(row.tool_call_id ?? '').trim()
      const toolCall = callId ? toolCallIndex.get(callId) : undefined
      if (toolCall) {
        const parsed = parseToolResult(row.content)
        toolCall.status = parsed.error ? 'error' : 'success'
        toolCall.result = parsed.error ? undefined : parsed
        toolCall.error = parsed.error
        toolCall.device = parsed.device ?? parsed.result?.device ?? toolCall.device
        toolCall.capability = parsed.capability ?? toolCall.capability
        toolCall.predictedEffect = parsed.predicted_effect
        toolCall.nextStep = parsed.next_step
      }
      continue
    }

    const toolCalls = parsePersistedToolCalls(row.tool_calls_json)
    const lastMessage = displayMessages[displayMessages.length - 1]
    if (
      row.role === 'assistant'
      && toolCalls.length === 0
      && lastMessage?.role === 'assistant'
      && !lastMessage.content
      && (lastMessage.toolCalls?.length ?? 0) > 0
    ) {
      lastMessage.content = row.content
      lastMessage.timestamp = parseAppDate(row.created_at ?? '') ?? lastMessage.timestamp
      continue
    }

    const message: DisplayMessage = {
      id: `msg_${row.id}`,
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content,
      thinking: '',
      thinkingExpanded: false,
      status: 'final',
      timestamp: parseAppDate(row.created_at ?? '') ?? new Date(),
      toolCalls,
      runtimeTrace: [],
      traceExpanded: false,
    }
    for (const toolCall of message.toolCalls ?? []) {
      toolCallIndex.set(toolCall.call_id, toolCall)
    }
    displayMessages.push(message)
  }

  return displayMessages
}

function parsePersistedToolCalls(value: string | null | undefined): ToolCallState[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map((tc: any) => ({
      call_id: String(tc.id ?? tc.call_id ?? ''),
      name: String(tc.function?.name ?? tc.name ?? ''),
      args: parseJsonRecord(tc.function?.arguments ?? tc.arguments),
      status: 'success' as const,
      expanded: false,
    })).filter((tc: ToolCallState) => tc.call_id && tc.name)
  } catch {
    return []
  }
}

function parseToolResult(content: string): any {
  const parsed = parseJsonRecord(content)
  return Object.keys(parsed).length > 0 ? parsed : { raw: content }
}

function parseJsonRecord(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return isRecord(value) ? value as Record<string, any> : {}
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
