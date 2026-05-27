import OpenAI from 'openai'
import { getDb as defaultGetDb } from '../../db/index.js'
import { chatService } from '../chat/service.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface LLMProviderConfig {
  id: number
  name: string
  api_base: string
  api_key: string
  enabled: boolean
  extra_config: Record<string, unknown>
}

export interface LLMModelConfig {
  id: number
  provider_id: number
  model_name: string
  category: string
  is_default: boolean
  enabled: boolean
}

export interface LLMChatResult {
  content: string | null
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  usage: { prompt_tokens: number; completion_tokens: number }
}

export interface LLMChatDelta {
  delta: string | null
  role?: string | null
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  finish_reason?: string | null
  usage?: { prompt_tokens: number; completion_tokens: number }
}

export interface LLMEmbeddingResult {
  model: string
  data: Array<{ index: number; embedding: number[] }>
  usage?: Record<string, unknown>
}

export interface LLMRerankResult {
  model: string
  results: Array<{ index: number; relevance_score: number }>
  usage?: Record<string, unknown>
}

interface ProviderRow {
  id: number
  name: string
  api_base: string
  api_key: string
  enabled: number
  extra_config: string
}

interface ModelRow {
  id: number
  provider_id: number
  model_name: string
  category: string
  is_default: number
  enabled: number
}

interface ChatTarget {
  cache_key: string
  api_base: string
  api_key: string
  model_name: string
}

class LLMService {
  private clients = new Map<string, OpenAI>()

  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  // ── Provider CRUD ──

  listProviders(): LLMProviderConfig[] {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM llm_providers ORDER BY id ASC').all() as ProviderRow[]
    return rows.map((row) => this.normalizeProviderRow(row))
  }

