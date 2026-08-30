<script setup lang="ts">
import type { ResourceSearchHit } from '@/api/resources'
import type { MediaCandidate, MediaItem, MediaSourceSite } from '@/features/media/types'
import BilibiliSearchPanel from '@/components/media/BilibiliSearchPanel.vue'
import MediaUrlSniffPanel from '@/components/media/MediaUrlSniffPanel.vue'
import ResourceSearchPanel from '@/components/resources/ResourceSearchPanel.vue'

defineProps<{
  biliKeyword: string
  biliLoading: boolean
  biliError: string
  biliResults: MediaItem[]
  resolvingId: string
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
  formatTime: (totalSeconds: number) => string
  streamKindLabel: (kind: string) => string
  candidateSubtitle: (candidate: MediaCandidate) => string
}>()

defineEmits<{
  'update:biliKeyword': [value: string]
  'update:url': [value: string]
  'update:title': [value: string]
  'update:artist': [value: string]
  searchBilibili: []
  playBilibili: [item: MediaItem]
  queueBilibili: [item: MediaItem]
  bookmarkBilibili: [item: MediaItem]
  selectResource: [url: string]
  sniffResource: [hit: ResourceSearchHit]
  playResource: [hit: ResourceSearchHit]
  queueResource: [hit: ResourceSearchHit]
  bookmarkResource: [hit: ResourceSearchHit]
  submitUrl: []
  sniffUrl: []
  queueUrl: []
  bookmarkUrl: []
  selectSourceUrl: [url: string]
  sourceSniff: [payload: { site: MediaSourceSite; candidates: MediaCandidate[] }]
  playCandidate: [candidate: MediaCandidate]
  queueCandidate: [candidate: MediaCandidate]
  bookmarkCandidate: [candidate: MediaCandidate]
}>()
</script>

<template>
  <section class="panel source-panel">
    <BilibiliSearchPanel
      :keyword="biliKeyword"
      :loading="biliLoading"
      :error="biliError"
      :results="biliResults"
      :resolving-id="resolvingId"
      :label="label"
      :format-time="formatTime"
      @update:keyword="$emit('update:biliKeyword', $event)"
      @search="$emit('searchBilibili')"
      @play="$emit('playBilibili', $event)"
      @queue="$emit('queueBilibili', $event)"
      @bookmark="$emit('bookmarkBilibili', $event)"
    />

    <div class="source-divider">
      <span>{{ label('互联网资源', 'Internet Resources') }}</span>
    </div>

    <ResourceSearchPanel
      @select="$emit('selectResource', $event)"
      @sniff="$emit('sniffResource', $event)"
      @play="$emit('playResource', $event)"
      @queue="$emit('queueResource', $event)"
      @bookmark="$emit('bookmarkResource', $event)"
    />

    <MediaUrlSniffPanel
      :url="url"
      :title="title"
      :artist="artist"
      :sniff-loading="sniffLoading"
      :candidates="candidates"
      :preparing-candidate-id="preparingCandidateId"
      :form-error="formError"
      :sniff-error="sniffError"
      :session-error="sessionError"
      :label="label"
      :stream-kind-label="streamKindLabel"
      :candidate-subtitle="candidateSubtitle"
      @update:url="$emit('update:url', $event)"
      @update:title="$emit('update:title', $event)"
      @update:artist="$emit('update:artist', $event)"
      @submit="$emit('submitUrl')"
      @sniff="$emit('sniffUrl')"
      @queue="$emit('queueUrl')"
      @bookmark="$emit('bookmarkUrl')"
      @select-source-url="$emit('selectSourceUrl', $event)"
      @source-sniff="$emit('sourceSniff', $event)"
      @play-candidate="$emit('playCandidate', $event)"
      @queue-candidate="$emit('queueCandidate', $event)"
      @bookmark-candidate="$emit('bookmarkCandidate', $event)"
    />
  </section>
</template>

<style scoped>
.panel {
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 16px;
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
</style>
