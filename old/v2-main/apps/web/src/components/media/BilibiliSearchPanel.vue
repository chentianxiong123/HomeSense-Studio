<script setup lang="ts">
import type { MediaItem } from '@/features/media/types'

withDefaults(defineProps<{
  keyword: string
  loading: boolean
  error: string
  results: MediaItem[]
  resolvingId: string
  label: (zh: string, en: string) => string
  formatTime: (seconds: number) => string
  eyebrow?: string
  title?: string
  placeholder?: string
  providerName?: string
  description?: string
}>(), {
  eyebrow: '',
  title: '',
  placeholder: '',
  providerName: '',
  description: '',
})

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
      <span class="eyebrow inline">{{ eyebrow || label('来源', 'Source') }}</span>
      <h2>{{ title || label('在线搜索', 'Online Search') }}</h2>
      <p v-if="description" class="panel-description">{{ description }}</p>
    </div>
  </div>

  <form class="search-form" @submit.prevent="emit('search')">
    <input
      :value="keyword"
      type="search"
      :placeholder="placeholder || label('搜索音乐或视频', 'Search media')"
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
        <small>{{ result.artist || providerName || label('在线来源', 'Online source') }} · {{ formatTime(result.duration_sec || 0) }}</small>
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

<style scoped>
.panel-head {
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

.panel-description {
  margin: 7px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.6;
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

.primary-btn,
.row-icon {
  border-radius: 8px;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.primary-btn {
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
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

.media-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
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

.row-icon {
  width: 32px;
  height: 32px;
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 700px) {
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .search-form {
    grid-template-columns: 1fr;
  }
}
</style>
