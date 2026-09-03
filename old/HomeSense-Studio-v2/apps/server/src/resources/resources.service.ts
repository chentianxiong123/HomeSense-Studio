import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { cliBridge } from '../cli/cli-bridge'
import { getDb } from '../db/database'
import type {
  ResourceMediaCandidate,
  ResourceNormalizeInput,
  ResourceSearchHit,
  ResourceSearchInput,
  ResourceSearchResult,
  ResourceSourceDefinition,
  ResourceSourceInput,
  ResourceSourceKind,
  ResourceSourceRecord,
} from './resources.types'

interface ResourceSourceRow {
  id: number
  name: string
  kind: string
  enabled: number
  definition_json: string
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

@Injectable()
export class ResourcesService {
  listSources(): { sources: ResourceSourceRecord[] } {
    const rows = getDb()
      .prepare(
        `SELECT id, name, kind, enabled, definition_json, last_checked_at, last_error, created_at, updated_at
         FROM resource_sources
         ORDER BY enabled DESC, updated_at DESC, id DESC`,
      )
      .all() as ResourceSourceRow[]
    return { sources: rows.map(rowToSource) }
  }

  getSource(sourceId: number): ResourceSourceRecord {
    const row = getDb()
      .prepare(
        `SELECT id, name, kind, enabled, definition_json, last_checked_at, last_error, created_at, updated_at
         FROM resource_sources
         WHERE id = ?`,
      )
      .get(sourceId) as ResourceSourceRow | undefined
    if (!row) throw new NotFoundException('Resource source not found')
    return rowToSource(row)
  }

  createSource(input: ResourceSourceInput): { source: ResourceSourceRecord } {
    const normalized = normalizeSourceInput(input)
    const result = getDb()
      .prepare(
        `INSERT INTO resource_sources (name, kind, enabled, definition_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        normalized.name,
        normalized.kind,
        normalized.enabled ? 1 : 0,
        JSON.stringify(normalized.definition),
      )
    return { source: this.getSource(Number(result.lastInsertRowid)) }
  }

  updateSource(sourceId: number, input: ResourceSourceInput): { source: ResourceSourceRecord } {
    const existing = this.getSource(sourceId)
    const normalized = normalizeSourceInput({
      name: input.name ?? existing.name,
      kind: input.kind ?? existing.kind,
      enabled: input.enabled ?? existing.enabled,
      definition: input.definition ?? existing.definition,
    })
    getDb()
      .prepare(
        `UPDATE resource_sources
         SET name = ?, kind = ?, enabled = ?, definition_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        normalized.name,
        normalized.kind,
        normalized.enabled ? 1 : 0,
        JSON.stringify(normalized.definition),
        sourceId,
      )
    return { source: this.getSource(sourceId) }
  }

  removeSource(sourceId: number): { status: string } {
    getDb().prepare('DELETE FROM resource_sources WHERE id = ?').run(sourceId)
    return { status: 'success' }
  }

  async search(input: ResourceSearchInput): Promise<{ result: ResourceSearchResult }> {
    const query = String(input.query || '').trim()
    if (!query) throw new BadRequestException('query is required')
    const limit = normalizeLimit(input.limit)
    const sourceIds = normalizeSourceIds(input.source_ids)
    const sources = this.readSearchSources(sourceIds)
    if (sources.length === 0) throw new BadRequestException('No enabled resource sources available')

    const result = await cliBridge.run('media-cli', 'resource_search', {
      query,
      limit,
      normalize: optionalBoolean(input.normalize) ?? true,
      normalize_limit: normalizeLimit(input.normalize_limit ?? 10),
      sources: sources.map((source) => ({
        id: String(source.id),
        name: source.name,
        kind: source.kind,
        definition: source.definition,
      })),
    })
    if (result.status !== 'success') {
      throw new BadRequestException(result.message || result.error || 'Resource search failed')
    }

    const data = normalizeSearchResult(result.data, query)
    this.recordSourceResults(data.sources)
    return { result: data }
  }

