<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mediaApi } from '@/api/media'
import MediaBookmarksPanel from '@/components/media/MediaBookmarksPanel.vue'
import MediaNowPlayingPanel from '@/components/media/MediaNowPlayingPanel.vue'
import MediaOutputPanel from '@/components/media/MediaOutputPanel.vue'
import MediaQueuePanel from '@/components/media/MediaQueuePanel.vue'
import MediaSourcePanel from '@/components/media/MediaSourcePanel.vue'
import { useLocale } from '@/composables/useLocale'
import { useMediaSources } from '@/composables/useMediaSources'
import { useMediaPlayer } from '@/features/media/player'
import type { MediaItem, MediaPlayMode } from '@/features/media/types'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const player = useMediaPlayer()
const playlistLoading = ref(false)
const bookmarksPanel = ref<InstanceType<typeof MediaBookmarksPanel> | null>(null)

const {
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
} = useMediaSources({
  player,
  label,
  persistPlaylistItem,
  saveBookmark: async (item, tags, dedupe) => {
    await bookmarksPanel.value?.saveItem(item, tags, dedupe)
  },
})

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
      <MediaSourcePanel
        v-model:bili-keyword="biliKeyword"
        v-model:url="urlInput"
        v-model:title="titleInput"
        v-model:artist="artistInput"
        :bili-loading="biliLoading"
        :bili-error="biliError"
        :bili-results="biliResults"
        :resolving-id="resolvingId"
        :sniff-loading="sniffLoading"
        :candidates="sniffCandidates"
        :preparing-candidate-id="preparingCandidateId"
        :form-error="formError"
        :sniff-error="sniffError"
        :session-error="session.state === 'error' ? (session.error || '') : ''"
        :label="label"
        :format-time="formatTime"
        :stream-kind-label="streamKindLabel"
        :candidate-subtitle="candidateSubtitle"
        @search-bilibili="searchBilibili"
        @play-bilibili="playBilibili"
        @queue-bilibili="queueBilibili"
        @bookmark-bilibili="bookmarkBilibili"
        @select-resource="selectResourceUrl"
        @sniff-resource="sniffResourceHit"
        @play-resource="playResourceHit"
        @queue-resource="queueResourceHit"
        @bookmark-resource="bookmarkResourceHit"
        @submit-url="submitUrl"
        @sniff-url="sniffMediaUrl"
        @queue-url="queueUrl"
        @bookmark-url="bookmarkUrl"
        @select-source-url="selectSourceSiteUrl"
        @source-sniff="applySourceSiteSniff"
        @play-candidate="playCandidate"
        @queue-candidate="queueCandidate"
        @bookmark-candidate="bookmarkCandidate"
      />

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

@media (max-width: 1080px) {
  .media-page {
    padding: 22px 18px 126px;
  }

  .media-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .page-head {
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

}
</style>
