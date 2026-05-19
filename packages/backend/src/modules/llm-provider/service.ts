import OpenAI from 'openai'
import { getDb } from '../../db/index.js'

type GetDbFn = () => ReturnType<typeof getDb>

export type LLMProviderType = 'openai' | 'deepseek' | 'ollama' | 'mimo' | 'custom'
export type ModelSlotName = 'planner' | 'fast' | 'vision' | 'embedding' | 'rerank' | 'local'
type StoredProviderType = LLMProviderType | 'disabled'

export interface LLMProviderConfig {
  id: number
  name: string
  provider_type: LLMProviderType
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  is_default: boolean
  extra_config: Record<string, unknown>
}

export interface LLMModelSlotConfig {
  slot_name: ModelSlotName
  provider_type: StoredProviderType
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  dimensions: number | null
  capabilities: string[]
  extra_config: Record<string, unknown>
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
  provider_type: LLMProviderType
  api_base: string
  api_key: string
  model_name: string
  enabled: number
  is_default: number
  extra_config: string
}

interface SlotRow {
  slot_name: ModelSlotName
  provider_type: StoredProviderType
  api_base: string
  api_key: string
  model_name: string
  enabled: number
  dimensions: number | null
  capabilities_json: string
  extra_config_json: string
}

type ChatTarget =
  | {
      cache_key: string
      provider_type: LLMProviderType
      api_base: string
      api_key: string
      model_name: string
    }
  | {
      cache_key: string
      provider_type: LLMProviderType
      api_base: string
      api_key: string
      model_name: string
    }

const SLOT_ENV_MAP: Array<{ slot: ModelSlotName; prefix: string; capabilities: string[] }> = [
  { slot: 'planner', prefix: 'PLANNER', capabilities: ['chat', 'tools'] },
  { slot: 'fast', prefix: 'FAST', capabilities: ['chat'] },
  { slot: 'vision', prefix: 'VISION', capabilities: ['vision', 'chat'] },
  { slot: 'embedding', prefix: 'EMBEDDING', capabilities: ['embedding'] },
  { slot: 'rerank', prefix: 'RERANK', capabilities: ['rerank'] },
  { slot: 'local', prefix: 'LOCAL_LLM', capabilities: ['chat', 'fallback'] },
]

function normalizeProviderType(value: string | undefined): StoredProviderType {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return 'openai'
  if (normalized === 'disabled') return 'disabled'
  if (normalized === 'openai' || normalized === 'deepseek' || normalized === 'ollama' || normalized === 'mimo' || normalized === 'custom') {
    return normalized
  }
  if (normalized === 'pie-xian' || normalized === 'compatible-openai' || normalized === 'openai_compatible') {
    return 'openai'
  }
  return 'custom'
}

class LLMService {
  private clients = new Map<string, OpenAI>()

  constructor(private readonly getDb: GetDbFn = getDb) {}

  listProviders(): LLMProviderConfig[] {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM llm_providers ORDER BY is_default DESC, id ASC').all() as ProviderRow[]
    return rows.map((row) => this.normalizeProviderRow(row))
  }

  addProvider(config: Omit<LLMProviderConfig, 'id'>): number {
    const db = this.getDb()
    const result = db.prepare(
      `INSERT INTO llm_providers (name, provider_type, api_base, api_key, model_name, enabled, is_default, extra_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      config.name,
      config.provider_type,
      config.api_base,
      config.api_key,
      config.model_name,
      config.enabled ? 1 : 0,
      config.is_default ? 1 : 0,
      JSON.stringify(config.extra_config ?? {}),
    )
    if (config.is_default) {
      db.prepare('UPDATE llm_providers SET is_default = 0 WHERE id != ?').run(Number(result.lastInsertRowid))
    }
    this.clients.delete(`provider:${String(result.lastInsertRowid)}`)
    return Number(result.lastInsertRowid)
  }

  updateProvider(id: number, config: Partial<LLMProviderConfig>): void {
    const db = this.getDb()
    const existingRow = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id) as ProviderRow | undefined
    if (!existingRow) throw new Error(`Provider not found: ${id}`)

    const existing = this.normalizeProviderRow(existingRow)
    const updated = { ...existing, ...config }
    db.prepare(
      `UPDATE llm_providers SET
        name=?, provider_type=?, api_base=?, api_key=?, model_name=?, enabled=?, is_default=?, extra_config=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      updated.name,
      updated.provider_type,
      updated.api_base,
      updated.api_key,
      updated.model_name,
      updated.enabled ? 1 : 0,
      updated.is_default ? 1 : 0,
      JSON.stringify(updated.extra_config ?? {}),
      id,
    )
    if (config.is_default) {
      db.prepare('UPDATE llm_providers SET is_default = 0 WHERE id != ?').run(id)
    }
    this.clients.delete(`provider:${id}`)
  }

