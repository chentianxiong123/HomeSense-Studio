import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getDb } from '../db/database'
import {
  inferMimeType,
  normalizeBookmarkInput,
  normalizeHttpUrl,
  normalizeItem,
  normalizeSourceSiteInput,
  normalizeUpstreamHeaders,
  optionalBoolean,
  optionalString,
  rowToBookmark,
  rowToItem,
  rowToSourceSite,
} from './media.helpers'
import type {
  MediaBookmark,
  MediaBookmarkInput,
  MediaBookmarkQueryInput,
  MediaBookmarkRow,
  MediaBookmarkUpdateInput,
  MediaPlaylistItem,
  MediaPlaylistReorderInput,
  MediaPlaylistRow,
  MediaSourceSite,
  MediaSourceSiteInput,
  MediaSourceSiteRow,
  MediaSourceSiteUpdateInput,
  PrepareMediaStreamInput,
  PreparedMediaStream,
  PreparedStreamRecord,
} from './media.types'
export type {
  MediaBookmark,
  MediaBookmarkInput,
  MediaBookmarkQueryInput,
  MediaBookmarkUpdateInput,
  MediaCandidate,
  MediaCandidateKind,
  MediaPlaylistItem,
  MediaPlaylistReorderInput,
  MediaSourceKind,
  MediaSourceSite,
  MediaSourceSiteInput,
  MediaSourceSiteKind,
  MediaSourceSiteUpdateInput,
  MediaStreamKind,
  PrepareMediaStreamInput,
  PreparedMediaStream,
} from './media.types'

const PREPARED_STREAM_TTL_MS = 2 * 60 * 60 * 1000
const MEDIA_CACHE_ROOT = path.resolve(process.cwd(), '../../data/media/cache')
const MEDIA_CACHE_MAX_ITEMS = normalizeCacheMaxItems(process.env.MEDIA_CACHE_MAX_ITEMS)

type BilibiliAudioCacheEntry = {
  key: string
  source: 'bilibili'
  bvid: string
  file_path: string
  mime_type: string
  title?: string
  play_count: number
  last_played_at: string
  created_at: string
  updated_at: string
  size: number
}

@Injectable()
export class MediaService {
  private readonly preparedStreams = new Map<string, PreparedStreamRecord>()
  private readonly activeCacheDownloads = new Set<string>()

  cacheStatus() {
    const entries = listAudioCacheFiles()
    return {
      root: MEDIA_CACHE_ROOT,
      max_items: MEDIA_CACHE_MAX_ITEMS,
      file_count: entries.length,
      total_bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
      updated_at: new Date().toISOString(),
    }
  }

  clearCache() {
    const entries = listCacheFiles()
    let removedFiles = 0
    let removedBytes = 0
    for (const entry of entries) {
      try {
        fs.rmSync(entry.path, { force: true })
        removedFiles += 1
        removedBytes += entry.size
      } catch {
        // Best-effort cleanup; status below reflects what was actually removed.
      }
    }
    pruneEmptyCacheDirs(MEDIA_CACHE_ROOT)
    return {
      status: 'success',
      removed_files: removedFiles,
      removed_bytes: removedBytes,
      cache: this.cacheStatus(),
    }
  }

  getBilibiliAudioCache(bvid: string): { path: string; mimeType: string; size: number } | null {
    const cleanBvid = normalizeBvid(bvid)
    if (!cleanBvid) return null
    const filePath = bilibiliAudioCachePath(cleanBvid)
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size <= 0) return null
    const meta = readBilibiliCacheEntry(cleanBvid)
    return {
      path: filePath,
      mimeType: meta?.mime_type || 'audio/mp4',
      size: stat.size,
    }
  }

  recordBilibiliAudioPlayback(bvid: string, title?: string) {
    const cleanBvid = normalizeBvid(bvid)
    if (!cleanBvid) return
    const now = new Date().toISOString()
    const existing = readBilibiliCacheEntry(cleanBvid)
    const filePath = bilibiliAudioCachePath(cleanBvid)
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : existing?.size ?? 0
    writeBilibiliCacheEntry({
      key: `bilibili:${cleanBvid}`,
      source: 'bilibili',
      bvid: cleanBvid,
      file_path: filePath,
      mime_type: existing?.mime_type || 'audio/mp4',
      title: title || existing?.title,
      play_count: (existing?.play_count ?? 0) + 1,
      last_played_at: now,
      created_at: existing?.created_at || now,
      updated_at: now,
      size,
    })
  }

  cacheBilibiliAudio(input: { bvid: string; upstreamUrl: string; mimeType?: string; title?: string; headers?: Record<string, string> }) {
    const bvid = normalizeBvid(input.bvid)
    const upstreamUrl = optionalString(input.upstreamUrl)
    if (!bvid || !upstreamUrl) return
    const filePath = bilibiliAudioCachePath(bvid)
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return
    if (this.activeCacheDownloads.has(bvid)) return

    this.activeCacheDownloads.add(bvid)
    void this.downloadBilibiliAudioCache({ ...input, bvid, upstreamUrl })
      .catch(() => {})
      .finally(() => {
        this.activeCacheDownloads.delete(bvid)
      })
  }

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

  private async downloadBilibiliAudioCache(input: { bvid: string; upstreamUrl: string; mimeType?: string; title?: string; headers?: Record<string, string> }) {
    const filePath = bilibiliAudioCachePath(input.bvid)
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const response = await fetch(input.upstreamUrl, { headers: input.headers })
    if (!response.ok || !response.body) throw new Error(`Bilibili audio cache download failed: ${response.status}`)
    await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(tempPath))
    const stat = fs.statSync(tempPath)
    if (stat.size <= 0) {
      fs.rmSync(tempPath, { force: true })
      throw new Error('Bilibili audio cache download is empty')
    }
    fs.renameSync(tempPath, filePath)
    const now = new Date().toISOString()
    const existing = readBilibiliCacheEntry(input.bvid)
    writeBilibiliCacheEntry({
      key: `bilibili:${input.bvid}`,
      source: 'bilibili',
      bvid: input.bvid,
      file_path: filePath,
      mime_type: input.mimeType || existing?.mime_type || response.headers.get('content-type') || 'audio/mp4',
      title: input.title || existing?.title,
      play_count: existing?.play_count ?? 0,
      last_played_at: existing?.last_played_at || now,
      created_at: existing?.created_at || now,
      updated_at: now,
      size: stat.size,
    })
    enforceCacheLimit()
  }
}

