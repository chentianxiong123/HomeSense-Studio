import { cliApi } from './cli'
import type { MediaBookmark, MediaCandidate, MediaItem, MediaOutput, MediaSourceSite, MediaSourceSiteKind, PreparedMediaStream } from '@/features/media/types'

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

export interface MediaSearchResult {
  keyword: string
  page: number
  page_size: number
  total: number
  items: MediaItem[]
}

export interface BilibiliAudioResult {
  bvid: string
  cid: number
  stream_url: string
  quality: number
  size?: number
  mime_type?: string
  codecs?: string
  item: MediaItem
}

export interface XiaoAiSpeakerTarget {
  did: string
  model?: string
  name?: string
  home_id?: string | number
  home_name?: string
  room_name?: string
  connection_type?: string
  control_path?: string
}

export interface XiaoAiSpeakerListResult {
  speakers: XiaoAiSpeakerTarget[]
  count: number
  experimental_status_api?: string
}

export interface XiaoAiSpeakerStatusResult {
  state: string
  media_type?: string
  media_title?: string
  media_artist?: string
  media_album?: string
  media_image_url?: string
  media_duration?: number
  media_position?: number
  volume?: number
  repeat_mode?: string
}

export interface DlnaDiscoverResult {
  devices: Array<{
    id: string
    udn: string
    name: string
    location: string
    ip: string
    port: number
    device_type?: string
    server?: string
    model?: string
    manufacturer?: string
    services?: Array<Record<string, string>>
  }>
  count: number
  timeout: number
}

export interface DlnaStatusResult {
  state?: string
  transport_status?: string
  duration?: string
  position?: string
  volume?: number | string | null
  transport_error?: string
  position_error?: string
  volume_error?: string
}

export interface MediaSniffResult {
  url: string
  count: number
  candidates: MediaCandidate[]
  strategy?: string
  warning?: string
}

export interface MediaSourceSiteInput {
  title?: string
  url: string
  provider?: string
  kind?: MediaSourceSiteKind
  tags?: string[]
}

export interface MediaBookmarkInput extends MediaItem {
  tags?: string[]
  favorite?: boolean
}

export interface MediaBookmarkQuery {
  q?: string
  source?: string
  favorite?: boolean
  tag?: string
}

export interface MediaCacheStatus {
  root: string
  max_items: number
  file_count: number
  total_bytes: number
  updated_at: string
}

export interface BilibiliAuthStatus {
  authenticated: boolean
  has_saved_login?: boolean
  source?: string
  saved_at?: number
  message?: string
  user?: {
    mid?: number | string
    uname?: string
    face?: string
    vip_type?: number
  } | null
}

export interface BilibiliQrStartResult {
  url: string
  qr_svg?: string
  qrcode_key: string
}

export interface BilibiliQrPollResult extends BilibiliAuthStatus {
  qr_status?: 'waiting_scan' | 'waiting_confirm' | 'expired' | 'confirmed' | 'pending'
  code?: number
}

export interface BilibiliFavoriteFolder {
  id: number
  title: string
  media_count: number
  fav_state?: unknown
}

export interface BilibiliFavoriteFoldersResult {
  folders: BilibiliFavoriteFolder[]
  user?: BilibiliAuthStatus['user']
}

export interface BilibiliFavoriteMediasResult {
  media_id: number
  page: number
  page_size: number
  total: number
  has_more: boolean
  items: MediaItem[]
}

