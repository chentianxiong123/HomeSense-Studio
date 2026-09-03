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

export interface MediaPlaylistRow {
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

export interface MediaBookmarkRow {
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

export interface MediaSourceSiteRow {
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

export interface PreparedStreamRecord {
  id: string
  candidateId?: string
  upstreamUrl: string
  mimeType: string
  headers: Record<string, string>
  expiresAtMs: number
}
