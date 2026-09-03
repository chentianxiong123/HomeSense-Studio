const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return response.json()
}

export interface ExecutorDescriptor {
  name: string
  kind: 'cli' | 'service' | 'workflow' | 'agent' | 'plan'
  description: string
  enabled: boolean
  capabilities: string[]
  metadata?: Record<string, unknown>
}

export interface CLIExecutorDescriptor {
  name: string
  source: 'builtin' | 'third_party'
  protocol: 'process_json_arg' | 'process_stdin_json' | 'in_process_module'
  timeout_ms: number
  actions: string[]
  action_details: Array<{
    name: string
    description?: string
    params_schema: Record<string, string>
  }>
}

export type AgentAdapterBinding =
  | {
      kind: 'cli'
      cli_name: string
      default_action: string
    }
  | {
      kind: 'a2a'
      endpoint_env?: string
      endpoint_url?: string
      agent_name?: string
    }

export interface AgentAdapterDescriptor {
  id: string
  category: 'coding' | 'automation' | 'media' | 'device'
  transport: 'local_cli' | 'local_agent' | 'remote_bridge' | 'a2a_http'
  display_name: string
  description: string
  enabled: boolean
  status: 'ready' | 'planned' | 'disabled'
  capabilities: string[]
  execution_modes: Array<'deferred' | 'immediate'>
  input_schema: {
    task: 'string'
    payload: 'object'
    execution_mode: Array<'deferred' | 'immediate'>
  }
  input_template: {
    task: string
    payload: Record<string, unknown>
  }
  sample_dispatch: {
    task: string
    payload: Record<string, unknown>
    execution_mode: 'deferred' | 'immediate'
  }
  adapter_binding?: AgentAdapterBinding
  runtime_status?: {
    binding_kind: 'cli' | 'a2a' | 'none'
    mode: 'local_ready' | 'a2a_ready' | 'a2a_dry_run' | 'unbound'
    configured: boolean
    endpoint_env?: string
    agent_name?: string
  }
}

export interface PlanPreview {
  plan: {
    id: string
    name: string
    description: string
    intent: string
    input: string
    source: string
  }
  steps: Array<{
    order: number
    tool: string
    action: string
    params: Record<string, unknown>
    proposed_executor: string | null
    supported: boolean
  }>
  executable: boolean
}

export const executorApi = {
  listExecutors: () => request<{
    executors: ExecutorDescriptor[]
    agent_adapters: AgentAdapterDescriptor[]
    cli_executors: CLIExecutorDescriptor[]
  }>('/api/executor-gateway/executors'),
  listPlans: () => request<{ plans: Array<Record<string, unknown>> }>('/api/executor-gateway/plans'),
  getPlan: (id: string) => request<{ status: string; data: PlanPreview }>(`/api/executor-gateway/plans/${id}`),
}
