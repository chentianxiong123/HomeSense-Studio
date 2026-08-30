<script setup lang="ts">
import MediaSourceSitesPanel from '@/components/media/MediaSourceSitesPanel.vue'
import type { MediaCandidate, MediaSourceSite } from '@/features/media/types'

defineProps<{
  url: string
  title: string
  artist: string
  sniffLoading: boolean
  candidates: MediaCandidate[]
  preparingCandidateId: string
  formError: string
  sniffError: string
  sessionError: string
  label: (zh: string, en: string) => string
  streamKindLabel: (kind: string) => string
  candidateSubtitle: (candidate: MediaCandidate) => string
}>()

const emit = defineEmits<{
  'update:url': [value: string]
  'update:title': [value: string]
  'update:artist': [value: string]
  submit: []
  sniff: []
  queue: []
  bookmark: []
  'select-source-url': [url: string]
  'source-sniff': [payload: { site: MediaSourceSite; candidates: MediaCandidate[] }]
  'play-candidate': [candidate: MediaCandidate]
  'queue-candidate': [candidate: MediaCandidate]
  'bookmark-candidate': [candidate: MediaCandidate]
}>()
</script>

<template>
  <div class="source-divider">
    <span>{{ label('直连 URL', 'Direct URL') }}</span>
  </div>

  <MediaSourceSitesPanel
    :current-url="url"
    @select="emit('select-source-url', $event)"
    @sniff="emit('source-sniff', $event)"
  />

  <div class="source-divider">
    <span>URL</span>
  </div>

  <form class="url-form" @submit.prevent="emit('submit')">
    <label class="form-field full">
      <span>URL</span>
      <input
        :value="url"
        type="url"
        placeholder="https://..."
        autocomplete="off"
        @input="emit('update:url', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label class="form-field">
      <span>{{ label('标题', 'Title') }}</span>
      <input
        :value="title"
        type="text"
        :placeholder="label('可选', 'Optional')"
        autocomplete="off"
        @input="emit('update:title', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label class="form-field">
      <span>{{ label('作者', 'Artist') }}</span>
      <input
        :value="artist"
        type="text"
        :placeholder="label('可选', 'Optional')"
        autocomplete="off"
        @input="emit('update:artist', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <div class="form-actions full">
      <button class="plain-btn" type="button" :disabled="sniffLoading" @click="emit('sniff')">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {{ sniffLoading ? label('嗅探中', 'Sniffing') : label('嗅探', 'Sniff') }}
      </button>
      <button class="plain-btn" type="button" @click="emit('queue')">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        {{ label('加入队列', 'Add') }}
      </button>
      <button class="plain-btn" type="button" @click="emit('bookmark')">
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

  <div v-if="candidates.length > 0" class="candidate-list">
    <div v-for="candidate in candidates" :key="candidate.id" class="candidate-row">
      <span class="candidate-kind">{{ streamKindLabel(candidate.stream_kind || candidate.kind) }}</span>
      <button class="candidate-main" type="button" @click="emit('play-candidate', candidate)">
        <strong>{{ candidate.title }}</strong>
        <small>{{ candidateSubtitle(candidate) }}</small>
      </button>
      <div class="row-actions">
        <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('收藏', 'Bookmark')" @click="emit('bookmark-candidate', candidate)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m12 17.3-6.2 3.4 1.2-7.1-5.1-5 7.1-1L12 1.2l3.1 6.4 7.1 1-5.1 5 1.2 7.1z" />
          </svg>
        </button>
        <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('加入队列', 'Add to queue')" @click="emit('queue-candidate', candidate)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <button class="row-icon" type="button" :disabled="preparingCandidateId === candidate.id" :title="label('播放', 'Play')" @click="emit('play-candidate', candidate)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <p v-if="formError" class="notice error">{{ formError }}</p>
  <p v-if="sniffError" class="notice warn">{{ sniffError }}</p>
  <p v-if="sessionError" class="notice error">{{ sessionError }}</p>
</template>

<style scoped>
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

.url-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

.form-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.primary-btn,
.plain-btn,
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

@media (max-width: 700px) {
  .url-form,
  .form-actions {
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
