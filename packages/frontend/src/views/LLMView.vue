<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api, type LLMProviderConfig, type LLMModel, type LLMUsageTotals } from '@/api'

const activeTab = ref<'chat' | 'embedding' | 'rerank' | 'usage'>('chat')
const tabs = [
  { key: 'chat' as const, label: '对话模型' },
  { key: 'embedding' as const, label: '嵌入模型' },
  { key: 'rerank' as const, label: '重排序模型' },
  { key: 'usage' as const, label: '使用统计' },
]

const providers = ref<LLMProviderConfig[]>([])
const modelsMap = ref<Record<number, LLMModel[]>>({})
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null

function showSuccess(msg: string) {
  successMessage.value = msg
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => { successMessage.value = '' }, 3000)
}

// ── Provider CRUD ──

async function loadProviders() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.llm.listProviders()
    providers.value = res.providers
    // Load models for each provider
    modelsMap.value = {}
    for (const p of res.providers) {
      const filterCategory = activeTab.value === 'usage' ? undefined : activeTab.value
      const mres = await api.llm.listModels(p.id, filterCategory)
      modelsMap.value[p.id] = mres.models
    }
  } catch (e) {
    errorMessage.value = '加载失败: ' + (e as Error).message
  } finally {
    loading.value = false
  }
}

const showProviderModal = ref(false)
const editingProvider = ref<LLMProviderConfig | null>(null)
const providerForm = ref({
  name: '',
  api_base: '',
  api_key: '',
})
const showApiKey = ref(false)

function resetProviderForm() {
  providerForm.value = { name: '', api_base: '', api_key: '' }
  editingProvider.value = null
}

function openAddProvider() {
  resetProviderForm()
  showProviderModal.value = true
}

function openEditProvider(p: LLMProviderConfig) {
  editingProvider.value = p
  providerForm.value = {
    name: p.name,
    api_base: p.api_base,
    api_key: '',
  }
  showProviderModal.value = true
}

async function saveProvider() {
  try {
    if (editingProvider.value) {
      await api.llm.updateProvider(editingProvider.value.id, {
        name: providerForm.value.name,
        api_base: providerForm.value.api_base,
        api_key: providerForm.value.api_key || editingProvider.value.api_key,
        enabled: true,
        extra_config: {},
      })
      showSuccess('更新成功')
    } else {
      await api.llm.createProvider({
        name: providerForm.value.name,
        api_base: providerForm.value.api_base,
        api_key: providerForm.value.api_key,
        enabled: true,
        extra_config: {},
      })
      showSuccess('添加成功')
    }
    showProviderModal.value = false
    await loadProviders()
  } catch (e) {
    errorMessage.value = '保存失败: ' + (e as Error).message
  }
}

async function deleteProvider(id: number) {
  if (!confirm('确定删除此 Provider？（下属模型也将删除）')) return
  try {
    await api.llm.deleteProvider(id)
    showSuccess('删除成功')
    await loadProviders()
  } catch (e) {
    errorMessage.value = '删除失败: ' + (e as Error).message
  }
}

// ── Model CRUD ──

const modelProviderId = ref<number>(0)
const modelQueryResults = ref<string[]>([])
const modelQueryLoading = ref(false)
const showQueryDropdown = ref(false)
const modelInputText = ref('')

async function queryProviderModels(providerId: number) {
  modelQueryLoading.value = true
  modelQueryResults.value = []
  try {
    const res = await api.llm.queryProviderModels(providerId)
    if (res.status === 'error') {
      errorMessage.value = '查询失败: ' + (res.message || '未知错误')
      return
    }
    modelQueryResults.value = res.models || []
    modelProviderId.value = providerId
  } catch (e) {
    errorMessage.value = '查询模型失败: ' + (e as Error).message
  } finally {
    modelQueryLoading.value = false
  }
}

function toggleQuery(providerId: number) {
  if (showQueryDropdown.value && modelProviderId.value === providerId) {
    showQueryDropdown.value = false
    return
  }
  modelProviderId.value = providerId
  showQueryDropdown.value = true
  queryProviderModels(providerId)
}

