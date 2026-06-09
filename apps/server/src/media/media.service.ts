import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/database'

export type MediaSourceKind = 'bilibili' | 'url' | 'local' | 'storage'
export type MediaCandidateKind = 'page' | 'playlist' | 'stream'
export type MediaStreamKind = 'audio' | 'video' | 'hls' | 'dash'
export type MediaSourceSiteKind = 'page' | 'channel' | 'playlist' | 'search' | 'custom'

export interface MediaPlaylistItem {
  id: string
  source: MediaSourceKind
  title: string
  artist?: string
  cover?: string
  duration_sec?: number
  upstream_id?: string
  upstream_url?: string
  stream_url?: string
  mime_type?: string
  stream_kind?: MediaStreamKind
}

interface MediaPlaylistRow {
  item_id: string
  source: string
  title: string
  artist: string | null
  cover: string | null
  duration_sec: number | null
  upstream_id: string | null
  upstream_url: string | null
  stream_url: string | null
  mime_type: string | null
}

interface MediaSourceSiteRow {
  id: number
  title: string
  url: string
  provider: string
  kind: string
  tags_json: string
  last_sniffed_at: string | null
  last_candidates_count: number | null
  created_at: string
  updated_at: string
}

export interface MediaCandidate {
  id: string
  source: MediaSourceKind
  kind: MediaCandidateKind
  stream_kind?: MediaStreamKind
  title: string
  url: string
  page_url?: string
  mime_type?: string
  duration_sec?: number
  thumbnail?: string
  headers?: Record<string, string>
  confidence?: number
  provider: string
}

export interface MediaPlaylistReorderInput {
  itemIds: string[]
}

export interface MediaSourceSite {
  id: number
  title: string
  url: string
  provider: string
  kind: MediaSourceSiteKind
  tags: string[]
  last_sniffed_at?: string
  last_candidates_count?: number
  created_at: string
  updated_at: string
}

export interface MediaSourceSiteInput {
  title?: string
  url?: string
  provider?: string
  kind?: string
  tags?: unknown
}

export interface MediaSourceSiteUpdateInput {
  title?: string
  url?: string
  provider?: string
  kind?: string
  tags?: unknown
}

export interface PrepareMediaStreamInput {
  candidate_id?: string
  url?: string
  mime_type?: string
  headers?: Record<string, unknown>
}

export interface PreparedMediaStream {
  id: string
  candidate_id?: string
  url: string
  upstream_url: string
  mime_type: string
  proxied: boolean
  expires_at: string
  seekable: boolean
}

interface PreparedStreamRecord {
  id: string
  candidateId?: string
  upstreamUrl: string
  mimeType: string
  headers: Record<string, string>
  expiresAtMs: number
}

const PREPARED_STREAM_TTL_MS = 2 * 60 * 60 * 1000
const BLOCKED_UPSTREAM_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

@Injectable()
export class MediaService {
  private readonly preparedStreams = new Map<string, PreparedStreamRecord>()

  listSourceSites() {
    const rows = getDb()
      .prepare(
        `SELECT id, title, url, provider, kind, tags_json, last_sniffed_at, last_candidates_count, created_at, updated_at
         FROM media_source_sites
         ORDER BY updated_at DESC, id DESC`,
      )
      .all() as MediaSourceSiteRow[]
    return { sites: rows.map(rowToSourceSite) }
  }

