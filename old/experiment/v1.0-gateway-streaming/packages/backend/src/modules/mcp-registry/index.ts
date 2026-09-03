import type Database from 'better-sqlite3'
import { getDb } from '../../db/index.js'

export type McpTransport = 'stdio' | 'http' | 'sse' | 'websocket'

export interface McpToolDefinition {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export interface McpServerRecord {
  id: number
  name: string
  transport: McpTransport
  endpoint: string
  command: string
  args: string[]
  description: string
  tools: McpToolDefinition[]
  auth: Record<string, unknown>
  metadata: Record<string, unknown>
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RegisterMcpServerInput {
  name?: string
  transport?: string
  endpoint?: string
  command?: string
  args?: unknown
  description?: string
  tools?: unknown
  auth?: unknown
  metadata?: unknown
  enabled?: boolean
}

interface McpServerRow {
  id: number
  name: string
  transport: McpTransport
  endpoint: string
  command: string
  args_json: string
  description: string
  tools_json: string
  auth_json: string
  metadata_json: string
  enabled: number
  created_at: string
  updated_at: string
}

export class McpRegistryService {
  constructor(private readonly dbProvider: () => Database.Database = getDb) {}

  ensureDefaults(): void {
    this.ensureDefault({
      name: 'homesense-device-context',
      transport: 'http',
      endpoint: 'internal://mcp/homesense-device-context',
      description: 'Planned MCP surface for exposing current devices, rooms, context device, and capability summaries.',
      tools: [
        { name: 'list_devices', description: 'List managed devices with online state, room, bindings, and capability counts.' },
        { name: 'get_device_capabilities', description: 'Read structured capability schemas for a selected device.' },
        { name: 'get_current_context', description: 'Read the current room, context devices, and session-level context hints.' },
      ],
      auth: {
        mode: 'internal_session',
        credentials_owned_by: 'homesense',
      },
      metadata: {
        source: 'system',
        status: 'planned',
        role: 'mcp facade over real device management, not a fake device source',
      },
      enabled: false,
    })
  }

  list(): McpServerRecord[] {
    const rows = this.dbProvider()
      .prepare('SELECT * FROM mcp_servers ORDER BY enabled DESC, name ASC')
      .all() as McpServerRow[]
    return rows.map(rowToRecord)
  }

  get(id: number): McpServerRecord | null {
    const row = this.dbProvider()
      .prepare('SELECT * FROM mcp_servers WHERE id = ?')
      .get(id) as McpServerRow | undefined
    return row ? rowToRecord(row) : null
  }

  getByName(name: string): McpServerRecord | null {
    const row = this.dbProvider()
      .prepare('SELECT * FROM mcp_servers WHERE name = ?')
      .get(name) as McpServerRow | undefined
    return row ? rowToRecord(row) : null
  }

  register(input: RegisterMcpServerInput): McpServerRecord {
    const normalized = normalizeInput(input)
    const result = this.dbProvider().prepare(`
      INSERT INTO mcp_servers (
        name, transport, endpoint, command, args_json, description, tools_json, auth_json, metadata_json, enabled, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        transport = excluded.transport,
        endpoint = excluded.endpoint,
        command = excluded.command,
        args_json = excluded.args_json,
        description = excluded.description,
        tools_json = excluded.tools_json,
        auth_json = excluded.auth_json,
        metadata_json = excluded.metadata_json,
        enabled = excluded.enabled,
        updated_at = datetime('now')
    `).run(
      normalized.name,
      normalized.transport,
      normalized.endpoint,
      normalized.command,
      JSON.stringify(normalized.args),
      normalized.description,
      JSON.stringify(normalized.tools),
      JSON.stringify(normalized.auth),
      JSON.stringify(normalized.metadata),
      normalized.enabled ? 1 : 0,
    )
    const record = Number(result.lastInsertRowid)
      ? this.get(Number(result.lastInsertRowid))
      : this.getByName(normalized.name)
    if (!record) throw new Error(`MCP server registration failed: ${normalized.name}`)
    return record
  }

  remove(id: number): boolean {
    const result = this.dbProvider()
      .prepare('DELETE FROM mcp_servers WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  private ensureDefault(input: RegisterMcpServerInput): void {
    if (!input.name || this.getByName(input.name)) return
    this.register(input)
  }
}

export const mcpRegistryService = new McpRegistryService()

function normalizeInput(input: RegisterMcpServerInput) {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('name is required')
  return {
    name,
    transport: normalizeTransport(input.transport),
    endpoint: String(input.endpoint ?? '').trim(),
    command: String(input.command ?? '').trim(),
    args: normalizeStringList(input.args),
    description: String(input.description ?? '').trim(),
    tools: normalizeTools(input.tools),
    auth: normalizeObject(input.auth),
    metadata: normalizeObject(input.metadata),
    enabled: input.enabled !== false,
  }
}

function normalizeTransport(value: unknown): McpTransport {
  if (value === 'http' || value === 'sse' || value === 'websocket') return value
  return 'stdio'
}

function normalizeTools(value: unknown): McpToolDefinition[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return { name: item.trim() }
    const row = normalizeObject(item)
    return {
      name: String(row.name ?? '').trim(),
      description: optionalString(row.description),
      input_schema: normalizeOptionalObject(row.input_schema ?? row.schema),
    }
  }).filter((tool) => tool.name)
}

function rowToRecord(row: McpServerRow): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    endpoint: row.endpoint,
    command: row.command,
    args: parseJsonArray(row.args_json).map(String),
    description: row.description,
    tools: normalizeTools(parseJsonArray(row.tools_json)),
    auth: parseJsonObject(row.auth_json),
    metadata: parseJsonObject(row.metadata_json),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/\s+/).map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return normalizeObject(JSON.parse(raw) as unknown)
  } catch {
    return {}
  }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeOptionalObject(value: unknown): Record<string, unknown> | undefined {
  const object = normalizeObject(value)
  return Object.keys(object).length > 0 ? object : undefined
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}
