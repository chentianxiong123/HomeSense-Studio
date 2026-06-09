<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mediaApi } from '@/api/media'
import { useLocale } from '@/composables/useLocale'
import type { MediaCandidate, MediaSourceSite, MediaSourceSiteKind } from '@/features/media/types'

const props = defineProps<{
  currentUrl?: string
}>()

const emit = defineEmits<{
  (event: 'select', url: string): void
  (event: 'sniff', payload: { site: MediaSourceSite; candidates: MediaCandidate[] }): void
}>()

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const sites = ref<MediaSourceSite[]>([])
const loading = ref(false)
const saving = ref(false)
const sniffingId = ref<number | null>(null)
const error = ref('')
const titleInput = ref('')
const tagInput = ref('')

onMounted(() => {
  void loadSites()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function loadSites() {
  loading.value = true
  error.value = ''
  try {
    const result = await mediaApi.listSourceSites()
    sites.value = result.sites
  } catch (err) {
    sites.value = []
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function saveCurrentUrl() {
  const url = String(props.currentUrl || '').trim()
  error.value = ''
  if (!url) {
    error.value = label('先输入一个网站 URL', 'Enter a site URL first')
    return
  }
  try {
    new URL(url)
  } catch {
    error.value = label('URL 格式不正确', 'Invalid URL')
    return
  }

  saving.value = true
  try {
    const result = await mediaApi.addSourceSite({
      title: titleInput.value.trim() || undefined,
      url,
      kind: inferKind(url),
      tags: parseTags(tagInput.value),
    })
    sites.value = [result.site, ...sites.value.filter((site) => site.id !== result.site.id)]
    titleInput.value = ''
    tagInput.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function sniffSite(site: MediaSourceSite) {
  sniffingId.value = site.id
  error.value = ''
  try {
    const result = await mediaApi.sniffSourceSite(site.id)
    if (result.site) {
      sites.value = sites.value.map((item) => item.id === result.site?.id ? result.site : item)
    }
    if (result.status !== 'success' || !result.data) {
      error.value = result.message || result.error || label('嗅探失败', 'Sniff failed')
      return
    }
    emit('select', site.url)
    emit('sniff', { site: result.site || site, candidates: result.data.candidates })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    sniffingId.value = null
  }
}

async function removeSite(site: MediaSourceSite) {
  error.value = ''
  try {
    await mediaApi.removeSourceSite(site.id)
    sites.value = sites.value.filter((item) => item.id !== site.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function selectSite(site: MediaSourceSite) {
  emit('select', site.url)
}

function kindLabel(kind: MediaSourceSiteKind): string {
  const map: Record<MediaSourceSiteKind, string> = {
    page: label('页面', 'Page'),
    channel: label('频道', 'Channel'),
    playlist: label('列表', 'Playlist'),
    search: label('搜索', 'Search'),
    custom: label('自定义', 'Custom'),
  }
  return map[kind]
}

function siteSubtitle(site: MediaSourceSite): string {
  const parts = [site.provider, kindLabel(site.kind)]
  if (typeof site.last_candidates_count === 'number') {
    parts.push(label(`${site.last_candidates_count} 个候选`, `${site.last_candidates_count} candidates`))
  }
  return parts.filter(Boolean).join(' · ')
}

function inferKind(url: string): MediaSourceSiteKind {
  const lowered = url.toLowerCase()
  if (lowered.includes('playlist') || lowered.includes('list=')) return 'playlist'
  if (lowered.includes('channel') || lowered.includes('/space/') || lowered.includes('/u/')) return 'channel'
  if (lowered.includes('search') || lowered.includes('keyword=')) return 'search'
  return 'page'
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(/[,\s，]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 8)
}
</script>

<template>
  <section class="source-sites">
    <div class="source-sites-head">
      <div>
        <span class="eyebrow inline">{{ label('网站库', 'Sites') }}</span>
        <h3>{{ label('媒体来源', 'Media Sources') }}</h3>
      </div>
      <button class="plain-btn" type="button" :disabled="loading" @click="loadSites">
        {{ loading ? label('刷新中', 'Loading') : label('刷新', 'Refresh') }}
      </button>
    </div>

    <div class="save-form">
      <input v-model="titleInput" type="text" :placeholder="label('名称，可选', 'Name, optional')" autocomplete="off" />
      <input v-model="tagInput" type="text" :placeholder="label('标签，可选', 'Tags, optional')" autocomplete="off" />
      <button class="primary-btn" type="button" :disabled="saving" @click="saveCurrentUrl">
        {{ saving ? label('保存中', 'Saving') : label('保存当前 URL', 'Save URL') }}
      </button>
    </div>

    <p v-if="error" class="notice warn">{{ error }}</p>

    <div v-if="sites.length > 0" class="site-list">
      <div v-for="site in sites" :key="site.id" class="site-row">
        <button class="site-main" type="button" @click="selectSite(site)">
          <strong>{{ site.title }}</strong>
          <small>{{ siteSubtitle(site) }}</small>
        </button>
        <div class="row-actions">
          <button class="row-icon" type="button" :disabled="sniffingId === site.id" :title="label('嗅探', 'Sniff')" @click="sniffSite(site)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('删除', 'Remove')" @click="removeSite(site)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div v-else class="empty-line">{{ label('暂无保存的网站', 'No saved sites') }}</div>
  </section>
</template>

<style scoped>
.source-sites {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-sites-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
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
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0;
}

.save-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
}

.save-form input {
  min-width: 0;
  height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 750;
  outline: none;
  padding: 0 10px;
}

.save-form input:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
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
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.plain-btn {
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

.notice.warn {
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.site-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}

.site-row,
.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.site-row {
  min-height: 54px;
  padding: 7px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.site-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  cursor: pointer;
}

.site-main strong,
.site-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-main strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.site-main small {
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
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.empty-line {
  padding: 18px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

@media (max-width: 700px) {
  .source-sites-head {
    align-items: stretch;
    flex-direction: column;
  }

  .save-form {
    grid-template-columns: 1fr;
  }

  .site-row {
    grid-template-columns: 1fr;
  }

  .site-row .row-actions {
    justify-content: flex-end;
  }
}
</style>
