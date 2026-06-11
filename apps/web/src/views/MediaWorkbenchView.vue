<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mediaApi } from '@/api/media'
import type { ResourceSearchHit } from '@/api/resources'
import MediaBookmarksPanel from '@/components/media/MediaBookmarksPanel.vue'
import MediaOutputPanel from '@/components/media/MediaOutputPanel.vue'
import MediaSourceSitesPanel from '@/components/media/MediaSourceSitesPanel.vue'
import ResourceSearchPanel from '@/components/resources/ResourceSearchPanel.vue'
import { useLocale } from '@/composables/useLocale'
import { useMediaPlayer } from '@/features/media/player'
import type { MediaBookmark, MediaCandidate, MediaItem, MediaPlayMode, MediaSourceSite } from '@/features/media/types'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const player = useMediaPlayer()
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
const playlistLoading = ref(false)
const bookmarksPanel = ref<InstanceType<typeof MediaBookmarksPanel> | null>(null)

const activeItem = player.currentItem
const queue = player.queue
const session = computed(() => player.state.session)
const hasQueue = computed(() => queue.value.length > 0)
const sessionDetail = computed(() => {
  const item = session.value.item
  if (!item) return label('无会话', 'No session')
  return `${item.title} · ${session.value.output.name}`
})
const playModeLabel = computed(() => {
  const map: Record<MediaPlayMode, string> = {
    order: label('顺序播放', 'Order'),
    loop: label('列表循环', 'Loop'),
    single: label('单曲循环', 'Single'),
    random: label('随机播放', 'Random'),
  }
  return map[player.state.playMode]
})

