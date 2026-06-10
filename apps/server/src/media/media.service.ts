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

export interface MediaBookmark extends MediaPlaylistItem {
  bookmark_id: number
  tags: string[]
  favorite: boolean
  play_count: number
  last_played_at?: string
  created_at: string
  updated_at: string
}

export interface MediaBookmarkInput extends MediaPlaylistItem {
  tags?: unknown
  favorite?: unknown
}

export interface MediaBookmarkUpdateInput {
  source?: MediaSourceKind
  title?: string
  artist?: string
  cover?: string
  duration_sec?: number
  upstream_id?: string
  upstream_url?: string
  stream_url?: string
  mime_type?: string
  stream_kind?: MediaStreamKind
  tags?: unknown
  favorite?: unknown
}

export interface MediaBookmarkQueryInput {
  q?: string
  source?: string
  favorite?: unknown
  tag?: string
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

interface MediaBookmarkRow {
  id: number
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
  stream_kind: string | null
  tags_json: string
  favorite: number
  play_count: number
  last_played_at: string | null
  created_at: string
  updated_at: string
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

  listBookmarks(input: MediaBookmarkQueryInput = {}) {
    const clauses: string[] = []
    const params: unknown[] = []
    const q = optionalString(input.q)
    const source = optionalString(input.source)
    const favorite = optionalBoolean(input.favorite)
    const tag = optionalString(input.tag)

    if (q) {
      clauses.push('(title LIKE ? OR artist LIKE ? OR upstream_url LIKE ? OR stream_url LIKE ?)')
      const pattern = `%${q}%`
      params.push(pattern, pattern, pattern, pattern)
    }
    if (source && ['bilibili', 'url', 'local', 'storage'].includes(source)) {
      clauses.push('source = ?')
      params.push(source)
    }
    if (favorite != null) {
      clauses.push('favorite = ?')
      params.push(favorite ? 1 : 0)
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = getDb()
      .prepare(
        `SELECT id, item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url,
                stream_url, mime_type, stream_kind, tags_json, favorite, play_count,
                last_played_at, created_at, updated_at
         FROM media_bookmarks
         ${where}
         ORDER BY favorite DESC, COALESCE(last_played_at, updated_at) DESC, id DESC`,
      )
      .all(...params) as MediaBookmarkRow[]
    const bookmarks = rows.map(rowToBookmark)
    return {
      bookmarks: tag
        ? bookmarks.filter((bookmark) => bookmark.tags.includes(tag))
        : bookmarks,
    }
  }

  addBookmark(input: MediaBookmarkInput) {
    const normalized = normalizeBookmarkInput(input)
    const db = getDb()
    const existing = db
      .prepare(
        `SELECT id, item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url,
                stream_url, mime_type, stream_kind, tags_json, favorite, play_count,
                last_played_at, created_at, updated_at
         FROM media_bookmarks
         WHERE item_id = ?`,
      )
      .get(normalized.item.id) as MediaBookmarkRow | undefined

    if (existing) {
      const favorite = normalized.favorite ?? Boolean(existing.favorite)
      db.prepare(
        `UPDATE media_bookmarks
         SET source = ?, title = ?, artist = ?, cover = ?, duration_sec = ?, upstream_id = ?,
             upstream_url = ?, stream_url = ?, mime_type = ?, stream_kind = ?, tags_json = ?,
             favorite = ?, updated_at = datetime('now')
         WHERE item_id = ?`,
      ).run(
        normalized.item.source,
        normalized.item.title,
        normalized.item.artist ?? null,
        normalized.item.cover ?? null,
        normalized.item.duration_sec ?? null,
        normalized.item.upstream_id ?? null,
        normalized.item.upstream_url ?? null,
        normalized.item.stream_url ?? null,
        normalized.item.mime_type ?? null,
        normalized.item.stream_kind ?? null,
        JSON.stringify(normalized.tags),
        favorite ? 1 : 0,
        normalized.item.id,
      )
      return { bookmark: this.getBookmark(normalized.item.id) }
    }

    db.prepare(
      `INSERT INTO media_bookmarks
       (item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url,
        stream_url, mime_type, stream_kind, tags_json, favorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      normalized.item.id,
      normalized.item.source,
      normalized.item.title,
      normalized.item.artist ?? null,
      normalized.item.cover ?? null,
      normalized.item.duration_sec ?? null,
      normalized.item.upstream_id ?? null,
      normalized.item.upstream_url ?? null,
      normalized.item.stream_url ?? null,
      normalized.item.mime_type ?? null,
      normalized.item.stream_kind ?? null,
      JSON.stringify(normalized.tags),
      normalized.favorite ? 1 : 0,
    )
    return { bookmark: this.getBookmark(normalized.item.id) }
  }

  updateBookmark(itemId: string, input: MediaBookmarkUpdateInput) {
    const existing = this.getBookmark(itemId)
    const normalized = normalizeBookmarkInput({
      id: existing.id,
      source: input.source ?? existing.source,
      title: input.title ?? existing.title,
      artist: input.artist ?? existing.artist,
      cover: input.cover ?? existing.cover,
      duration_sec: input.duration_sec ?? existing.duration_sec,
      upstream_id: input.upstream_id ?? existing.upstream_id,
      upstream_url: input.upstream_url ?? existing.upstream_url,
      stream_url: input.stream_url ?? existing.stream_url,
      mime_type: input.mime_type ?? existing.mime_type,
      stream_kind: input.stream_kind ?? existing.stream_kind,
      tags: input.tags ?? existing.tags,
      favorite: input.favorite ?? existing.favorite,
    })

    getDb().prepare(
      `UPDATE media_bookmarks
       SET source = ?, title = ?, artist = ?, cover = ?, duration_sec = ?, upstream_id = ?,
           upstream_url = ?, stream_url = ?, mime_type = ?, stream_kind = ?, tags_json = ?,
           favorite = ?, updated_at = datetime('now')
       WHERE item_id = ?`,
    ).run(
      normalized.item.source,
      normalized.item.title,
      normalized.item.artist ?? null,
      normalized.item.cover ?? null,
      normalized.item.duration_sec ?? null,
      normalized.item.upstream_id ?? null,
      normalized.item.upstream_url ?? null,
      normalized.item.stream_url ?? null,
      normalized.item.mime_type ?? null,
      normalized.item.stream_kind ?? null,
      JSON.stringify(normalized.tags),
      normalized.favorite ? 1 : 0,
      existing.id,
    )
    return { bookmark: this.getBookmark(existing.id) }
  }

  removeBookmark(itemId: string) {
    getDb().prepare('DELETE FROM media_bookmarks WHERE item_id = ?').run(itemId)
    return { status: 'success' }
  }

  markBookmarkPlayed(itemId: string) {
    const result = getDb().prepare(
      `UPDATE media_bookmarks
       SET play_count = play_count + 1, last_played_at = datetime('now'), updated_at = datetime('now')
       WHERE item_id = ?`,
    ).run(itemId)
    if (result.changes === 0) throw new NotFoundException('Media bookmark not found')
    return { bookmark: this.getBookmark(itemId) }
  }

  getBookmark(itemId: string): MediaBookmark {
    const row = getDb()
      .prepare(
        `SELECT id, item_id, source, title, artist, cover, duration_sec, upstream_id, upstream_url,
                stream_url, mime_type, stream_kind, tags_json, favorite, play_count,
                last_played_at, created_at, updated_at
         FROM media_bookmarks
         WHERE item_id = ?`,
      )
      .get(itemId) as MediaBookmarkRow | undefined
    if (!row) throw new NotFoundException('Media bookmark not found')
    return rowToBookmark(row)
  }

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

function rowToBookmark(row: MediaBookmarkRow): MediaBookmark {
  return {
    id: row.item_id,
    bookmark_id: row.id,
    source: row.source as MediaBookmark['source'],
    title: row.title,
    tags: parseTagsJson(row.tags_json),
    favorite: row.favorite === 1,
    play_count: row.play_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.artist ? { artist: row.artist } : {}),
    ...(row.cover ? { cover: row.cover } : {}),
    ...(row.duration_sec != null ? { duration_sec: row.duration_sec } : {}),
    ...(row.upstream_id ? { upstream_id: row.upstream_id } : {}),
    ...(row.upstream_url ? { upstream_url: row.upstream_url } : {}),
    ...(row.stream_url ? { stream_url: row.stream_url } : {}),
    ...(row.mime_type ? { mime_type: row.mime_type } : {}),
    ...(optionalStreamKind(row.stream_kind) ? { stream_kind: optionalStreamKind(row.stream_kind) } : {}),
    ...(row.last_played_at ? { last_played_at: row.last_played_at } : {}),
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

function normalizeBookmarkInput(input: MediaBookmarkInput): { item: MediaPlaylistItem; tags: string[]; favorite?: boolean } {
  return {
    item: normalizeItem(input),
    tags: normalizeTags(input.tags),
    favorite: optionalBoolean(input.favorite),
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

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
  }
  return undefined
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
