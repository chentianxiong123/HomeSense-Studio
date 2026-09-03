import { getDb } from '../../db/index.js'
import { CONTEXT_TTL_MS } from '../command/constants.js'

export interface RuntimeContextEntry {
  key: string
  value: string
  updated_at: string
  active: boolean
  age_ms: number
  ttl_ms: number
}

export interface RuntimeContextWindow {
  entries: Record<string, RuntimeContextEntry>
  working_context: Record<string, unknown>
  recent_messages: Array<{ role: string; content: string }>
  retrieval_hits: RuntimeContextRetrievalHit[]
  context_usage: RuntimeContextUsage
  max_turns: number
  ttl_ms: number
  retrieval_limit: number
  context_token_budget: number
  session_active: boolean
  last_activity_at: string | null
  expires_at: string | null
}

export interface RuntimeContextOptions {
  conversationId: number
  messages: Array<{ role: string; content: string }>
  maxTurns?: number
  ttlMs?: number
  retrievalLimit?: number
  contextTokenBudget?: number
  lastActivityAt?: string | null
  getDb?: typeof getDb
}

export interface RuntimeContextSettings {
  max_turns: number
  ttl_ms: number
  retrieval_limit: number
  context_token_budget: number
}

export interface RuntimeContextState {
  expired_at: string | null
}

export interface RuntimeContextRetrievalHit {
  id: string
  kind: string
  title: string
  snippet: string
  source?: 'memory' | 'compiled_knowledge'
  score?: number
  intent_pattern?: string
  device_refs?: string[]
  skill_refs?: Array<{ kind: string; id: string; label?: string }>
  steps?: Array<{ tool: string; action: string; params?: Record<string, unknown> }>
  success_count?: number
  workflow_graph_hash?: string
}

export interface RuntimeContextUsage {
  used_tokens: number
  max_tokens: number
  message_tokens: number
  working_context_tokens: number
  retrieval_tokens: number
}

const DEFAULT_MAX_TURNS = 12
const DEFAULT_RETRIEVAL_LIMIT = 3
const DEFAULT_CONTEXT_TOKEN_BUDGET = 20_000
const SETTINGS_KEY = 'runtime_context'
const SETTINGS_STATE_KEY = 'runtime_context_state'

export function buildRuntimeContextWindow(options: RuntimeContextOptions): RuntimeContextWindow {
  const db = options.getDb?.() ?? getDb()
  const settings = getRuntimeContextSettings(db)
  const state = getRuntimeContextState(db)
  const maxTurns = clampInteger(options.maxTurns ?? settings.max_turns, 2, 50, DEFAULT_MAX_TURNS)
  const ttlMs = clampInteger(options.ttlMs ?? settings.ttl_ms, 60_000, 24 * 60 * 60 * 1000, CONTEXT_TTL_MS)
  const retrievalLimit = clampInteger(options.retrievalLimit ?? settings.retrieval_limit, 0, 8, DEFAULT_RETRIEVAL_LIMIT)
  const contextTokenBudget = clampInteger(
    options.contextTokenBudget ?? settings.context_token_budget,
    1_000,
    200_000,
    DEFAULT_CONTEXT_TOKEN_BUDGET,
  )
  const activity = resolveSessionActivity(options.messages, options.lastActivityAt)
  const sessionActive = activity.lastActivityMs != null && Date.now() - activity.lastActivityMs < ttlMs
  if (!sessionActive && activity.lastActivityAt) {
    saveRuntimeContextState({ expired_at: activity.lastActivityAt }, db)
    state.expired_at = activity.lastActivityAt
  }
  const epochAt = parseContextUpdatedAt(state.expired_at ?? '')
  const entries = loadUserContextEntries(ttlMs, sessionActive, epochAt, db)
  const recentMessages = buildRecentMessages(options.messages, maxTurns, sessionActive)
  const query = [...recentMessages].reverse().find((message) => message.role === 'user')?.content ?? ''
  const workingContext = buildWorkingContext(entries, db)
  const retrievalHits = retrieveRuntimeContext(query, retrievalLimit, db)

  return {
    entries,
    working_context: workingContext,
    recent_messages: recentMessages,
    retrieval_hits: retrievalHits,
    context_usage: estimateContextUsage(recentMessages, workingContext, retrievalHits, contextTokenBudget),
    max_turns: maxTurns,
    ttl_ms: ttlMs,
    retrieval_limit: retrievalLimit,
    context_token_budget: contextTokenBudget,
    session_active: sessionActive,
    last_activity_at: activity.lastActivityAt,
    expires_at: activity.lastActivityMs == null ? null : new Date(activity.lastActivityMs + ttlMs).toISOString(),
  }
}

