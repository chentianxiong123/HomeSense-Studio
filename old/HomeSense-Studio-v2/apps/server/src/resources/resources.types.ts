export type ResourceSourceKind = 'html' | 'json'
export type ResourceHitKind = 'page' | 'video' | 'audio' | 'image' | 'book' | 'file'
export type ResourceMediaCandidateKind = 'video' | 'audio' | 'hls' | 'dash' | 'embed'

export interface ResourceSourceDefinition {
  search_url_template: string
  result_url_include?: string
  result_url_exclude?: string
  title_include?: string
  items_path?: string
  title_path?: string
  url_path?: string
  snippet_path?: string
  cover_path?: string
  base_url?: string
  headers?: Record<string, string>
  timeout_sec?: number
}

export interface ResourceSourceRecord {
  id: number
  name: string
  kind: ResourceSourceKind
  enabled: boolean
  definition: ResourceSourceDefinition
  last_checked_at?: string
  last_error?: string
  created_at: string
  updated_at: string
}

export interface ResourceSourceInput {
  name?: string
  kind?: string
  enabled?: unknown
  definition?: unknown
}

export interface ResourceSearchInput {
  query?: string
  source_ids?: unknown
  limit?: unknown
  normalize?: unknown
  normalize_limit?: unknown
}

export interface ResourceNormalizeInput {
  query?: string
  url?: string
  title?: string
  source_id?: string
  source_name?: string
  snippet?: string
  cover?: string
  hit?: unknown
}

export interface ResourceMediaCandidate {
  url: string
  kind: ResourceMediaCandidateKind
  mime_type?: string
  source?: string
}

export interface ResourceSearchHit {
  id: string
  source_id: string
  source_name: string
  title: string
  url: string
  snippet?: string
  cover?: string
  kind: ResourceHitKind
  confidence: number
  site_name?: string
  media_candidates?: ResourceMediaCandidate[]
  signals?: string[]
  normalize_status?: 'success' | 'error'
  normalize_error?: string
}

export interface ResourceSearchResult {
  query: string
  count: number
  hits: ResourceSearchHit[]
  sources: Array<{
    source_id: string
    status: 'success' | 'error'
    count?: number
    message?: string
  }>
}
