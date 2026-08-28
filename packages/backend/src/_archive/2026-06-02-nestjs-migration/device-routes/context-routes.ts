import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import {
  buildRuntimeContextWindow,
  getRuntimeContextSettings,
  saveRuntimeContextSettings,
} from '../runtime/index.js'
import { chatService } from '../chat/service.js'

export async function userContextRoutes(app: FastifyInstance) {
  // GET /api/runtime-context — unified active context window used by chat runtime
  app.get('/api/runtime-context', async () => {
    let messages: Array<{ role: string; content: string; created_at?: string }> = []
    try {
      messages = chatService.getConversationMessages(1, undefined, 50).messages
    } catch {}
    const lastActivityAt = messages.length > 0 ? messages[messages.length - 1].created_at : null
    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages,
      lastActivityAt,
    })
    return { context }
  })

  app.get('/api/runtime/settings', async () => {
    return { settings: getRuntimeContextSettings() }
  })

  app.put('/api/runtime/settings', async (request) => {
    const body = request.body as {
      max_turns?: number
      ttl_ms?: number
      retrieval_limit?: number
      context_token_budget?: number
    }
    return { status: 'ok', settings: saveRuntimeContextSettings(body) }
  })

  // GET /api/user-context — fetch all context entries
  app.get('/api/user-context', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT key, value, updated_at FROM user_context').all() as Array<{
      key: string; value: string; updated_at: string
    }>
    const context: Record<string, { value: string; updated_at: string }> = {}
    for (const row of rows) context[row.key] = { value: row.value, updated_at: row.updated_at }
    return { context }
  })

  // PUT /api/user-context/:key — set a context entry
  app.put('/api/user-context/:key', async (request) => {
    const { key } = request.params as { key: string }
    const body = request.body as { value: string }
    const db = getDb()
    db.prepare(`
      INSERT INTO user_context (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, body.value ?? '', new Date().toISOString())
    return { status: 'ok', key, value: body.value }
  })
}