export function getRuntimeContextSettings(db: ReturnType<typeof getDb> = getDb()): RuntimeContextSettings {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value_json: string } | undefined
  if (!row) return defaultSettings()
  try {
    return normalizeSettings(JSON.parse(row.value_json))
  } catch {
    return defaultSettings()
  }
}

export function saveRuntimeContextSettings(
  input: Partial<RuntimeContextSettings>,
  db: ReturnType<typeof getDb> = getDb(),
): RuntimeContextSettings {
  const settings = normalizeSettings({ ...getRuntimeContextSettings(db), ...input })
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(SETTINGS_KEY, JSON.stringify(settings))
  return settings
}

export function getRuntimeContextState(db: ReturnType<typeof getDb> = getDb()): RuntimeContextState {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(SETTINGS_STATE_KEY) as { value_json: string } | undefined
  if (!row) return defaultState()
  try {
    return normalizeState(JSON.parse(row.value_json))
  } catch {
    return defaultState()
  }
}

export function saveRuntimeContextState(
  input: Partial<RuntimeContextState>,
  db: ReturnType<typeof getDb> = getDb(),
): RuntimeContextState {
  const state = normalizeState({ ...getRuntimeContextState(db), ...input })
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(SETTINGS_STATE_KEY, JSON.stringify(state))
  return state
}

export function getActiveContextValue(context: RuntimeContextWindow | undefined, key: string): string | undefined {
  const entry = context?.entries[key]
  if (!entry?.active || !entry.value) return undefined
  return entry.value
}

export function parseContextUpdatedAt(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return Number.NaN
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed
  return new Date(normalized).getTime()
}

function loadUserContextEntries(
  ttlMs: number,
  sessionActive: boolean,
  epochAtMs: number,
  db: ReturnType<typeof getDb>,
): Record<string, RuntimeContextEntry> {
  const rows = db.prepare('SELECT key, value, updated_at FROM user_context').all() as Array<{
    key: string
    value: string
    updated_at: string
  }>

  const now = Date.now()
  const entries: Record<string, RuntimeContextEntry> = {}
  for (const row of rows) {
    const updatedAt = parseContextUpdatedAt(row.updated_at)
    const ageMs = Number.isFinite(updatedAt) ? now - updatedAt : Number.MAX_SAFE_INTEGER
    entries[row.key] = {
      key: row.key,
      value: row.value,
      updated_at: row.updated_at,
      active: Boolean(row.value) && sessionActive && (Number.isNaN(epochAtMs) || updatedAt >= epochAtMs),
      age_ms: ageMs,
      ttl_ms: ttlMs,
    }
  }
  return entries
}

function buildWorkingContext(entries: Record<string, RuntimeContextEntry>, db: ReturnType<typeof getDb>): Record<string, unknown> {
  const context: Record<string, unknown> = {}
  for (const entry of Object.values(entries)) {
    if (!entry.active || !entry.value) continue
    context[entry.key] = entry.value
  }
  enrichRoomContext(context, db)
  enrichDeviceContext(context, db)
  return context
}

function enrichRoomContext(context: Record<string, unknown>, db: ReturnType<typeof getDb>): void {
  const roomId = Number(context.current_room)
  if (!Number.isFinite(roomId)) return

  const room = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(roomId) as { id: number; name: string } | undefined
  if (!room) return

  context.current_room_id = room.id
  context.current_room_name = room.name
}

function enrichDeviceContext(context: Record<string, unknown>, db: ReturnType<typeof getDb>): void {
  const deviceId = Number(context.current_device)
  if (!Number.isFinite(deviceId)) return

  const device = db.prepare(
    `SELECT d.id, d.name, d.device_type, d.room_id, r.name AS room_name
     FROM user_devices d
     LEFT JOIN rooms r ON r.id = d.room_id
     WHERE d.id = ?`,
  ).get(deviceId) as {
    id: number
    name: string
    device_type: string
    room_id: number | null
    room_name: string | null
  } | undefined
  if (!device) return

  context.current_device_id = device.id
  context.current_device_name = device.name
  context.current_device_type = device.device_type
  if (device.room_id != null) context.current_device_room_id = device.room_id
  if (device.room_name) context.current_device_room_name = device.room_name

  if (context.current_room == null && device.room_id != null) {
    context.current_room = String(device.room_id)
    context.current_room_id = device.room_id
    if (device.room_name) context.current_room_name = device.room_name
  }
}

