import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { chatService } from './service.js'
import { reactGraph, ChatReActState } from './graph.js'
import { buildRuntimeContextWindow } from '../runtime-context/index.js'
import { getDb } from '../../db/index.js'
import {
  buildDeviceCardProjection,
  type DeviceCardRow,
} from '../device/device-card-projection.js'
import { buildRuntimePathCandidate } from './path-candidate.js'
import { memoryAssetsService } from '../memory-assets/index.js'

// Plain LLM stream path is frozen/disabled. All messages now go through LangGraph ReAct graph.
// import { llmService } from '../llm-provider/service.js'

interface StreamBody {
  messages: Array<{ role: string; content: string }>
}

export interface SerializedGraphMessageEvents {
  events: Array<Record<string, unknown>>
  emittedPlainAssistant: boolean
}

const CHAT_CONTEXT_MESSAGE_LIMIT = 80

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '').trim()
}

function readDeviceIdFromToolArgs(args: Record<string, unknown>): number | null {
  const raw = args.device_id
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : null
}

function buildToolStartDevicePayload(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const deviceId = readDeviceIdFromToolArgs(args)
  if (deviceId == null) return undefined

  try {
    const device = getDb().prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(deviceId) as DeviceCardRow | undefined
    if (!device) return undefined
    const card = buildDeviceCardProjection(device)
    return {
      id: device.id,
      name: device.name,
      device_type: device.device_type,
      room: card.room.name,
      room_id: card.room.id,
      sources: card.sources,
      card,
    }
  } catch {
    return undefined
  }
}

function readCapabilityFromToolArgs(args: Record<string, unknown>): string | undefined {
  const value = args.capability ?? args.capability_id
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function selectLatestUserMessage(messages: Array<{ role: string; content: string }>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const content = typeof message.content === 'string' ? message.content.trim() : ''
    if (content) return content
  }
  return null
}

export function buildPromptMessagesFromConversationRows(rows: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  return rows
    .filter((row) => ['user', 'assistant', 'system'].includes(row.role))
    .map((row) => ({
      role: row.role,
      content: typeof row.content === 'string' ? row.content : '',
    }))
    .filter((row) => row.content.trim())
}

export function buildGraphMessageSseEvents(messages: any[]): SerializedGraphMessageEvents {
  const events: Array<Record<string, unknown>> = []
  let emittedPlainAssistant = false
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const thinkingContent = msg.content || ''
        if (thinkingContent) {
          events.push({ content: thinkingContent, done: false })
        }
        for (const tc of msg.tool_calls) {
          let args = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const typedArgs = args as Record<string, unknown>
          events.push({
            type: 'tool_start',
            call_id: tc.id,
            name: tc.function.name,
            args,
            device: buildToolStartDevicePayload(typedArgs),
            capability: readCapabilityFromToolArgs(typedArgs),
          })
        }
      } else {
        events.push({ content: msg.content || '', done: false })
        emittedPlainAssistant = true
      }
    } else if (msg.role === 'tool') {
      const callId = msg.tool_call_id || 'unknown'
      let parsed = { error: 'unknown' }
      try { parsed = JSON.parse(msg.content) } catch {}
      events.push({
        type: 'tool_end',
        call_id: callId,
        status: parsed.error ? 'error' : 'success',
        result: parsed.error ? undefined : parsed,
        error: parsed.error,
      })
    }
  }
  return { events, emittedPlainAssistant }
}

