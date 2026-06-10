async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

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
  name: string
  kind: ResourceSourceKind
  enabled?: boolean
  definition: ResourceSourceDefinition
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

export const resourcesApi = {
  listSources: () =>
    request<{ sources: ResourceSourceRecord[] }>('/api/resources/sources'),

  createSource: (input: ResourceSourceInput) =>
    request<{ source: ResourceSourceRecord }>('/api/resources/sources', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateSource: (sourceId: number, input: Partial<ResourceSourceInput>) =>
    request<{ source: ResourceSourceRecord }>(`/api/resources/sources/${encodeURIComponent(String(sourceId))}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeSource: (sourceId: number) =>
    request<{ status: string }>(`/api/resources/sources/${encodeURIComponent(String(sourceId))}`, {
      method: 'DELETE',
    }),

  testSource: (sourceId: number, input: { query?: string; limit?: number }) =>
    request<{ result: ResourceSearchResult; source: ResourceSourceRecord }>(`/api/resources/sources/${encodeURIComponent(String(sourceId))}/test`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  search: (input: { query: string; source_ids?: number[]; limit?: number; normalize?: boolean; normalize_limit?: number }) =>
    request<{ result: ResourceSearchResult }>('/api/resources/search', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  normalize: (input: { query?: string; url?: string; title?: string; hit?: ResourceSearchHit }) =>
    request<{ hit: ResourceSearchHit }>('/api/resources/normalize', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
