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
const DEFAULT_CODE_SERVER_ENDPOINT = 'http://127.0.0.1:8080'

export class ExternalIntegrationsService {
  constructor(private readonly dbProvider: () => Database.Database = getDb) {}

  ensureDefaults(): void {
    this.ensureDefault({
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
          auth: {
            mode: 'service_token',
            status_source: 'bilibili-music health',
            credentials_owned_by: 'bilibili-music',
          },
          public: false,
        },
      })

    this.ensureDefault({
        name: 'bilibili-cli',
        kind: 'cli',
        endpoint: defaultBilibiliCliEndpoint(),
        description: 'Real Bilibili CLI bridge for search, video metadata, account, feed, collections, and interactions.',
        capability_ids: [
          'media.bilibili.status',
          'media.bilibili.search',
          'media.bilibili.video',
          'media.bilibili.user',
          'media.bilibili.feed',
          'media.bilibili.interaction',
        ],
        actions: [
          { name: 'health', capability_id: 'integration.health', description: 'Check bridge and reference checkout readiness.' },
          { name: 'status', capability_id: 'media.bilibili.status', description: 'Check login/auth status.' },
          { name: 'search', capability_id: 'media.bilibili.search', description: 'Search users or videos.' },
          { name: 'video', capability_id: 'media.bilibili.video', description: 'Fetch video details, subtitles, comments, AI summary, and related videos.' },
          { name: 'user', capability_id: 'media.bilibili.user', description: 'Fetch user profile.' },
          { name: 'user_videos', capability_id: 'media.bilibili.user', description: 'Fetch user videos.' },
          { name: 'hot', capability_id: 'media.bilibili.search', description: 'Fetch hot videos.' },
          { name: 'rank', capability_id: 'media.bilibili.search', description: 'Fetch ranking videos.' },
          { name: 'favorites', capability_id: 'media.bilibili.feed', description: 'Fetch favorite folders or contents.' },
          { name: 'following', capability_id: 'media.bilibili.feed', description: 'Fetch following list.' },
          { name: 'watch_later', capability_id: 'media.bilibili.feed', description: 'Fetch watch-later list.' },
          { name: 'history', capability_id: 'media.bilibili.feed', description: 'Fetch watch history.' },
          { name: 'like', capability_id: 'media.bilibili.interaction', description: 'Like or unlike a video.' },
          { name: 'coin', capability_id: 'media.bilibili.interaction', description: 'Coin a video.' },
          { name: 'triple', capability_id: 'media.bilibili.interaction', description: 'One-click triple action.' },
        ],
        metadata: {
          source: 'system',
          adapter: 'jackwener/bilibili-cli',
          executor: 'bilibili-cli',
          entrypoint: 'uv run bili',
          endpoint_env: 'HOMESENSE_BILIBILI_CLI_DIR',
          output_envelope: 'ok/schema_version/data/error',
          auth: {
            mode: 'cli_profile',
            status_action: 'status',
            identity_action: 'whoami',
            login_action: 'login',
            logout_action: 'logout',
            storage: 'upstream_cli_credentials',
            credentials_owned_by: 'bilibili-cli',
          },
          public: false,
        },
      })

    this.ensureDefault({
        name: 'message-gateway',
        kind: 'local_service',
        endpoint: 'internal://message-gateway',
        enabled: false,
        description: 'Planned multi-channel message gateway inspired by Hermes gateway adapters, session context, delivery router, and mirroring.',
        capability_ids: [
          'message.gateway.receive',
          'message.gateway.send',
          'message.gateway.mirror',
          'message.gateway.status',
        ],
        actions: [
          { name: 'status', capability_id: 'message.gateway.status', description: 'Inspect gateway runtime status.' },
          { name: 'send', capability_id: 'message.gateway.send', description: 'Deliver a message to a configured channel.' },
          { name: 'mirror', capability_id: 'message.gateway.mirror', description: 'Mirror outbound messages into a session transcript.' },
        ],
        metadata: {
          source: 'planned',
          reference: 'D:/files/HomeSense/References/hermes-agent/gateway',
          patterns: ['platform_adapters', 'contextvars_session_scope', 'delivery_router', 'session_mirror'],
          auth: {
            mode: 'per_channel_token',
            credentials_owned_by: 'channel_platform',
            notes: 'Each messaging platform keeps its own token or bot secret.',
          },
        },
      })

