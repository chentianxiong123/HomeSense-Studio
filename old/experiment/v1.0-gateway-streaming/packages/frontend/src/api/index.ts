const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  return resp.json()
}

export interface AuthStatus {
  status: 'success' | 'error'
  data?: {
    logged_in: boolean
    user_id?: string
    token_valid?: boolean
    has_saved_login?: boolean
    pending_qr?: boolean
    qr?: { login_url?: string; qr_image?: string; lp_url?: string }
    next_steps?: { should_scan_qr?: boolean }
    qr_url?: string | null
    qr_image?: string
    lp_url?: string
    message?: string
  }
  error?: string
  message?: string
}

export interface DeviceInfo {
  did: string
  model: string
  name: string
  manufacturer: string
  connection_type: 'wifi' | 'bt' | 'ir' | 'gateway'
  parent_id: string | null
  home_id?: string
  spec_type: string
  device_type?: string
  home_name?: string
  room_name?: string
  ip_address?: string
  features: Array<Record<string, unknown>>
  entities: Array<Record<string, unknown>>
  capability_profile?: Record<string, unknown>
}

export interface DiscoverResult {
  devices: DeviceInfo[]
  homes?: Array<Record<string, unknown>>
  error?: string
  message?: string
  duration_ms?: number
}

export interface ConversationMessage {
  id: number
  conversation_id?: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls_json?: string
  tool_result_json?: string
  tool_call_id?: string | null
  created_at: string
}

export interface LLMProvider {
  id: number
  name: string
  api_base: string
  api_key: string
  category: 'chat' | 'embedding' | 'rerank' | 'vision'
  enabled: boolean
  extra_config: Record<string, unknown>
}

export interface LLMProviderConfig extends LLMProvider {}

export interface LLMModel {
  id: number
  provider_id: number
  model_name: string
  category: 'chat' | 'embedding' | 'rerank' | 'vision'
  is_default: boolean
  enabled: boolean
}

export interface LLMUsageEntry {
  id: number
  model_id: number | null
  provider_id: number | null
  provider_name: string
  model_name: string
  category: string
  input_tokens: number
  output_tokens: number
  created_at: string
}

export interface LLMUsageTotals {
  total_input: number
  total_output: number
  total_success: number
  total_fail: number
  daily: Array<{ date: string; provider_name: string; model_name: string; category: string; success_count: number; fail_count: number; input_tokens: number; output_tokens: number }>
  by_provider: Array<{ provider_name: string; success: number; fail: number; input: number; output: number }>
  by_model: Array<{ model_name: string; success: number; fail: number; input: number; output: number }>
  by_category: Array<{ category: string; success: number; fail: number; input: number; output: number }>
}

export interface UserDevice {
  id: number
  name: string
  device_type: 'television' | 'stb' | 'speaker' | 'router' | 'outlet' | 'phone' | 'tv_box' | 'tablet' | 'computer' | 'other'
  room_id: number | null
  room_name: string | null
  mi_did: string | null
  adb_ip: string
  ip_address: string
  created_at: string
  updated_at: string
}

export interface DeviceCardProjection {
  id: number
  name: string
  device_type: UserDevice['device_type']
  room: {
    id: number | null
    name: string
  }
  sources: string[]
  bindings: {
    mi_did: string | null
    adb_ip: string | null
    ip_address: string | null
  }
  network: {
    ping_target: string | null
    online: boolean | null
    checked: boolean
    method: 'ping' | 'none'
  }
  display: {
    icon: string
    title: string
    subtitle: string
    status: 'online' | 'offline' | 'unknown'
  }
}