function retrieveRuntimeContext(
  query: string,
  limit: number,
  db: ReturnType<typeof getDb>,
): RuntimeContextRetrievalHit[] {
  const text = query.trim()
  if (!text || limit <= 0) return []
  if (shouldSkipRuntimeRetrieval(text)) return []

  const memoryHits = retrieveMemoryExperiencePaths(text, limit, db)
  if (memoryHits.length >= limit) return memoryHits.slice(0, limit)

  const compiledHits = retrieveCompiledKnowledge(text, limit - memoryHits.length, db)
  return [...memoryHits, ...compiledHits].slice(0, limit)
}

function shouldSkipRuntimeRetrieval(query: string): boolean {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/[!！。？?\s,.，、~～]+/g, '')
  if (!normalized) return true

  return new Set([
    '你好',
    '你好啊',
    '你好呀',
    '您好',
    'hello',
    'hellothere',
    'hi',
    'hithere',
    '嗨',
    '嘿',
    'hey',
    'heythere',
    '在吗',
    '你在吗',
    '早',
    '早啊',
    '早上好',
    '晚上好',
    '晚安',
    '谢谢',
    '谢了',
    '辛苦了',
    'thanks',
    'thankyou',
    'thankyouverymuch',
    '哈哈',
    '哈哈哈',
    '呵呵',
    'ok',
    'okay',
  ]).has(normalized)
    || /^哈{2,}$/.test(normalized)
    || /^(hello|hi|hey)(there|buddy|friend)?$/.test(normalized)
}

function retrieveCompiledKnowledge(
  query: string,
  limit: number,
  db: ReturnType<typeof getDb>,
): RuntimeContextRetrievalHit[] {
  if (limit <= 0) return []
  const like = `%${query.slice(0, 80)}%`
  try {
    return (db.prepare(`
      SELECT id, kind, title, substr(body, 1, 160) AS snippet
      FROM compiled_knowledge_items
      WHERE title LIKE ? OR body LIKE ?
      ORDER BY rank_score DESC, updated_at DESC
      LIMIT ?
    `).all(like, like, limit) as RuntimeContextRetrievalHit[])
      .map(normalizeRetrievalHit)
  } catch {
    return []
  }
}

