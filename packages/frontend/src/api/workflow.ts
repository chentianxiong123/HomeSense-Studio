const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return resp.json()
}

export interface WorkflowNodeData {
  id?: number
  type: string
  label: string
  config: Record<string, unknown>
  position: { x: number; y: number }
}

export interface WorkflowEdgeData {
  source_node_id: number
  target_node_id: number
  source_port?: string
  target_port?: string
  condition?: Record<string, unknown>
}

export interface Workflow {
  id: number
  name: string
  description: string
  trigger_type: 'manual' | 'cron' | 'chat'
  cron_expression: string | null
  published: number
  graph_json: string
  graph_hash?: string
  created_at: string
  updated_at: string
  graph_updated_at?: string
}

export interface WorkflowRun {
  id: number
  workflow_id: number
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  triggered_by: string
  started_at: string | null
  finished_at: string | null
  result_json: string
  graph_hash?: string
  inputs_json: string
  trace_json: string
  events_json: string
}

export interface WorkflowRunQuality {
  workflow_id: number
  total_runs: number
  success_count: number
  failure_count: number
  last_run_status: 'pending' | 'running' | 'succeeded' | 'failed' | ''
  last_run_at: string
  last_success_at: string
  last_success_inputs_json: string
  last_success_input_keys: string[]
  evidence_status: 'untested' | 'proven' | 'regressed' | 'failing' | 'running'
}

export interface WorkflowRunResult {
  run_id: number
  workflow_id: number
  graph_hash?: string
  status: 'succeeded' | 'failed'
  outputs: Record<string, unknown>
  error?: string
  trace: Array<{
    node_id: string
    node_type: string
    status: 'succeeded' | 'failed' | 'skipped'
    inputs: Record<string, unknown>
    resolved_inputs?: Record<string, unknown>
    upstream?: Array<{
      node_id: string
      node_type: string
      source_port: string
      target_port: string
      status: 'succeeded' | 'failed' | 'skipped'
      outputs: Record<string, unknown>
    }>
    outputs: Record<string, unknown>
    duration_ms: number
    error?: string
    compensation_task_id?: number
    attempts?: number
    retry_errors?: string[]
  }>
  events: Array<Record<string, unknown>>
}

export interface WorkflowPreviewResult {
  workflow_id: number
  executable: boolean
  warnings: string[]
  steps: WorkflowPreviewStep[]
}

export interface WorkflowPreviewStep {
  node_id: string
  node_type: string
  label: string
  summary: string
  executor_name?: string
  target?: string
  cli_name?: string
  action?: string
  params?: Record<string, unknown>
  risk: 'none' | 'dry_run' | 'device' | 'external'
  resolution_mode: 'static' | 'simulated' | 'unresolved'
  runnable: boolean
  preview_state: 'ready' | 'skipped' | 'blocked'
  active_outputs: string[]
  subflow?: {
    workflow_id?: number
    workflow_name?: string
    input_keys: string[]
    output_key: string | null
    node_count?: number
  }
}

export interface WorkflowNodeDefinition {
  type: string
  label: string
  icon: string
  color: string
  category: 'trigger' | 'device' | 'logic' | 'compute' | 'control' | 'output'
  description: string
  default_config: Record<string, unknown>
  config_schema: WorkflowNodeConfigField[]
  output_schema: WorkflowNodeOutputField[]
}

export interface WorkflowNodeConfigField {
  key: string
  label: string
  control: 'text' | 'textarea' | 'number' | 'boolean' | 'json' | 'select'
  required?: boolean
  placeholder?: string
  helper?: string
  options?: Array<{ label: string; value: string | number | boolean }>
}

export interface WorkflowNodeOutputField {
  key: string
  label: string
  type: 'boolean' | 'string' | 'number' | 'object' | 'array' | 'unknown'
  description?: string
}

export interface WorkflowReseedResult {
  created: string[]
  updated: string[]
  skipped: string[]
}

export interface WorkflowDetailResult {
  workflow: Workflow
  nodes: WorkflowNodeData[]
  edges: WorkflowEdgeData[]
  run_quality: WorkflowRunQuality
}

export const workflowApi = {
  listNodeDefinitions: () => request<{ node_definitions: WorkflowNodeDefinition[] }>('/api/workflows/node-definitions'),
  list: () => request<{ workflows: Workflow[] }>('/api/workflows'),
  reseedDefaults: (overwrite = true) =>
    request<{ status: string; data: WorkflowReseedResult }>('/api/workflows/reseed-defaults', {
      method: 'POST',
      body: JSON.stringify({ overwrite }),
    }),
  get: (id: number) => request<WorkflowDetailResult>(`/api/workflows/${id}`),
  create: (data: { name: string; description?: string; trigger_type?: string; nodes?: WorkflowNodeData[]; edges?: WorkflowEdgeData[] }) =>
    request<{ status: string; data: { id: number } }>('/api/workflows', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Workflow> & { nodes?: WorkflowNodeData[]; edges?: WorkflowEdgeData[] }) =>
    request<{ status: string }>(`/api/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<{ status: string }>(`/api/workflows/${id}`, { method: 'DELETE' }),
  run: (id: number, inputs?: Record<string, unknown>) =>
    request<{ status: string; data: WorkflowRunResult }>(`/api/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ inputs }) }),
  preview: (id: number, inputs?: Record<string, unknown>) =>
    request<{ status: string; data: WorkflowPreviewResult }>(`/api/workflows/${id}/preview`, { method: 'POST', body: JSON.stringify({ inputs }) }),
  runs: (id: number) =>
    request<{ runs: WorkflowRun[] }>(`/api/workflows/${id}/runs`),
}