export interface DeviceRuntimeManifestCapabilitySummary {
  capability_id: string
  name: string
  kind: string
  source: string
  risk: string
  required_fields: string[]
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown> | null
  sample_arguments: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface DeviceRuntimeManifestItem extends DeviceCardProjection {
  capability_count: number
  capabilities?: DeviceRuntimeManifestCapabilitySummary[] | Array<Record<string, unknown>>
}

export interface DeviceRuntimeManifest {
  version: number
  generated_at: string
  include_capabilities: 'none' | 'summary' | 'full'
  devices: DeviceRuntimeManifestItem[]
}

export interface Room {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface MiDeviceCandidate {
  did: string
  name: string
  model: string
  device_type: string
  room_name: string
  home_name: string
}

export interface AdbConnection {
  address: string
  name: string
  model: string
  status: string
}

export const api = {
  auth: {
    login: () => request<AuthStatus>('/api/auth/login', { method: 'POST' }),
    passwordLogin: (username: string, password: string) =>
      request<AuthStatus>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    verifyTicket: (ticket: string, username: string, password: string) =>
      request<AuthStatus>('/api/auth/verify-ticket', {
        method: 'POST',
        body: JSON.stringify({ ticket, username, password }),
      }),
    status: () => request<AuthStatus>('/api/auth/status'),
    logout: () => request<AuthStatus>('/api/auth/logout', { method: 'POST' }),
  },
  devices: {
    list: () => request<DiscoverResult>('/api/devices'),
    discover: () => request<DiscoverResult>('/api/devices/discover', { method: 'POST' }),
    get: (did: string) => request<Record<string, unknown>>(`/api/devices/${did}`),
    control: (did: string, body: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/devices/${did}/control`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    status: (did: string) => request<Record<string, unknown>>(`/api/devices/${did}/status`),
    diagnostics: () => request<Record<string, unknown>>('/api/devices/mi/diagnostics'),
    scenes: (homeId?: string) =>
      request<Record<string, unknown>>(homeId ? `/api/devices/scenes?home_id=${encodeURIComponent(homeId)}` : '/api/devices/scenes'),
    executeScene: (body: { scene_id?: string; scene_name?: string; home_id?: string }) =>
      request<Record<string, unknown>>('/api/devices/scenes/execute', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    speakers: () => request<Record<string, unknown>>('/api/devices/speakers'),
    irControllers: (parentDid: string) =>
      request<Record<string, unknown>>(`/api/devices/ir/controllers/${encodeURIComponent(parentDid)}`),
    irKeys: (controllerId: string) =>
      request<Record<string, unknown>>(`/api/devices/ir/keys/${encodeURIComponent(controllerId)}`),
    update: (did: string, body: { name?: string; room_name?: string; home_name?: string }) =>
      request<{ status: string; data?: { did: string } }>(`/api/devices/${did}`, { method: 'PUT', body: JSON.stringify(body) }),
  },
  userDevices: {
    list: () => request<{ devices: UserDevice[] }>('/api/user-devices'),
    cards: (online?: boolean) =>
      request<{ cards: DeviceCardProjection[] }>(`/api/user-devices/cards${online ? '?online=1' : ''}`),
    runtimeManifest: (options?: { online?: boolean; capabilities?: 'none' | 'summary' | 'full'; limit?: number }) => {
      const params = new URLSearchParams()
      if (options?.online) params.set('online', '1')
      if (options?.capabilities) params.set('capabilities', options.capabilities)
      if (options?.limit != null) params.set('limit', String(options.limit))
      const suffix = params.toString() ? `?${params.toString()}` : ''
      return request<{ manifest: DeviceRuntimeManifest }>(`/api/user-devices/runtime-manifest${suffix}`)
    },
    get: (id: number) => request<{ device: UserDevice }>(`/api/user-devices/${id}`),
    create: (body: { name: string; device_type?: string; room_id?: number | null; mi_did?: string | null; adb_ip?: string; ip_address?: string }) =>
      request<{ status: string; data: { device: UserDevice } }>('/api/user-devices', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name?: string; device_type?: string; room_id?: number | null; mi_did?: string | null; adb_ip?: string; ip_address?: string }) =>
      request<{ status: string; data: { device: UserDevice } }>(`/api/user-devices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number) => request<{ status: string }>(`/api/user-devices/${id}`, { method: 'DELETE' }),
    miCandidates: () => request<{ devices: MiDeviceCandidate[] }>('/api/user-devices/mi-candidates'),
    ping: () => request<{ online: Record<number, boolean> }>('/api/user-devices/ping-all'),
    capabilities: (id: number, refresh?: boolean) =>
      request<{
        status: string
        data?: {
          did: string
          name: string
          device_type: string
          room: string
          capabilities: Array<{
            capability_id?: string
            name: string
            kind: string
            type?: string
            source?: string
            input_schema?: Record<string, unknown>
            output_schema?: Record<string, unknown> | null
            output?: Record<string, { type: string; description: string }> | null
            risk?: string
            metadata?: Record<string, unknown>
          }>
        }
        registry?: {
          version: number
          source: string
          capabilities: Array<Record<string, unknown>>
        }
        error?: string
        message?: string
      }>(`/api/user-devices/${id}/capabilities${refresh ? '?refresh=true' : ''}`),
    executeCapability: (
      id: number,
      capabilityOrPayload: string | {
        capability?: string
        capability_id?: string
        params?: string
        arguments?: Record<string, unknown>
      },
      params?: string,
    ) =>
      request<{ status: string; data?: { capability: string; capability_id?: string; kind?: string; source?: string; output?: unknown }; error?: string; message?: string }>(`/api/user-devices/${id}/capabilities/execute`, {
        method: 'POST',
        body: JSON.stringify(
          typeof capabilityOrPayload === 'string'
            ? { capability: capabilityOrPayload, ...(params !== undefined ? { params } : {}) }
            : capabilityOrPayload,
        ),
      }),
    capabilityHistory: (id: number) =>
      request<{ history: Array<{ time: string; deviceId: string; capability: string; params: string; status: string; result?: string }> }>(`/api/user-devices/${id}/capabilities/history`),
    irKeys: (id: number) =>
      request<{ status: string; data?: { controller_id: string; name: string; keys: Array<{ key_id: string; name: string; type?: string }> }; error?: string; message?: string }>(`/api/user-devices/${id}/ir-keys`),
    irPress: (id: number, keyId: string) =>
      request<{ status: string; data?: { key_id: string; result: unknown }; error?: string; message?: string }>(`/api/user-devices/${id}/ir-press`, {
        method: 'POST',
        body: JSON.stringify({ key_id: keyId }),
      }),
    listApps: (id: number, refresh?: boolean) =>
      request<{ status: string; data?: { apps: Array<{ package: string; name: string }>; updated_at: string }; error?: string; message?: string }>(`/api/user-devices/${id}/apps${refresh ? '?refresh=true' : ''}`),
    launchApp: (id: number, packageName: string) =>
      request<{ status: string; data?: unknown; error?: string; message?: string }>(`/api/user-devices/${id}/apps/launch`, {
        method: 'POST',
        body: JSON.stringify({ package: packageName }),
      }),
  },
  adbDevices: {
    list: () => request<{ devices: AdbConnection[]; duration_ms?: number }>('/api/devices/adb/list'),
    connect: (address: string, name?: string, model?: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/connect', { method: 'POST', body: JSON.stringify({ address, name, model }) }),
    disconnect: (address: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/disconnect', { method: 'POST', body: JSON.stringify({ address }) }),
    info: (address: string) =>
      request<{ display: unknown | null; currentApp: unknown | null }>(`/api/devices/adb/info?address=${encodeURIComponent(address)}`),
    screenshot: (address: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/screenshot', { method: 'POST', body: JSON.stringify({ address }) }),
    launchApp: (address: string, pkg: string, package_name?: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/launch', { method: 'POST', body: JSON.stringify({ address, package: pkg, package_name }) }),
    currentApp: (address: string) =>
      request<{ status: string; data?: unknown }>(`/api/devices/adb/app?address=${encodeURIComponent(address)}`),
    tap: (address: string, x: number, y: number) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/tap', { method: 'POST', body: JSON.stringify({ address, x, y }) }),
    inputText: (address: string, text: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/input', { method: 'POST', body: JSON.stringify({ address, text }) }),
    pressKey: (address: string, key: string) =>
      request<{ status: string; data?: unknown }>('/api/devices/adb/press_key', { method: 'POST', body: JSON.stringify({ address, key }) }),
  },
  chat: {
    streamUrl: () => `${API_BASE}/api/chat/stream`,
    messages: (cursor?: number, limit?: number) => {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', String(cursor))
      if (limit) params.set('limit', String(limit))
      const qs = params.toString()
      return request<{ messages: ConversationMessage[]; hasMore?: boolean }>(`/api/chat/messages${qs ? '?' + qs : ''}`)
    },
  },
  llm: {
    listProviders: (category?: string) =>
      request<{ providers: LLMProviderConfig[] }>(`/api/llm/providers${category ? `?category=${category}` : ''}`),
    listModels: (providerId: number, category?: string) =>
      request<{ models: LLMModel[] }>(`/api/llm/providers/${providerId}/models${category ? `?category=${category}` : ''}`),
    createProvider: (body: Omit<LLMProviderConfig, 'id'>) =>
      request<{ id: number }>('/api/llm/providers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateProvider: (id: number, body: Partial<LLMProviderConfig>) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteProvider: (id: number) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, { method: 'DELETE' }),
    addProvider: (body: Omit<LLMProviderConfig, 'id'>) =>
      request<{ id: number }>('/api/llm/providers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createModel: (providerId: number, body: { model_name: string; category?: string; is_default?: boolean; enabled?: boolean }) =>
      request<{ id: number }>(`/api/llm/providers/${providerId}/models`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    queryProviderModels: (providerId: number, body?: { api_base?: string; api_key?: string }) =>
      request<{ models: string[]; status?: string; error?: string; message?: string }>(`/api/llm/providers/${providerId}/models/query`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      }),
    updateModel: (id: number, body: Partial<LLMModel>) =>
      request<{ status: string }>(`/api/llm/models/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteModel: (id: number) =>
      request<{ status: string }>(`/api/llm/models/${id}`, { method: 'DELETE' }),
    setDefaultModel: (id: number) =>
      request<{ status: string }>(`/api/llm/models/${id}/default`, { method: 'POST' }),
    vision: (params: { model_id?: number; prompt: string; images: Array<{ url?: string; image_url?: string; base64?: string; data?: string; mime_type?: string; detail?: 'auto' | 'low' | 'high' }>; system?: string; temperature?: number; max_tokens?: number }) =>
      request<{ status: string; data?: { content: string | null; usage: { prompt_tokens: number; completion_tokens: number } }; error?: string; message?: string }>('/api/llm/vision', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    usage: (params?: { provider_id?: number; model_id?: number; model_name?: string; category?: string; from?: string; to?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams()
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v != null && v !== '') qs.set(k, String(v))
        }
      }
      const query = qs.toString()
      return request<{ entries: LLMUsageEntry[]; total: number }>(`/api/llm/usage${query ? `?${query}` : ''}`)
    },
    usageTotals: () =>
      request<LLMUsageTotals>('/api/llm/usage/totals'),
    chatModels: () =>
      request<{ models: Array<{ id: number; provider_name: string; model_name: string; is_default: boolean }> }>('/api/llm/chat-models'),
    defaultModel: (category?: string) =>
      request<{ provider_name: string; model_name: string; category: string }>(`/api/llm/default-model${category ? `?category=${category}` : ''}`),
    selectModel: (id: number) =>
      request<{ status: string }>(`/api/llm/models/${id}/set-default`, { method: 'POST' }),
  },
  health: () => request<{ status: string; timestamp: string }>('/api/health'),
  services: {
    list: () => request<{ services: Array<Record<string, unknown>> }>('/api/services'),
  },
  manifests: {
    list: () =>
      request<{
        manifests: Array<{
          id: string
          kind: 'cli' | 'agent' | 'a2a' | 'service' | 'channel'
          display_name: string
          description: string
          capabilities: string[]
          protocol: string
          transport: string
          status: 'ready' | 'planned' | 'disabled' | 'dry_run'
          configured: boolean
          timeout_ms?: number
          endpoint_env?: string
          actions: Array<{
            name: string
            description?: string
            params_schema?: Record<string, { type: string; required: boolean; description?: string; default?: unknown }>
          }>
          sample_invocation?: Record<string, unknown>
        }>
        summary: {
          total: number
          by_kind: Record<string, number>
          configured: number
        }
      }>('/api/manifests'),
    invoke: (id: string, body: Record<string, unknown>) =>
      request<{
        status: 'success' | 'error'
        manifest_id: string
        kind: string
        duration_ms: number
        data?: unknown
        error?: string
        message?: string
      }>(`/api/manifests/${encodeURIComponent(id)}/invoke`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  serviceCall: (name: string, params: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/services/${encodeURIComponent(name)}/call`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  approvals: {
    resolve: (id: string, decision: 'approved' | 'denied') =>
      request<{ status: string; approval?: { id: string; decision?: string } }>(
        `/api/approvals/${encodeURIComponent(id)}/resolve`,
        { method: 'POST', body: JSON.stringify({ decision }) },
      ),
    list: () =>
      request<{ approvals: Array<{ id: string; turn_id: string; reason: string; decision?: string; created_at: number; resolved_at?: number }> }>(
        '/api/approvals',
      ),
  },
  agents: {
    listInstances: () =>
      request<{
        instances: Array<{
          id: number
          slug: string
          name: string
          profile: 'entertainment' | 'productivity' | 'maintainer' | 'remote_bot'
          surface: 'chat' | 'studio' | 'scheduler' | 'remote'
          memory_scope: string
          tool_scope_json: string
          default_channel: string
          status: string
        }>
      }>('/api/agents/instances'),
  },
  devtest: {
    smokeSequence: () =>
      request<{
        sequence: Array<{ order: number; label: string; tool: string; action: string; params: Record<string, unknown> }>
      }>('/api/devtest/smoke/sequence'),
    virtualHome: () =>
      request<{ sandbox: Record<string, unknown> }>('/api/devtest/virtual-home'),
    sandboxRegistry: () =>
      request<{ registry: Record<string, unknown> }>('/api/devtest/sandbox/registry'),
    sandboxExecute: (body: { device_id: number; capability: string; params?: string | Record<string, unknown> | unknown[] }) =>
      request<{
        status: 'success' | 'error'
        error?: string
        message?: string
        duration_ms: number
        device: { id: number; name: string; device_type: string; room_name: string | null }
        request: { capability: string; params: unknown }
        execution: Record<string, unknown>
        sandbox: { projection?: Record<string, unknown>; timeline_tail: Array<Record<string, unknown>> }
      }>('/api/devtest/sandbox/execute', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    runSmoke: () =>
      request<{
        status: string
        intent: string
        duration_ms: number
        overall: 'success' | 'partial' | 'failed'
        summary: { success: number; error: number; skipped: number; total: number }
        steps: Array<{
          order: number
          label: string
          tool: string
          action: string
          params: Record<string, unknown>
          status: 'success' | 'error' | 'skipped'
          duration_ms: number
          result?: unknown
          error?: string
        }>
      }>('/api/devtest/smoke', { method: 'POST' }),
  },
  rooms: {
    list: () => request<{ rooms: Room[] }>('/api/rooms'),
    get: (id: number) => request<{ room: Room }>(`/api/rooms/${id}`),
    create: (body: { name: string }) =>
      request<{ status: string; data: { room: Room } }>('/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name: string }) =>
      request<{ status: string; data: { room: Room } }>(`/api/rooms/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number) => request<{ status: string }>(`/api/rooms/${id}`, { method: 'DELETE' }),
  },
  userContext: {
    get: () => request<{ context: Record<string, { value: string; updated_at: string }> }>('/api/user-context'),
    runtime: () => request<{ context: { entries: Record<string, { key: string; value: string; updated_at: string; active: boolean; age_ms: number; ttl_ms: number }>; working_context: Record<string, unknown>; recent_messages: Array<{ role: string; content: string }>; retrieval_hits: Array<{ id: string; kind: string; title: string; snippet: string; source?: string; score?: number }>; context_usage: { used_tokens: number; max_tokens: number; message_tokens: number; working_context_tokens: number; retrieval_tokens: number }; max_turns: number; ttl_ms: number; retrieval_limit: number; context_token_budget: number; session_active: boolean; last_activity_at: string | null; expires_at: string | null } }>('/api/runtime-context'),
    settings: () => request<{ settings: { max_turns: number; ttl_ms: number; retrieval_limit: number; context_token_budget: number } }>('/api/runtime-context/settings'),
    updateSettings: (body: { max_turns?: number; ttl_ms?: number; retrieval_limit?: number; context_token_budget?: number }) =>
      request<{ status: string; settings: { max_turns: number; ttl_ms: number; retrieval_limit: number; context_token_budget: number } }>('/api/runtime-context/settings', { method: 'PUT', body: JSON.stringify(body) }),
    set: (key: string, value: string) =>
      request<{ status: string }>(`/api/user-context/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  },
  ruleEngine: {
    list: () => request<{ rules: Array<{ id: number; trigger_pattern: string; priority: number; enabled: boolean; actions: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }> }> }>('/api/rules'),
    create: (body: { trigger_pattern: string; priority?: number; actions: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }> }) =>
      request<{ status: string; rule?: unknown }>('/api/rules', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { trigger_pattern?: string; priority?: number; enabled?: boolean; actions?: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }> }) =>
      request<{ status: string }>(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: number) =>
      request<{ status: string }>(`/api/rules/${id}`, { method: 'DELETE' }),
    toggle: (id: number, enabled: boolean) =>
      request<{ status: string }>(`/api/rules/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  },
  command: {
    match: (input: string) =>
      request<{ matched: boolean; device_id?: number; capability?: string; ir_key?: string; alias?: string; stripped_input?: string; mentioned_device?: string | null }>('/api/command/match', { method: 'POST', body: JSON.stringify({ input }) }),
    listAliases: (deviceId?: number) =>
      request<{ aliases: Array<{ id: number; device_type: string; device_id: number | null; capability: string; ir_key: string; alias: string; is_custom: number; enabled: number }> }>(`/api/command/aliases${deviceId ? `?device_id=${deviceId}` : ''}`),
    addAlias: (body: { device_id: number; capability: string; ir_key?: string; alias: string }) =>
      request<{ status: string }>('/api/command/aliases', { method: 'POST', body: JSON.stringify(body) }),
    removeAlias: (id: number) =>
      request<{ status: string }>(`/api/command/aliases/${id}`, { method: 'DELETE' }),
    listStopwords: () =>
      request<{ stopwords: Array<{ id: number; word: string; is_custom: number }> }>('/api/command/stopwords'),
    addStopword: (word: string) =>
      request<{ status: string }>('/api/command/stopwords', { method: 'POST', body: JSON.stringify({ word }) }),
    removeStopword: (id: number) =>
      request<{ status: string }>(`/api/command/stopwords/${id}`, { method: 'DELETE' }),
    l1Policy: () =>
      request<{
        policy: {
          max_compact_length: number
          allow_summary: string
          blocked_markers: Array<{ id: string; label: string; description: string; examples: string[] }>
          blocked_punctuation: Array<{ id: string; label: string; description: string; examples: string[] }>
          blocked_patterns: Array<{ id: string; label: string; description: string; examples: string[] }>
        }
      }>('/api/command/l1-policy'),
    checkL1Policy: (input: string) =>
      request<{ allowed: boolean; reason: string }>('/api/command/l1-policy/check', {
        method: 'POST',
        body: JSON.stringify({ input }),
      }),
  },
  observability: {
    cronSchedules: () => request<{ schedules: Array<{ id: string; cron: string }> }>('/api/cron/schedules'),
    compensationTasks: () =>
      request<{ tasks: Array<Record<string, unknown>> }>('/api/compensation/tasks'),
    compensationTask: (id: number) =>
      request<{ task: Record<string, unknown> }>(`/api/compensation/tasks/${id}`),
    previewCompensationTask: (id: number) =>
      request<{ status: string; result: { can_execute: boolean; checks: Array<{ name: string; passed: boolean; message: string }>; estimated_impact: string; warnings: string[] } }>(`/api/compensation/tasks/${id}/preview`, { method: 'POST' }),
    retryCompensationTask: (id: number) =>
      request<{ status: string; success: boolean }>(`/api/compensation/tasks/${id}/retry`, { method: 'POST' }),
    rules: () => request<{ rules: Array<Record<string, unknown>> }>('/api/rules'),
    experiences: () => request<{ experiences: Array<Record<string, unknown>> }>('/api/experiences'),
    memoryStatus: () =>
      request<{
        canonical_profile: Record<string, unknown> | null
        current_embedding_slot: Record<string, unknown> | null
        embedding_locked: boolean
        slot_matches_canonical: boolean
        memory_entity_count: number
        compiled_knowledge_count: number
      }>('/api/memory/status'),
    memoryCompiled: () =>
      request<{ items: Array<Record<string, unknown>> }>('/api/memory/compiled'),
workflowRuns: (workflowId: number) =>
      request<{ runs: Array<Record<string, unknown>> }>(`/api/workflows/${workflowId}/runs`),
  },
}