onMounted(() => {
  void loadPlaylist()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function submitUrl() {
  const item = createUrlItem()
  if (!item) return

  await player.playItem(item)
  if (player.state.session.state !== 'error') {
    await persistPlaylistItem(item)
    clearUrlForm()
  }
}

async function queueUrl() {
  const item = createUrlItem()
  if (!item) return

  player.addToQueue(item)
  await persistPlaylistItem(item)
  clearUrlForm()
}

async function sniffMediaUrl() {
  const url = urlInput.value.trim()
  sniffError.value = ''
  formError.value = ''
  sniffCandidates.value = []
  if (!url) {
    sniffError.value = label('请输入要嗅探的 URL', 'Enter a URL to sniff')
    return
  }
  try {
    new URL(url)
  } catch {
    sniffError.value = label('URL 格式不正确', 'Invalid URL')
    return
  }

  sniffLoading.value = true
  try {
    const result = await mediaApi.sniffUrl({ url, max_candidates: 16 })
    if (result.status === 'success' && result.data) {
      sniffCandidates.value = result.data.candidates
      if (result.data.candidates.length === 0) {
        sniffError.value = result.data.warning || label('没有发现可播放候选', 'No playable candidates found')
      }
      return
    }
    sniffError.value = result.message || result.error || label('嗅探失败', 'Sniff failed')
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
    ? label('没有发现可播放候选', 'No playable candidates found')
    : ''
}

async function playCandidate(candidate: MediaCandidate) {
  const item = await createCandidateItem(candidate)
  if (!item) return
  await player.playItem(item)
  if (player.state.session.state !== 'error') await persistPlaylistItem(item)
}

async function queueCandidate(candidate: MediaCandidate) {
  const item = await createCandidateItem(candidate)
  if (!item) return
  player.addToQueue(item)
  await persistPlaylistItem(item)
}

async function bookmarkCandidate(candidate: MediaCandidate) {
  const item = await createCandidateItem(candidate)
  if (!item) return
  await bookmarksPanel.value?.saveItem(durableBookmarkItem(item), candidateBookmarkTags(candidate), true)
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
    formError.value = label('请输入媒体 URL', 'Enter a media URL')
    return null
  }
  try {
    new URL(url)
  } catch {
    formError.value = label('URL 格式不正确', 'Invalid URL')
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
    biliError.value = label('请输入关键词', 'Enter a keyword')
    return
  }
  biliLoading.value = true
  try {
    const result = await mediaApi.searchBilibili(keyword, 1, 12)
    if (result.status === 'success' && result.data) {
      biliResults.value = result.data.items
    } else {
      biliResults.value = []
      biliError.value = result.message || result.error || label('搜索失败', 'Search failed')
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
    await player.playItem(playableItem)
    if (player.state.session.state !== 'error') await persistPlaylistItem(playableItem)
  } finally {
    resolvingId.value = ''
  }
}

async function queueBilibili(item: MediaItem) {
  const playableItem = createBilibiliPlaybackItem(item)
  if (!playableItem) return
  player.addToQueue(playableItem)
  await persistPlaylistItem(playableItem)
}

async function bookmarkBilibili(item: MediaItem) {
  const playableItem = createBilibiliPlaybackItem(item)
  if (!playableItem) return
  await bookmarksPanel.value?.saveItem(playableItem, ['bilibili'], true)
}

function createBilibiliPlaybackItem(item: MediaItem): MediaItem | null {
  const bvid = item.upstream_id
  if (!bvid) return null
  return {
    ...item,
    stream_url: mediaApi.bilibiliAudioProxyUrl(bvid),
  }
}

async function loadPlaylist() {
  playlistLoading.value = true
  try {
    const result = await mediaApi.listPlaylist()
    player.hydrateQueue(result.items)
  } catch (error) {
    console.warn('failed to load media playlist', error)
  } finally {
    playlistLoading.value = false
  }
}

async function persistPlaylistItem(item: MediaItem) {
  try {
    await mediaApi.addPlaylistItem(item)
  } catch (error) {
    console.warn('failed to persist media playlist item', error)
  }
}

async function bookmarkUrl() {
  const item = createUrlItem()
  if (!item) return
  await bookmarksPanel.value?.saveItem(item, ['url'], true)
  clearUrlForm()
}

async function playBookmark(bookmark: MediaBookmark) {
  const item = await createBookmarkPlaybackItem(bookmark)
  await player.playItem(item)
  if (player.state.session.state !== 'error') await persistPlaylistItem(item)
}

async function queueBookmark(bookmark: MediaBookmark) {
  const item = await createBookmarkPlaybackItem(bookmark)
  player.addToQueue(item)
  await persistPlaylistItem(item)
}

async function removeQueued(index: number) {
  const item = queue.value[index]
  if (!item) return
  player.removeFromQueue(index)
  try {
    await mediaApi.removePlaylistItem(item.id)
  } catch (error) {
    console.warn('failed to remove media playlist item', error)
  }
}

async function moveQueued(index: number, direction: -1 | 1) {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= queue.value.length) return
  player.reorderQueue(index, targetIndex)
  await persistPlaylistOrder()
}

async function persistPlaylistOrder() {
  try {
    const result = await mediaApi.reorderPlaylist(queue.value.map((item) => item.id))
    player.hydrateQueue(result.items)
  } catch (error) {
    console.warn('failed to persist media playlist order', error)
    await loadPlaylist()
  }
}

async function clearQueue() {
  player.clearQueue()
  try {
    await mediaApi.clearPlaylist()
  } catch (error) {
    console.warn('failed to clear media playlist', error)
  }
}

function clearUrlForm() {
  urlInput.value = ''
  titleInput.value = ''
  artistInput.value = ''
}

function togglePlayMode() {
  const modes: MediaPlayMode[] = ['order', 'loop', 'single', 'random']
  const currentIndex = modes.indexOf(player.state.playMode)
  player.setPlayMode(modes[(currentIndex + 1) % modes.length] || 'loop')
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    bilibili: 'Bilibili',
    url: 'URL',
    local: label('本地', 'Local'),
    storage: label('存储', 'Storage'),
  }
  return map[source] ?? source
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
    audio: label('音频', 'Audio'),
    video: label('视频', 'Video'),
    hls: 'HLS',
    dash: 'DASH',
    playlist: label('播放清单', 'Playlist'),
    stream: label('媒体流', 'Stream'),
    page: label('页面', 'Page'),
  }
  return map[kind] ?? kind
}

function confidenceLabel(confidence: number | undefined): string {
  if (typeof confidence !== 'number') return ''
  return `${Math.round(confidence * 100)}%`
}

