import type { FastifyInstance } from 'fastify'
import { ContextService } from '../../nest/modules/context/context.service.js'

const contextService = new ContextService()

export async function userContextRoutes(app: FastifyInstance) {
  app.get('/api/runtime-context', async (request) => {
    const query = request.query as { conversationId?: string; limit?: string }
    const conversationId = Number.parseInt(query?.conversationId ?? '1', 10)
    const limit = Number.parseInt(query?.limit ?? '50', 10)
    const context = contextService.getRuntimeContextWindow(
      Number.isFinite(conversationId) ? conversationId : 1,
      Number.isFinite(limit) ? limit : 50,
    )
    return { context }
  })

  app.get('/api/runtime/settings', async () => {
    return { settings: contextService.getRuntimeSettings() }
  })

  app.put('/api/runtime/settings', async (request) => {
    const body = request.body as {
      max_turns?: number
      ttl_ms?: number
      retrieval_limit?: number
      context_token_budget?: number
    }
    return { status: 'ok', settings: contextService.updateRuntimeSettings(body ?? {}) }
  })

  app.get('/api/runtime-context/settings', async () => {
    return { settings: contextService.getRuntimeSettings() }
  })

  app.put('/api/runtime-context/settings', async (request) => {
    const body = request.body as {
      max_turns?: number
      ttl_ms?: number
      retrieval_limit?: number
      context_token_budget?: number
    }
    return { status: 'ok', settings: contextService.updateRuntimeSettings(body ?? {}) }
  })

  app.get('/api/user-context', async () => {
    const rows = contextService.listUserContext()
    const context: Record<string, { value: string; updated_at: string }> = {}
    for (const row of rows) {
      context[row.key] = { value: row.value, updated_at: row.updated_at }
    }
    return { context }
  })

  app.put('/api/user-context/:key', async (request) => {
    const { key } = request.params as { key: string }
    const body = request.body as { value?: string }
    return contextService.setUserContext(key, body?.value ?? '')
  })
}
