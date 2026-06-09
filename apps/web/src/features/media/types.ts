export type MediaSourceKind = 'bilibili' | 'url' | 'local'
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