function addModelInline(providerId: number, modelName: string) {
  const cat = activeTab.value === 'usage' ? 'chat' : activeTab.value
  api.llm.createModel(providerId, {
    model_name: modelName,
    category: cat,
    is_default: false,
    enabled: true,
  }).then(() => {
    showSuccess('模型已添加')
    loadProviders()
  }).catch((e) => {
    errorMessage.value = '添加失败: ' + (e as Error).message
  })
}

function addModelByInput(providerId: number) {
  const name = modelInputText.value.trim()
  if (!name) return
  modelInputText.value = ''
  addModelInline(providerId, name)
}

function pickModel(name: string) {
  modelInputText.value = name
  showQueryDropdown.value = false
}

async function deleteModel(id: number) {
  if (!confirm('确定删除此模型？')) return
  try {
    await api.llm.deleteModel(id)
    showSuccess('模型删除成功')
    await loadProviders()
  } catch (e) {
    errorMessage.value = '删除模型失败: ' + (e as Error).message
  }
}

async function setDefaultModel(id: number) {
  try {
    await api.llm.setDefaultModel(id)
    showSuccess('已设为主模型')
    await loadProviders()
  } catch (e) {
    errorMessage.value = '设置失败: ' + (e as Error).message
  }
}

// ── Usage ──

const usageTotals = ref<LLMUsageTotals | null>(null)
const usageLoading = ref(false)
const usageView = ref<'daily' | 'provider' | 'model' | 'category'>('provider')
const usageProviderFilter = ref('')
const usageModelFilter = ref('')

const usageProviderOptions = computed(() => {
  if (!usageTotals.value) return []
  const names = new Set<string>()
  for (const row of usageTotals.value.daily) {
    if (row.provider_name) names.add(row.provider_name)
  }
  return ['', ...Array.from(names).sort()]
})

const usageModelOptions = computed(() => {
  if (!usageTotals.value) return []
  const names = new Set<string>()
  for (const row of usageTotals.value.daily) {
    names.add(row.model_name)
  }
  return ['', ...Array.from(names).sort()]
})

const usageFilteredDaily = computed(() => {
  if (!usageTotals.value) return []
  let rows = usageTotals.value.daily
  if (usageProviderFilter.value) rows = rows.filter(r => r.provider_name === usageProviderFilter.value)
  if (usageModelFilter.value) rows = rows.filter(r => r.model_name === usageModelFilter.value)
  return rows
})

const usageFilteredProvider = computed(() => {
  if (!usageTotals.value) return []
  let rows = usageTotals.value.by_provider
  if (usageProviderFilter.value) rows = rows.filter(r => r.provider_name === usageProviderFilter.value)
  return rows
})

const usageFilteredModel = computed(() => {
  if (!usageTotals.value) return []
  let rows = usageTotals.value.by_model
  if (usageModelFilter.value) rows = rows.filter(r => r.model_name === usageModelFilter.value)
  return rows
})

const usageFilteredCategory = computed(() => {
  if (!usageTotals.value) return []
  return usageTotals.value.by_category
})

