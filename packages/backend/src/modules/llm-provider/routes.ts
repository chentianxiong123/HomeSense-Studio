import type { FastifyInstance } from 'fastify'
import { llmService } from './service.js'

export async function llmProviderRoutes(app: FastifyInstance) {
  // ── Provider CRUD ──

  app.get('/api/llm/providers', async () => {
    return { providers: llmService.listProviders() }
  })

  app.post('/api/llm/providers', async (request) => {
    const body = request.body as Record<string, unknown>
    const id = llmService.addProvider({
      name: String(body.name ?? ''),
      api_base: String(body.api_base ?? ''),
      api_key: String(body.api_key ?? ''),
      enabled: body.enabled !== false,
      extra_config: (body.extra_config as Record<string, unknown>) ?? {},
    })
    return { id }
  })

  app.put('/api/llm/providers/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    llmService.updateProvider(Number(id), body as any)
    return { status: 'ok' }
  })

  app.delete('/api/llm/providers/:id', async (request) => {
    const { id } = request.params as { id: string }
    llmService.removeProvider(Number(id))
    return { status: 'ok' }
  })

  // ── Model CRUD ──

  app.get('/api/llm/providers/:pid/models', async (request) => {
    const { pid } = request.params as { pid: string }
    const q = request.query as { category?: string }
    return { models: llmService.listModels(Number(pid), q.category || undefined) }
  })

  app.post('/api/llm/providers/:pid/models', async (request) => {
    const { pid } = request.params as { pid: string }
    const body = request.body as Record<string, unknown>
    const id = llmService.addModel(Number(pid), {
      model_name: String(body.model_name ?? ''),
      category: (body.category as string) ?? 'chat',
      is_default: body.is_default === true,
      enabled: body.enabled !== false,
    })
    return { id }
  })

  app.post('/api/llm/providers/:pid/models/query', async (request) => {
    const { pid } = request.params as { pid: string }
    const body = request.body as { api_base?: string; api_key?: string }
    try {
      const models = await llmService.queryProviderModels(Number(pid), body.api_base, body.api_key)
      return { models }
    } catch (err) {
      return { status: 'error', error: 'QUERY_FAILED', message: (err as Error).message, models: [] }
    }
  })

  app.put('/api/llm/models/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as Record<string, unknown>
    llmService.updateModel(Number(id), {
      model_name: body.model_name ? String(body.model_name) : undefined,
      category: body.category ? String(body.category) : undefined,
      is_default: body.is_default == null ? undefined : body.is_default === true,
      enabled: body.enabled == null ? undefined : body.enabled !== false,
    })
    return { status: 'ok' }
  })

  app.delete('/api/llm/models/:id', async (request) => {
    const { id } = request.params as { id: string }
    llmService.removeModel(Number(id))
    return { status: 'ok' }
  })

  app.post('/api/llm/models/:id/default', async (request) => {
    const { id } = request.params as { id: string }
    llmService.setDefaultModel(Number(id))
    return { status: 'ok' }
  })

  // ── Inference ──

  app.post('/api/llm/chat', async (request) => {
    const body = request.body as {
      model_id?: number
      messages: Array<{ role: string; content: string }>
      tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
      temperature?: number
      max_tokens?: number
    }
    try {
      const result = await llmService.chat(body)
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'LLM_ERROR', message: (err as Error).message }
    }
  })

  app.post('/api/llm/embedding', async (request) => {
    const body = request.body as {
      model_id?: number
      input: string | string[]
    }
    try {
      const result = await llmService.embed(body)
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'EMBEDDING_ERROR', message: (err as Error).message }
    }
  })

  app.post('/api/llm/rerank', async (request) => {
    const body = request.body as {
      model_id?: number
      query: string
      documents: string[]
    }
    try {
      const result = await llmService.rerank(body)
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'RERANK_ERROR', message: (err as Error).message }
    }
  })

  // ── Usage ──

  app.get('/api/llm/usage/totals', async () => {
    return llmService.queryUsageTotals()
  })

  app.get('/api/llm/default-model', async (request) => {
    const q = request.query as { category?: string }
    try {
      const model = llmService.getDefaultModel(q.category || 'chat')
      const providers = llmService.listProviders()
      const provider = providers.find(p => p.id === model.provider_id)
      return { provider_name: provider?.name ?? '', model_name: model.model_name, category: model.category }
    } catch {
      return { provider_name: '', model_name: '', category: q.category || 'chat' }
    }
  })

  app.get('/api/llm/chat-models', async () => {
    const providers = llmService.listProviders()
    const result: Array<{ id: number; provider_name: string; model_name: string; is_default: boolean }> = []
    for (const p of providers) {
      const models = llmService.listModels(p.id, 'chat')
      for (const m of models) {
        result.push({ id: m.id, provider_name: p.name, model_name: m.model_name, is_default: m.is_default })
      }
    }
    return { models: result }
  })

  app.post('/api/llm/models/:id/set-default', async (request) => {
    const { id } = request.params as { id: string }
    try {
      llmService.setDefaultModel(Number(id))
      return { status: 'ok' }
    } catch (err) {
      return { status: 'error', error: (err as Error).message }
    }
  })
}