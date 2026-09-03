<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mediaApi } from '@/api/media'
import { useLocale } from '@/composables/useLocale'
import type { MediaBookmark, MediaItem } from '@/features/media/types'

const emit = defineEmits<{
  (event: 'play', item: MediaBookmark): void
  (event: 'queue', item: MediaBookmark): void
}>()

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const bookmarks = ref<MediaBookmark[]>([])
const loading = ref(false)
const error = ref('')
const query = ref('')
const favoriteOnly = ref(false)
const savingId = ref('')

onMounted(() => {
  void loadBookmarks()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function loadBookmarks() {
  loading.value = true
  error.value = ''
  try {
    const result = await mediaApi.listBookmarks({
      q: query.value.trim() || undefined,
      favorite: favoriteOnly.value ? true : undefined,
    })
    bookmarks.value = result.bookmarks
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function saveItem(item: MediaItem, tags: string[] = [], favorite = true) {
  savingId.value = item.id
  error.value = ''
  try {
    await mediaApi.addBookmark({ ...item, tags, favorite })
    await loadBookmarks()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingId.value = ''
  }
}

async function toggleFavorite(bookmark: MediaBookmark) {
  savingId.value = bookmark.id
  error.value = ''
  try {
    const result = await mediaApi.updateBookmark(bookmark.id, { favorite: !bookmark.favorite })
    bookmarks.value = bookmarks.value.map((item) => item.id === bookmark.id ? result.bookmark : item)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingId.value = ''
  }
}

async function removeBookmark(bookmark: MediaBookmark) {
  savingId.value = bookmark.id
  error.value = ''
  try {
    await mediaApi.removeBookmark(bookmark.id)
    bookmarks.value = bookmarks.value.filter((item) => item.id !== bookmark.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingId.value = ''
  }
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

function itemMeta(item: MediaBookmark): string {
  return [
    sourceLabel(item.source),
    item.artist,
    item.play_count > 0 ? label(`播放 ${item.play_count} 次`, `${item.play_count} plays`) : '',
  ].filter(Boolean).join(' · ')
}

function play(bookmark: MediaBookmark) {
  emit('play', bookmark)
  void markPlayed(bookmark)
}

function queue(bookmark: MediaBookmark) {
  emit('queue', bookmark)
}

async function markPlayed(bookmark: MediaBookmark) {
  try {
    const result = await mediaApi.markBookmarkPlayed(bookmark.id)
    bookmarks.value = bookmarks.value.map((item) => item.id === bookmark.id ? result.bookmark : item)
  } catch (err) {
    console.warn('failed to mark media bookmark played', err)
  }
}

defineExpose({
  reload: loadBookmarks,
  saveItem,
})
</script>

<template>
  <section class="bookmarks-panel">
    <div class="bookmarks-head">
      <div>
        <span class="eyebrow inline">{{ label('收藏', 'Library') }}</span>
        <h2>{{ label('媒体收藏', 'Media Bookmarks') }}</h2>
      </div>
      <button class="plain-btn" type="button" :disabled="loading" :title="label('刷新', 'Refresh')" @click="loadBookmarks">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <form class="bookmark-tools" @submit.prevent="loadBookmarks">
      <input v-model="query" type="search" :placeholder="label('搜索收藏', 'Search bookmarks')" autocomplete="off" />
      <button class="toggle-btn" type="button" :class="{ active: favoriteOnly }" @click="favoriteOnly = !favoriteOnly; loadBookmarks()">
        <svg viewBox="0 0 24 24" width="15" height="15" :fill="favoriteOnly ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
        </svg>
      </button>
    </form>

    <p v-if="error" class="notice error">{{ error }}</p>

    <div v-if="bookmarks.length > 0" class="bookmark-list">
      <div v-for="bookmark in bookmarks" :key="bookmark.id" class="bookmark-row">
        <img v-if="bookmark.cover" :src="bookmark.cover" :alt="bookmark.title" referrerpolicy="no-referrer" />
        <span v-else class="cover-fallback" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </span>
        <button class="bookmark-main" type="button" @click="play(bookmark)">
          <strong>{{ bookmark.title }}</strong>
          <small>{{ itemMeta(bookmark) }}</small>
        </button>
        <div class="row-actions">
          <button class="row-icon" type="button" :disabled="savingId === bookmark.id" :title="label('星标', 'Favorite')" @click="toggleFavorite(bookmark)">
            <svg viewBox="0 0 24 24" width="15" height="15" :fill="bookmark.favorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('加入队列', 'Add to queue')" @click="queue(bookmark)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="savingId === bookmark.id" :title="label('删除', 'Remove')" @click="removeBookmark(bookmark)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="empty-line">
      {{ loading ? label('加载中', 'Loading') : label('暂无收藏', 'No bookmarks') }}
    </div>
  </section>
</template>

<style scoped>
.bookmarks-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bookmarks-head {
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

h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
}

.bookmark-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
  gap: 8px;
}

.bookmark-tools input {
  min-width: 0;
  height: 38px;
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

.bookmark-tools input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
}

.plain-btn,
.toggle-btn,
.row-icon {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.plain-btn {
  width: 38px;
  height: 38px;
}

.toggle-btn {
  width: 38px;
  height: 38px;
}

.toggle-btn.active {
  border-color: #0f766e;
  background: #f0fdfa;
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

.bookmark-list {
  max-height: 360px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bookmark-row,
.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.bookmark-row {
  min-height: 58px;
  padding: 7px;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.bookmark-row img,
.cover-fallback {
  width: 58px;
  height: 42px;
  border-radius: 6px;
  background: #e6fffb;
  object-fit: cover;
}

.cover-fallback {
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.bookmark-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}

.bookmark-main strong,
.bookmark-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-main strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.bookmark-main small {
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
  width: 32px;
  height: 32px;
}

.empty-line {
  padding: 24px 18px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

@media (max-width: 700px) {
  .bookmark-row {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .bookmark-row img,
  .cover-fallback {
    width: 48px;
    height: 38px;
  }

  .row-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
