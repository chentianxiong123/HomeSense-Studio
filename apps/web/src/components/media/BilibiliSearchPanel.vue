<script setup lang="ts">
import type { MediaItem } from '@/features/media/types'

defineProps<{
  keyword: string
  loading: boolean
  error: string
  results: MediaItem[]
  resolvingId: string
  label: (zh: string, en: string) => string
  formatTime: (seconds: number) => string
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  search: []
  play: [item: MediaItem]
  queue: [item: MediaItem]
  bookmark: [item: MediaItem]
}>()
</script>

<template>
  <div class="panel-head">
    <div>
      <span class="eyebrow inline">{{ label('来源', 'Source') }}</span>
      <h2>Bilibili</h2>
    </div>
  </div>

  <form class="search-form" @submit.prevent="emit('search')">
    <input
      :value="keyword"
      type="search"
      :placeholder="label('搜索音乐或视频', 'Search media')"
      autocomplete="off"
      @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
    />
    <button class="primary-btn" type="submit" :disabled="loading">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      {{ loading ? label('搜索中', 'Searching') : label('搜索', 'Search') }}
    </button>
  </form>

  <p v-if="error" class="notice error">{{ error }}</p>

  <div v-if="results.length > 0" class="media-results">
    <div v-for="result in results" :key="result.id" class="result-row">
      <img v-if="result.cover" :src="result.cover" :alt="result.title" referrerpolicy="no-referrer" />
      <span v-else class="result-cover-fallback" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </span>
      <button class="result-main" type="button" @click="emit('play', result)">
        <strong>{{ result.title }}</strong>
        <small>{{ result.artist || 'Bilibili' }} · {{ formatTime(result.duration_sec || 0) }}</small>
      </button>
      <div class="row-actions">
        <button class="row-icon" type="button" :title="label('收藏', 'Bookmark')" @click="emit('bookmark', result)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
          </svg>
        </button>
        <button class="row-icon" type="button" :title="label('加入队列', 'Add to queue')" @click="emit('queue', result)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <button class="row-icon" type="button" :disabled="resolvingId === result.id" :title="label('播放', 'Play')" @click="emit('play', result)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
