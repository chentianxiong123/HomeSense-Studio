/**
 * Mock API server — intercepts all /api/* fetch() calls and returns
 * plausible mock data so the frontend runs without a backend.
 *
 * Import this file once in main.ts:  import './mock-server'
 */

const origFetch = window.fetch.bind(window)
const REAL_API_PREFIXES = [
  '/api/auth',
  '/api/rooms',
  '/api/user-devices',
  '/api/terminal',
]

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_ROOMS = [
  { id: 1, name: '客厅', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
  { id: 2, name: '卧室', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
  { id: 3, name: '厨房', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
]

const MOCK_LLM_PROVIDERS = [
  {
    id: 1,
    name: 'openai-mock',
    api_base: 'https://api.openai.com/v1',
    api_key: '***',
    category: 'chat',
    enabled: true,
    extra_config: {},
  },
]

const MOCK_LLM_MODELS = [
  { id: 1, provider_id: 1, model_name: 'gpt-4o-mini', category: 'chat', is_default: true, enabled: true },
  { id: 2, provider_id: 1, model_name: 'gpt-4o', category: 'chat', is_default: false, enabled: true },
]

const MOCK_CHAT_MESSAGES = [
  {
    id: 1,
    conversation_id: 1,
    role: 'assistant',
    content: '你好！我是 HomeSense 助手。当前运行在离线模式，后端未连接。',
    created_at: '2026-06-05T00:00:00Z',
  },
]

const MOCK_SERVICES = [
  { id: 'adb-cli', name: 'ADB CLI', status: 'ready', kind: 'cli' },
  { id: 'mi-cli', name: 'Mi CLI', status: 'ready', kind: 'cli' },
]

const MOCK_AGENTS = [
  {
    id: 1,
    slug: 'default',
    name: '默认助手',
    profile: 'entertainment',
    surface: 'chat',
    memory_scope: 'global',
    tool_scope_json: '{}',
    default_channel: 'chat',
    status: 'active',
  },
]

const MOCK_USER_CONTEXT = {
  entries: {},
  working_context: {},
  recent_messages: [],
  retrieval_hits: [],
  context_usage: { used_tokens: 0, max_tokens: 8000, message_tokens: 0, working_context_tokens: 0, retrieval_tokens: 0 },
  max_turns: 20,
  ttl_ms: 3600000,
  retrieval_limit: 5,
  context_token_budget: 4000,
  session_active: false,
  last_activity_at: null,
  expires_at: null,
}

// ─── Router ──────────────────────────────────────────────────────────────────

type MockHandler = (url: URL, method: string, body: unknown, match?: RegExpExecArray) => unknown

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFound(): Response {
  return json({ status: 'error', error: 'Not found (mock)' }, 404)
}

const routes: Array<{ pattern: RegExp; methods: string[]; handler: MockHandler }> = []

function route(pattern: RegExp, methods: string[], handler: MockHandler) {
  routes.push({ pattern, methods, handler })
}

// --- Chat ---
route(/^\/api\/chat\/messages$/, ['GET'], () => ({ messages: MOCK_CHAT_MESSAGES, hasMore: false }))
route(/^\/api\/chat\/stream$/, ['GET'], () => new Response('data: {"role":"assistant","content":"[mock stream end]"}\n\n', {
  status: 200,
  headers: { 'Content-Type': 'text/event-stream' },
}))

// --- LLM ---
route(/^\/api\/llm\/providers$/, ['GET'], () => ({ providers: MOCK_LLM_PROVIDERS }))
route(/^\/api\/llm\/providers$/, ['POST'], () => ({ id: 99 }))
route(/^\/api\/llm\/providers\/(\d+)\/models$/, ['GET'], () => ({ models: MOCK_LLM_MODELS }))
route(/^\/api\/llm\/providers\/(\d+)\/models$/, ['POST'], () => ({ id: 99 }))
route(/^\/api\/llm\/providers\/(\d+)\/models\/query$/, ['POST'], () => ({ models: ['gpt-4o-mini', 'gpt-4o'], status: 'success' }))
route(/^\/api\/llm\/providers\/(\d+)$/, ['PUT'], () => ({ status: 'success' }))
route(/^\/api\/llm\/providers\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))
route(/^\/api\/llm\/models\/(\d+)$/, ['PUT'], () => ({ status: 'success' }))
route(/^\/api\/llm\/models\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))
route(/^\/api\/llm\/models\/(\d+)\/default$/, ['POST'], () => ({ status: 'success' }))
route(/^\/api\/llm\/models\/(\d+)\/set-default$/, ['POST'], () => ({ status: 'success' }))
route(/^\/api\/llm\/vision$/, ['POST'], () => ({
  status: 'success',
  data: { content: 'This is a mock vision response.', usage: { prompt_tokens: 100, completion_tokens: 20 } },
}))
route(/^\/api\/llm\/usage$/, ['GET'], () => ({ entries: [], total: 0 }))
route(/^\/api\/llm\/usage\/totals$/, ['GET'], () => ({
  total_input: 0, total_output: 0, total_success: 0, total_fail: 0,
  daily: [], by_provider: [], by_model: [], by_category: [],
}))
route(/^\/api\/llm\/chat-models$/, ['GET'], () => ({
  models: MOCK_LLM_MODELS.map((m) => ({ id: m.id, provider_name: 'openai-mock', model_name: m.model_name, is_default: m.is_default })),
}))
route(/^\/api\/llm\/default-model$/, ['GET'], () => ({
  provider_name: 'openai-mock', model_name: 'gpt-4o-mini', category: 'chat',
}))

// --- Health ---
route(/^\/api\/health$/, ['GET'], () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// --- Services ---
route(/^\/api\/services$/, ['GET'], () => ({ services: MOCK_SERVICES }))

// --- Manifests ---
route(/^\/api\/manifests$/, ['GET'], () => ({
  manifests: MOCK_SERVICES.map((s) => ({
    id: s.id,
    kind: s.kind,
    display_name: s.name,
    description: `${s.name} service`,
    capabilities: [],
    protocol: 'stdio',
    transport: 'pipe',
    status: 'ready',
    configured: true,
    actions: [],
  })),
  summary: { total: MOCK_SERVICES.length, by_kind: { cli: MOCK_SERVICES.length }, configured: MOCK_SERVICES.length },
}))
route(/^\/api\/manifests\/(.+)\/invoke$/, ['POST'], () => ({
  status: 'success', manifest_id: 'mock', kind: 'cli', duration_ms: 42, data: { ok: true },
}))

// --- Approvals ---
route(/^\/api\/approvals$/, ['GET'], () => ({ approvals: [] }))
route(/^\/api\/approvals\/(.+)\/resolve$/, ['POST'], () => ({ status: 'success', approval: { id: 'mock', decision: 'approved' } }))

// --- Agents ---
route(/^\/api\/agents\/instances$/, ['GET'], () => ({ instances: MOCK_AGENTS }))

// --- Rooms ---
route(/^\/api\/rooms$/, ['GET'], () => ({ rooms: MOCK_ROOMS }))
route(/^\/api\/rooms$/, ['POST'], (_url, _m, body: any) => ({
  status: 'success', data: { room: { id: 99, name: body?.name ?? 'New Room', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
}))
route(/^\/api\/rooms\/(\d+)$/, ['GET'], (_url, _m, _b, match?: RegExpExecArray) => {
  const id = Number(match?.[1])
  return { room: MOCK_ROOMS.find((r) => r.id === id) ?? MOCK_ROOMS[0] }
})
route(/^\/api\/rooms\/(\d+)$/, ['PUT'], (_url, _m, body: any, match?: RegExpExecArray) => {
  const id = Number(match?.[1])
  const r = MOCK_ROOMS.find((x) => x.id === id) ?? MOCK_ROOMS[0]
  return { status: 'success', data: { room: { ...r, ...body } } }
})
route(/^\/api\/rooms\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))

// --- User Context / Runtime Context ---
route(/^\/api\/user-context$/, ['GET'], () => ({ context: {} }))
route(/^\/api\/user-context\/(.+)$/, ['PUT'], () => ({ status: 'success' }))
route(/^\/api\/runtime-context$/, ['GET'], () => ({ context: MOCK_USER_CONTEXT }))
route(/^\/api\/runtime-context\/settings$/, ['GET'], () => ({
  settings: { max_turns: 20, ttl_ms: 3600000, retrieval_limit: 5, context_token_budget: 4000 },
}))
route(/^\/api\/runtime-context\/settings$/, ['PUT'], () => ({
  status: 'success',
  settings: { max_turns: 20, ttl_ms: 3600000, retrieval_limit: 5, context_token_budget: 4000 },
}))

// --- Rule Engine ---
route(/^\/api\/rules$/, ['GET'], () => ({ rules: [] }))
route(/^\/api\/rules$/, ['POST'], () => ({ status: 'success', rule: {} }))
route(/^\/api\/rules\/(\d+)$/, ['PUT'], () => ({ status: 'success' }))
route(/^\/api\/rules\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))
route(/^\/api\/rules\/(\d+)\/toggle$/, ['PATCH'], () => ({ status: 'success' }))

// --- Command ---
route(/^\/api\/command\/match$/, ['POST'], () => ({ matched: false }))
route(/^\/api\/command\/aliases$/, ['GET'], () => ({ aliases: [] }))
route(/^\/api\/command\/aliases$/, ['POST'], () => ({ status: 'success' }))
route(/^\/api\/command\/aliases\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))
route(/^\/api\/command\/stopwords$/, ['GET'], () => ({ stopwords: [] }))
route(/^\/api\/command\/stopwords$/, ['POST'], () => ({ status: 'success' }))
route(/^\/api\/command\/stopwords\/(\d+)$/, ['DELETE'], () => ({ status: 'success' }))
route(/^\/api\/command\/l1-policy$/, ['GET'], () => ({
  policy: { max_compact_length: 20, allow_summary: 'on', blocked_markers: [], blocked_punctuation: [], blocked_patterns: [] },
}))
route(/^\/api\/command\/l1-policy\/check$/, ['POST'], () => ({ allowed: true, reason: '' }))

// --- Observability ---
route(/^\/api\/cron\/schedules$/, ['GET'], () => ({ schedules: [] }))
route(/^\/api\/compensation\/tasks$/, ['GET'], () => ({ tasks: [] }))
route(/^\/api\/compensation\/tasks\/(\d+)$/, ['GET'], () => ({ task: {} }))
route(/^\/api\/compensation\/tasks\/(\d+)\/preview$/, ['POST'], () => ({
  status: 'success', result: { can_execute: false, checks: [], estimated_impact: 'none', warnings: [] },
}))
route(/^\/api\/compensation\/tasks\/(\d+)\/retry$/, ['POST'], () => ({ status: 'success', success: true }))
route(/^\/api\/experiences$/, ['GET'], () => ({ experiences: [] }))
route(/^\/api\/memory\/status$/, ['GET'], () => ({
  canonical_profile: null, current_embedding_slot: null, embedding_locked: false,
  slot_matches_canonical: false, memory_entity_count: 0, compiled_knowledge_count: 0,
}))
route(/^\/api\/memory\/compiled$/, ['GET'], () => ({ items: [] }))
route(/^\/api\/workflows\/(\d+)\/runs$/, ['GET'], () => ({ runs: [] }))

// ─── Fetch Override ──────────────────────────────────────────────────────────

window.fetch = async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init?.method ?? 'GET').toUpperCase()

  // Only intercept /api/* requests
  if (!url.startsWith('/api/') && !url.includes('://localhost') && !url.includes('/api/')) {
    return origFetch(input, init)
  }

  // Extract path from URL
  let path: string
  try {
    if (url.startsWith('http')) {
      path = new URL(url).pathname
    } else {
      path = url.split('?')[0]
    }
  } catch {
    return origFetch(input, init)
  }

  if (REAL_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return origFetch(input, init)
  }

  // Parse body if JSON
  let body: unknown = undefined
  if (init?.body && typeof init.body === 'string') {
    try { body = JSON.parse(init.body) } catch { body = init.body }
  }

  // Match route
  for (const r of routes) {
    if (!r.methods.includes(method)) continue
    const match = r.pattern.exec(path)
    if (match) {
      const result = r.handler(new URL(`http://localhost${path}`), method, body, match)
      if (result instanceof Response) return result
      // Simulate ~30ms network delay
      await new Promise((res) => setTimeout(res, 10 + Math.random() * 30))
      return json(result)
    }
  }

  // Unmatched /api/* — return 404 mock
  console.warn(`[mock-server] Unmatched: ${method} ${path}`)
  return notFound()
}

console.info('[mock-server] /api/auth, /api/rooms, /api/user-devices, and /api/terminal pass through to the real backend')

export {}