function stateText(state: string): string {
  const normalized = state.toLowerCase()
  const map: Record<string, string> = {
    idle: label('待机', 'Idle'),
    loading: label('载入中', 'Loading'),
    playing: label('播放中', 'Playing'),
    paused: label('已暂停', 'Paused'),
    stopped: label('已停止', 'Stopped'),
    stopped_pending: label('已停止', 'Stopped'),
    no_media_present: label('无媒体', 'No media'),
    transitioning: label('切换中', 'Transitioning'),
    error: label('失败', 'Error'),
  }
  return map[normalized] ?? state
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00'
  const seconds = Math.floor(totalSeconds)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
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
</script>

<template>
  <div class="media-page">
    <header class="page-head">
      <div>
        <span class="eyebrow">Media</span>
        <h1>{{ label('媒体工作台', 'Media Workbench') }}</h1>
      </div>
      <div class="session-chip" :class="session.state">
        <span>{{ stateText(session.state) }}</span>
        <strong>{{ sessionDetail }}</strong>
      </div>
    </header>

    <main class="media-layout">
      <section class="panel source-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow inline">{{ label('来源', 'Source') }}</span>
            <h2>Bilibili</h2>
          </div>
        </div>

        <form class="search-form" @submit.prevent="searchBilibili">
          <input v-model="biliKeyword" type="search" :placeholder="label('搜索音乐或视频', 'Search media')" autocomplete="off" />
          <button class="primary-btn" type="submit" :disabled="biliLoading">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {{ biliLoading ? label('搜索中', 'Searching') : label('搜索', 'Search') }}
          </button>
        </form>

        <p v-if="biliError" class="notice error">{{ biliError }}</p>

        <div v-if="biliResults.length > 0" class="media-results">
          <div v-for="result in biliResults" :key="result.id" class="result-row">
            <img v-if="result.cover" :src="result.cover" :alt="result.title" referrerpolicy="no-referrer" />
            <span v-else class="result-cover-fallback" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </span>
            <button class="result-main" type="button" @click="playBilibili(result)">
              <strong>{{ result.title }}</strong>
              <small>{{ result.artist || 'Bilibili' }} · {{ formatTime(result.duration_sec || 0) }}</small>
            </button>
            <div class="row-actions">
              <button class="row-icon" type="button" :title="label('收藏', 'Bookmark')" @click="bookmarkBilibili(result)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
                </svg>
              </button>
              <button class="row-icon" type="button" :title="label('加入队列', 'Add to queue')" @click="queueBilibili(result)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
              <button class="row-icon" type="button" :disabled="resolvingId === result.id" :title="label('播放', 'Play')" @click="playBilibili(result)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="source-divider">
          <span>{{ label('互联网资源', 'Internet Resources') }}</span>
        </div>

        <ResourceSearchPanel
          @select="selectResourceUrl"
          @sniff="sniffResourceHit"
          @play="playResourceHit"
          @queue="queueResourceHit"
          @bookmark="bookmarkResourceHit"
        />

        <div class="source-divider">
          <span>{{ label('直连 URL', 'Direct URL') }}</span>
        </div>

        <MediaSourceSitesPanel
          :current-url="urlInput"
          @select="selectSourceSiteUrl"
          @sniff="applySourceSiteSniff"
        />

        <div class="source-divider">
          <span>URL</span>
        </div>

        <form class="url-form" @submit.prevent="submitUrl">
          <label class="form-field full">
            <span>URL</span>
            <input v-model="urlInput" type="url" placeholder="https://..." autocomplete="off" />
          </label>
          <label class="form-field">
            <span>{{ label('标题', 'Title') }}</span>
            <input v-model="titleInput" type="text" :placeholder="label('可选', 'Optional')" autocomplete="off" />
          </label>
          <label class="form-field">
            <span>{{ label('作者', 'Artist') }}</span>
            <input v-model="artistInput" type="text" :placeholder="label('可选', 'Optional')" autocomplete="off" />
          </label>
          <div class="form-actions full">
            <button class="plain-btn" type="button" :disabled="sniffLoading" @click="sniffMediaUrl">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              {{ sniffLoading ? label('嗅探中', 'Sniffing') : label('嗅探', 'Sniff') }}
            </button>
            <button class="plain-btn" type="button" @click="queueUrl">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              {{ label('加入队列', 'Add') }}
            </button>
            <button class="plain-btn" type="button" @click="bookmarkUrl">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
              </svg>
              {{ label('收藏', 'Save') }}
            </button>
            <button class="primary-btn" type="submit">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {{ label('播放', 'Play') }}
            </button>
          </div>
        </form>

        <div v-if="sniffCandidates.length > 0" class="candidate-list">
          <div v-for="candidate in sniffCandidates" :key="candidate.id" class="candidate-row">
            <span class="candidate-kind">{{ streamKindLabel(candidate.stream_kind || candidate.kind) }}</span>
            <button class="candidate-main" type="button" @click="playCandidate(candidate)">
              <strong>{{ candidate.title }}</strong>
              <small>{{ candidateSubtitle(candidate) }}</small>
            </button>
            <div class="row-actions">
              <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('收藏', 'Bookmark')" @click="bookmarkCandidate(candidate)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
                </svg>
              </button>
              <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('加入队列', 'Add to queue')" @click="queueCandidate(candidate)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
              <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('播放', 'Play')" @click="playCandidate(candidate)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <p v-if="formError" class="notice error">{{ formError }}</p>
        <p v-if="sniffError" class="notice warn">{{ sniffError }}</p>
        <p v-if="session.state === 'error'" class="notice error">{{ session.error }}</p>
      </section>

      <section class="panel session-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow inline">{{ label('会话', 'Session') }}</span>
            <h2>{{ label('当前播放', 'Now Playing') }}</h2>
          </div>
          <button class="plain-btn" type="button" :disabled="!player.canControl.value" @click="player.stop()">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M7 7h10v10H7z" />
            </svg>
            {{ label('停止', 'Stop') }}
          </button>
        </div>

        <div v-if="activeItem" class="now-row">
          <span class="cover-fallback" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </span>
          <div class="now-copy">
            <strong>{{ activeItem.title }}</strong>
            <span>{{ sourceLabel(activeItem.source) }} · {{ session.output.name }}</span>
          </div>
        </div>

        <div v-else class="empty-line">{{ label('暂无播放项', 'No active item') }}</div>

        <div class="session-meter">
          <div class="meter-track">
            <span :style="{ width: `${player.progress.value}%` }" />
          </div>
          <div class="meter-copy">
            <span>{{ formatTime(session.position_sec) }}</span>
            <span>{{ formatTime(session.duration_sec || activeItem?.duration_sec || 0) }}</span>
          </div>
        </div>

        <div class="transport-row">
          <button class="icon-btn" type="button" :title="playModeLabel" @click="togglePlayMode">
            <svg v-if="player.state.playMode === 'random'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M16 3h5v5" />
              <path d="M4 20 21 3" />
              <path d="M21 16v5h-5" />
              <path d="M15 15 21 21" />
              <path d="M4 4l5 5" />
            </svg>
            <svg v-else-if="player.state.playMode === 'single'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
              <path d="M11 10h1v4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
          <button class="icon-btn" type="button" :disabled="!player.hasPrevious.value" @click="player.previous()">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="m19 20-9-8 9-8v16Z" />
              <path d="M5 19V5" />
            </svg>
          </button>
          <button class="play-btn" type="button" :disabled="!player.canControl.value" @click="player.toggle()">
            <svg v-if="session.state === 'playing' || session.state === 'loading'" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button class="icon-btn" type="button" :disabled="!player.hasNext.value" @click="player.next()">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="m5 4 9 8-9 8V4Z" />
              <path d="M19 5v14" />
            </svg>
          </button>
        </div>
        <div class="mode-line">{{ playModeLabel }}</div>
      </section>

      <section class="panel bookmarks-shell">
        <MediaBookmarksPanel
          ref="bookmarksPanel"
          @play="playBookmark"
          @queue="queueBookmark"
        />
      </section>

      <section class="panel queue-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow inline">{{ label('队列', 'Queue') }}</span>
            <h2>{{ label('播放列表', 'Playlist') }}</h2>
          </div>
          <button class="plain-btn" type="button" :disabled="!hasQueue || playlistLoading" @click="clearQueue()">
            {{ playlistLoading ? label('加载中', 'Loading') : label('清空', 'Clear') }}
          </button>
        </div>

        <div v-if="hasQueue" class="queue-list">
          <div v-for="(queued, index) in queue" :key="queued.id" class="queue-row" :class="{ active: index === player.state.currentIndex }">
            <button class="queue-main" type="button" @click="player.playAtIndex(index)">
              <span>{{ index + 1 }}</span>
              <strong>{{ queued.title }}</strong>
              <small>{{ sourceLabel(queued.source) }}</small>
            </button>
            <div class="row-actions">
              <button class="row-icon" type="button" :disabled="index === 0" :title="label('上移', 'Move up')" @click="moveQueued(index, -1)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m6 15 6-6 6 6" />
                </svg>
              </button>
              <button class="row-icon" type="button" :disabled="index === queue.length - 1" :title="label('下移', 'Move down')" @click="moveQueued(index, 1)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <button class="row-icon" type="button" :title="label('移除', 'Remove')" @click="removeQueued(index)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-line">{{ label('队列为空', 'Queue is empty') }}</div>
      </section>

      <MediaOutputPanel :active-item="activeItem" :session-output-id="session.output.id" />
    </main>
  </div>
</template>

<style scoped>
.media-page {
  min-height: 100%;
  padding: 32px 40px 128px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-head,
.panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.page-head {
  min-height: 94px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.eyebrow.inline {
  display: inline-flex;
  margin-bottom: 5px;
}

h1,
h2 {
  margin: 0;
  color: var(--text-primary);
  font-weight: 900;
  letter-spacing: 0;
}

h1 {
  margin-top: 5px;
  font-size: 30px;
}

h2 {
  font-size: 20px;
}

.session-chip {
  min-width: 240px;
  max-width: 460px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-chip.playing,
.session-chip.loading {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.session-chip.error {
  border-color: #fecaca;
  background: #fef2f2;
}

.session-chip span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.session-chip strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-layout {
  display: grid;
  grid-template-columns: minmax(320px, 0.9fr) minmax(360px, 1.1fr);
  gap: 14px;
  align-items: start;
}

.panel {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.queue-panel {
  min-height: 260px;
}

.bookmarks-shell {
  min-height: 260px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.url-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.search-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.search-form input {
  min-width: 0;
  height: 40px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  font-weight: 750;
  outline: none;
  padding: 0 11px;
}

.search-form input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
}

.form-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field.full,
.url-form .full {
  grid-column: 1 / -1;
}

.form-field span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.form-field input {
  width: 100%;
  height: 40px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  font-weight: 750;
  outline: none;
  padding: 0 11px;
}

.form-field input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
}

.primary-btn,
.plain-btn,
.icon-btn,
.play-btn,
.row-icon {
  border-radius: 8px;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.primary-btn,
.plain-btn {
  min-height: 38px;
  padding: 0 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

.plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
}

.plain-btn:hover:not(:disabled) {
  border-color: #0f766e;
  color: #0f766e;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
}

.notice.error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.notice.warn {
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.media-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}

.candidate-row {
  min-height: 56px;
  padding: 7px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.candidate-kind {
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  background: #f0fdfa;
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.candidate-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}

.candidate-main strong,
.candidate-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidate-main strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.candidate-main small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.result-row {
  min-height: 64px;
  padding: 7px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.result-row img,
.result-cover-fallback {
  width: 72px;
  height: 48px;
  border-radius: 6px;
  background: #e6fffb;
  object-fit: cover;
}

.result-cover-fallback {
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.result-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}

.result-main strong,
.result-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-main strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.result-main small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.source-divider {
  min-height: 1px;
  border-top: 1px solid #e2e8f0;
  display: flex;
}

.source-divider span {
  margin-top: -8px;
  padding-right: 9px;
  background: #fff;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.now-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.cover-fallback {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  background: #e6fffb;
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.now-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.now-copy strong,
.now-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-copy strong {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.now-copy span {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
}

.session-meter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meter-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #e2e8f0;
}

.meter-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #0f766e;
}

.meter-copy {
  display: flex;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
}

.transport-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.mode-line {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.icon-btn,
.play-btn,
.row-icon {
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn {
  width: 40px;
  height: 40px;
}

.play-btn {
  width: 48px;
  height: 48px;
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.queue-row,
.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.queue-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
  padding: 6px;
}

.queue-row.active {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.queue-main {
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.queue-main span {
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.queue-main strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-main small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.row-icon {
  width: 32px;
  height: 32px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-line {
  padding: 26px 18px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

@media (max-width: 1080px) {
  .media-page {
    padding: 22px 18px 126px;
  }

  .media-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .page-head,
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .session-chip {
    width: 100%;
    max-width: none;
    min-width: 0;
  }

  h1 {
    font-size: 24px;
  }

  .url-form,
  .form-actions,
  .search-form {
    grid-template-columns: 1fr;
  }

  .queue-row {
    grid-template-columns: 1fr;
  }

  .candidate-row {
    grid-template-columns: 1fr;
  }

  .candidate-row .row-actions {
    justify-content: flex-end;
  }

  .queue-main {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .queue-main small {
    grid-column: 2;
  }

  .queue-row .row-actions {
    justify-content: flex-end;
  }

  .queue-main small {
    justify-self: start;
  }
}
</style>
