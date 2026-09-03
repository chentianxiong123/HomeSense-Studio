const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return response.json()
}

export interface McpToolRecord {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export interface McpServerRecord {
  id: number
  name: string
  transport: 'stdio' | 'http' | 'sse' | 'websocket'
  endpoint: string
  command: string
  args: string[]
  description: string
  tools: McpToolRecord[]
  auth: Record<string, unknown>
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export const mcpApi = {
  listServers: () => request<{ servers: McpServerRecord[] }>('/api/mcp/servers'),
  getServer: (id: number | string) => request<{ server: McpServerRecord }>(`/api/mcp/servers/${encodeURIComponent(String(id))}`),
}