function retrieveMemoryExperiencePaths(
  query: string,
  limit: number,
  db: ReturnType<typeof getDb>,
): RuntimeContextRetrievalHit[] {
  try {
    const rows = db.prepare(`
      SELECT
        m.id,
        m.kind,
        m.title,
        m.summary,
        m.search_text,
        m.source,
        m.confidence,
        m.priority,
        m.metadata_json,
        p.intent_pattern,
        p.steps_json,
        p.skill_refs_json,
        p.device_refs_json,
        p.success_count,
        p.last_success_at,
        w.graph_hash AS current_workflow_graph_hash
      FROM memory_items m
      JOIN memory_experience_paths p ON p.memory_item_id = m.id
      LEFT JOIN workflows w
        ON w.id = CAST(json_extract(m.metadata_json, '$.workflow_id') AS INTEGER)
      WHERE m.kind = 'experience_path'
        AND m.status = 'active'
        AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
      ORDER BY m.priority DESC, p.success_count DESC, m.confidence DESC, m.updated_at DESC
      LIMIT 80
    `).all() as Array<{
      id: string
      kind: string
      title: string
      summary: string
      search_text: string
      source: string
      confidence: number
      priority: number
      metadata_json: string
      intent_pattern: string
      steps_json: string
      skill_refs_json: string
      device_refs_json: string
      success_count: number
      last_success_at: string | null
      current_workflow_graph_hash: string | null
    }>

    const terms = extractSearchTerms(query)
    const scoredRows: Array<{
      row: (typeof rows)[number] & { metadata: Record<string, unknown>; current_workflow_graph_hash: string }
      score: number
    }> = []
    for (const row of rows) {
      const metadata = safeParseObject(row.metadata_json)
      const workflowId = readPositiveNumber(metadata.workflow_id)
      const storedWorkflowGraphHash = String(metadata.workflow_graph_hash ?? metadata.graph_hash ?? '').trim()
      const currentWorkflowGraphHash = String(row.current_workflow_graph_hash ?? '').trim()

      if (workflowId != null) {
        if (!currentWorkflowGraphHash) continue
        if (storedWorkflowGraphHash && storedWorkflowGraphHash !== currentWorkflowGraphHash) continue
      }

      scoredRows.push({
        row: {
          ...row,
          metadata,
          current_workflow_graph_hash: currentWorkflowGraphHash,
        },
        score: scoreMemoryRow(row, terms),
      })
    }

    return scoredRows
      .filter((item) => item.score > 0)
      .sort((left, right) =>
        right.score - left.score
        || right.row.priority - left.row.priority
        || right.row.success_count - left.row.success_count
        || right.row.confidence - left.row.confidence,
      )
      .slice(0, limit)
      .map(({ row, score }) => {
        const workflowGraphHash = String(row.metadata.workflow_graph_hash ?? '').trim() || row.current_workflow_graph_hash
        return {
          id: row.id,
          kind: row.kind,
          title: row.title,
          snippet: row.summary || row.intent_pattern,
          source: 'memory',
          score,
          intent_pattern: row.intent_pattern,
          device_refs: readDeviceRefs(row.device_refs_json),
          skill_refs: readSkillRefs(row.skill_refs_json),
          steps: readPathSteps(row.steps_json),
          success_count: row.success_count,
          ...(workflowGraphHash ? { workflow_graph_hash: workflowGraphHash } : {}),
        }
      })
  } catch {
    return []
  }
}

function extractSearchTerms(query: string): string[] {
  const compact = normalizeSearchText(query)
  const terms = new Set<string>()
  if (compact.length >= 2) terms.add(compact)

  for (const match of query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const term = normalizeSearchText(match)
    if (term.length >= 2) terms.add(term)
  }

  if (compact.length >= 3 && compact.length <= 32) {
    for (let index = 0; index < compact.length - 1; index += 1) {
      terms.add(compact.slice(index, index + 2))
    }
  }

  return Array.from(terms)
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function readPositiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function scoreMemoryRow(
  row: { title: string; summary: string; search_text: string; intent_pattern: string; success_count: number; confidence: number },
  terms: string[],
): number {
  if (terms.length === 0) return 0
  const haystack = normalizeSearchText([
    row.title,
    row.summary,
    row.search_text,
    row.intent_pattern,
  ].join('\n'))

  let score = 0
  for (const term of terms) {
    if (!term || !haystack.includes(term)) continue
    score += term.length >= 4 ? 0.28 : 0.12
  }
  if (haystack.includes(terms[0])) score += 0.35
  score += Math.min(0.2, row.success_count * 0.04)
  score += Math.min(0.15, row.confidence * 0.15)
  return Math.min(1, score)
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').trim()
}

function readStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
  } catch {
    return []
  }
}

function readDeviceRefs(value: string): string[] {
  const refs = new Set<string>()
  for (const ref of readStringArray(value)) {
    const trimmed = ref.trim()
    if (!trimmed) continue
    refs.add(/^device:/.test(trimmed) ? trimmed : `device:${trimmed}`)
  }
  return Array.from(refs)
}

function readSkillRefs(value: string): Array<{ kind: string; id: string; label?: string }> {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is { kind: string; id: string; label?: string } =>
        Boolean(item)
        && typeof item === 'object'
        && typeof item.kind === 'string'
        && typeof item.id === 'string',
      )
      .map((item) => ({
        kind: item.kind,
        id: item.id,
        ...(typeof item.label === 'string' ? { label: item.label } : {}),
      }))
  } catch {
    return []
  }
}

function readPathSteps(value: string): Array<{ tool: string; action: string; params?: Record<string, unknown> }> {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is { tool: string; action: string; params?: Record<string, unknown> } =>
        Boolean(item)
        && typeof item === 'object'
        && typeof item.tool === 'string'
        && typeof item.action === 'string',
      )
      .slice(0, 5)
      .map((item) => ({
        tool: item.tool,
        action: item.action,
        ...(item.params && typeof item.params === 'object' && !Array.isArray(item.params)
          ? { params: item.params }
          : {}),
      }))
  } catch {
    return []
  }
}