  removeProvider(id: number): void {
    const db = this.getDb()
    db.prepare('DELETE FROM llm_providers WHERE id = ?').run(id)
    this.clients.delete(`provider:${id}`)
  }

  setDefault(id: number): void {
    const db = this.getDb()
    db.prepare('UPDATE llm_providers SET is_default = 0').run()
    db.prepare('UPDATE llm_providers SET is_default = 1 WHERE id = ?').run(id)
  }

  listModelSlots(): LLMModelSlotConfig[] {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM llm_model_slots ORDER BY slot_name ASC').all() as SlotRow[]
    return rows.map((row) => this.normalizeSlotRow(row))
  }

  getModelSlot(slot: ModelSlotName): LLMModelSlotConfig | undefined {
    const db = this.getDb()
    const row = db.prepare('SELECT * FROM llm_model_slots WHERE slot_name = ?').get(slot) as SlotRow | undefined
    return row ? this.normalizeSlotRow(row) : undefined
  }

  upsertModelSlot(slot: ModelSlotName, config: Partial<LLMModelSlotConfig>): LLMModelSlotConfig {
    const db = this.getDb()
    const existing = this.getModelSlot(slot)
    const merged: LLMModelSlotConfig = {
      slot_name: slot,
      provider_type: config.provider_type ?? existing?.provider_type ?? 'openai',
      api_base: config.api_base ?? existing?.api_base ?? '',
      api_key: config.api_key ?? existing?.api_key ?? '',
      model_name: config.model_name ?? existing?.model_name ?? '',
      enabled: config.enabled ?? existing?.enabled ?? true,
      dimensions: config.dimensions ?? existing?.dimensions ?? null,
      capabilities: config.capabilities ?? existing?.capabilities ?? [],
      extra_config: config.extra_config ?? existing?.extra_config ?? {},
    }

    db.prepare(
      `INSERT INTO llm_model_slots (
        slot_name, provider_type, api_base, api_key, model_name, enabled, dimensions, capabilities_json, extra_config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot_name) DO UPDATE SET
        provider_type=excluded.provider_type,
        api_base=excluded.api_base,
        api_key=excluded.api_key,
        model_name=excluded.model_name,
        enabled=excluded.enabled,
        dimensions=excluded.dimensions,
        capabilities_json=excluded.capabilities_json,
        extra_config_json=excluded.extra_config_json,
        updated_at=datetime('now')`,
    ).run(
      merged.slot_name,
      merged.provider_type,
      merged.api_base,
      merged.api_key,
      merged.model_name,
      merged.enabled ? 1 : 0,
      merged.dimensions,
      JSON.stringify(merged.capabilities),
      JSON.stringify(merged.extra_config),
    )

    this.clients.delete(`slot:${slot}`)
    return this.getModelSlot(slot) as LLMModelSlotConfig
  }

  seedSlotsFromEnv(): void {
    for (const definition of SLOT_ENV_MAP) {
      const modelName = this.readEnv(`${definition.prefix}_MODEL`)
      const providerType = this.readEnv(`${definition.prefix}_PROVIDER`)
      const apiBase = this.readEnv(`${definition.prefix}_BASE_URL`)
      const apiKey = this.readEnv(`${definition.prefix}_API_KEY`)
      const dimensionsRaw = this.readEnv(`${definition.prefix}_DIMENSIONS`)

      const hasExplicitConfig = Boolean(modelName || providerType || apiBase || apiKey || dimensionsRaw)
      if (!hasExplicitConfig) continue
      const existing = this.getModelSlot(definition.slot)
      // Always refresh from env when PLANNER/Fast slot values come from env (env-driven config),
      // or when the slot hasn't been seeded yet.
      if (existing && !this.shouldRefreshSlotFromEnv(existing) && !this.envDrivenSlot(definition.slot)) continue

      const normalizedProvider = normalizeProviderType(providerType)
      const dimensions = dimensionsRaw ? Number(dimensionsRaw) : null

      this.upsertModelSlot(definition.slot, {
        provider_type: normalizedProvider,
        api_base: apiBase,
        api_key: apiKey,
        model_name: modelName,
        enabled: normalizedProvider !== 'disabled',
        dimensions: Number.isFinite(dimensions) ? dimensions : null,
        capabilities: definition.capabilities,
      })
    }
  }

