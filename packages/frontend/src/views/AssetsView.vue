<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { agentApi } from '@/api/agents'
import { executorApi } from '@/api/executor'
import { manifestApi } from '@/api/manifests'
import { skillApi } from '@/api/skills'
import {
  buildAssetRecords,
  buildAssetSummary,
  filterAssetsByKind,
  type AssetFilter,
  type AssetRecord,
} from '@/features/studio/assets'
import {
  buildAssetActionLinks,
  formatAssetBadge,
  buildAssetPreviewFacts,
  buildFilterCounts,
  formatAssetStatus,
} from '@/features/studio/assetWorkbench'
import { useLocale } from '@/composables/useLocale'

const router = useRouter()
const { locale } = useLocale()

const ASSET_FILTER_KEY = 'homesense-studio.assets.asset-filter'
const ASSET_SEARCH_KEY = 'homesense-studio.assets.asset-search'
const SELECTED_ASSET_KEY = 'homesense-studio.assets.selected-asset'

const loading = ref(false)
const errorMessage = ref('')
const filter = ref<AssetFilter>('all')
const search = ref('')
const selectedAssetId = ref('')
const assets = ref<AssetRecord[]>([])

const isZh = computed(() => locale.value === 'zh')

const filterOptions = computed(() => [
  { value: 'all', zh: '全部资产', en: 'All Assets' },
  { value: 'skill', zh: '技能', en: 'Skills' },
  { value: 'manifest', zh: '执行清单', en: 'Manifests' },
  { value: 'plan', zh: '计划', en: 'Plans' },
  { value: 'agent', zh: '智能体', en: 'Agents' },
])

const filteredAssets = computed(() => {
  const byKind = filterAssetsByKind(assets.value, filter.value)
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return byKind
  return byKind.filter((asset) => asset.searchText.includes(keyword))
})

const selectedAsset = computed(() =>
  filteredAssets.value.find((asset) => asset.id === selectedAssetId.value)
  ?? assets.value.find((asset) => asset.id === selectedAssetId.value)
  ?? filteredAssets.value[0]
  ?? assets.value[0]
  ?? null,
)

const summary = computed(() => buildAssetSummary(assets.value))
const filterCounts = computed(() => buildFilterCounts(assets.value))
const selectedAssetFacts = computed(() =>
  selectedAsset.value ? buildAssetPreviewFacts(selectedAsset.value, label) : [],
)
const selectedAssetActions = computed(() =>
  selectedAsset.value ? buildAssetActionLinks(selectedAsset.value, label) : [],
)

watch(filter, (value) => {
  window.localStorage.setItem(ASSET_FILTER_KEY, value)
})

watch(search, (value) => {
  window.localStorage.setItem(ASSET_SEARCH_KEY, value)
})

watch(selectedAsset, (asset) => {
  if (!asset) return
  selectedAssetId.value = asset.id
  window.localStorage.setItem(SELECTED_ASSET_KEY, asset.id)
})

onMounted(async () => {
  restorePreferences()
  await loadAssets()
})

async function loadAssets() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [skills, manifests, plans, agents] = await Promise.all([
      skillApi.list(),
      manifestApi.list(),
      executorApi.listPlans(),
      agentApi.list(),
    ])

    assets.value = buildAssetRecords({
      workflows: [],
      skills: skills.skills ?? [],
      manifests: manifests.manifests ?? [],
      plans: normalizePlans(plans.plans ?? []),
      agents: agents.instances ?? [],
    })

    const remembered = window.localStorage.getItem(SELECTED_ASSET_KEY)
    if (remembered && assets.value.some((asset) => asset.id === remembered)) {
      selectedAssetId.value = remembered
    } else if (assets.value[0]) {
      selectedAssetId.value = assets.value[0].id
    }
  } catch (error) {
    errorMessage.value = (error as Error).message || 'Failed to load assets.'
    assets.value = []
  } finally {
    loading.value = false
  }
}