  addSourceSite(input: MediaSourceSiteInput) {
    const site = normalizeSourceSiteInput(input)
    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM media_source_sites WHERE url = ?')
      .get(site.url) as { id: number } | undefined
    if (existing) {
      throw new BadRequestException('source site url already exists')
    }

    const result = db.prepare(
      `INSERT INTO media_source_sites (title, url, provider, kind, tags_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(site.title, site.url, site.provider, site.kind, JSON.stringify(site.tags))
    return { site: this.getSourceSite(Number(result.lastInsertRowid)) }
  }

  updateSourceSite(siteId: number, input: MediaSourceSiteUpdateInput) {
    const existing = this.getSourceSite(siteId)
    const merged = normalizeSourceSiteInput({
      title: input.title ?? existing.title,
      url: input.url ?? existing.url,
      provider: input.provider ?? existing.provider,
      kind: input.kind ?? existing.kind,
      tags: input.tags ?? existing.tags,
    })
    getDb().prepare(
      `UPDATE media_source_sites
       SET title = ?, url = ?, provider = ?, kind = ?, tags_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(merged.title, merged.url, merged.provider, merged.kind, JSON.stringify(merged.tags), siteId)
    return { site: this.getSourceSite(siteId) }
  }

  removeSourceSite(siteId: number) {
    getDb().prepare('DELETE FROM media_source_sites WHERE id = ?').run(siteId)
    return { status: 'success' }
  }

  getSourceSite(siteId: number): MediaSourceSite {
    const row = getDb()
      .prepare(
        `SELECT id, title, url, provider, kind, tags_json, last_sniffed_at, last_candidates_count, created_at, updated_at
         FROM media_source_sites
         WHERE id = ?`,
      )
      .get(siteId) as MediaSourceSiteRow | undefined
    if (!row) throw new NotFoundException('Media source site not found')
    return rowToSourceSite(row)
  }

  markSourceSiteSniffed(siteId: number, candidatesCount: number) {
    getDb().prepare(
      `UPDATE media_source_sites
       SET last_sniffed_at = datetime('now'), last_candidates_count = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(Math.max(0, Math.floor(candidatesCount)), siteId)
    return { site: this.getSourceSite(siteId) }
  }

  listPlaylist() {
    const rows = getDb()
      .prepare(
        `SELECT item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url, stream_url, mime_type
         FROM media_playlist_items
         ORDER BY sort_order ASC, id ASC`,
      )
      .all() as MediaPlaylistRow[]
    return { items: rows.map(rowToItem) }
  }

  addPlaylistItem(input: MediaPlaylistItem) {
    const item = normalizeItem(input)
    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM media_playlist_items WHERE item_id = ?')
      .get(item.id) as { id: number } | undefined

    if (existing) {
      db.prepare(
        `UPDATE media_playlist_items
         SET source = ?, title = ?, artist = ?, cover = ?, duration_sec = ?, upstream_id = ?,
             upstream_url = ?, stream_url = ?, mime_type = ?, updated_at = datetime('now')
         WHERE item_id = ?`,
      ).run(
        item.source,
        item.title,
        item.artist ?? null,
        item.cover ?? null,
        item.duration_sec ?? null,
        item.upstream_id ?? null,
        item.upstream_url ?? null,
        item.stream_url ?? null,
        item.mime_type ?? null,
        item.id,
      )
      return { item }
    }

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM media_playlist_items')
      .get() as { max_order: number }
    db.prepare(
      `INSERT INTO media_playlist_items
       (item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url, stream_url, mime_type, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      item.id,
      item.source,
      item.title,
      item.artist ?? null,
      item.cover ?? null,
      item.duration_sec ?? null,
      item.upstream_id ?? null,
      item.upstream_url ?? null,
      item.stream_url ?? null,
      item.mime_type ?? null,
      maxOrder.max_order + 1,
    )
    return { item }
  }

  removePlaylistItem(itemId: string) {
    getDb().prepare('DELETE FROM media_playlist_items WHERE item_id = ?').run(itemId)
    return { status: 'success' }
  }

  reorderPlaylist(input: MediaPlaylistReorderInput) {
    if (!Array.isArray(input.itemIds)) {
      throw new BadRequestException('itemIds is required')
    }
    const itemIds = input.itemIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('itemIds must be unique')
    }

    const db = getDb()
    const update = db.prepare(
      `UPDATE media_playlist_items
       SET sort_order = ?, updated_at = datetime('now')
       WHERE item_id = ?`,
    )
    const transaction = db.transaction((ids: string[]) => {
      ids.forEach((itemId, index) => update.run(index, itemId))
    })
    transaction(itemIds)
    return this.listPlaylist()
  }

  clearPlaylist() {
    getDb().prepare('DELETE FROM media_playlist_items').run()
    return { status: 'success' }
  }

  prepareStream(input: PrepareMediaStreamInput, publicBaseUrl: string): { stream: PreparedMediaStream } {
    const upstreamUrl = normalizeHttpUrl(input.url)
    const token = randomUUID()
    const mimeType = optionalString(input.mime_type) || inferMimeType(upstreamUrl)
    const expiresAtMs = Date.now() + PREPARED_STREAM_TTL_MS
    const record: PreparedStreamRecord = {
      id: token,
      candidateId: optionalString(input.candidate_id),
      upstreamUrl,
      mimeType,
      headers: normalizeUpstreamHeaders(input.headers),
      expiresAtMs,
    }
    this.cleanupPreparedStreams()
    this.preparedStreams.set(token, record)

    return {
      stream: {
        id: token,
        ...(record.candidateId ? { candidate_id: record.candidateId } : {}),
        url: `${publicBaseUrl}/api/media/proxy/stream/${encodeURIComponent(token)}`,
        upstream_url: upstreamUrl,
        mime_type: mimeType,
        proxied: true,
        expires_at: new Date(expiresAtMs).toISOString(),
        seekable: true,
      },
    }
  }

  getPreparedStream(token: string): PreparedStreamRecord {
    this.cleanupPreparedStreams()
    const record = this.preparedStreams.get(token)
    if (!record) throw new NotFoundException('Prepared media stream not found')
    return record
  }

  private cleanupPreparedStreams() {
    const now = Date.now()
    for (const [token, record] of this.preparedStreams.entries()) {
      if (record.expiresAtMs <= now) this.preparedStreams.delete(token)
    }
  }
}

function normalizeItem(input: MediaPlaylistItem): MediaPlaylistItem {
  const id = String(input.id || '').trim()
  const title = String(input.title || '').trim()
  const source = String(input.source || '').trim()
  if (!id) throw new BadRequestException('item.id is required')
  if (!title) throw new BadRequestException('item.title is required')
  if (!['bilibili', 'url', 'local', 'storage'].includes(source)) {
    throw new BadRequestException('item.source is invalid')
  }
  return {
    id,
    source: source as MediaPlaylistItem['source'],
    title,
    artist: optionalString(input.artist),
    cover: optionalString(input.cover),
    duration_sec: optionalNumber(input.duration_sec),
    upstream_id: optionalString(input.upstream_id),
    upstream_url: optionalString(input.upstream_url),
    stream_url: optionalString(input.stream_url),
    mime_type: optionalString(input.mime_type),
    stream_kind: optionalStreamKind(input.stream_kind),
  }
}

function rowToItem(row: MediaPlaylistRow): MediaPlaylistItem {
  return {
    id: row.item_id,
    source: row.source as MediaPlaylistItem['source'],
    title: row.title,
    ...(row.artist ? { artist: row.artist } : {}),
    ...(row.cover ? { cover: row.cover } : {}),
    ...(row.duration_sec != null ? { duration_sec: row.duration_sec } : {}),
    ...(row.upstream_id ? { upstream_id: row.upstream_id } : {}),
    ...(row.upstream_url ? { upstream_url: row.upstream_url } : {}),
    ...(row.stream_url ? { stream_url: row.stream_url } : {}),
    ...(row.mime_type ? { mime_type: row.mime_type } : {}),
  }
}

function rowToSourceSite(row: MediaSourceSiteRow): MediaSourceSite {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    provider: row.provider,
    kind: isSourceSiteKind(row.kind) ? row.kind : 'page',
    tags: parseTagsJson(row.tags_json),
    ...(row.last_sniffed_at ? { last_sniffed_at: row.last_sniffed_at } : {}),
    ...(row.last_candidates_count != null ? { last_candidates_count: row.last_candidates_count } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function normalizeSourceSiteInput(input: MediaSourceSiteInput): Required<Pick<MediaSourceSite, 'title' | 'url' | 'provider' | 'kind' | 'tags'>> {
  const url = normalizeHttpUrl(input.url)
  const title = optionalString(input.title) || titleFromUrl(url)
  const provider = optionalString(input.provider) || providerFromUrl(url)
  const kind = isSourceSiteKind(input.kind) ? input.kind : 'page'
  return {
    title,
    url,
    provider,
    kind,
    tags: normalizeTags(input.tags),
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

function optionalStreamKind(value: unknown): MediaStreamKind | undefined {
  if (value === 'audio' || value === 'video' || value === 'hls' || value === 'dash') return value
  return undefined
}

function isSourceSiteKind(value: unknown): value is MediaSourceSiteKind {
  return value === 'page' || value === 'channel' || value === 'playlist' || value === 'search' || value === 'custom'
}

function normalizeHttpUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) throw new BadRequestException('url is required')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new BadRequestException('url must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('url must be an http(s) URL')
  }
  return parsed.toString()
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url)
  const lastPart = parsed.pathname.split('/').filter(Boolean).at(-1)
  return decodeURIComponent(lastPart || parsed.hostname)
}

function providerFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '')
  if (host.includes('bilibili.com')) return 'bilibili'
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube'
  if (host.includes('vimeo.com')) return 'vimeo'
  return host || 'generic'
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12)
  return Array.from(new Set(tags))
}

