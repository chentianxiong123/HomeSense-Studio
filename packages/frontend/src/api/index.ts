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

export interface ChatResponse {
  status: 'success' | 'error'
  data?: {
    conversation_id: number
    session?: {
      conversation_id: number
      channel: string
      user_id: string
      agent_instance_id: number | null
      working_context_json: string
      pending_task_id: string | null
      last_intent: string
      last_plan_id: string | null
      last_trace_id: string | null
      summary: string
      expires_at: string | null
      created_at: string
      updated_at: string
    }
    level: 1 | 2 | 3
    content: string
    actions?: Array<{ success: boolean; data?: unknown; error?: string }>
    metadata: {
      processing_time_ms: number
      completed_message?: string
      matched_rule?: number
      matched_plan_id?: string
      recalled_memories?: number
      plan_executable?: boolean
      target_device_id?: string
      tool_calls?: number
    }
  }
  error?: string
  message?: string
}

export interface ConversationMessage {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls_json?: string
  tool_result_json?: string
  created_at: string
}

export interface Conversation {
  id: number
  channel?: string
  user_id?: string
  agent_instance_id?: number | null
  last_intent?: string
  last_plan_id?: string | null
  summary?: string
  created_at: string
  updated_at: string
}

export interface LLMProvider {
  id: number
  name: string
  api_base: string
  api_key: string
  enabled: boolean
  extra_config: Record<string, unknown>
}

export interface LLMProviderConfig extends LLMProvider {}

export interface LLMModel {
  id: number
  provider_id: number
  model_name: string
  category: 'chat' | 'embedding' | 'rerank'
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
    get: (id: number) => request<{ device: UserDevice }>(`/api/user-devices/${id}`),
    create: (body: { name: string; device_type?: string; room_id?: number | null; mi_did?: string | null; adb_ip?: string; ip_address?: string }) =>
      request<{ status: string; data: { device: UserDevice } }>('/api/user-devices', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: { name?: string; device_type?: string; room_id?: number | null; mi_did?: string | null; adb_ip?: string; ip_address?: string }) =>
      request<{ status: string; data: { device: UserDevice } }>(`/api/user-devices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: number) => request<{ status: string }>(`/api/user-devices/${id}`, { method: 'DELETE' }),
    miCandidates: () => request<{ devices: MiDeviceCandidate[] }>('/api/user-devices/mi-candidates'),
    ping: () => request<{ online: Record<number, boolean> }>('/api/user-devices/ping-all'),
    capabilities: (id: number, refresh?: boolean) =>
      request<{ status: string; data?: { did: string; name: string; device_type: string; room: string; capabilities: Array<{ name: string; kind: string; type?: string; source?: string; output?: Record<string, { type: string; description: string }> | null }> }; error?: string; message?: string }>(`/api/user-devices/${id}/capabilities${refresh ? '?refresh=true' : ''}`),
    executeCapability: (id: number, capability: string, params?: string) =>
      request<{ status: string; data?: { capability: string; kind?: string; output?: unknown }; error?: string; message?: string }>(`/api/user-devices/${id}/capabilities/execute`, {
        method: 'POST',
        body: JSON.stringify({ capability, ...(params !== undefined ? { params } : {}) }),
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
    send: (message: string, conversationId?: number) =>
      request<ChatResponse>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message, conversation_id: conversationId }),
      }),
    history: (conversationId?: number) =>
      request<{ conversations: Conversation[] } | { messages: ConversationMessage[] }>(
        conversationId ? `/api/chat/history?conversation_id=${conversationId}` : '/api/chat/history',
      ),
    messages: (id: number, cursor?: number, limit?: number) => {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', String(cursor))
      if (limit) params.set('limit', String(limit))
      const qs = params.toString()
      return request<{ messages: ConversationMessage[]; hasMore?: boolean }>(`/api/chat/${id}${qs ? '?' + qs : ''}`)
    },
},
  llm: {
    listProviders: () =>
      request<{ providers: LLMProviderConfig[] }>('/api/llm/providers'),
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
  observability: {
    cronSchedules: () => request<{ schedules: Array<{ id: string; cron: string }> }>('/api/cron/schedules'),
    compensationTasks: () =>
      request<{ tasks: Array<Record<string, unknown>> }>('/api/compensation/tasks'),
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
