<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mediaApi, type BilibiliFavoriteFolder } from '@/api/media'
import type { MediaItem } from '@/features/media/types'

defineProps<{
  resolvingId: string
  label: (zh: string, en: string) => string
  formatTime: (seconds: number) => string
  providerName?: string
}>()

const emit = defineEmits<{
  play: [item: MediaItem]
  queue: [item: MediaItem]
  bookmark: [item: MediaItem]
}>()

const folders = ref<BilibiliFavoriteFolder[]>([])
const selectedFolderId = ref<number | null>(null)
const items = ref<MediaItem[]>([])
const loadingFolders = ref(false)
const loadingItems = ref(false)
const error = ref('')
const page = ref(1)
const hasMore = ref(false)

async function loadFolders() {
  loadingFolders.value = true
  error.value = ''
  try {
    const result = await mediaApi.bilibiliFavoriteFolders()
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'Bilibili favorites failed')
    folders.value = result.data.folders
    if (!selectedFolderId.value && folders.value[0]) {
      selectedFolderId.value = folders.value[0].id
      await loadItems(true)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingFolders.value = false
  }
}

async function selectFolder(folderId: number) {
  if (selectedFolderId.value === folderId) return
  selectedFolderId.value = folderId
  await loadItems(true)
}

async function loadItems(reset = false) {
  if (!selectedFolderId.value) return
  loadingItems.value = true
  error.value = ''
  try {
    const nextPage = reset ? 1 : page.value + 1
    const result = await mediaApi.bilibiliFavoriteMedias(selectedFolderId.value, nextPage, 20)
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'Bilibili favorite medias failed')
    page.value = nextPage
    hasMore.value = result.data.has_more
    items.value = reset ? result.data.items : [...items.value, ...result.data.items]
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingItems.value = false
  }
}

onMounted(loadFolders)
</script>

<template>
  <section class="bili-favorites">
    <div class="section-head">
      <div>
        <span class="eyebrow inline">{{ providerName || 'Bilibili' }}</span>
        <h3>{{ label('Bilibili 收藏夹', 'Bilibili Favorites') }}</h3>
      </div>
      <button class="plain-btn" type="button" :disabled="loadingFolders" @click="loadFolders">
        {{ loadingFolders ? label('读取中', 'Loading') : label('刷新', 'Refresh') }}
      </button>
    </div>

    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="folders.length > 0" class="folder-tabs">
      <button
        v-for="folder in folders"
        :key="folder.id"
        type="button"
        :class="{ active: folder.id === selectedFolderId }"
        @click="selectFolder(folder.id)"
      >
        {{ folder.title }}
        <small>{{ folder.media_count }}</small>
      </button>
    </div>

    <div v-if="items.length > 0" class="favorite-results">
      <div v-for="item in items" :key="item.id" class="favorite-row">
        <img v-if="item.cover" :src="item.cover" :alt="item.title" referrerpolicy="no-referrer" />
        <button class="favorite-main" type="button" @click="emit('play', item)">
          <strong>{{ item.title }}</strong>
          <small>{{ item.artist || providerName || label('音乐来源', 'Music source') }} · {{ formatTime(item.duration_sec || 0) }}</small>
        </button>
        <div class="row-actions">
          <button class="row-icon" type="button" :title="label('收藏到本地', 'Bookmark locally')" @click="emit('bookmark', item)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('加入队列', 'Add to queue')" @click="emit('queue', item)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="resolvingId === item.id" :title="label('播放', 'Play')" @click="emit('play', item)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      </div>
      <button v-if="hasMore" class="plain-btn load-more" type="button" :disabled="loadingItems" @click="loadItems(false)">
        {{ loadingItems ? label('加载中', 'Loading') : label('加载更多', 'Load more') }}
      </button>
    </div>

    <div v-else class="empty-line">
      {{ loadingItems || loadingFolders ? label('加载中', 'Loading') : label('登录 Bilibili 后可读取收藏夹。', 'Login to Bilibili to read favorite folders.') }}
    </div>
  </section>
</template>

<style scoped>
.bili-favorites {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
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

h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
}

.folder-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.folder-tabs button {
  min-height: 32px;
  border: 1px solid #dbe3ec;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  white-space: nowrap;
}

.folder-tabs button.active {
  border-color: #0f766e;
  background: #ecfeff;
  color: #0f766e;
}

.folder-tabs small {
  color: inherit;
  opacity: 0.72;
}

.favorite-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}

.favorite-row {
  min-height: 58px;
  padding: 7px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.favorite-row img {
  width: 64px;
  height: 42px;
  border-radius: 6px;
  object-fit: cover;
  background: #e6fffb;
}

.favorite-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}

.favorite-main strong,
.favorite-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-main strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.favorite-main small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-icon {
  width: 30px;
  height: 30px;
  border: 1px solid #dbe3ec;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.plain-btn {
  min-height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  padding: 0 11px;
}

.load-more {
  align-self: center;
}

.notice {
  margin: 0;
  padding: 9px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 800;
}

.notice.error {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.empty-line {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-align: center;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 700px) {
  .favorite-row {
    grid-template-columns: 1fr;
  }

  .favorite-row img {
    display: none;
  }
}
</style>