function normalizeCacheMaxItems(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 500
  return Math.min(5000, Math.max(1, Math.floor(parsed)))
}

function listCacheFiles(): Array<{ path: string; size: number; mtimeMs: number }> {
  fs.mkdirSync(MEDIA_CACHE_ROOT, { recursive: true })
  const root = fs.realpathSync(MEDIA_CACHE_ROOT)
  const files: Array<{ path: string; size: number; mtimeMs: number }> = []
  walkCacheDir(root, files)
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function listAudioCacheFiles(): Array<{ path: string; size: number; mtimeMs: number }> {
  return listCacheFiles().filter((entry) => isAudioCacheFile(entry.path))
}

function isAudioCacheFile(filePath: string): boolean {
  return ['.aac', '.flac', '.m4a', '.m4s', '.mp3', '.ogg', '.opus', '.wav'].includes(path.extname(filePath).toLowerCase())
}

function walkCacheDir(dir: string, files: Array<{ path: string; size: number; mtimeMs: number }>): void {
  const root = fs.realpathSync(MEDIA_CACHE_ROOT)
  const current = fs.realpathSync(dir)
  if (!isWithinPath(current, root)) return
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      walkCacheDir(fullPath, files)
      continue
    }
    if (!entry.isFile()) continue
    const stat = fs.statSync(fullPath)
    files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs })
  }
}

function pruneEmptyCacheDirs(dir: string): void {
  if (!fs.existsSync(dir)) return
  const root = fs.realpathSync(MEDIA_CACHE_ROOT)
  const current = fs.realpathSync(dir)
  if (!isWithinPath(current, root)) return
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyCacheDirs(path.join(current, entry.name))
  }
  if (current === root) return
  try {
    fs.rmdirSync(current)
  } catch {
    // Directory is not empty or cannot be removed.
  }
}

function isWithinPath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function normalizeBvid(value: string): string {
  const bvid = String(value || '').trim()
  return /^BV[0-9A-Za-z]+$/.test(bvid) ? bvid : ''
}

function bilibiliAudioCacheDir(): string {
  return path.join(MEDIA_CACHE_ROOT, 'bilibili')
}

function bilibiliAudioCachePath(bvid: string): string {
  return path.join(bilibiliAudioCacheDir(), `${bvid}.m4s`)
}

function bilibiliAudioMetaPath(bvid: string): string {
  return path.join(bilibiliAudioCacheDir(), `${bvid}.json`)
}

function readBilibiliCacheEntry(bvid: string): BilibiliAudioCacheEntry | null {
  try {
    return JSON.parse(fs.readFileSync(bilibiliAudioMetaPath(bvid), 'utf8')) as BilibiliAudioCacheEntry
  } catch {
    return null
  }
}

function writeBilibiliCacheEntry(entry: BilibiliAudioCacheEntry): void {
  fs.mkdirSync(bilibiliAudioCacheDir(), { recursive: true })
  fs.writeFileSync(bilibiliAudioMetaPath(entry.bvid), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
}

function listBilibiliCacheEntries(): BilibiliAudioCacheEntry[] {
  const dir = bilibiliAudioCacheDir()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readBilibiliCacheEntry(name.replace(/\.json$/, '')))
    .filter((entry): entry is BilibiliAudioCacheEntry => Boolean(entry && fs.existsSync(entry.file_path)))
}

function enforceCacheLimit(): void {
  const entries = listBilibiliCacheEntries()
  if (entries.length <= MEDIA_CACHE_MAX_ITEMS) return
  const removable = entries
    .sort((a, b) => {
      if (a.play_count !== b.play_count) return a.play_count - b.play_count
      return Date.parse(a.last_played_at || a.updated_at) - Date.parse(b.last_played_at || b.updated_at)
    })
    .slice(0, entries.length - MEDIA_CACHE_MAX_ITEMS)

  for (const entry of removable) {
    fs.rmSync(entry.file_path, { force: true })
    fs.rmSync(bilibiliAudioMetaPath(entry.bvid), { force: true })
  }
}
