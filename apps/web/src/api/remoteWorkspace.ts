const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  return response.json()
}

export interface RemoteWorkspaceEndpointProbe {
  url: string
  reachable: boolean
  status_code: number | null
  state?: string
  last_heartbeat?: number | null
  error?: string
}

export interface RemoteWorkspaceCliProbe {
  command: string
  args: string[]
  available: boolean
  version?: string
  error?: string
  candidates: string[]
  install_hint: string
}

export interface RemoteWorkspaceSourceKernelProbe {
  name: string
  mode: 'source_embedded'
  available: boolean
  source_path: string
  status: 'scaffolded' | 'ready'
  notes: string[]
  error?: string
}

export interface RemoteWorkspaceSshProbe {
  command: string
  args: string[]
  available: boolean
  version?: string
  error?: string
  candidates: string[]
  install_hint: string
}

export interface RemoteWorkspaceLaunchRecipe {
  command: string
  cwd: string
  notes: string[]
}

export interface RemoteWorkspaceLaunchResult {
  status: 'started' | 'starting' | 'already_running' | 'missing_cli' | 'failed'
  command: string
  cwd: string
  pid?: number
  message?: string
  endpoint?: RemoteWorkspaceEndpointProbe
}

export interface RemoteWorkspaceStopResult {
  status: 'stopped' | 'not_running' | 'failed'
  message?: string
}

export type RemoteWorkspaceTargetKind = 'code_server' | 'ssh_host' | 'http_workspace' | 'local_service'

export interface RemoteWorkspaceTarget {
  id: string
  label: string
  kind: RemoteWorkspaceTargetKind
  endpoint: string
  workspace_root?: string
  source: 'sidecar' | 'external_integration'
  enabled: boolean
  status: 'ready' | 'registered' | 'offline'
  integration_id?: number
  capabilities: string[]
  auth: {
    mode: string
    owner: string
    notes: string
  }
}

export interface RemoteWorkspaceTargetProbe {
  id: string
  label: string
  kind: RemoteWorkspaceTargetKind
  checked_at: string
  reachable: boolean
  endpoint: string
  command?: string
  status_code?: number | null
  output?: string
  error?: string
}

export interface RemoteWorkspaceFileEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size: number | null
  modified_at: string | null
}

export interface RemoteWorkspaceFileList {
  target_id: string
  label: string
  kind: 'local_source' | 'ssh' | 'adb'
  root: string
  path: string
  absolute_path: string
  entries: RemoteWorkspaceFileEntry[]
  truncated: boolean
}

export interface RemoteWorkspaceFilePreview {
  target_id: string
  label: string
  kind: 'local_source' | 'ssh' | 'adb'
  root: string
  path: string
  absolute_path: string
  name: string
  size: number
  modified_at: string | null
  encoding: 'utf8' | 'binary'
  content: string
  truncated: boolean
}

export interface RemoteWorkspaceStatus {
  checked_at: string
  integration_state: 'missing' | 'registered' | 'enabled'
  readiness: 'missing' | 'registered' | 'partial' | 'ready'
  endpoint: RemoteWorkspaceEndpointProbe
  cli: RemoteWorkspaceCliProbe
  kernel: RemoteWorkspaceSourceKernelProbe
  ssh: RemoteWorkspaceSshProbe
  launch: RemoteWorkspaceLaunchRecipe
  reference: {
    name: string
    url: string
    docs_url: string
    healthcheck_url: string
  }
  auth: {
    mode: string
    independent: boolean
    owner: string
    notes: string
  }
  integration: {
    id: number
    name: string
    kind: string
    endpoint: string
    description: string
    enabled: boolean
    metadata: Record<string, unknown>
    created_at: string
    updated_at: string
  } | null
}

export const remoteWorkspaceApi = {
  status: () => request<{ status: string; data: RemoteWorkspaceStatus }>('/api/remote-workspace/status'),
  targets: () => request<{ status: string; data: RemoteWorkspaceTarget[] }>('/api/remote-workspace/targets'),
  registerTarget: (body: Record<string, unknown>) =>
    request<{ status: string; data: RemoteWorkspaceTarget }>('/api/remote-workspace/targets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeTarget: (id: string) =>
    request<{ status: string }>(`/api/remote-workspace/targets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  probeTarget: (id: string) =>
    request<{ status: string; data: RemoteWorkspaceTargetProbe }>(`/api/remote-workspace/targets/${encodeURIComponent(id)}/probe`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  fileTree: (params: { targetId?: string; path?: string; limit?: number } = {}) => {
    const query = new URLSearchParams()
    if (params.targetId) query.set('target_id', params.targetId)
    if (params.path) query.set('path', params.path)
    if (params.limit) query.set('limit', String(params.limit))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<{ status: string; data: RemoteWorkspaceFileList }>(`/api/remote-workspace/filesystem/tree${suffix}`)
  },
  filePreview: (params: { targetId?: string; path?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.targetId) query.set('target_id', params.targetId)
    if (params.path) query.set('path', params.path)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request<{ status: string; data: RemoteWorkspaceFilePreview }>(`/api/remote-workspace/filesystem/file${suffix}`)
  },
  start: () =>
    request<{ status: string; data: RemoteWorkspaceLaunchResult }>('/api/remote-workspace/start', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  stop: () =>
    request<{ status: string; data: RemoteWorkspaceStopResult }>('/api/remote-workspace/stop', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  terminalUrl: (params: { targetId?: string; sessionId?: string; cols?: number; rows?: number } = {}) => {
    const base = API_BASE || window.location.origin
    const url = new URL('/api/remote-workspace/terminal', base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (params.targetId) url.searchParams.set('target_id', params.targetId)
    if (params.sessionId) url.searchParams.set('session_id', params.sessionId)
    if (params.cols) url.searchParams.set('cols', String(params.cols))
    if (params.rows) url.searchParams.set('rows', String(params.rows))
    return url.toString()
  },
}
