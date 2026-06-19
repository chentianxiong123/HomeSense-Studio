import { ref } from 'vue'
import { mediaApi } from '@/api/media'
import type { ResourceSearchHit } from '@/api/resources'
import type { useMediaPlayer } from '@/features/media/player'
import type { MediaBookmark, MediaCandidate, MediaItem, MediaSourceSite } from '@/features/media/types'

type LabelFn = (zh: string, en: string) => string
type MediaPlayer = ReturnType<typeof useMediaPlayer>

export function useMediaSources(options: {
  player: MediaPlayer
  label: LabelFn
  persistPlaylistItem: (item: MediaItem) => Promise<void>
  saveBookmark: (item: MediaItem, tags: string[], dedupe: boolean) => Promise<void>
}) {
  const urlInput = ref('')
  const titleInput = ref('')
  const artistInput = ref('')
  const formError = ref('')
  const sniffLoading = ref(false)
  const sniffError = ref('')
  const sniffCandidates = ref<MediaCandidate[]>([])
  const preparingCandidateId = ref('')
  const biliKeyword = ref('')
  const biliLoading = ref(false)
  const biliError = ref('')
  const biliResults = ref<MediaItem[]>([])
  const resolvingId = ref('')

  async function submitUrl() {
    const item = createUrlItem()
    if (!item) return

    await options.player.playItem(item)
    if (options.player.state.session.state !== 'error') {
      await options.persistPlaylistItem(item)
      clearUrlForm()
    }
  }

  async function queueUrl() {
    const item = createUrlItem()
    if (!item) return

    options.player.addToQueue(item)
    await options.persistPlaylistItem(item)
    clearUrlForm()
  }

  async function sniffMediaUrl() {
    const url = urlInput.value.trim()
    sniffError.value = ''
    formError.value = ''
    sniffCandidates.value = []
    if (!url) {
      sniffError.value = options.label('请输入要嗅探的 URL', 'Enter a URL to sniff')
      return
    }
    try {
      new URL(url)
    } catch {
      sniffError.value = options.label('URL 格式不正确', 'Invalid URL')
      return
    }

    sniffLoading.value = true
    try {
      const result = await mediaApi.sniffUrl({ url, max_candidates: 16 })
      if (result.status === 'success' && result.data) {
        sniffCandidates.value = result.data.candidates
        if (result.data.candidates.length === 0) {
          sniffError.value = result.data.warning || options.label('没有发现可播放候选', 'No playable candidates found')
        }
        return
      }
      sniffError.value = result.message || result.error || options.label('嗅探失败', 'Sniff failed')
    } catch (error) {
      sniffError.value = error instanceof Error ? error.message : String(error)
    } finally {
      sniffLoading.value = false
    }
  }

  function selectSourceSiteUrl(url: string) {
    urlInput.value = url
    formError.value = ''
    sniffError.value = ''
  }

  function selectResourceUrl(url: string) {
    urlInput.value = url
    formError.value = ''
    sniffError.value = ''
  }

  async function sniffResourceHit(hit: ResourceSearchHit) {
    urlInput.value = hit.url
    titleInput.value = hit.title
    formError.value = ''
    await sniffMediaUrl()
  }

  async function playResourceHit(hit: ResourceSearchHit) {
    const candidate = createResourceCandidate(hit)
    if (!candidate) {
      await sniffResourceHit(hit)
      return
    }
    await playCandidate(candidate)
  }

  async function queueResourceHit(hit: ResourceSearchHit) {
    const candidate = createResourceCandidate(hit)
    if (!candidate) {
      await sniffResourceHit(hit)
      return
    }
    await queueCandidate(candidate)
  }

  async function bookmarkResourceHit(hit: ResourceSearchHit) {
    const candidate = createResourceCandidate(hit)
    if (!candidate) {
      await sniffResourceHit(hit)
      return
    }
    await bookmarkCandidate(candidate)
  }

  function applySourceSiteSniff(payload: { site: MediaSourceSite; candidates: MediaCandidate[] }) {
    urlInput.value = payload.site.url
    titleInput.value = payload.site.title
    sniffCandidates.value = payload.candidates
    sniffError.value = payload.candidates.length === 0
      ? options.label('没有发现可播放候选', 'No playable candidates found')
      : ''
  }

  async function playCandidate(candidate: MediaCandidate) {
    const item = await createCandidateItem(candidate)
    if (!item) return
    await options.player.playItem(item)
    if (options.player.state.session.state !== 'error') await options.persistPlaylistItem(item)
  }

  async function queueCandidate(candidate: MediaCandidate) {
    const item = await createCandidateItem(candidate)
    if (!item) return
    options.player.addToQueue(item)
    await options.persistPlaylistItem(item)
  }

  async function bookmarkCandidate(candidate: MediaCandidate) {
    const item = await createCandidateItem(candidate)
    if (!item) return
    await options.saveBookmark(durableBookmarkItem(item), candidateBookmarkTags(candidate), true)
  }

  async function createCandidateItem(candidate: MediaCandidate): Promise<MediaItem | null> {
    preparingCandidateId.value = candidate.id
    sniffError.value = ''
    try {
      const prepared = await mediaApi.prepareStream({
        candidate_id: candidate.id,
        url: candidate.url,
        mime_type: candidate.mime_type,
        headers: candidate.headers,
      })
      return {
        id: `candidate:${candidate.id}`,
        source: candidate.source,
        title: candidate.title || titleFromUrl(candidate.url),
        artist: candidate.provider || 'Sniff',
        duration_sec: candidate.duration_sec,
        upstream_url: prepared.stream.upstream_url,
        stream_url: prepared.stream.url,
        mime_type: prepared.stream.mime_type,
        stream_kind: candidate.stream_kind,
      }
    } catch (error) {
      sniffError.value = error instanceof Error ? error.message : String(error)
      return null
    } finally {
      preparingCandidateId.value = ''
    }
  }

  function createResourceCandidate(hit: ResourceSearchHit): MediaCandidate | null {
    const media = hit.media_candidates?.find((candidate) => candidate.kind !== 'embed')
    if (!media) return null
    return {
      id: `resource:${hit.id}:${media.url}`,
      source: 'url',
      kind: 'stream',
      stream_kind: resourceStreamKind(media.kind),
      title: hit.title || titleFromUrl(media.url),
      url: media.url,
      page_url: hit.url,
      mime_type: media.mime_type,
      thumbnail: hit.cover,
      confidence: hit.confidence,
      provider: hit.site_name || hit.source_name || 'Resource',
    }
  }

  function resourceStreamKind(kind: string): MediaCandidate['stream_kind'] {
    if (kind === 'audio') return 'audio'
    if (kind === 'hls') return 'hls'
    if (kind === 'dash') return 'dash'
    return 'video'
  }

  function createUrlItem(): MediaItem | null {
    const url = urlInput.value.trim()
    formError.value = ''
    if (!url) {
      formError.value = options.label('请输入媒体 URL', 'Enter a media URL')
      return null
    }
    try {
      new URL(url)
    } catch {
      formError.value = options.label('URL 格式不正确', 'Invalid URL')
      return null
    }

    return {
      id: `url:${url}`,
      source: 'url',
      title: titleInput.value.trim() || titleFromUrl(url),
      artist: artistInput.value.trim() || 'URL',
      upstream_url: url,
      stream_url: url,
    }
  }

  async function searchBilibili() {
    const keyword = biliKeyword.value.trim()
    biliError.value = ''
    if (!keyword) {
      biliError.value = options.label('请输入关键词', 'Enter a keyword')
      return
    }
    biliLoading.value = true
    try {
      const result = await mediaApi.searchBilibili(keyword, 1, 12, { preferSingleTrack: true })
      if (result.status === 'success' && result.data) {
        biliResults.value = result.data.items
      } else {
        biliResults.value = []
        biliError.value = result.message || result.error || options.label('搜索失败', 'Search failed')
      }
    } catch (error) {
      biliResults.value = []
      biliError.value = error instanceof Error ? error.message : String(error)
    } finally {
      biliLoading.value = false
    }
  }

  async function playBilibili(item: MediaItem) {
    const playableItem = createBilibiliPlaybackItem(item)
    if (!playableItem) return
    resolvingId.value = item.id
    try {
      await options.player.playItem(playableItem)
      if (options.player.state.session.state !== 'error') await options.persistPlaylistItem(playableItem)
    } finally {
      resolvingId.value = ''
    }
  }

  async function queueBilibili(item: MediaItem) {
    const playableItem = createBilibiliPlaybackItem(item)
    if (!playableItem) return
    options.player.addToQueue(playableItem)
    await options.persistPlaylistItem(playableItem)
  }

  async function bookmarkBilibili(item: MediaItem) {
    const playableItem = createBilibiliPlaybackItem(item)
    if (!playableItem) return
    await options.saveBookmark(playableItem, ['bilibili'], true)
  }

  function createBilibiliPlaybackItem(item: MediaItem): MediaItem | null {
    const bvid = item.upstream_id
    if (!bvid) return null
    return {
      ...item,
      stream_url: mediaApi.bilibiliAudioProxyUrl(bvid),
      mime_type: item.mime_type || 'audio/mp4',
      stream_kind: 'audio',
    }
  }

  async function bookmarkUrl() {
    const item = createUrlItem()
    if (!item) return
    await options.saveBookmark(item, ['url'], true)
    clearUrlForm()
  }

  async function playBookmark(bookmark: MediaBookmark) {
    const item = await createBookmarkPlaybackItem(bookmark)
    await options.player.playItem(item)
    if (options.player.state.session.state !== 'error') await options.persistPlaylistItem(item)
  }

  async function queueBookmark(bookmark: MediaBookmark) {
    const item = await createBookmarkPlaybackItem(bookmark)
    options.player.addToQueue(item)
    await options.persistPlaylistItem(item)
  }

  function clearUrlForm() {
    urlInput.value = ''
    titleInput.value = ''
    artistInput.value = ''
  }

  function candidateSubtitle(candidate: MediaCandidate): string {
    return [
      streamKindLabel(candidate.stream_kind || candidate.kind),
      candidate.mime_type,
      candidate.provider,
      confidenceLabel(candidate.confidence),
    ].filter(Boolean).join(' · ')
  }

  function candidateBookmarkTags(candidate: MediaCandidate): string[] {
    return Array.from(new Set([
      candidate.provider,
      candidate.stream_kind || candidate.kind,
    ].filter(Boolean)))
  }

  function durableBookmarkItem(item: MediaItem): MediaItem {
    if (!item.id.startsWith('candidate:')) return item
    const durable = { ...item }
    delete durable.stream_url
    return durable
  }

  async function createBookmarkPlaybackItem(bookmark: MediaBookmark): Promise<MediaItem> {
    if (!bookmark.id.startsWith('candidate:') || !bookmark.upstream_url) return bookmark
    const prepared = await mediaApi.prepareStream({
      candidate_id: bookmark.id,
      url: bookmark.upstream_url,
      mime_type: bookmark.mime_type,
    })
    return {
      ...bookmark,
      stream_url: prepared.stream.url,
      mime_type: prepared.stream.mime_type,
    }
  }

  function streamKindLabel(kind: string): string {
    const map: Record<string, string> = {
      audio: options.label('音频', 'Audio'),
      video: options.label('视频', 'Video'),
      hls: 'HLS',
      dash: 'DASH',
      playlist: options.label('播放清单', 'Playlist'),
      stream: options.label('媒体流', 'Stream'),
      page: options.label('页面', 'Page'),
    }
    return map[kind] ?? kind
  }

  function confidenceLabel(confidence: number | undefined): string {
    if (typeof confidence !== 'number') return ''
    return `${Math.round(confidence * 100)}%`
  }

  function titleFromUrl(url: string): string {
    try {
      const parsed = new URL(url)
      const lastPart = parsed.pathname.split('/').filter(Boolean).at(-1)
      return decodeURIComponent(lastPart || parsed.hostname)
    } catch {
      return url
    }
  }

  return {
    urlInput,
    titleInput,
    artistInput,
    formError,
    sniffLoading,
    sniffError,
    sniffCandidates,
    preparingCandidateId,
    biliKeyword,
    biliLoading,
    biliError,
    biliResults,
    resolvingId,
    submitUrl,
    queueUrl,
    sniffMediaUrl,
    selectSourceSiteUrl,
    selectResourceUrl,
    sniffResourceHit,
    playResourceHit,
    queueResourceHit,
    bookmarkResourceHit,
    applySourceSiteSniff,
    playCandidate,
    queueCandidate,
    bookmarkCandidate,
    searchBilibili,
    playBilibili,
    queueBilibili,
    bookmarkBilibili,
    bookmarkUrl,
    playBookmark,
    queueBookmark,
    streamKindLabel,
    candidateSubtitle,
  }
}