  async normalize(input: ResourceNormalizeInput): Promise<{ hit: ResourceSearchHit }> {
    const result = await cliBridge.run('media-cli', 'resource_normalize', {
      query: optionalString(input.query) || '',
      ...(input.hit ? { hit: input.hit } : {}),
      ...(optionalString(input.url) ? { url: optionalString(input.url) } : {}),
      ...(optionalString(input.title) ? { title: optionalString(input.title) } : {}),
      ...(optionalString(input.source_id) ? { source_id: optionalString(input.source_id) } : {}),
      ...(optionalString(input.source_name) ? { source_name: optionalString(input.source_name) } : {}),
      ...(optionalString(input.snippet) ? { snippet: optionalString(input.snippet) } : {}),
      ...(optionalString(input.cover) ? { cover: optionalString(input.cover) } : {}),
    })
    if (result.status !== 'success') {
      throw new BadRequestException(result.message || result.error || 'Resource normalize failed')
    }
    const data = result.data as { hit?: unknown } | undefined
    const hit = normalizeHit(data?.hit)
    if (!hit) throw new BadRequestException('Resource normalize returned invalid hit')
    return { hit }
  }

  async testSource(sourceId: number, input: ResourceSearchInput): Promise<{ result: ResourceSearchResult; source: ResourceSourceRecord }> {
    const source = this.getSource(sourceId)
    const result = await this.search({
      query: input.query || 'test',
      limit: input.limit || 8,
      normalize: input.normalize ?? true,
      normalize_limit: input.normalize_limit ?? 4,
      source_ids: [sourceId],
    })
    return { ...result, source: this.getSource(sourceId) }
  }

  private readSearchSources(sourceIds: number[]): ResourceSourceRecord[] {
    const rows = getDb()
      .prepare(
        `SELECT id, name, kind, enabled, definition_json, last_checked_at, last_error, created_at, updated_at
         FROM resource_sources
         WHERE enabled = 1
         ORDER BY updated_at DESC, id DESC`,
      )
      .all() as ResourceSourceRow[]
    const sources = rows.map(rowToSource)
    if (sourceIds.length === 0) return sources
    const allowed = new Set(sourceIds)
    return sources.filter((source) => allowed.has(source.id))
  }

