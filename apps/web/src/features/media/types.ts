export type MediaSourceKind = 'bilibili' | 'url' | 'local' | 'storage'
export type MediaCandidateKind = 'page' | 'playlist' | 'stream'
export type MediaStreamKind = 'audio' | 'video' | 'hls' | 'dash'
export type MediaSourceSiteKind = 'page' | 'channel' | 'playlist' | 'search' | 'custom'
export type MediaOutputKind = 'browser' | 'dlna' | 'xiaoai' | 'adb'
export type MediaSessionState = 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error'
export type MediaPlayMode = 'order' | 'loop' | 'single' | 'random'

export interface MediaItem {
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

export interface MediaOutput {
  id: string
  kind: MediaOutputKind
  name: string
  device_id?: number
  endpoint?: string
  online?: boolean
  meta?: Record<string, unknown>
}

export interface MediaSession {
  id: string
  item: MediaItem | null
  output: MediaOutput
  state: MediaSessionState
  position_sec: number
  duration_sec: number
  volume: number
  error?: string
}