async function loadUsage() {
  usageLoading.value = true
  try {
    const totalsRes = await api.llm.usageTotals()
    usageTotals.value = totalsRes
  } catch (e) {
    errorMessage.value = '加载统计失败: ' + (e as Error).message
  } finally {
    usageLoading.value = false
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function switchTab(key: 'chat' | 'embedding' | 'rerank' | 'usage') {
  activeTab.value = key
  if (key === 'usage') {
    loadUsage()
  } else {
    loadProviders()
  }
}

const categoryLabel: Record<string, string> = {
  chat: '对话',
  embedding: '嵌入',
  rerank: '重排序',
}

onMounted(loadProviders)
</script>

<template>
  <div class="llm-page">
    <h1 class="page-title">提供商管理</h1>

    <div v-if="errorMessage" class="msg error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="msg success">{{ successMessage }}</div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <template v-if="activeTab !== 'usage'">
    <div class="toolbar">
      <button class="btn-primary" @click="openAddProvider">+ 添加提供商</button>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="providers.length === 0" class="empty">
      暂无提供商，请先添加
    </div>

    <div v-else class="card-list">
      <div v-for="p in providers" :key="p.id" class="card">
        <div class="card-body">
          <div class="card-header">
            <span class="card-name">{{ p.name }}</span>
            <button class="btn-outline btn-xs" @click="openEditProvider(p)">编辑</button>
            <button class="btn-danger btn-xs" @click="deleteProvider(p.id)">删除</button>
          </div>
          <div class="card-meta">
            <div class="meta-item">
              <span class="meta-label">接口</span>
              <span class="meta-value code">{{ p.api_base }}</span>
            </div>
          </div>

          <!-- Models list -->
          <div class="model-section">
            <div class="model-header">
              <span class="model-title">模型列表</span>
            </div>
            <div v-if="!modelsMap[p.id]?.length" class="model-empty">暂无模型</div>
            <div v-for="m in modelsMap[p.id]" :key="m.id" class="model-row">
              <div class="model-info">
                <span class="model-name">{{ m.model_name }}</span>
                <span class="model-category-tag">{{ categoryLabel[m.category] || m.category }}</span>
                <span v-if="m.is_default" class="badge-active">主模型</span>
              </div>
              <div class="model-actions">
                <button v-if="!m.is_default" class="btn-text btn-xs" @click="setDefaultModel(m.id)">设为主模型</button>
                <button class="btn-text-danger btn-xs" @click="deleteModel(m.id)">删除</button>
              </div>
            </div>
            <div class="model-add-row">
              <input
                v-model="modelInputText"
                class="model-input"
                placeholder="输入模型名，回车添加"
                @keydown.enter.prevent="addModelByInput(p.id)"
              />
              <div class="model-dropdown-wrap">
                <button
                  class="btn-dropdown"
                  :class="{ open: showQueryDropdown && modelProviderId === p.id }"
                  :disabled="modelQueryLoading"
                  @click="toggleQuery(p.id)"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <div v-if="showQueryDropdown && modelProviderId === p.id" class="model-dropdown">
                  <div v-if="modelQueryLoading" class="model-dropdown-item" style="color:var(--text-tertiary)">查询中...</div>
                  <div v-else-if="modelQueryResults.length === 0" class="model-dropdown-item" style="color:var(--text-tertiary)">无可用模型</div>
                  <div v-for="m in modelQueryResults" :key="m" class="model-dropdown-item" @click="pickModel(m)">{{ m }}</div>
                </div>
              </div>
              <button class="btn-text btn-xs" @click="addModelByInput(p.id)">添加</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>

    <template v-else>
      <div v-if="usageLoading" class="loading">加载中...</div>

      <template v-else-if="usageTotals">
        <div class="usage-summary">
          <div class="summary-card">
            <div class="summary-value">{{ formatTokens(usageTotals.total_input) }}</div>
            <div class="summary-label">输入 Tokens</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">{{ formatTokens(usageTotals.total_output) }}</div>
            <div class="summary-label">输出 Tokens</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">{{ usageTotals.total_success }}</div>
            <div class="summary-label">成功次数</div>
          </div>
          <div class="summary-card">
            <div class="summary-value">{{ usageTotals.total_fail }}</div>
            <div class="summary-label">失败次数</div>
          </div>
        </div>

        <div class="usage-filters">
          <div class="view-btns">
            <button :class="['view-btn', { active: usageView === 'daily' }]" @click="usageView = 'daily'">按天</button>
            <button :class="['view-btn', { active: usageView === 'provider' }]" @click="usageView = 'provider'">按提供商</button>
            <button :class="['view-btn', { active: usageView === 'model' }]" @click="usageView = 'model'">按模型</button>
            <button :class="['view-btn', { active: usageView === 'category' }]" @click="usageView = 'category'">按类型</button>
          </div>
          <div class="filter-row">
            <select v-model="usageProviderFilter" class="filter-select">
              <option value="">全部提供商</option>
              <option v-for="name in usageProviderOptions" :key="name" :value="name">{{ name }}</option>
            </select>
            <select v-model="usageModelFilter" class="filter-select">
              <option value="">全部模型</option>
              <option v-for="name in usageModelOptions" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
        </div>

        <div v-if="usageView === 'daily' && usageFilteredDaily.length > 0" class="usage-breakdown">
          <table class="usage-table">
            <thead><tr><th>日期</th><th>Provider</th><th>模型</th><th>类型</th><th>成功</th><th>失败</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>
              <tr v-for="row in usageFilteredDaily" :key="row.date + row.provider_name + row.model_name">
                <td class="nowrap">{{ row.date }}</td>
                <td>{{ row.provider_name || '-' }}</td>
                <td>{{ row.model_name }}</td>
                <td>{{ row.category }}</td>
                <td>{{ row.success_count }}</td>
                <td>{{ row.fail_count }}</td>
                <td>{{ formatTokens(row.input_tokens) }}</td>
                <td>{{ formatTokens(row.output_tokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="usageView === 'provider' && usageFilteredProvider.length > 0" class="usage-breakdown">
          <table class="usage-table">
            <thead><tr><th>Provider</th><th>成功</th><th>失败</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>
              <tr v-for="row in usageFilteredProvider" :key="row.provider_name">
                <td>{{ row.provider_name || '(未命名)' }}</td>
                <td>{{ row.success }}</td>
                <td>{{ row.fail }}</td>
                <td>{{ formatTokens(row.input) }}</td>
                <td>{{ formatTokens(row.output) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="usageView === 'model' && usageFilteredModel.length > 0" class="usage-breakdown">
          <table class="usage-table">
            <thead><tr><th>模型</th><th>成功</th><th>失败</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>
              <tr v-for="row in usageFilteredModel" :key="row.model_name">
                <td>{{ row.model_name }}</td>
                <td>{{ row.success }}</td>
                <td>{{ row.fail }}</td>
                <td>{{ formatTokens(row.input) }}</td>
                <td>{{ formatTokens(row.output) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="usageView === 'category' && usageFilteredCategory.length > 0" class="usage-breakdown">
          <table class="usage-table">
            <thead><tr><th>类型</th><th>成功</th><th>失败</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>
              <tr v-for="row in usageFilteredCategory" :key="row.category">
                <td>{{ row.category }}</td>
                <td>{{ row.success }}</td>
                <td>{{ row.fail }}</td>
                <td>{{ formatTokens(row.input) }}</td>
                <td>{{ formatTokens(row.output) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="usageTotals.total_success === 0 && usageTotals.total_fail === 0" class="empty">暂无用量数据</div>
      </template>
    </template>

    <!-- Provider Modal -->
    <div v-if="showProviderModal" class="modal-overlay">
      <div class="modal">
        <h2>{{ editingProvider ? '编辑提供商' : '添加提供商' }}</h2>
        <div class="form-group">
          <label>名称</label>
          <input v-model="providerForm.name" placeholder="如: 硅基流动" />
        </div>
        <div class="form-group">
          <label>接口地址</label>
          <input v-model="providerForm.api_base" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="form-group">
          <label>API Key</label>
          <div class="key-input-wrap">
            <input v-model="providerForm.api_key" :type="showApiKey ? 'text' : 'password'" :placeholder="editingProvider ? '留空保持不变' : ''" />
            <button class="btn-eye" @click="showApiKey = !showApiKey" type="button">
              <svg v-if="!showApiKey" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showProviderModal = false">取消</button>
          <button class="btn-primary" @click="saveProvider">{{ editingProvider ? '保存' : '添加' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.llm-page {
  height: 100%;
  padding: 32px 48px;
  overflow-y: auto;
}
.page-title {
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 24px;
  color: var(--text-primary);
}
.msg {
  padding: 10px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 500;
}
.msg.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.msg.success { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.tabs {
  display: flex; gap: 8px; margin-bottom: 20px;
}
.tab-btn {
  padding: 8px 20px; border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--surface-color); color: var(--text-secondary); cursor: pointer;
  font-size: 15px; font-weight: 600; transition: all 0.2s;
}
.tab-btn:hover { border-color: #10b981; color: #10b981; }
.tab-btn.active { background: rgba(16, 185, 129, 0.1); border-color: #10b981; color: #10b981; font-weight: 700; }
.toolbar { margin-bottom: 16px; }
.btn-primary {
  padding: 10px 24px; background: #10b981; color: #fff; border: none; border-radius: 10px;
  cursor: pointer; font-size: 15px; font-weight: 600; transition: all 0.2s;
}
.btn-primary:hover { background: #059669; transform: translateY(-1px); }
.btn-outline {
  padding: 6px 14px; border: 1px solid var(--border-color); border-radius: 8px;
  background: var(--surface-color); color: var(--text-secondary); cursor: pointer; font-size: 16px; transition: all 0.2s;
}
.btn-outline:hover { border-color: #10b981; color: #10b981; }
.btn-danger {
  padding: 4px 10px; border: 1px solid #fca5a5; border-radius: 6px;
  background: #fff; color: #dc2626; cursor: pointer; font-size: 15px; transition: all 0.2s;
}
.btn-danger:hover { background: #fef2f2; border-color: #dc2626; }
.btn-text {
  padding: 2px 8px; border: none; background: none; color: #10b981; cursor: pointer; font-size: 15px; font-weight: 500;
}
.btn-text:hover { text-decoration: underline; }
.btn-text-danger {
  padding: 2px 8px; border: none; background: none; color: #dc2626; cursor: pointer; font-size: 15px; font-weight: 500;
}
.btn-text-danger:hover { text-decoration: underline; }
.btn-xs { font-size: 15px; padding: 3px 8px; }
.btn-sm { font-size: 16px; padding: 5px 12px; }
.loading, .empty {
  padding: 48px; text-align: center; color: var(--text-tertiary); font-size: 16px;
}
.card-list { display: flex; flex-direction: column; gap: 12px; }
.card {
  background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 12px;
  padding: 16px 20px; transition: all 0.2s;
}
.card:hover { box-shadow: var(--shadow-sm); border-color: #d1d5db; }
.card-body { width: 100%; }
.card-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}
.card-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.card-meta {
  display: flex; gap: 24px; font-size: 15px; margin-bottom: 14px;
}
.meta-item { display: flex; align-items: center; gap: 6px; }
.meta-label { color: var(--text-tertiary); font-weight: 500; }
.meta-value { color: var(--text-primary); }
.meta-value.code {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 16px; color: var(--text-secondary);
}
.badge-active {
  display: inline-block; padding: 2px 10px; border-radius: 12px;
  background: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 15px; font-weight: 700;
}
.model-section {
  border-top: 1px solid var(--border-color); padding-top: 12px;
}
.model-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.model-title { font-size: 15px; font-weight: 600; color: var(--text-secondary); }
.model-empty { font-size: 16px; color: var(--text-tertiary); padding: 4px 0; }
.model-query-results {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-bottom: 8px;
}
.model-query-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; border-bottom: 1px solid var(--border-color);
}
.model-query-row:last-child { border-bottom: none; }
.model-header-right { display: flex; align-items: center; gap: 6px; }
.model-dropdown {
  position: absolute; top: 100%; right: 0; z-index: 10;
  min-width: 240px; max-height: 220px; overflow-y: auto;
  border: 1px solid var(--border-color); border-radius: 8px; margin-top: 4px;
  background: var(--surface-color); box-shadow: var(--shadow-md);
}
.model-dropdown-item {
  padding: 7px 12px; cursor: pointer; font-size: 16px; color: var(--text-primary);
  border-bottom: 1px solid var(--border-color); transition: background 0.15s;
}
.model-dropdown-item:last-child { border-bottom: none; }
.model-dropdown-item:hover { background: rgba(16, 185, 129, 0.06); color: #10b981; }
.model-dropdown-wrap { position: relative; flex-shrink: 0; }
.btn-dropdown {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: 1px solid var(--border-color); border-radius: 6px;
  background: var(--surface-color); cursor: pointer; color: var(--text-secondary); transition: all 0.2s;
  padding: 0;
}
.btn-dropdown:hover { border-color: #10b981; color: #10b981; }
.btn-dropdown.open { border-color: #10b981; color: #10b981; transform: rotate(180deg); }
.btn-dropdown:disabled { opacity: 0.5; cursor: not-allowed; }
.model-add-row {
  display: flex; align-items: center; gap: 6px; margin-top: 8px; padding: 0 10px;
}
.model-input {
  flex: 1; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px;
  font-size: 16px; font-family: inherit; color: var(--text-primary); background: #fff; outline: none;
}
.model-input:focus { border-color: #10b981; }
.model-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; border-radius: 8px; margin-bottom: 4px;
}
.model-row:hover { background: rgba(16, 185, 129, 0.03); }
.model-info { display: flex; align-items: center; gap: 8px; }
.model-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.model-category-tag {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  background: rgba(16, 185, 129, 0.06); color: var(--text-secondary); font-size: 15px;
}
.model-actions { display: flex; gap: 4px; }
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.modal {
  background: var(--surface-color); border-radius: 16px; padding: 28px;
  width: 460px; max-width: 90vw; box-shadow: var(--shadow-lg);
}
.modal h2 { font-size: 17px; font-weight: 700; margin-bottom: 20px; color: var(--text-primary); }
.form-group { margin-bottom: 14px; }
.form-group label {
  display: block; font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-bottom: 5px;
}
.form-group input, .form-group select {
  width: 100%; padding: 9px 12px; border: 1px solid var(--border-color); border-radius: 8px;
  font-size: 15px; color: var(--text-primary); background: #fff; outline: none; transition: border-color 0.2s;
}
.form-group input:focus, .form-group select:focus {
  border-color: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}
.key-input-wrap { display: flex; gap: 4px; }
.key-input-wrap input { flex: 1; }
.btn-eye {
  display: flex; align-items: center; justify-content: center;
  width: 40px; border: 1px solid var(--border-color); border-radius: 8px;
  background: var(--surface-color); cursor: pointer; color: var(--text-secondary); flex-shrink: 0;
}
.btn-eye:hover { border-color: #10b981; color: #10b981; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
.btn-cancel {
  padding: 9px 20px; border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--surface-color); color: var(--text-secondary); cursor: pointer; font-size: 15px;
}
.btn-cancel:hover { background: #f3f4f6; }
.usage-filter {
  display: flex; align-items: center; gap: 10px; margin-bottom: 20px; font-size: 15px; color: var(--text-secondary);
}
.usage-filters {
  display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;
}
.view-btns { display: flex; gap: 6px; }
.view-btn {
  padding: 6px 16px; border: 1px solid var(--border-color); border-radius: 8px;
  background: var(--surface-color); color: var(--text-secondary); cursor: pointer;
  font-size: 16px; font-weight: 600; transition: all 0.2s;
}
.view-btn:hover { border-color: #10b981; color: #10b981; }
.view-btn.active { background: rgba(16, 185, 129, 0.1); border-color: #10b981; color: #10b981; }
.filter-row { display: flex; gap: 8px; }
.filter-select {
  padding: 6px 12px; border: 1px solid var(--border-color); border-radius: 8px;
  font-size: 16px; font-family: inherit; color: var(--text-primary);
  background: var(--surface-color); outline: none;
}
.filter-select:focus { border-color: #10b981; }
.date-input {
  padding: 7px 12px; border: 1px solid var(--border-color); border-radius: 8px;
  font-size: 15px; font-family: inherit; color: var(--text-primary); background: var(--surface-color); outline: none;
}
.date-input:focus { border-color: #10b981; }
.usage-summary { display: flex; gap: 16px; margin-bottom: 24px; }
.summary-card {
  flex: 1; background: var(--surface-color); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 20px; text-align: center;
}
.summary-value { font-size: 28px; font-weight: 800; color: #10b981; margin-bottom: 4px; }
.summary-label { font-size: 16px; color: var(--text-tertiary); font-weight: 500; }
.usage-breakdown { margin-bottom: 24px; }
.breakdown-title { font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 10px; }
.usage-table { width: 100%; border-collapse: collapse; font-size: 15px; }
.usage-table th {
  text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border-color);
  color: var(--text-tertiary); font-weight: 600; font-size: 16px;
}
.usage-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-color); color: var(--text-primary); }
.usage-table tr:hover td { background: rgba(16, 185, 129, 0.03); }
.nowrap { white-space: nowrap; }
</style>