import { BadRequestException } from '@nestjs/common'
import type {
  MediaBookmark,
  MediaBookmarkInput,
  MediaBookmarkRow,
  MediaPlaylistItem,
  MediaPlaylistRow,
  MediaSourceSite,
  MediaSourceSiteInput,
  MediaSourceSiteKind,
  MediaSourceSiteRow,
  MediaStreamKind,
} from './media.types'

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

export function normalizeItem(input: MediaPlaylistItem): MediaPlaylistItem {
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

export function rowToItem(row: MediaPlaylistRow): MediaPlaylistItem {
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

export function rowToBookmark(row: MediaBookmarkRow): MediaBookmark {
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

export function rowToSourceSite(row: MediaSourceSiteRow): MediaSourceSite {
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

export function normalizeBookmarkInput(input: MediaBookmarkInput): { item: MediaPlaylistItem; tags: string[]; favorite?: boolean } {
  return {
    item: normalizeItem(input),
    tags: normalizeTags(input.tags),
    favorite: optionalBoolean(input.favorite),
  }
}

export function normalizeSourceSiteInput(input: MediaSourceSiteInput): Required<Pick<MediaSourceSite, 'title' | 'url' | 'provider' | 'kind' | 'tags'>> {
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

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

export function optionalBoolean(value: unknown): boolean | undefined {
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

export function normalizeHttpUrl(value: unknown): string {
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

export function normalizeUpstreamHeaders(input: Record<string, unknown> | undefined): Record<string, string> {
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

export function inferMimeType(url: string): string {
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