export const mediaApi = {
  cacheStatus: () =>
    request<{ cache: MediaCacheStatus }>('/api/media/cache'),

  clearCache: () =>
    request<{ status: string; removed_files: number; removed_bytes: number; cache: MediaCacheStatus }>('/api/media/cache', {
      method: 'DELETE',
    }),

  listBookmarks: (query: MediaBookmarkQuery = {}) => {
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    if (query.source) params.set('source', query.source)
    if (query.favorite != null) params.set('favorite', String(query.favorite))
    if (query.tag) params.set('tag', query.tag)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return request<{ bookmarks: MediaBookmark[] }>(`/api/media/bookmarks${suffix}`)
  },

  addBookmark: (input: MediaBookmarkInput) =>
    request<{ bookmark: MediaBookmark }>('/api/media/bookmarks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateBookmark: (itemId: string, input: Partial<MediaBookmarkInput>) =>
    request<{ bookmark: MediaBookmark }>(`/api/media/bookmarks/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeBookmark: (itemId: string) =>
    request<{ status: string }>(`/api/media/bookmarks/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),

  markBookmarkPlayed: (itemId: string) =>
    request<{ bookmark: MediaBookmark }>(`/api/media/bookmarks/${encodeURIComponent(itemId)}/played`, {
      method: 'POST',
    }),

  listSourceSites: () =>
    request<{ sites: MediaSourceSite[] }>('/api/media/source-sites'),

  addSourceSite: (input: MediaSourceSiteInput) =>
    request<{ site: MediaSourceSite }>('/api/media/source-sites', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateSourceSite: (siteId: number, input: Partial<MediaSourceSiteInput>) =>
    request<{ site: MediaSourceSite }>(`/api/media/source-sites/${encodeURIComponent(String(siteId))}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  removeSourceSite: (siteId: number) =>
    request<{ status: string }>(`/api/media/source-sites/${encodeURIComponent(String(siteId))}`, {
      method: 'DELETE',
    }),

  sniffSourceSite: (siteId: number) =>
    request<{ status: 'success' | 'error'; data?: MediaSniffResult; site?: MediaSourceSite; error?: string; message?: string }>(`/api/media/source-sites/${encodeURIComponent(String(siteId))}/sniff`, {
      method: 'POST',
    }),

  listPlaylist: () =>
    request<{ items: MediaItem[] }>('/api/media/playlist'),

  addPlaylistItem: (item: MediaItem) =>
    request<{ item: MediaItem }>('/api/media/playlist', {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  removePlaylistItem: (itemId: string) =>
    request<{ status: string }>(`/api/media/playlist/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),

  reorderPlaylist: (itemIds: string[]) =>
    request<{ items: MediaItem[] }>('/api/media/playlist/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ itemIds }),
    }),

  clearPlaylist: () =>
    request<{ status: string }>('/api/media/playlist', {
      method: 'DELETE',
    }),

  bilibiliStatus: () =>
    cliApi.run<BilibiliAuthStatus>('media-cli', {
      action: 'bilibili_status',
      params: {},
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliImportCookie: (cookie: string) =>
    cliApi.run<BilibiliAuthStatus>('media-cli', {
      action: 'bilibili_import_cookie',
      params: { cookie },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliBrowserImport: () =>
    cliApi.run<BilibiliAuthStatus>('media-cli', {
      action: 'bilibili_browser_import',
      params: {},
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliLogout: () =>
    cliApi.run<BilibiliAuthStatus>('media-cli', {
      action: 'bilibili_logout',
      params: {},
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliQrStart: () =>
    cliApi.run<BilibiliQrStartResult>('media-cli', {
      action: 'bilibili_qr_start',
      params: {},
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliQrPoll: (qrcodeKey: string) =>
    cliApi.run<BilibiliQrPollResult>('media-cli', {
      action: 'bilibili_qr_poll',
      params: { qrcode_key: qrcodeKey },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliFavoriteFolders: () =>
    cliApi.run<BilibiliFavoriteFoldersResult>('media-cli', {
      action: 'bilibili_favorite_folders',
      params: {},
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliFavoriteMedias: (mediaId: number, page = 1, pageSize = 20) =>
    cliApi.run<BilibiliFavoriteMediasResult>('media-cli', {
      action: 'bilibili_favorite_medias',
      params: { media_id: mediaId, page, page_size: pageSize },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  listXiaoAiOutputs: async (): Promise<MediaOutput[]> => {
    const result = await cliApi.run<XiaoAiSpeakerListResult>('mi-cli', {
      action: 'speaker_list',
      params: {},
      ttl_ms: 60_000,
    })
    if (result.status !== 'success' || !result.data) {
      throw new Error(result.message || result.error || 'Failed to list XiaoAi speakers')
    }
    return result.data.speakers.map((speaker) => ({
      id: `xiaoai:${speaker.did}`,
      kind: 'xiaoai',
      name: speaker.name || speaker.did,
      endpoint: speaker.did,
      online: true,
      meta: {
        model: speaker.model,
        home_name: speaker.home_name,
        room_name: speaker.room_name,
        connection_type: speaker.connection_type,
        control_path: speaker.control_path,
      },
    }))
  },

  getXiaoAiStatus: (did: string) =>
    cliApi.run<XiaoAiSpeakerStatusResult>('mi-cli', {
      action: 'speaker_status',
      params: { did },
      ttl_ms: 5_000,
      bypass_cache: true,
    }),

  controlXiaoAi: (did: string, control: 'pause' | 'resume' | 'stop' | 'volume', volume?: number) =>
    cliApi.run('mi-cli', {
      action: 'speaker_control',
      params: { did, control, ...(volume != null ? { volume } : {}) },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  listDlnaOutputs: async (): Promise<MediaOutput[]> => {
    const result = await cliApi.run<DlnaDiscoverResult>('media-cli', {
      action: 'dlna_discover',
      params: { timeout: 3 },
      ttl_ms: 15_000,
      bypass_cache: true,
    })
    if (result.status !== 'success' || !result.data) {
      throw new Error(result.message || result.error || 'Failed to discover DLNA devices')
    }
    return result.data.devices.map((device) => ({
      id: device.id,
      kind: 'dlna',
      name: isHomeSenseVirtualDlna(device) ? `${device.name || device.ip} DLNA` : device.name || device.ip,
      endpoint: device.location,
      online: true,
      meta: {
        udn: device.udn,
        ip: device.ip,
        port: device.port,
        device_type: device.device_type,
        server: device.server,
        model: device.model,
        manufacturer: device.manufacturer,
        services: device.services,
        virtual: isHomeSenseVirtualDlna(device),
      },
    }))
  },

  playBilibiliOnXiaoAi: (input: { did: string; bvid: string; title?: string; quality?: number }) =>
    request<{ status: 'success' | 'error'; data?: unknown; error?: string; message?: string; proxy_url?: string }>('/api/media/outputs/xiaoai/play-bilibili', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  playBilibiliOnDlna: (input: { location: string; bvid: string; title?: string; quality?: number }) =>
    request<{ status: 'success' | 'error'; data?: unknown; error?: string; message?: string; proxy_url?: string }>('/api/media/outputs/dlna/play-bilibili', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  playUrlOnDlna: (input: { location: string; url: string; title?: string; content_type?: string }) =>
    request<{ status: 'success' | 'error'; data?: unknown; error?: string; message?: string; url?: string }>('/api/media/outputs/dlna/play-url', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getDlnaStatus: (location: string) =>
    cliApi.run<DlnaStatusResult>('media-cli', {
      action: 'dlna_status',
      params: { location },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  controlDlna: (location: string, control: 'pause' | 'resume' | 'stop' | 'volume', volume?: number) =>
    cliApi.run('media-cli', {
      action: 'dlna_control',
      params: { location, control, ...(volume != null ? { volume } : {}) },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  searchBilibili: (keyword: string, page = 1, pageSize = 20, options: { preferSingleTrack?: boolean } = {}) =>
    cliApi.run<MediaSearchResult>('media-cli', {
      action: 'search_bilibili',
      params: {
        keyword,
        page,
        page_size: pageSize,
        ...(options.preferSingleTrack
          ? {
              prefer_single_track: true,
              min_duration_sec: 90,
              ideal_duration_sec: 240,
              max_duration_sec: 540,
            }
          : {}),
      },
      ttl_ms: 60_000,
    }),

  resolveBilibiliAudio: (bvid: string, quality = 64) =>
    cliApi.run<BilibiliAudioResult>('media-cli', {
      action: 'resolve_audio',
      params: { bvid, quality },
      ttl_ms: 0,
      bypass_cache: true,
    }),

  bilibiliAudioProxyUrl: (bvid: string, quality = 64) =>
    `/api/media/proxy/audio/bilibili/${encodeURIComponent(bvid)}?quality=${encodeURIComponent(String(quality))}`,

  sniffUrl: (input: { url: string; max_candidates?: number; inspect_page?: boolean }) =>
    request<{ status: 'success' | 'error'; data?: MediaSniffResult; error?: string; message?: string }>('/api/media/sniff', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  prepareStream: (input: { candidate_id?: string; url: string; mime_type?: string; headers?: Record<string, string> }) =>
    request<{ stream: PreparedMediaStream }>('/api/media/streams/prepare', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

function isHomeSenseVirtualDlna(device: DlnaDiscoverResult['devices'][number]): boolean {
  return device.manufacturer === 'HomeSense' || device.location.includes('/api/media/virtual-dlna/')
}