  addProvider(config: Omit<LLMProviderConfig, 'id'>): number {
    const db = this.getDb()
    const result = db.prepare(
      `INSERT INTO llm_providers (name, api_base, api_key, enabled, extra_config)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(config.name, config.api_base, config.api_key, config.enabled ? 1 : 0, JSON.stringify(config.extra_config ?? {}))
    return Number(result.lastInsertRowid)
  }

  updateProvider(id: number, config: Partial<LLMProviderConfig>): void {
    const db = this.getDb()
    const existing = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id) as ProviderRow | undefined
    if (!existing) throw new Error(`Provider not found: ${id}`)
    const updated = { ...this.normalizeProviderRow(existing), ...config }
    db.prepare(
      `UPDATE llm_providers SET name=?, api_base=?, api_key=?, enabled=?, extra_config=?, updated_at=datetime('now') WHERE id=?`,
    ).run(updated.name, updated.api_base, updated.api_key, updated.enabled ? 1 : 0, JSON.stringify(updated.extra_config ?? {}), id)
    this.clients.delete(`provider:${id}`)
  }

  removeProvider(id: number): void {
    const db = this.getDb()
    db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id)
    this.clients.delete(`provider:${id}`)
  }

  // ── Model CRUD ──

  listModels(providerId?: number, category?: string): LLMModelConfig[] {
    const db = this.getDb()
    let sql = 'SELECT * FROM llm_models'
    const conditions: string[] = []
    const params: unknown[] = []
    if (providerId) { conditions.push('provider_id = ?'); params.push(providerId) }
    if (category) { conditions.push('category = ?'); params.push(category) }
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    sql += ' ORDER BY is_default DESC, id ASC'
    const rows = db.prepare(sql).all(...params) as ModelRow[]
    return rows.map((row) => this.normalizeModelRow(row))
  }

  addModel(providerId: number, config: Omit<LLMModelConfig, 'id' | 'provider_id'>): number {
    const db = this.getDb()
    const result = db.prepare(
      `INSERT INTO llm_models (provider_id, model_name, category, is_default, enabled) VALUES (?, ?, ?, ?, ?)`,
    ).run(providerId, config.model_name, config.category, config.is_default ? 1 : 0, config.enabled ? 1 : 0)
    const id = Number(result.lastInsertRowid)
    if (config.is_default) {
      db.prepare('UPDATE llm_models SET is_default = 0 WHERE id != ? AND category = ?').run(id, config.category)
    }
    return id
  }

  updateModel(id: number, config: Partial<LLMModelConfig>): void {
    const db = this.getDb()
    const existing = db.prepare('SELECT * FROM llm_models WHERE id = ?').get(id) as ModelRow | undefined
    if (!existing) throw new Error(`Model not found: ${id}`)
    const updated = { ...this.normalizeModelRow(existing), ...config }
    db.prepare(
      `UPDATE llm_models SET model_name=?, category=?, is_default=?, enabled=?, updated_at=datetime('now') WHERE id=?`,
    ).run(updated.model_name, updated.category, updated.is_default ? 1 : 0, updated.enabled ? 1 : 0, id)
    if (config.is_default) {
      db.prepare('UPDATE llm_models SET is_default = 0 WHERE id != ? AND category = ?').run(id, updated.category)
    }
  }

  removeModel(id: number): void {
    this.getDb().prepare('DELETE FROM llm_models WHERE id = ?').run(id)
  }

  setDefaultModel(id: number): void {
    const db = this.getDb()
    const row = db.prepare('SELECT category FROM llm_models WHERE id = ?').get(id) as { category: string } | undefined
    if (!row) throw new Error(`Model not found: ${id}`)
    db.prepare('UPDATE llm_models SET is_default = 0 WHERE category = ?').run(row.category)
    db.prepare('UPDATE llm_models SET is_default = 1 WHERE id = ?').run(id)
  }

  getDefaultModel(category: string): LLMModelConfig {
    const db = this.getDb()
    const row = db.prepare(
      'SELECT * FROM llm_models WHERE category = ? AND is_default = 1 AND enabled = 1 ORDER BY id ASC LIMIT 1',
    ).get(category) as ModelRow | undefined
    if (row) return this.normalizeModelRow(row)
    const fallback = db.prepare(
      'SELECT * FROM llm_models WHERE category = ? AND enabled = 1 ORDER BY id ASC LIMIT 1',
    ).get(category) as ModelRow | undefined
    if (fallback) return this.normalizeModelRow(fallback)
    throw new Error(`No model available for category: ${category}`)
  }

  async queryProviderModels(providerId: number, apiBase?: string, apiKey?: string): Promise<string[]> {
    const provider = this.getDb().prepare('SELECT * FROM llm_providers WHERE id = ?').get(providerId) as ProviderRow | undefined
    if (!provider) throw new Error(`Provider not found: ${providerId}`)
    const baseUrl = (apiBase || provider.api_base).replace(/\/+$/, '')
    const key = apiKey || provider.api_key

    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        const data = await resp.json() as { data?: Array<{ id: string }> }
        if (data.data?.length) {
          return data.data.map((m) => m.id).sort()
        }
      }
    } catch {}
    return []
  }

  // ── Inference ──

  async chat(params: {
    model_id?: number
    messages: Array<{ role: string; content: string }>
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
    temperature?: number
    max_tokens?: number
  }): Promise<LLMChatResult> {
    const target = this.resolveChatTarget(params.model_id, 'chat')
    const client = this.getClient(target)

    const chatParams: OpenAI.ChatCompletionCreateParams = {
      model: target.model_name,
      messages: params.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
    }

    if (params.tools && params.tools.length > 0) {
      chatParams.tools = params.tools as OpenAI.ChatCompletionTool[]
    }

    const response = await client.chat.completions.create(chatParams)
    const choice = response.choices[0]
    const message = choice.message

    const result: LLMChatResult = {
      content: message.content ?? null,
      tool_calls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
      },
    }

    try {
      const meta = this.resolveUsageMeta2(params.model_id, 'chat')
      chatService.recordUsage({ ...meta, category: 'chat', success: true, input_tokens: result.usage.prompt_tokens, output_tokens: result.usage.completion_tokens })
    } catch {}

    return result
  }

  async *chatStream(params: {
    model_id?: number
    messages: Array<{ role: string; content: string }>
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
    temperature?: number
    max_tokens?: number
  }): AsyncGenerator<LLMChatDelta, void, void> {
    const target = this.resolveChatTarget(params.model_id, 'chat')
    const client = this.getClient(target)
    const meta = this.resolveUsageMeta2(params.model_id, 'chat')
    let capturedInput = 0
    let capturedOutput = 0

    const chatParams: OpenAI.ChatCompletionCreateParams = {
      model: target.model_name,
      messages: params.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
    }

    if (params.tools && params.tools.length > 0) {
      chatParams.tools = params.tools as OpenAI.ChatCompletionTool[]
    }

    const stream = await client.chat.completions.create(chatParams)
    const toolCallAcc = new Map<number, { id: string; function: { name: string; arguments: string } }>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index == null) continue
          let entry = toolCallAcc.get(tc.index)
          if (!entry) {
            entry = { id: '', function: { name: '', arguments: '' } }
            toolCallAcc.set(tc.index, entry)
          }
          if (tc.id) entry.id = tc.id
          if (tc.function?.name) entry.function.name = tc.function.name
          if (tc.function?.arguments) entry.function.arguments += tc.function.arguments
        }
      }

      if (chunk.usage) {
        capturedInput = chunk.usage.prompt_tokens ?? 0
        capturedOutput = chunk.usage.completion_tokens ?? 0
      }

      yield {
        delta: delta?.content ?? null,
        role: delta?.role ?? null,
        tool_calls: toolCallAcc.size > 0
          ? Array.from(toolCallAcc.entries()).sort(([a], [b]) => a - b).map(([, tc]) => tc)
          : undefined,
        finish_reason: chunk.choices[0]?.finish_reason ?? null,
        usage: chunk.usage ? { prompt_tokens: capturedInput, completion_tokens: capturedOutput } : undefined,
      }
    }

    if (capturedInput > 0 || capturedOutput > 0) {
      try {
        chatService.recordUsage({ ...meta, category: 'chat', success: true, input_tokens: capturedInput, output_tokens: capturedOutput })
      } catch {}
    }
  }

  async embed(params: {
    model_id?: number
    input: string | string[]
  }): Promise<LLMEmbeddingResult> {
    const model = params.model_id
      ? (this.getDb().prepare('SELECT * FROM llm_models WHERE id = ?').get(params.model_id) as ModelRow | undefined)
      : null
    const resolvedModel = model ? this.normalizeModelRow(model) : this.getDefaultModel('embedding')
    const provider = this.getDb().prepare('SELECT * FROM llm_providers WHERE id = ?').get(resolvedModel.provider_id) as ProviderRow | undefined
    if (!provider) throw new Error(`Provider not found for model ${resolvedModel.id}`)

    const target = {
      cache_key: `provider:${provider.id}`,
      api_base: provider.api_base,
      api_key: provider.api_key,
      model_name: resolvedModel.model_name,
    }

    const response = await fetch(this.joinUrl(target.api_base, '/embeddings'), {
      method: 'POST',
      headers: this.buildJsonHeaders(target.api_key),
      body: JSON.stringify({ model: target.model_name, input: params.input }),
    })

    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json() as {
      model?: string
      data?: Array<{ index?: number; embedding?: number[] }>
      usage?: Record<string, unknown>
    }

    const usageRaw = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    try {
      chatService.recordUsage({
        provider_name: provider.name,
        model_name: target.model_name,
        category: 'embedding',
        success: true,
        input_tokens: Number(usageRaw?.prompt_tokens ?? 0),
        output_tokens: Number(usageRaw?.completion_tokens ?? 0),
      })
    } catch {}

    return {
      model: payload.model ?? target.model_name,
      data: (payload.data ?? []).map((item, index) => ({
        index: Number(item.index ?? index),
        embedding: Array.isArray(item.embedding) ? item.embedding.map((value) => Number(value)) : [],
      })),
      usage: payload.usage,
    }
  }

  async rerank(params: {
    model_id?: number
    query: string
    documents: string[]
  }): Promise<LLMRerankResult> {
    const model = params.model_id
      ? (this.getDb().prepare('SELECT * FROM llm_models WHERE id = ?').get(params.model_id) as ModelRow | undefined)
      : null
    const resolvedModel = model ? this.normalizeModelRow(model) : this.getDefaultModel('rerank')
    const provider = this.getDb().prepare('SELECT * FROM llm_providers WHERE id = ?').get(resolvedModel.provider_id) as ProviderRow | undefined
    if (!provider) throw new Error(`Provider not found for model ${resolvedModel.id}`)

    const target = {
      cache_key: `provider:${provider.id}`,
      api_base: provider.api_base,
      api_key: provider.api_key,
      model_name: resolvedModel.model_name,
    }

    const response = await fetch(this.joinUrl(target.api_base, '/rerank'), {
      method: 'POST',
      headers: this.buildJsonHeaders(target.api_key),
      body: JSON.stringify({ model: target.model_name, query: params.query, documents: params.documents }),
    })

    if (!response.ok) {
      throw new Error(`Rerank request failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json() as {
      results?: Array<{ index?: number; relevance_score?: number }>
      usage?: Record<string, unknown>
    }

    const usageRaw = payload.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    try {
      chatService.recordUsage({
        provider_name: provider.name,
        model_name: target.model_name,
        category: 'rerank',
        success: true,
        input_tokens: Number(usageRaw?.prompt_tokens ?? 0),
        output_tokens: Number(usageRaw?.completion_tokens ?? 0),
      })
    } catch {}

    return {
      model: target.model_name,
      results: (payload.results ?? []).map((item, index) => ({
        index: Number(item.index ?? index),
        relevance_score: Number(item.relevance_score ?? 0),
      })),
      usage: payload.usage,
    }
  }

  // ── Usage Tracking ──

  queryUsageTotals(): {
    total_input: number
    total_output: number
    total_success: number
    total_fail: number
    daily: Array<any>
    by_provider: Array<{ provider_name: string; success: number; fail: number; input: number; output: number }>
    by_model: Array<{ model_name: string; success: number; fail: number; input: number; output: number }>
    by_category: Array<{ category: string; success: number; fail: number; input: number; output: number }>
  } {
    return chatService.queryUsageTotals()
  }

  // ── Private ──

  private resolveChatTarget(modelId?: number, defaultCategory: string = 'chat'): ChatTarget {
    let model: LLMModelConfig
    if (modelId) {
      const row = this.getDb().prepare('SELECT * FROM llm_models WHERE id = ?').get(modelId) as ModelRow | undefined
      if (!row) throw new Error(`Model not found: ${modelId}`)
      model = this.normalizeModelRow(row)
    } else {
      model = this.getDefaultModel(defaultCategory)
    }

    const provider = this.getDb().prepare('SELECT * FROM llm_providers WHERE id = ?').get(model.provider_id) as ProviderRow | undefined
    if (!provider) throw new Error(`Provider not found: ${model.provider_id}`)

    return {
      cache_key: `model:${model.id}`,
      api_base: provider.api_base,
      api_key: provider.api_key,
      model_name: model.model_name,
    }
  }

  private getClient(target: ChatTarget): OpenAI {
    let client = this.clients.get(target.cache_key)
    if (client) return client

    client = new OpenAI({
      apiKey: target.api_key || 'dummy',
      baseURL: target.api_base || undefined,
    })
    this.clients.set(target.cache_key, client)
    return client
  }

  private buildJsonHeaders(apiKey: string): Record<string, string> {
    return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  }

  private joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`
  }

  private normalizeProviderRow(row: ProviderRow): LLMProviderConfig {
    return {
      id: row.id,
      name: row.name,
      api_base: row.api_base,
      api_key: row.api_key,
      enabled: row.enabled === 1,
      extra_config: this.parseJson(row.extra_config, {}),
    }
  }

  private normalizeModelRow(row: ModelRow): LLMModelConfig {
    return {
      id: row.id,
      provider_id: row.provider_id,
      model_name: row.model_name,
      category: row.category,
      is_default: row.is_default === 1,
      enabled: row.enabled === 1,
    }
  }

  private parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback
    try { return JSON.parse(raw) as T } catch { return fallback }
  }

  private resolveUsageMeta2(modelId?: number, defaultCategory = 'chat'): {
    provider_name: string
    model_name: string
  } {
    try {
      let model: LLMModelConfig
      if (modelId) {
        const row = this.getDb().prepare('SELECT * FROM llm_models WHERE id = ?').get(modelId) as ModelRow | undefined
        if (!row) throw new Error('not found')
        model = this.normalizeModelRow(row)
      } else {
        model = this.getDefaultModel(defaultCategory)
      }
      const provider = this.getDb().prepare('SELECT name FROM llm_providers WHERE id = ?').get(model.provider_id) as { name: string } | undefined
      return { provider_name: provider?.name ?? '', model_name: model.model_name }
    } catch {
      return { provider_name: '', model_name: '' }
    }
  }
}

export const llmService = new LLMService()