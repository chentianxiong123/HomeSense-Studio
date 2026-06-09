import { BadRequestException, Injectable } from '@nestjs/common'
import { getDb } from '../db/database'

export interface MediaPlaylistItem {
  id: string
  source: 'bilibili' | 'url' | 'local'
  title: string
  artist?: string
  cover?: string
  duration_sec?: number
  upstream_id?: string
  upstream_url?: string
  stream_url?: string
  mime_type?: string
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

export interface MediaPlaylistReorderInput {
  itemIds: string[]
}

@Injectable()
export class MediaService {
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
}

function normalizeItem(input: MediaPlaylistItem): MediaPlaylistItem {
  const id = String(input.id || '').trim()
  const title = String(input.title || '').trim()
  const source = String(input.source || '').trim()
  if (!id) throw new BadRequestException('item.id is required')
  if (!title) throw new BadRequestException('item.title is required')
  if (!['bilibili', 'url', 'local'].includes(source)) {
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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}
