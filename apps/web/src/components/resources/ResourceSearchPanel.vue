<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { resourcesApi, type ResourceSearchHit, type ResourceSourceKind, type ResourceSourceRecord } from '@/api/resources'
import { useLocale } from '@/composables/useLocale'

const emit = defineEmits<{
  (event: 'select', url: string): void
  (event: 'sniff', hit: ResourceSearchHit): void
}>()

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const sources = ref<ResourceSourceRecord[]>([])
const hits = ref<ResourceSearchHit[]>([])
const query = ref('')
const sourceName = ref('')
const sourceKind = ref<ResourceSourceKind>('html')
const sourceTemplate = ref('')
const sourceInclude = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')

onMounted(() => {
  void loadSources()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function loadSources() {
  loading.value = true
  error.value = ''
  try {
    const result = await resourcesApi.listSources()
    sources.value = result.sources
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function addSource() {
  const name = sourceName.value.trim()
  const template = sourceTemplate.value.trim()
  error.value = ''
  if (!name || !template) {
    error.value = label('请输入源名称和搜索模板', 'Enter source name and search template')
    return
  }
  saving.value = true
  try {
    await resourcesApi.createSource({
      name,
      kind: sourceKind.value,
      enabled: true,
      definition: {
        search_url_template: template,
        ...(sourceInclude.value.trim() ? { result_url_include: sourceInclude.value.trim() } : {}),
      },
    })
    sourceName.value = ''
    sourceTemplate.value = ''
    sourceInclude.value = ''
    await loadSources()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function toggleSource(source: ResourceSourceRecord) {
  error.value = ''
  try {
    const result = await resourcesApi.updateSource(source.id, { enabled: !source.enabled })
    sources.value = sources.value.map((item) => item.id === source.id ? result.source : item)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function removeSource(source: ResourceSourceRecord) {
  error.value = ''
  try {
    await resourcesApi.removeSource(source.id)
    sources.value = sources.value.filter((item) => item.id !== source.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function searchResources() {
  const term = query.value.trim()
  error.value = ''
  hits.value = []
  if (!term) {
    error.value = label('请输入搜索词', 'Enter a search query')
    return
  }
  const enabledIds = sources.value.filter((source) => source.enabled).map((source) => source.id)
  if (enabledIds.length === 0) {
    error.value = label('请先添加并启用资源源', 'Add and enable a resource source first')
    return
  }
  loading.value = true
  try {
    const result = await resourcesApi.search({ query: term, source_ids: enabledIds, limit: 24, normalize: true, normalize_limit: 10 })
    hits.value = result.result.hits
    if (result.result.hits.length === 0) {
      error.value = label('没有找到结果', 'No results found')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function kindLabel(kind: string) {
  const map: Record<string, string> = {
    page: label('页面', 'Page'),
    video: label('视频', 'Video'),
    audio: label('音频', 'Audio'),
    image: label('图片', 'Image'),
    book: label('书籍', 'Book'),
    file: label('文件', 'File'),
    html: 'HTML',
    json: 'JSON',
  }
  return map[kind] ?? kind
}

function resultMeta(hit: ResourceSearchHit): string {
  return [
    hit.site_name || hit.source_name,
    kindLabel(hit.kind),
    `${Math.round(hit.confidence * 100)}%`,
    hit.media_candidates?.length ? label(`${hit.media_candidates.length} 个候选`, `${hit.media_candidates.length} candidates`) : '',
  ].filter(Boolean).join(' · ')
}

function signalLabel(signal: string): string {
  const map: Record<string, string> = {
    open_graph: 'OG',
    schema_org: 'Schema',
    media_candidate: label('媒体', 'Media'),
    direct_media: label('直链', 'Direct'),
  }
  return map[signal] ?? signal
}

function primaryUrl(hit: ResourceSearchHit): string {
  const direct = hit.media_candidates?.find((candidate) => candidate.kind !== 'embed')
  return direct?.url || hit.url
}
</script>

<template>
  <section class="resource-search">
    <div class="resource-head">
      <div>
        <span class="eyebrow inline">{{ label('聚合', 'Aggregate') }}</span>
        <h2>{{ label('互联网资源', 'Internet Resources') }}</h2>
      </div>
      <button class="plain-icon" type="button" :disabled="loading" :title="label('刷新源', 'Refresh sources')" @click="loadSources">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <form class="resource-form" @submit.prevent="searchResources">
      <input v-model="query" type="search" :placeholder="label('搜索已配置源', 'Search configured sources')" autocomplete="off" />
      <button class="primary-btn" type="submit" :disabled="loading">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        {{ loading ? label('搜索中', 'Searching') : label('搜索', 'Search') }}
      </button>
    </form>

    <details class="source-editor">
      <summary>{{ label('资源源', 'Sources') }} · {{ sources.length }}</summary>
      <div class="source-list">
        <div v-for="source in sources" :key="source.id" class="source-row" :class="{ disabled: !source.enabled }">
          <button class="source-main" type="button" @click="toggleSource(source)">
            <strong>{{ source.name }}</strong>
            <small>{{ kindLabel(source.kind) }} · {{ source.enabled ? label('启用', 'Enabled') : label('停用', 'Disabled') }}</small>
          </button>
          <button class="plain-icon" type="button" :title="label('删除', 'Remove')" @click="removeSource(source)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      <form class="add-source-form" @submit.prevent="addSource">
        <input v-model="sourceName" type="text" :placeholder="label('源名称', 'Source name')" autocomplete="off" />
        <select v-model="sourceKind">
          <option value="html">HTML</option>
          <option value="json">JSON</option>
        </select>
        <input v-model="sourceTemplate" class="full" type="url" placeholder="https://example.com/search?q={{query}}" autocomplete="off" />
        <input v-model="sourceInclude" class="full" type="text" :placeholder="label('URL 包含正则，可选', 'URL include regex, optional')" autocomplete="off" />
        <button class="plain-btn full" type="submit" :disabled="saving">
          {{ saving ? label('保存中', 'Saving') : label('添加源', 'Add source') }}
        </button>
      </form>
    </details>

    <p v-if="error" class="notice warn">{{ error }}</p>

    <div v-if="hits.length > 0" class="hit-list">
      <div v-for="hit in hits" :key="hit.id" class="hit-row">
        <img v-if="hit.cover" :src="hit.cover" :alt="hit.title" referrerpolicy="no-referrer" />
        <span v-else class="kind-chip">{{ kindLabel(hit.kind) }}</span>
        <button class="hit-main" type="button" @click="emit('select', primaryUrl(hit))">
          <strong>{{ hit.title }}</strong>
          <small>{{ resultMeta(hit) }}</small>
          <span v-if="hit.snippet" class="hit-snippet">{{ hit.snippet }}</span>
          <span v-if="hit.signals?.length" class="signal-row">
            <span v-for="signal in hit.signals" :key="signal">{{ signalLabel(signal) }}</span>
          </span>
        </button>
        <div class="row-actions">
          <button class="plain-icon" type="button" :title="label('使用 URL', 'Use URL')" @click="emit('select', primaryUrl(hit))">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93" />
              <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07" />
            </svg>
          </button>
          <button class="plain-icon" type="button" :title="label('嗅探页面', 'Sniff page')" @click="emit('sniff', hit)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.resource-search {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.resource-head {
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

.resource-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.resource-form input,
.add-source-form input,
.add-source-form select {
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

.resource-form input:focus,
.add-source-form input:focus,
.add-source-form select:focus {
  border-color: #0f766e;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.1);
}

.primary-btn,
.plain-btn,
.plain-icon {
  border-radius: 8px;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.primary-btn,
.plain-btn {
  min-height: 38px;
  padding: 0 12px;
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

.plain-btn,
.plain-icon {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
}

.plain-icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.source-editor {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 10px;
}

.source-editor summary {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.source-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.source-row {
  min-height: 46px;
  padding: 6px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.source-row.disabled {
  opacity: 0.55;
}

.source-main,
.hit-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  cursor: pointer;
}

.source-main strong,
.source-main small,
.hit-main strong,
.hit-main small,
.hit-snippet {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-main strong,
.hit-main strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.source-main small,
.hit-main small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.hit-snippet {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.signal-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.signal-row span {
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #475569;
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 900;
}

.add-source-form {
  margin-top: 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 8px;
}

.add-source-form .full {
  grid-column: 1 / -1;
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

.hit-list {
  max-height: 300px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hit-row {
  min-height: 58px;
  padding: 7px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.hit-row img,
.kind-chip {
  width: 58px;
  height: 40px;
  border-radius: 6px;
}

.hit-row img {
  object-fit: cover;
}

.kind-chip {
  background: #f0fdfa;
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 700px) {
  .resource-form,
  .add-source-form {
    grid-template-columns: 1fr;
  }

  .hit-row {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .hit-row img,
  .kind-chip {
    width: 48px;
    height: 38px;
  }

  .row-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