  async chat(params: {
    provider_id?: number
    slot?: ModelSlotName
    messages: Array<{ role: string; content: string }>
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
    temperature?: number
    max_tokens?: number
  }): Promise<LLMChatResult> {
    const target = this.resolveChatTarget(params.provider_id, params.slot)
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

    return {
      content: message.content ?? null,
      tool_calls: message.tool_calls?.map((tc) => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? 0,
        completion_tokens: response.usage?.completion_tokens ?? 0,
      },
    }
  }

  async *chatStream(params: {
    provider_id?: number
    slot?: ModelSlotName
    messages: Array<{ role: string; content: string }>
    tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }>
    temperature?: number
    max_tokens?: number
  }): AsyncGenerator<LLMChatDelta, void, void> {
    const target = this.resolveChatTarget(params.provider_id, params.slot)
    const client = this.getClient(target)

    const chatParams: OpenAI.ChatCompletionCreateParams = {
      model: target.model_name,
      messages: params.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 2048,
      stream: true,
    }

    if (params.tools && params.tools.length > 0) {
      chatParams.tools = params.tools as OpenAI.ChatCompletionTool[]
    }

    const stream = await client.chat.completions.create(chatParams)

    // Per OpenAI streaming protocol, tool_calls.arguments are delivered as
    // incremental JSON fragments across chunks, indexed by tool_calls[i].index.
    // Accumulate by index so consumers receive fully assembled arguments.
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

      const sortedToolCalls = toolCallAcc.size > 0
        ? Array.from(toolCallAcc.entries()).sort(([a], [b]) => a - b).map(([, tc]) => tc)
        : undefined

      yield {
        delta: delta?.content ?? null,
        role: delta?.role ?? null,
        tool_calls: sortedToolCalls,
        finish_reason: chunk.choices[0]?.finish_reason ?? null,
        usage: chunk.usage ? {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
        } : undefined,
      }
    }
  }

  async embed(params: {
    slot?: ModelSlotName
    input: string | string[]
  }): Promise<LLMEmbeddingResult> {
    const target = this.resolveModelTarget(params.slot ?? 'embedding')
    const response = await fetch(this.joinUrl(target.api_base, '/embeddings'), {
      method: 'POST',
      headers: this.buildJsonHeaders(target.api_key),
      body: JSON.stringify({
        model: target.model_name,
        input: params.input,
      }),
    })

    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json() as {
      model?: string
      data?: Array<{ index?: number; embedding?: number[] }>
      usage?: Record<string, unknown>
    }

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
    slot?: ModelSlotName
    query: string
    documents: string[]
  }): Promise<LLMRerankResult> {
    const target = this.resolveModelTarget(params.slot ?? 'rerank')
    const response = await fetch(this.joinUrl(target.api_base, '/rerank'), {
      method: 'POST',
      headers: this.buildJsonHeaders(target.api_key),
      body: JSON.stringify({
        model: target.model_name,
        query: params.query,
        documents: params.documents,
      }),
    })

    if (!response.ok) {
      throw new Error(`Rerank request failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json() as {
      results?: Array<{ index?: number; relevance_score?: number }>
      usage?: Record<string, unknown>
    }

    return {
      model: target.model_name,
      results: (payload.results ?? []).map((item, index) => ({
        index: Number(item.index ?? index),
        relevance_score: Number(item.relevance_score ?? 0),
      })),
      usage: payload.usage,
    }
  }

  private resolveChatTarget(providerId?: number, slot: ModelSlotName = 'planner'): ChatTarget {
    if (providerId) {
      const db = this.getDb()
      const row = db.prepare(
        'SELECT * FROM llm_providers WHERE id = ? AND enabled = 1',
      ).get(providerId) as ProviderRow | undefined
      if (!row) throw new Error(`Provider not found or disabled: ${providerId}`)

      return {
        cache_key: `provider:${providerId}`,
        provider_type: row.provider_type,
        api_base: row.api_base,
        api_key: row.api_key,
        model_name: row.model_name,
      }
    }

    const slotConfig = this.getModelSlot(slot)
    if (slotConfig && slotConfig.enabled && slotConfig.provider_type !== 'disabled' && slotConfig.model_name) {
      return {
        cache_key: `slot:${slot}`,
        provider_type: slotConfig.provider_type as LLMProviderType,
        api_base: slotConfig.api_base,
        api_key: slotConfig.api_key,
        model_name: slotConfig.model_name,
      }
    }

    const fallback = this.getDefaultProvider()
    return {
      cache_key: `provider:${fallback.id}`,
      provider_type: fallback.provider_type,
      api_base: fallback.api_base,
      api_key: fallback.api_key,
      model_name: fallback.model_name,
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

  private getDefaultProvider(): LLMProviderConfig {
    const db = this.getDb()
    const providerRow = db.prepare(
      'SELECT * FROM llm_providers WHERE is_default = 1 AND enabled = 1',
    ).get() as ProviderRow | undefined
    if (providerRow) return this.normalizeProviderRow(providerRow)

    const fallbackRow = db.prepare(
      'SELECT * FROM llm_providers WHERE enabled = 1 ORDER BY id ASC LIMIT 1',
    ).get() as ProviderRow | undefined
    if (fallbackRow) return this.normalizeProviderRow(fallbackRow)

    throw new Error('No LLM provider or model slot available')
  }

  private resolveModelTarget(slot: ModelSlotName): ChatTarget {
    const slotConfig = this.getModelSlot(slot)
    if (!slotConfig || !slotConfig.enabled || slotConfig.provider_type === 'disabled' || !slotConfig.model_name) {
      throw new Error(`Model slot not available: ${slot}`)
    }

    return {
      cache_key: `slot:${slot}`,
      provider_type: slotConfig.provider_type as LLMProviderType,
      api_base: slotConfig.api_base,
      api_key: slotConfig.api_key,
      model_name: slotConfig.model_name,
    }
  }

  private buildJsonHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  private joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`
  }

  private normalizeProviderRow(row: ProviderRow): LLMProviderConfig {
    return {
      id: row.id,
      name: row.name,
      provider_type: row.provider_type,
      api_base: row.api_base,
      api_key: row.api_key,
      model_name: row.model_name,
      enabled: row.enabled === 1,
      is_default: row.is_default === 1,
      extra_config: this.parseJson(row.extra_config, {}),
    }
  }

  private normalizeSlotRow(row: SlotRow): LLMModelSlotConfig {
    return {
      slot_name: row.slot_name,
      provider_type: row.provider_type,
      api_base: row.api_base,
      api_key: row.api_key,
      model_name: row.model_name,
      enabled: row.enabled === 1,
      dimensions: row.dimensions,
      capabilities: this.parseJson(row.capabilities_json, [] as string[]),
      extra_config: this.parseJson(row.extra_config_json, {}),
    }
  }

  private parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  private readEnv(name: string): string {
    return this.expandEnvReferences((process.env[name] ?? '').trim())
  }

  private expandEnvReferences(value: string, depth = 0): string {
    if (!value || depth > 5) return value
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, key: string) => {
      const resolved = (process.env[key] ?? '').trim()
      return resolved ? this.expandEnvReferences(resolved, depth + 1) : _match
    })
  }

  private shouldRefreshSlotFromEnv(slot: LLMModelSlotConfig): boolean {
    return [slot.api_base, slot.api_key, slot.model_name]
      .some((value) => typeof value === 'string' && value.includes('${'))
  }

  private envDrivenSlot(slot: ModelSlotName): boolean {
    const prefix = slot === 'local' ? 'LOCAL_LLM' : slot.toUpperCase()
    return [this.readEnv(`${prefix}_MODEL`), this.readEnv(`${prefix}_PROVIDER`), this.readEnv(`${prefix}_API_KEY`)]
      .some((v) => Boolean(v))
  }
}

export const llmService = new LLMService()