async function handleStreamPost(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as StreamBody

  if (!body.messages || body.messages.length === 0) {
    reply.code(400)
    return { status: 'error', error: 'INVALID_PARAMS', message: 'messages are required' }
  }

  const initialInput = selectLatestUserMessage(body.messages)
  if (!initialInput) {
    reply.code(400)
    return { status: 'error', error: 'INVALID_PARAMS', message: 'user message is required' }
  }
  try { chatService.ensureConversation(1) } catch {}
  let lastActivityAt: string | null = null
  try {
    const previous = chatService.getConversationMessages(1, undefined, 1).messages
    lastActivityAt = previous[previous.length - 1]?.created_at ?? null
  } catch {}
  chatService.addConversationMessage(1, 'user', initialInput)

  const origin = request.headers['origin'] || '*'
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })

  const flush = () => {
    if (typeof (reply.raw as any).flush === 'function') (reply.raw as any).flush()
  }
  const writeEvent = (event: Record<string, unknown>) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    flush()
  }
  const emitGraphMessages = (messages: any[]): boolean => {
    const serialized = buildGraphMessageSseEvents(messages)
    for (const event of serialized.events) writeEvent(event)
    return serialized.emittedPlainAssistant
  }

  try {
    // All messages go through LangGraph ReAct graph
    const conversationRows = chatService.getConversationMessages(1, undefined, CHAT_CONTEXT_MESSAGE_LIMIT).messages
    const inputMessages = buildPromptMessagesFromConversationRows(conversationRows)
    const runtimeContext = buildRuntimeContextWindow({
      conversationId: 1,
      messages: inputMessages,
      lastActivityAt,
    })

    const initialState: typeof ChatReActState.State = {
      messages: inputMessages,
      input: initialInput,
      conversationId: 1,
      currentToolCall: undefined,
      pendingToolCalls: [],
      isComplete: false,
      finalResponse: '',
      runtimeRoute: undefined,
      l1Command: undefined,
      runtimeTrace: [],
      runtimeContext,
      lightIntent: undefined,
      deviceInventory: [],
      error: undefined,
    }

    let finalState: typeof ChatReActState.State = initialState
    let emittedTraceCount = 0
    let emittedMessageCount = initialState.messages.length
    let emittedPlainAssistant = false
    const stream = await reactGraph.stream(initialState, { streamMode: 'values' })

    for await (const state of stream) {
      finalState = state as unknown as typeof ChatReActState.State
      const traces = finalState.runtimeTrace ?? []
      for (const trace of traces.slice(emittedTraceCount)) {
        writeEvent({ type: 'trace', trace })
      }
      emittedTraceCount = traces.length

      const messages = finalState.messages ?? []
      const justAddedMessages = messages.slice(emittedMessageCount)
      if (emitGraphMessages(justAddedMessages)) emittedPlainAssistant = true
      emittedMessageCount = messages.length
    }

    const newMessages = finalState.messages.slice(initialState.messages.length)

    const pathCandidate = buildRuntimePathCandidate({
      intent: initialInput,
      messages: newMessages,
      runtimeTrace: finalState.runtimeTrace ?? [],
      conversationId: finalState.conversationId || 1,
      originTraceId: `chat:${finalState.conversationId || 1}:${Date.now()}`,
    })
    if (pathCandidate) {
      writeEvent({ type: 'path_candidate', candidate: pathCandidate })
      try {
        memoryAssetsService.recordExperiencePath(pathCandidate)
      } catch {}
    }

    // Save to DB
    for (const msg of newMessages) {
      if (msg.role === 'assistant') {
        const toolCallsJson = msg.tool_calls?.length ? JSON.stringify(msg.tool_calls) : null
        chatService.addConversationMessage(1, 'assistant', stripThinkTags(msg.content || ''), toolCallsJson)
      } else if (msg.role === 'tool') {
        chatService.addConversationMessage(1, 'tool', msg.content, null, null, msg.tool_call_id)
      }
    }

    const finalText = finalState.finalResponse || newMessages
      .filter((m: any) => m.role === 'assistant' && !m.tool_calls?.length)
      .map((m: any) => m.content)
      .join('\n') || ''

    if (finalText && !emittedPlainAssistant) {
      writeEvent({ content: finalText, done: false })
    }

    writeEvent({ content: '', done: true })
  } catch (err) {
    const errMsg = (err as Error).message
    writeEvent({ error: errMsg, done: true })
  }

  reply.raw.end()
}

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/chat/stream', handleStreamPost)

  app.get('/api/chat/messages', async (request) => {
    const query = request.query as { cursor?: string; limit?: string }
    const limit = query.limit ? Math.min(Math.max(Number(query.limit), 1), 100) : 30
    const cursor = query.cursor ? Number(query.cursor) : undefined
    try {
      return chatService.getConversationMessages(1, cursor, limit)
    } catch {
      return { messages: [], hasMore: false }
    }
  })
}
