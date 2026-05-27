import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { chatService } from './service.js'
import { reactGraph, ChatReActState } from './graph.js'
import { llmService } from '../llm-provider/service.js'

interface StreamBody {
  messages: Array<{ role: string; content: string }>
}

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '').trim()
}

async function handleStreamPost(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as StreamBody

  if (!body.messages || body.messages.length === 0) {
    reply.code(400)
    return { status: 'error', error: 'INVALID_PARAMS', message: 'messages are required' }
  }

  const lastUserMsg = body.messages[body.messages.length - 1]
  try { chatService.ensureConversation(1) } catch {}
  chatService.addConversationMessage(1, lastUserMsg.role, lastUserMsg.content)

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

  try {
    // Check if this is a tool-trigger message
    const isToolTrigger = lastUserMsg.content.includes('调用工具') || lastUserMsg.content.toLowerCase().includes('tool')

    if (isToolTrigger) {
      // ── LangGraph ReAct Loop ──
      const initialInput: string = lastUserMsg.content
      const history = body.messages.slice(0, -1)

      const initialState = ChatReActState.create({
        messages: history,
        input: initialInput,
        conversationId: 1,
        currentToolCall: undefined,
        isComplete: false,
        finalResponse: '',
        error: undefined,
      })

      // Run the graph
      const finalState: typeof ChatReActState.State = await reactGraph.invoke(initialState)

      // Emit thinking + final content from each assistant message
      for (const msg of finalState.messages) {
        if (msg.role === 'assistant') {
          // If it has tool_calls, emit as tool_start events
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            const thinkingContent = msg.content || ''
            if (thinkingContent) {
              reply.raw.write(`data: ${JSON.stringify({ content: ` thinking\n${thinkingContent}\n response`, done: false })}\n\n`)
              flush()
            }
            for (const tc of msg.tool_calls) {
              let args = {}
              try { args = JSON.parse(tc.function.arguments) } catch {}
              reply.raw.write(`data: ${JSON.stringify({ type: 'tool_start', call_id: tc.id, name: tc.function.name, args })}\n\n`)
              flush()
            }
          } else {
            // Plain assistant content
            reply.raw.write(`data: ${JSON.stringify({ content: ` response\n\n${msg.content}`, done: false })}\n\n`)
            flush()
          }
        } else if (msg.role === 'tool') {
          // Emit tool_end events from tool messages
          const historyToolCall = finalState.messages.find(
            (m: any) => m.role === 'assistant' && m.tool_calls?.length > 0
          )
          const callId = historyToolCall?.tool_calls?.[0]?.id || 'unknown'

          let parsed = { error: 'unknown' }
          try { parsed = JSON.parse(msg.content) } catch {}

          reply.raw.write(`data: ${JSON.stringify({
            type: 'tool_end',
            call_id: callId,
            status: parsed.error ? 'error' : 'success',
            result: parsed.error ? undefined : parsed,
            error: parsed.error,
          })}\n\n`)
          flush()
        }
      }

      // Save to DB
      for (const msg of finalState.messages) {
        if (msg.role === 'assistant') {
          const toolCallsJson = msg.tool_calls?.length
            ? JSON.stringify(msg.tool_calls)
            : null
          chatService.addConversationMessage(1, 'assistant', msg.content || '', toolCallsJson)
        } else if (msg.role === 'tool') {
          chatService.addConversationMessage(1, 'tool', msg.content, null, null, msg.tool_call_id)
        }
      }

      // Emit done
      const finalText = finalState.finalResponse || finalState.messages
        .filter((m: any) => m.role === 'assistant' && !m.tool_calls?.length)
        .map((m: any) => m.content)
        .join('\n') || ''

      if (finalText) {
        reply.raw.write(`data: ${JSON.stringify({ content: finalText, done: false })}\n\n`)
        flush()
      }

      reply.raw.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`)
      flush()
    } else {
      // ── Plain LLM stream (no tool calls) ──
      const stream = llmService.chatStream({ messages: body.messages })
      let accumulated = ''

      for await (const delta of stream) {
        if (delta.delta) {
          accumulated += delta.delta
          reply.raw.write(`data: ${JSON.stringify({ content: delta.delta, done: false })}\n\n`)
          flush()
        }
      }

      const storedContent = accumulated
        .replace(/ thinking[\s\S]*?<\/think>/g, '')
        .replace(/ thinking[\s\S]*/g, '')
        .trim()
      chatService.addConversationMessage(1, 'assistant', storedContent)
      reply.raw.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`)
      flush()
    }
  } catch (err) {
    const errMsg = (err as Error).message
    reply.raw.write(`data: ${JSON.stringify({ error: errMsg, done: true })}\n\n`)
    flush()
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