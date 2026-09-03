import type Database from 'better-sqlite3'
import { getDb } from '../../db/index.js'

export type ExternalIntegrationKind = 'http' | 'cli' | 'local_service' | 'webhook'

export interface ExternalIntegrationAction {
  name: string
  capability_id?: string
  description?: string
  method?: string
  path?: string
  params_schema?: Record<string, unknown>
  sample?: Record<string, unknown>
}

export interface ExternalIntegrationRecord {
  id: number
  name: string
  kind: ExternalIntegrationKind
  endpoint: string
  description: string
  capability_ids: string[]
  actions: ExternalIntegrationAction[]
  enabled: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RegisterExternalIntegrationInput {
  name?: string
  kind?: ExternalIntegrationKind | string
  endpoint?: string
  base_url?: string
  description?: string
  capability_ids?: unknown
  capabilities?: unknown
  actions?: unknown
  enabled?: boolean
  metadata?: unknown
}

interface ExternalIntegrationRow {
  id: number
  name: string
  kind: ExternalIntegrationKind
  endpoint: string
  description: string
  capability_ids_json: string
  actions_json: string
  enabled: number
  metadata_json: string
  created_at: string
  updated_at: string
}

const DEFAULT_BILIBILI_MUSIC_ENDPOINT = 'http://127.0.0.1:28974'

export class ExternalIntegrationsService {
  constructor(private readonly dbProvider: () => Database.Database = getDb) {}

  ensureDefaults(): void {
    const existing = this.getByName('bilibili-music')
    if (existing) return
    this.register({
      name: 'bilibili-music',
      kind: 'http',
      endpoint: defaultBilibiliMusicEndpoint(),
      description: 'External capability source for DLNA casting, Bilibili media resolving, and speaker playback.',
      capability_ids: [
        'media.dlna.discover',
        'media.dlna.cast',
        'media.dlna.control',
        'media.speaker.list',
        'media.speaker.play',
        'media.music.resolve',
      ],
      actions: [
        { name: 'health', capability_id: 'integration.health', description: 'Check external service health.' },
        { name: 'discover_devices', capability_id: 'media.dlna.discover', description: 'Discover DLNA renderers.' },
        { name: 'start_cast', capability_id: 'media.dlna.cast', description: 'Start DLNA casting after media and device are selected.' },
        { name: 'list_speakers', capability_id: 'media.speaker.list', description: 'List available speaker playback targets.' },
        { name: 'play_bilibili', capability_id: 'media.speaker.play', description: 'Play Bilibili media on a speaker target.' },
        { name: 'resolve_audio', capability_id: 'media.music.resolve', description: 'Resolve Bilibili media into playable audio.' },
      ],
      metadata: {
        source: 'system',
        adapter: 'bilibili-cast-bridge',
        executors: ['dlna-cast-cli', 'speaker-cast-cli'],
        public: false,
      },
    })
  }

  list(): ExternalIntegrationRecord[] {
    const rows = this.dbProvider()
      .prepare('SELECT * FROM external_integrations ORDER BY enabled DESC, name ASC')
      .all() as ExternalIntegrationRow[]
    return rows.map(rowToRecord)
  }

  get(id: number): ExternalIntegrationRecord | null {
    const row = this.dbProvider()
      .prepare('SELECT * FROM external_integrations WHERE id = ?')
      .get(id) as ExternalIntegrationRow | undefined
    return row ? rowToRecord(row) : null
  }

  getByName(name: string): ExternalIntegrationRecord | null {
    const row = this.dbProvider()
      .prepare('SELECT * FROM external_integrations WHERE name = ?')
      .get(name) as ExternalIntegrationRow | undefined
    return row ? rowToRecord(row) : null
  }

  register(input: RegisterExternalIntegrationInput): ExternalIntegrationRecord {
    const normalized = normalizeInput(input)
    const result = this.dbProvider().prepare(`
      INSERT INTO external_integrations (
        name, kind, endpoint, description, capability_ids_json, actions_json, enabled, metadata_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        kind = excluded.kind,
        endpoint = excluded.endpoint,
        description = excluded.description,
        capability_ids_json = excluded.capability_ids_json,
        actions_json = excluded.actions_json,
        enabled = excluded.enabled,
        metadata_json = excluded.metadata_json,
        updated_at = datetime('now')
    `).run(
      normalized.name,
      normalized.kind,
      normalized.endpoint,
      normalized.description,
      JSON.stringify(normalized.capability_ids),
      JSON.stringify(normalized.actions),
      normalized.enabled ? 1 : 0,
      JSON.stringify(normalized.metadata),
    )
    const id = Number(result.lastInsertRowid || this.getByName(normalized.name)?.id)
    const record = id ? this.get(id) : this.getByName(normalized.name)
    if (!record) throw new Error(`External integration registration failed: ${normalized.name}`)
    return record
  }

  remove(id: number): boolean {
    const result = this.dbProvider()
      .prepare('DELETE FROM external_integrations WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}

export const externalIntegrationsService = new ExternalIntegrationsService()

function normalizeInput(input: RegisterExternalIntegrationInput) {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('name is required')
  const endpoint = String(input.endpoint ?? input.base_url ?? '').trim()
  const kind = normalizeKind(input.kind)
  const capabilityIds = unique([
    ...normalizeStringList(input.capability_ids),
    ...normalizeStringList(input.capabilities),
  ])
  const actions = normalizeActions(input.actions)
  return {
    name,
    kind,
    endpoint,
    description: String(input.description ?? '').trim(),
    capability_ids: capabilityIds,
    actions,
    enabled: input.enabled !== false,
    metadata: normalizeObject(input.metadata),
  }
}

function normalizeKind(value: unknown): ExternalIntegrationKind {
  if (value === 'cli' || value === 'local_service' || value === 'webhook') return value
  return 'http'
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeActions(value: unknown): ExternalIntegrationAction[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === 'string') return { name: item.trim() }
    const row = normalizeObject(item)
    return {
      name: String(row.name ?? row.action ?? row.capability_id ?? '').trim(),
      capability_id: optionalString(row.capability_id ?? row.capability),
      description: optionalString(row.description),
      method: optionalString(row.method)?.toUpperCase(),
      path: optionalString(row.path),
      params_schema: normalizeOptionalObject(row.params_schema),
      sample: normalizeOptionalObject(row.sample),
    }
  }).filter((action) => action.name)
}

function rowToRecord(row: ExternalIntegrationRow): ExternalIntegrationRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    endpoint: row.endpoint,
    description: row.description,
    capability_ids: parseJsonArray(row.capability_ids_json) as string[],
    actions: parseJsonArray(row.actions_json).map((item) => normalizeActions([item])[0]).filter(Boolean),
    enabled: row.enabled === 1,
    metadata: parseJsonObject(row.metadata_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function defaultBilibiliMusicEndpoint(): string {
  return String(
    process.env.HOMESENSE_BILIBILI_MUSIC_BASE_URL
    ?? process.env.BILIBILI_MUSIC_BASE_URL
    ?? process.env.HOMESENSE_CAST_BASE_URL
    ?? process.env.CAST_SERVICE_BASE_URL
    ?? DEFAULT_BILIBILI_MUSIC_ENDPOINT,
  ).replace(/\/+$/, '')
}