function parseTagsJson(value: string): string[] {
  try {
    return normalizeTags(JSON.parse(value))
  } catch {
    return []
  }
}

function normalizeUpstreamHeaders(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input || typeof input !== 'object') return {}
  const headers: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim()
    const lowerName = name.toLowerCase()
    if (!name || BLOCKED_UPSTREAM_HEADERS.has(lowerName)) continue
    if (typeof rawValue !== 'string') continue
    const value = rawValue.trim()
    if (!value) continue
    headers[name] = value
  }
  return headers
}

function inferMimeType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.mp3')) return 'audio/mpeg'
  if (pathname.endsWith('.m4a')) return 'audio/mp4'
  if (pathname.endsWith('.aac')) return 'audio/aac'
  if (pathname.endsWith('.flac')) return 'audio/flac'
  if (pathname.endsWith('.wav')) return 'audio/wav'
  if (pathname.endsWith('.ogg')) return 'audio/ogg'
  if (pathname.endsWith('.webm')) return 'video/webm'
  if (pathname.endsWith('.mkv')) return 'video/x-matroska'
  if (pathname.endsWith('.mov')) return 'video/quicktime'
  if (pathname.endsWith('.avi')) return 'video/x-msvideo'
  if (pathname.endsWith('.flv')) return 'video/x-flv'
  if (pathname.endsWith('.ts')) return 'video/mp2t'
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (pathname.endsWith('.mpd')) return 'application/dash+xml'
  return 'video/mp4'
}
