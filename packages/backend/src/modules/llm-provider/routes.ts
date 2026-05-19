import type { FastifyInstance } from 'fastify'
import { llmService, type ModelSlotName } from './service.js'

export async function llmProviderRoutes(app: FastifyInstance) {
  app.get('/api/llm/providers', async () => {
    return { providers: llmService.listProviders() }
  })

  app.get('/api/llm/slots', async () => {
    return { slots: llmService.listModelSlots() }
  })

  app.get('/api/llm/slots/:slot', async (request) => {
    const { slot } = request.params as { slot: ModelSlotName }
    return { slot: llmService.getModelSlot(slot) ?? null }
  })

  app.post('/api/llm/providers', async (request) => {
    const body = request.body as Record<string, unknown>
    const id = llmService.addProvider({
      name: String(body.name ?? ''),
      provider_type: (body.provider_type as 'openai' | 'deepseek' | 'ollama' | 'custom') ?? 'openai',
      api_base: String(body.api_base ?? ''),
      api_key: String(body.api_key ?? ''),
      model_name: String(body.model_name ?? ''),
      enabled: body.enabled !== false,
      is_default: body.is_default === true,
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

  app.post('/api/llm/providers/:id/default', async (request) => {
    const { id } = request.params as { id: string }
    llmService.setDefault(Number(id))
    return { status: 'ok' }
  })

  app.put('/api/llm/slots/:slot', async (request) => {
    const { slot } = request.params as { slot: ModelSlotName }
    const body = request.body as Record<string, unknown>
    const record = llmService.upsertModelSlot(slot, {
      provider_type: body.provider_type as any,
      api_base: body.api_base ? String(body.api_base) : undefined,
      api_key: body.api_key ? String(body.api_key) : undefined,
      model_name: body.model_name ? String(body.model_name) : undefined,
      enabled: body.enabled == null ? undefined : body.enabled !== false,
      dimensions: body.dimensions == null || body.dimensions === '' ? undefined : Number(body.dimensions),
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((value) => String(value)) : undefined,
      extra_config: (body.extra_config as Record<string, unknown>) ?? undefined,
    })
    return { status: 'ok', data: record }
  })

  app.post('/api/llm/chat', async (request) => {
    const body = request.body as {
      provider_id?: number
      slot?: ModelSlotName
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
      slot?: ModelSlotName
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
      slot?: ModelSlotName
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
}