  private recordSourceResults(results: ResourceSearchResult['sources']) {
    const db = getDb()
    const update = db.prepare(
      `UPDATE resource_sources
       SET last_checked_at = datetime('now'), last_error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    const tx = db.transaction((items: ResourceSearchResult['sources']) => {
      for (const item of items) {
        const sourceId = Number(item.source_id)
        if (!Number.isInteger(sourceId)) continue
        update.run(item.status === 'error' ? item.message || 'Resource search failed' : null, sourceId)
      }
    })
    tx(results)
  }
}

function normalizeSourceInput(input: ResourceSourceInput): Required<Pick<ResourceSourceRecord, 'name' | 'kind' | 'enabled' | 'definition'>> {
  const name = String(input.name || '').trim()
  if (!name) throw new BadRequestException('name is required')
  const kind = normalizeKind(input.kind)
  const definition = normalizeDefinition(input.definition)
  return {
    name,
    kind,
    enabled: optionalBoolean(input.enabled) ?? true,
    definition,
  }
}

function normalizeKind(value: unknown): ResourceSourceKind {
  if (value === 'json') return 'json'
  if (value === 'html' || value == null || value === '') return 'html'
  throw new BadRequestException('kind must be html or json')
}

function normalizeDefinition(value: unknown): ResourceSourceDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('definition is required')
  }
  const input = value as Record<string, unknown>
  const template = String(input.search_url_template || '').trim()
  if (!template) throw new BadRequestException('definition.search_url_template is required')
  if (!template.includes('{{query}}') && !template.includes('{query}')) {
    throw new BadRequestException('definition.search_url_template must include {{query}}')
  }
  const definition: ResourceSourceDefinition = { search_url_template: template }
  for (const key of [
    'result_url_include',
    'result_url_exclude',
    'title_include',
    'items_path',
    'title_path',
    'url_path',
    'snippet_path',
    'cover_path',
    'base_url',
  ] as const) {
    const text = optionalString(input[key])
    if (text) definition[key] = text
  }
  const timeout = Number(input.timeout_sec)
  if (Number.isFinite(timeout) && timeout > 0) definition.timeout_sec = Math.min(30, Math.max(3, Math.round(timeout)))
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(input.headers)) {
      const normalizedName = name.trim()
      const normalizedValue = String(value || '').trim()
      if (!normalizedName || !normalizedValue) continue
      headers[normalizedName] = normalizedValue
    }
    if (Object.keys(headers).length > 0) definition.headers = headers
  }
  return definition
}

function normalizeSearchResult(value: unknown, query: string): ResourceSearchResult {
  if (!value || typeof value !== 'object') {
    return { query, count: 0, hits: [], sources: [] }
  }
  const input = value as Partial<ResourceSearchResult>
  const hits = Array.isArray(input.hits) ? input.hits.map(normalizeHit).filter(Boolean) as ResourceSearchHit[] : []
  const sources = Array.isArray(input.sources)
    ? input.sources.map((source) => ({
      source_id: String(source?.source_id || ''),
      status: source?.status === 'error' ? 'error' as const : 'success' as const,
      ...(typeof source?.count === 'number' ? { count: source.count } : {}),
      ...(source?.message ? { message: String(source.message) } : {}),
    })).filter((source) => source.source_id)
    : []
  return {
    query: String(input.query || query),
    count: hits.length,
    hits,
    sources,
  }
}

function normalizeHit(value: unknown): ResourceSearchHit | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<ResourceSearchHit>
  const id = optionalString(input.id)
  const title = optionalString(input.title)
  const url = optionalString(input.url)
  if (!id || !title || !url) return null
  return {
    id,
    title,
    url,
    source_id: optionalString(input.source_id) || 'unknown',
    source_name: optionalString(input.source_name) || 'Source',
    kind: isHitKind(input.kind) ? input.kind : 'page',
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0,
    ...(optionalString(input.snippet) ? { snippet: optionalString(input.snippet) } : {}),
    ...(optionalString(input.cover) ? { cover: optionalString(input.cover) } : {}),
    ...(optionalString(input.site_name) ? { site_name: optionalString(input.site_name) } : {}),
    ...(Array.isArray(input.media_candidates) ? { media_candidates: input.media_candidates.map(normalizeMediaCandidate).filter(Boolean) as ResourceMediaCandidate[] } : {}),
    ...(Array.isArray(input.signals) ? { signals: Array.from(new Set(input.signals.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 12) } : {}),
    ...(input.normalize_status === 'success' || input.normalize_status === 'error' ? { normalize_status: input.normalize_status } : {}),
    ...(optionalString(input.normalize_error) ? { normalize_error: optionalString(input.normalize_error) } : {}),
  }
}

function normalizeMediaCandidate(value: unknown): ResourceMediaCandidate | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<ResourceMediaCandidate>
  const url = optionalString(input.url)
  if (!url) return null
  const kind = isMediaCandidateKind(input.kind) ? input.kind : mediaKindFromUrl(url)
  return {
    url,
    kind,
    ...(optionalString(input.mime_type) ? { mime_type: optionalString(input.mime_type) } : {}),
    ...(optionalString(input.source) ? { source: optionalString(input.source) } : {}),
  }
}

function rowToSource(row: ResourceSourceRow): ResourceSourceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: normalizeKind(row.kind),
    enabled: row.enabled === 1,
    definition: parseDefinition(row.definition_json),
    ...(row.last_checked_at ? { last_checked_at: row.last_checked_at } : {}),
    ...(row.last_error ? { last_error: row.last_error } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function parseDefinition(value: string): ResourceSourceDefinition {
  try {
    return normalizeDefinition(JSON.parse(value))
  } catch {
    return { search_url_template: 'https://example.com/search?q={{query}}' }
  }
}

function normalizeSourceIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => Number(item)).filter((num) => Number.isInteger(num) && num > 0)))
}

function normalizeLimit(value: unknown): number {
  const limit = Number(value)
  return Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.round(limit))) : 24
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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

function isHitKind(value: unknown): value is ResourceSearchHit['kind'] {
  return value === 'page' || value === 'video' || value === 'audio' || value === 'image' || value === 'book' || value === 'file'
}

function isMediaCandidateKind(value: unknown): value is ResourceMediaCandidate['kind'] {
  return value === 'video' || value === 'audio' || value === 'hls' || value === 'dash' || value === 'embed'
}

function mediaKindFromUrl(url: string): ResourceMediaCandidate['kind'] {
  const lower = url.split('?', 1)[0].toLowerCase()
  if (lower.endsWith('.m3u8')) return 'hls'
  if (lower.endsWith('.mpd')) return 'dash'
  if (/\.(mp3|m4a|aac|flac|wav|ogg)$/.test(lower)) return 'audio'
  if (/\.(mp4|webm|mkv|mov|avi|flv|ts)$/.test(lower)) return 'video'
  return 'embed'
}