function restorePreferences() {
  const savedFilter = window.localStorage.getItem(ASSET_FILTER_KEY)
  const savedSearch = window.localStorage.getItem(ASSET_SEARCH_KEY)
  const savedAsset = window.localStorage.getItem(SELECTED_ASSET_KEY)

  if (savedFilter === 'all' || savedFilter === 'skill' || savedFilter === 'manifest' || savedFilter === 'plan' || savedFilter === 'agent') {
    filter.value = savedFilter
  }
  if (savedSearch) search.value = savedSearch
  if (savedAsset) selectedAssetId.value = savedAsset
}

function normalizePlans(items: Array<Record<string, unknown>>) {
  return items.map((item) => ({
    id: String(item.id ?? ''),
    name: String(item.name ?? item.id ?? ''),
    description: String(item.description ?? ''),
    intent: String(item.intent ?? ''),
    input: String(item.input ?? ''),
    source: String(item.source ?? ''),
  }))
}

function selectAsset(asset: AssetRecord) {
  selectedAssetId.value = asset.id
}

function openAsset(asset: AssetRecord) {
  router.push(asset.route)
}

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function formatStatus(status: string) {
  return formatAssetStatus(status, label)
}

function safeStringify(value: unknown) {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <div class="assets-page">
    <section class="summary-strip">
      <div class="summary-card hero">
        <span class="summary-label">{{ label('资产中心', 'Asset Hub') }}</span>
        <strong>{{ label('技能 · 清单 · 计划 · 智能体', 'Skills · Manifests · Plans · Agents') }}</strong>
        <p>{{ label('统一浏览、筛选、预览和跳转非工作流资产。', 'Browse, filter, preview, and navigate non-workflow assets.') }}</p>
      </div>
      <div class="summary-card">
        <span class="summary-label">{{ label('技能 / 清单', 'Skill / Manifest') }}</span>
        <strong>{{ summary.skills + summary.manifests }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">{{ label('计划 / 智能体', 'Plan / Agent') }}</span>
        <strong>{{ summary.plans + summary.agents }}</strong>
      </div>
      <div class="summary-card highlight">
        <span class="summary-label">{{ label('已发布 / 就绪', 'Published / Ready') }}</span>
        <strong>{{ summary.published + summary.ready }}</strong>
      </div>
    </section>

    <section class="workbench">
      <aside class="asset-nav">
        <div class="nav-head">
          <h2>{{ label('资产筛选', 'Asset Filter') }}</h2>
          <button class="ghost-btn" @click="loadAssets">{{ label('刷新', 'Refresh') }}</button>
        </div>

        <div class="nav-caption">
          {{ label('技能、执行清单、计划和智能体。', 'Skills, manifests, plans, and agents.') }}
        </div>

        <button
          v-for="option in filterOptions"
          :key="option.value"
          :class="['asset-filter-btn', { active: filter === option.value }]"
          @click="filter = option.value as AssetFilter"
        >
          <span>{{ isZh ? option.zh : option.en }}</span>
          <span class="count">
            {{ filterCounts[option.value as AssetFilter] }}
          </span>
        </button>
      </aside>

      <main class="asset-table-area">
        <div class="asset-toolbar">
          <div>
            <h3>{{ label('资产列表', 'Asset List') }}</h3>
          </div>

          <div class="toolbar-actions">
            <div class="asset-count-pill">{{ filteredAssets.length }} / {{ summary.total }}</div>
            <input
              v-model="search"
              class="search-input"
              :placeholder="label('搜索名称、描述、能力', 'Search name, description, capability')"
            />
          </div>
        </div>

        <div v-if="errorMessage" class="empty-state error">{{ errorMessage }}</div>
        <div v-else-if="loading" class="empty-state">{{ label('资产加载中…', 'Loading assets…') }}</div>
        <div v-else-if="filteredAssets.length === 0" class="empty-state">{{ label('当前筛选下没有资产。', 'No assets under the current filter.') }}</div>
        <div v-else class="asset-table-shell">
          <table class="asset-table">
            <thead>
              <tr>
                <th>{{ label('类型', 'Type') }}</th>
                <th>{{ label('名称', 'Name') }}</th>
                <th>{{ label('状态', 'Status') }}</th>
                <th>{{ label('摘要', 'Summary') }}</th>
                <th>{{ label('动作', 'Action') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="asset in filteredAssets"
                :key="asset.id"
                :class="{ selected: selectedAsset?.id === asset.id }"
                @click="selectAsset(asset)"
              >
                <td>
                  <span class="asset-badge" :style="{ background: `${asset.accent}16`, color: asset.accent }">{{ formatAssetBadge(asset, label) }}</span>
                </td>
                <td>
                  <div class="asset-title">{{ asset.title }}</div>
                  <div class="asset-subtitle">{{ asset.subtitle }}</div>
                </td>
                <td><span class="status-chip">{{ formatStatus(asset.status) }}</span></td>
                <td class="asset-desc">{{ asset.description || asset.subtitle }}</td>
                <td>
                  <button class="open-btn" @click.stop="openAsset(asset)">{{ label('打开', 'Open') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>

      <aside class="preview-panel">
        <template v-if="selectedAsset">
          <div class="preview-head">
            <div>
              <span class="asset-badge" :style="{ background: `${selectedAsset.accent}16`, color: selectedAsset.accent }">{{ formatAssetBadge(selectedAsset, label) }}</span>
              <h3>{{ selectedAsset.title }}</h3>
              <p>{{ selectedAsset.description || selectedAsset.subtitle }}</p>
            </div>
            <button class="primary-btn" @click="openAsset(selectedAsset)">{{ label('进入详情', 'Open Detail') }}</button>
          </div>

          <div class="action-strip">
            <button
              v-for="action in selectedAssetActions"
              :key="action.route"
              :class="['preview-action-btn', { primary: action.route === selectedAsset.route }]"
              @click="router.push(action.route)"
            >
              {{ action.label }}
            </button>
          </div>

          <div class="preview-card">
            <div class="preview-card-head">
              <h4>{{ label('基础信息', 'Overview') }}</h4>
              <span>{{ formatStatus(selectedAsset.status) }}</span>
            </div>
            <div class="meta-grid dense">
              <div v-for="fact in selectedAssetFacts" :key="fact.label">
                <label>{{ fact.label }}</label>
                <span>{{ fact.value }}</span>
              </div>
            </div>
          </div>

          <div v-if="selectedAsset.meta" class="preview-card">
            <div class="preview-card-head">
              <h4>{{ label('结构化元数据', 'Structured Metadata') }}</h4>
            </div>
            <pre>{{ safeStringify(selectedAsset.meta) }}</pre>
          </div>
        </template>
        <div v-else class="empty-state">{{ label('选择一项资产查看右侧预览。', 'Select an asset to inspect the right preview panel.') }}</div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.assets-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 40px;
  background: #f7f9fa;
  overflow-y: auto;
}

.summary-strip {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.summary-card {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.summary-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.summary-card.highlight {
  border-color: rgba(16, 185, 129, 0.15);
  background: rgba(16, 185, 129, 0.05);
}

.summary-card.hero {
  background: rgba(255, 255, 255, 0.6);
}

.summary-label {
  display: inline-block;
  margin-bottom: 20px;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
}

.summary-card strong {
  display: block;
  font-size: 44px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.05em;
  line-height: 1;
}

.summary-card.hero strong {
  font-size: 40px;
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1.1;
}

.summary-card p {
  margin: 20px 0 0;
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 600px;
  letter-spacing: -0.01em;
}

.workbench {
  flex: 1;
  min-height: 840px;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 420px;
  gap: 32px;
}

.asset-nav,
.asset-table-area,
.preview-panel {
  min-height: 0;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.asset-nav {
  padding: 40px;
  display: flex;
  flex-direction: column;
}

.nav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
}

.nav-head h2 {
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.nav-caption {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.7;
  padding: 0 0 40px;
  opacity: 0.8;
  letter-spacing: -0.01em;
}

.ghost-btn,
.open-btn,
.primary-btn {
  height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  color: var(--text-primary);
}

.ghost-btn:hover {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.primary-btn {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
}

.primary-btn:hover {
  background: #059669;
  transform: translateY(-4px);
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.35);
  color: #fff;
}

.asset-filter-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: transparent;
  padding: 0 24px;
  cursor: pointer;
  text-align: left;
  color: var(--text-secondary);
  font-size: 16px;
  font-weight: 800;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  margin-bottom: 12px;
}

.asset-filter-btn:hover {
  background: rgba(255, 255, 255, 0.6);
  transform: translateX(12px);
}

.asset-filter-btn.active {
  background: #fff;
  color: #10b981;
  border-color: #10b981;
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.15);
  transform: translateX(16px);
}

.count {
  font-size: 14px;
  font-weight: 900;
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 14px;
  border-radius: 99px;
  color: var(--text-tertiary);
}

.asset-filter-btn.active .count {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.asset-toolbar {
  padding: 48px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.8);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.asset-toolbar h3 {
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 32px;
}

.asset-count-pill {
  height: 40px;
  padding: 0 20px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.search-input {
  width: 360px;
  height: 48px;
  padding: 0 24px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  font-size: 14px;
  font-weight: 800;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.8);
}

.search-input:focus {
  outline: none;
  border-color: #10b981;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.12);
  transform: translateY(-2px);
  background: #fff;
}

.asset-table th {
  padding: 24px 40px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  text-align: left;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

.asset-table td {
  padding: 32px 40px;
  border-top: 1px solid rgba(236, 239, 242, 0.6);
}

.asset-table tbody tr {
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.asset-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.6);
  transform: translateX(12px);
}

.asset-table tbody tr.selected {
  background: #fff;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.05);
  transform: translateX(16px);
  z-index: 1;
  position: relative;
}

.asset-title {
  font-size: 17px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.asset-subtitle {
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 900;
  margin-top: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.8;
}

.asset-desc {
  color: var(--text-tertiary);
  font-size: 15px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 480px;
  opacity: 0.9;
  letter-spacing: -0.01em;
}

.status-chip {
  background: rgba(255, 255, 255, 0.6);
  padding: 6px 18px;
  border-radius: 99px;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  border: 1px solid rgba(0,0,0,0.03);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}

.preview-panel {
  padding: 48px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.preview-head {
  padding-bottom: 40px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.8);
}

.preview-head h3 {
  font-size: 40px;
  font-weight: 900;
  color: var(--text-primary);
  margin: 24px 0 16px;
  letter-spacing: -0.05em;
  line-height: 1.1;
}

.preview-head p {
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.action-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.preview-action-btn {
  height: 48px;
  padding: 0 24px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.preview-action-btn:hover {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.12);
}

.preview-action-btn.primary {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
}

.preview-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  padding: 40px;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.preview-card:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
}

.preview-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
}

.preview-card-head h4 {
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.preview-card-head span {
  font-size: 14px;
  color: #10b981;
  font-weight: 900;
  text-transform: uppercase;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 16px;
  border-radius: 99px;
  letter-spacing: 0.12em;
}

.meta-grid.dense {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
}

.meta-grid label {
  display: block;
  margin-bottom: 14px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.meta-grid span {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

pre {
  margin: 0;
  padding: 32px;
  border-radius: 24px;
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: auto;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1.8;
}

.asset-badge {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 14px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.5;
  text-align: center;
  padding: 80px;
}

.empty-state.error {
  color: #ef4444;
  background: rgba(254, 242, 242, 0.5);
  border-radius: 32px;
  margin: 40px;
  opacity: 1;
}
</style>