    this.ensureDefault({
        name: 'code-server-workspace',
        kind: 'local_service',
        endpoint: defaultCodeServerEndpoint(),
        enabled: false,
        description: 'Optional browser workspace sidecar based on coder/code-server for editor, file tree, and integrated terminal.',
        capability_ids: [
          'workspace.code_server.status',
          'workspace.code_server.start',
          'workspace.code_server.stop',
          'workspace.code_server.open',
          'workspace.code_server.open_folder',
          'workspace.code_server.open_terminal',
          'filesystem.tree',
          'filesystem.preview',
          'terminal.session.open',
        ],
        actions: [
          { name: 'status', capability_id: 'workspace.code_server.status', description: 'Check code-server service readiness.' },
          { name: 'start', capability_id: 'workspace.code_server.start', description: 'Start the code-server sidecar when the CLI is available.' },
          { name: 'stop', capability_id: 'workspace.code_server.stop', description: 'Stop the code-server sidecar started by HomeSense.' },
          { name: 'open_workspace', capability_id: 'workspace.code_server.open', description: 'Open the browser workspace entry.' },
          { name: 'open_folder', capability_id: 'workspace.code_server.open_folder', description: 'Open a workspace folder when the service supports it.' },
          { name: 'open_terminal', capability_id: 'workspace.code_server.open_terminal', description: 'Open an integrated terminal in the browser workspace.' },
        ],
        metadata: {
          source: 'planned',
          adapter: 'coder/code-server',
          reference_url: 'https://github.com/coder/code-server',
          docs_url: 'https://coder.com/docs/code-server/latest',
          deployment_target: 'home_hub_or_nas',
          role: 'optional_browser_workspace_sidecar',
          reuse_reason: 'code-server already solves browser terminal, filesystem explorer, editor surface, and service auth as one deployable sidecar.',
          auth: {
            mode: 'service_password_or_reverse_proxy',
            credentials_owned_by: 'code-server',
            status_action: 'status',
            notes: 'HomeSense should register and open the sidecar; code-server or the reverse proxy owns its own password/session.',
          },
        },
      })

    this.ensureDefault({
        name: 'terminal-ssh-gateway',
        kind: 'local_service',
        endpoint: 'internal://terminal-ssh-gateway',
        enabled: false,
        description: 'Primary SSH terminal gateway for a home hub, desktop, or NAS deployment.',
        capability_ids: [
          'terminal.session.open',
          'terminal.session.input',
          'terminal.session.resize',
          'terminal.session.close',
          'terminal.ssh.connect',
        ],
        actions: [
          { name: 'open_session', capability_id: 'terminal.session.open', description: 'Open a local or SSH terminal session.' },
          { name: 'send_input', capability_id: 'terminal.session.input', description: 'Send terminal input.' },
          { name: 'resize', capability_id: 'terminal.session.resize', description: 'Resize a terminal session.' },
          { name: 'close_session', capability_id: 'terminal.session.close', description: 'Close a terminal session.' },
        ],
        metadata: {
          source: 'planned',
          deployment_target: 'home_hub_or_nas',
          frontend_candidate: 'xterm.js',
          service_candidates: ['ttyd', 'Wetty', 'Sshwifty'],
          protocol: 'websocket_terminal_stream',
          role: 'primary_remote_terminal_gateway',
          auth: {
            mode: 'ssh_key_or_agent',
            credentials_owned_by: 'target_host',
            notes: 'SSH stays isolated per host and per key.',
          },
        },
      })

    this.ensureDefault({
        name: 'filesystem-gateway',
        kind: 'local_service',
        endpoint: 'internal://filesystem-gateway',
        enabled: false,
        description: 'Planned browser-visible filesystem layer for remote host browsing, preview, and search.',
        capability_ids: [
          'filesystem.tree',
          'filesystem.read',
          'filesystem.search',
          'filesystem.preview',
          'filesystem.mount',
        ],
        actions: [
          { name: 'list_tree', capability_id: 'filesystem.tree', description: 'List a remote host filesystem tree.' },
          { name: 'read_file', capability_id: 'filesystem.read', description: 'Read a remote file.' },
          { name: 'search', capability_id: 'filesystem.search', description: 'Search filesystem paths and content.' },
          { name: 'preview', capability_id: 'filesystem.preview', description: 'Preview a remote file.' },
        ],
        metadata: {
          source: 'planned',
          deployment_target: 'home_hub_or_nas',
          frontend_candidate: 'filebrowser / SFTPGo',
          service_candidates: ['FileBrowser', 'SFTPGo'],
          auth: {
            mode: 'ssh_key_or_sftp',
            credentials_owned_by: 'target_host',
            notes: 'Remote host credentials stay on the host side or in a dedicated mount/service.',
          },
        },
      })

