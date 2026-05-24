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
  provider_type: 'openai' | 'deepseek' | 'ollama' | 'custom'
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  is_default: boolean
  extra_config: Record<string, unknown>
}

export interface LLMModelSlot {
  slot_name: 'planner' | 'fast' | 'vision' | 'embedding' | 'rerank' | 'local'
  provider_type: 'openai' | 'deepseek' | 'ollama' | 'custom' | 'disabled'
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  dimensions: number | null
  capabilities: string[]
  extra_config: Record<string, unknown>
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
      request<{ status: string; data?: { did: string; name: string; device_type: string; room: string; capabilities: Array<{ name: string; kind: string; type?: string; value_resolution?: string[] }> }; error?: string; message?: string }>(`/api/user-devices/${id}/capabilities${refresh ? '?refresh=true' : ''}`),
    executeCapability: (id: number, capability: string, params?: string) =>
      request<{ status: string; data?: { capability: string; key_id: string; result: unknown }; error?: string; message?: string }>(`/api/user-devices/${id}/capabilities/execute`, {
        method: 'POST',
        body: JSON.stringify({ capability, ...(params !== undefined ? { params } : {}) }),
      }),
    capabilityHistory: (id: number) =>
      request<{ history: Array<{ time: string; deviceId: string; capability: string; params: string; status: string }> }>(`/api/user-devices/${id}/capabilities/history`),
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
    messages: (id: number) =>
      request<{ messages: ConversationMessage[] }>(`/api/chat/${id}`),
  },
  llm: {
    listProviders: () => request<{ providers: LLMProvider[] }>('/api/llm/providers'),
    listSlots: () => request<{ slots: LLMModelSlot[] }>('/api/llm/slots'),
    getSlot: (slot: LLMModelSlot['slot_name']) =>
      request<{ slot: LLMModelSlot | null }>(`/api/llm/slots/${slot}`),
    updateSlot: (slot: LLMModelSlot['slot_name'], body: Partial<LLMModelSlot>) =>
      request<{ status: string; data: LLMModelSlot }>(`/api/llm/slots/${slot}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    addProvider: (provider: Partial<LLMProvider>) =>
      request<{ id: number }>('/api/llm/providers', {
        method: 'POST',
        body: JSON.stringify(provider),
      }),
    updateProvider: (id: number, provider: Partial<LLMProvider>) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(provider),
      }),
    deleteProvider: (id: number) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, { method: 'DELETE' }),
    setDefault: (id: number) =>
      request<{ status: string }>(`/api/llm/providers/${id}/default`, { method: 'POST' }),
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
