import type { FastifyInstance } from 'fastify'
import { agentRuntime } from '../agent-runtime/index.js'
import { conversationService } from '../conversation/index.js'

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (request) => {
    const body = request.body as {
      message: string
      conversation_id?: number
      channel?: string
      user_id?: string
      agent_instance_id?: number
      working_context?: Record<string, unknown>
    }
    const message = body.message
    if (!message) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing message parameter' }
    }

    const started = conversationService.createOrAttach({
      conversation_id: body.conversation_id,
      channel: body.channel,
      user_id: body.user_id,
      agent_instance_id: body.agent_instance_id,
      surface: 'chat',
      working_context: body.working_context,
    })
    const conversationId = started.conversation_id

    conversationService.appendMessage(conversationId, 'user', message)
    const contextRecord = conversationService.getContext(conversationId, 20)

    const response = await agentRuntime.processMessage(message, {
      conversation_id: conversationId,
      history: contextRecord.history.slice(0, -1),
      channel: contextRecord.session.channel,
      user_id: contextRecord.session.user_id,
      agent_instance_id: contextRecord.session.agent_instance_id,
      working_context: parseJson(contextRecord.session.working_context_json, {}),
      summary: contextRecord.session.summary,
    })

    conversationService.appendMessage(conversationId, 'assistant', response.content)
    const nextWorkingContext = {
      ...parseJson(contextRecord.session.working_context_json, {} as Record<string, unknown>),
      last_completed_message: response.metadata.completed_message ?? message,
      last_target_device_id: response.metadata.target_device_id ?? null,
      last_normalized_intent: response.metadata.normalized_intent ?? null,
      last_route_reason: response.metadata.route_reason ?? null,
      last_candidate_plan_ids: response.metadata.candidate_plan_ids ?? [],
      preferred_tv_device_id: response.metadata.target_device_id ?? parseJson(contextRecord.session.working_context_json, {} as Record<string, unknown>).preferred_tv_device_id ?? null,
    }
    conversationService.updateSession(conversationId, {
      working_context: nextWorkingContext,
      last_intent: message,
      last_plan_id: response.metadata.matched_plan_id ?? null,
      summary: response.content.slice(0, 240),
    })

    return {
      status: 'success',
      data: {
        conversation_id: conversationId,
        session: conversationService.getSession(conversationId),
        ...response,
      },
    }
  })

  app.get('/api/chat/history', async (request) => {
    const query = request.query as { conversation_id?: string }

    if (query.conversation_id) {
      return { messages: conversationService.getMessages(Number(query.conversation_id)) }
    }

    return { conversations: conversationService.listConversations(20) }
  })

  app.get('/api/chat/:id', async (request) => {
    const { id } = request.params as { id: string }
    return { messages: conversationService.getMessages(Number(id)) }
  })
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