function resolveSessionActivity(
  messages: Array<{ role: string; content: string }>,
  lastActivityAt?: string | null,
): { lastActivityAt: string | null; lastActivityMs: number | null } {
  if (lastActivityAt) {
    const parsed = parseContextUpdatedAt(lastActivityAt)
    if (Number.isFinite(parsed)) return { lastActivityAt, lastActivityMs: parsed }
  }
  if (messages.length > 0) {
    const now = new Date().toISOString()
    return { lastActivityAt: now, lastActivityMs: Date.now() }
  }
  return { lastActivityAt: null, lastActivityMs: null }
}

function buildRecentMessages(
  messages: Array<{ role: string; content: string }>,
  maxTurns: number,
  sessionActive: boolean,
): Array<{ role: string; content: string }> {
  const sanitized = messages
    .filter((message) => typeof message.role === 'string' && typeof message.content === 'string' && message.content.trim())
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))

  if (sessionActive) return sanitized.slice(-maxTurns)

  const latestUserIndex = findLatestUserMessageIndex(sanitized)
  if (latestUserIndex >= 0) return sanitized.slice(latestUserIndex).slice(-maxTurns)
  return sanitized.slice(-1)
}

function findLatestUserMessageIndex(messages: Array<{ role: string; content: string }>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function defaultSettings(): RuntimeContextSettings {
  return {
    max_turns: DEFAULT_MAX_TURNS,
    ttl_ms: CONTEXT_TTL_MS,
    retrieval_limit: DEFAULT_RETRIEVAL_LIMIT,
    context_token_budget: DEFAULT_CONTEXT_TOKEN_BUDGET,
  }
}

function defaultState(): RuntimeContextState {
  return {
    expired_at: null,
  }
}

function normalizeSettings(input: unknown): RuntimeContextSettings {
  const raw = input && typeof input === 'object' ? input as Partial<RuntimeContextSettings> : {}
  return {
    max_turns: clampInteger(raw.max_turns, 2, 50, DEFAULT_MAX_TURNS),
    ttl_ms: clampInteger(raw.ttl_ms, 60_000, 24 * 60 * 60 * 1000, CONTEXT_TTL_MS),
    retrieval_limit: clampInteger(raw.retrieval_limit, 0, 8, DEFAULT_RETRIEVAL_LIMIT),
    context_token_budget: clampInteger(raw.context_token_budget, 1_000, 200_000, DEFAULT_CONTEXT_TOKEN_BUDGET),
  }
}

function normalizeState(input: unknown): RuntimeContextState {
  const raw = input && typeof input === 'object' ? input as Partial<RuntimeContextState> : {}
  const expiredAt = typeof raw.expired_at === 'string' && raw.expired_at.trim() ? raw.expired_at : null
  return { expired_at: expiredAt }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.round(numberValue)))
}

function normalizeRetrievalHit(hit: RuntimeContextRetrievalHit): RuntimeContextRetrievalHit {
  return {
    id: String(hit.id),
    kind: hit.kind,
    title: hit.title,
    snippet: hit.snippet ?? '',
    source: hit.source ?? 'compiled_knowledge',
    score: hit.score,
  }
}

function estimateContextUsage(
  messages: Array<{ role: string; content: string }>,
  workingContext: Record<string, unknown>,
  retrievalHits: RuntimeContextRetrievalHit[],
  maxTokens: number,
): RuntimeContextUsage {
  const messageTokens = estimateTokens(messages.map((message) => `${message.role}: ${message.content}`).join('\n'))
  const workingContextTokens = estimateTokens(JSON.stringify(workingContext))
  const retrievalTokens = retrievalHits.length > 0 ? estimateTokens(JSON.stringify(retrievalHits)) : 0
  return {
    used_tokens: messageTokens + workingContextTokens + retrievalTokens,
    max_tokens: maxTokens,
    message_tokens: messageTokens,
    working_context_tokens: workingContextTokens,
    retrieval_tokens: retrievalTokens,
  }
}

function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const nonCjkCount = text.length - cjkCount
  return Math.ceil(cjkCount * 1.1 + nonCjkCount / 4)
}
