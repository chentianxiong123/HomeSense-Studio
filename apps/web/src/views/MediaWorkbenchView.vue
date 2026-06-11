<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mediaApi } from '@/api/media'
import type { ResourceSearchHit } from '@/api/resources'
import BilibiliSearchPanel from '@/components/media/BilibiliSearchPanel.vue'
import MediaBookmarksPanel from '@/components/media/MediaBookmarksPanel.vue'
import MediaNowPlayingPanel from '@/components/media/MediaNowPlayingPanel.vue'
import MediaOutputPanel from '@/components/media/MediaOutputPanel.vue'
import MediaQueuePanel from '@/components/media/MediaQueuePanel.vue'
import MediaUrlSniffPanel from '@/components/media/MediaUrlSniffPanel.vue'
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
        <BilibiliSearchPanel
          v-model:keyword="biliKeyword"
          :loading="biliLoading"
          :error="biliError"
          :results="biliResults"
          :resolving-id="resolvingId"
          :label="label"
          :format-time="formatTime"
          @search="searchBilibili"
          @play="playBilibili"
          @queue="queueBilibili"
          @bookmark="bookmarkBilibili"
        />
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

        <MediaUrlSniffPanel
          v-model:url="urlInput"
          v-model:title="titleInput"
          v-model:artist="artistInput"
          :sniff-loading="sniffLoading"
          :candidates="sniffCandidates"
          :preparing-candidate-id="preparingCandidateId"
          :form-error="formError"
          :sniff-error="sniffError"
          :session-error="session.state === 'error' ? (session.error || '') : ''"
          :label="label"
          :stream-kind-label="streamKindLabel"
          :candidate-subtitle="candidateSubtitle"
          @submit="submitUrl"
          @sniff="sniffMediaUrl"
          @queue="queueUrl"
          @bookmark="bookmarkUrl"
          @select-source-url="selectSourceSiteUrl"
          @source-sniff="applySourceSiteSniff"
          @play-candidate="playCandidate"
          @queue-candidate="queueCandidate"
          @bookmark-candidate="bookmarkCandidate"
        />
      </section>

      <MediaNowPlayingPanel
        :active-item="activeItem"
        :session="session"
        :progress="player.progress.value"
        :play-mode="player.state.playMode"
        :play-mode-label="playModeLabel"
        :can-control="player.canControl.value"
        :has-previous="player.hasPrevious.value"
        :has-next="player.hasNext.value"
        :label="label"
        :source-label="sourceLabel"
        :format-time="formatTime"
        @stop="player.stop"
        @previous="player.previous"
        @toggle="player.toggle"
        @next="player.next"
        @toggle-play-mode="togglePlayMode"
      />

      <section class="panel bookmarks-shell">
        <MediaBookmarksPanel
          ref="bookmarksPanel"
          @play="playBookmark"
          @queue="queueBookmark"
        />
      </section>

      <MediaQueuePanel
        :queue="queue"
        :current-index="player.state.currentIndex"
        :loading="playlistLoading"
        :label="label"
        :source-label="sourceLabel"
        @clear="clearQueue"
        @play="player.playAtIndex"
        @move="moveQueued"
        @remove="removeQueued"
      />
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

  .candidate-row {
    grid-template-columns: 1fr;
  }

  .candidate-row .row-actions {
    justify-content: flex-end;
  }

}
</style>