    this.ensureDefault({
        name: 'moonlight-web-runtime',
        kind: 'local_service',
        endpoint: 'internal://moonlight-web-runtime',
        enabled: false,
        description: 'Planned Moonlight web player runtime bridge for browser/PWA playback. HomeSense manages hosts, launch, and embedding while the runtime owns Moonlight/GameStream media handling.',
        capability_ids: [
          'streaming.web_player.open',
          'streaming.runtime.probe',
          'streaming.webrtc.bridge',
          'streaming.session.launch',
        ],
        actions: [
          { name: 'status', capability_id: 'streaming.runtime.probe', description: 'Check whether the Moonlight web runtime is available.' },
          { name: 'open_player', capability_id: 'streaming.web_player.open', description: 'Open the browser playback surface for a Sunshine host.' },
          { name: 'launch_session', capability_id: 'streaming.session.launch', description: 'Launch a browser-playable streaming session through the runtime.' },
        ],
        metadata: {
          source: 'planned',
          role: 'moonlight_web_runtime',
          deployment_target: 'home_hub_or_nas_sidecar',
          architecture: 'moonlight_runtime_to_webrtc_or_browser_playback_bridge',
          references: ['moonlight-common-c', 'moonlight-qt', 'moonlight-web-stream', 'WebRTC'],
          license_note: 'Moonlight client code is GPLv3; keep runtime boundary explicit before source-level absorption.',
          auth: {
            mode: 'runtime_session_or_reverse_proxy',
            credentials_owned_by: 'moonlight_web_runtime',
            notes: 'The runtime owns media-session auth and transport; HomeSense owns registry and launch control.',
          },
        },
      })
  }

  private ensureDefault(input: RegisterExternalIntegrationInput): void {
    const name = String(input.name ?? '').trim()
    const existing = name ? this.getByName(name) : null
    if (!existing) {
      this.register(input)
      return
    }
    const normalized = normalizeInput({
      ...input,
      endpoint: existing.endpoint || input.endpoint,
      enabled: existing.enabled,
      metadata: mergeDefaultMetadata(existing.metadata, input.metadata),
    })
    this.dbProvider().prepare(`
      UPDATE external_integrations SET
        kind = ?,
        endpoint = ?,
        description = ?,
        capability_ids_json = ?,
        actions_json = ?,
        enabled = ?,
        metadata_json = ?,
        updated_at = datetime('now')
      WHERE name = ?
    `).run(
      normalized.kind,
      normalized.endpoint,
      normalized.description,
      JSON.stringify(normalized.capability_ids),
      JSON.stringify(normalized.actions),
      normalized.enabled ? 1 : 0,
      JSON.stringify(normalized.metadata),
      normalized.name,
    )
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

  setEnabled(name: string, enabled: boolean): ExternalIntegrationRecord | null {
    const existing = this.getByName(name)
    if (!existing) return null
    this.dbProvider().prepare(`
      UPDATE external_integrations
      SET enabled = ?, updated_at = datetime('now')
      WHERE name = ?
    `).run(enabled ? 1 : 0, name)
    return this.getByName(name)
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

function mergeDefaultMetadata(existing: unknown, next: unknown): Record<string, unknown> {
  const existingObject = normalizeObject(existing)
  const nextObject = normalizeObject(next)
  const merged = { ...existingObject, ...nextObject }
  const existingAuth = normalizeObject(existingObject.auth)
  const nextAuth = normalizeObject(nextObject.auth)
  if (Object.keys(existingAuth).length > 0 || Object.keys(nextAuth).length > 0) {
    merged.auth = { ...existingAuth, ...nextAuth }
  }
  return merged
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

function defaultBilibiliCliEndpoint(): string {
  return String(
    process.env.HOMESENSE_BILIBILI_CLI_DIR
    ?? 'D:/files/HomeSense/References/bilibili-cli',
  )
}

function defaultCodeServerEndpoint(): string {
  return String(
    process.env.HOMESENSE_CODE_SERVER_BASE_URL
    ?? process.env.CODE_SERVER_BASE_URL
    ?? DEFAULT_CODE_SERVER_ENDPOINT,
  ).replace(/\/+$/, '')
}
