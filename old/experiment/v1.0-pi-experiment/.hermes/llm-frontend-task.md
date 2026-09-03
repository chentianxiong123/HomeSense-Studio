I need to create an LLM management frontend page in this project (HomeSense-Stdio). Please execute all of the following changes:

## 1. Register route
In packages/frontend/src/router/index.ts:
- Add import: `import LLMView from '@/views/LLMView.vue'` (around line 6-7)
- Add route after the '/devices' route: `{ path: '/llm', name: 'llm-models', component: LLMView },`

## 2. Add nav tab
In packages/frontend/src/App.vue:
- In the navItems array (line 10-15), after the integrations item, add:
  `{ key: 'models', label: locale.value === 'zh' ? '模型' : 'Models', route: '/llm' },`

## 3. Add API methods and type
In packages/frontend/src/api/index.ts:
- Add this type definition somewhere before the export:
```
export interface LLMProviderConfig {
  id: number
  name: string
  provider_type: string
  api_base: string
  api_key: string
  model_name: string
  enabled: boolean
  is_default: boolean
  category: string
  extra_config: Record<string, unknown>
}
```
- Inside the export object (before the closing `}` of the api object), add a `llm` property:
```
llm: {
    listProviders: (category?: string) =>
      request<{ providers: LLMProviderConfig[] }>(`/api/llm/providers${category ? `?category=${category}` : ''}`),
    createProvider: (body: Record<string, unknown>) =>
      request<{ id: number }>('/api/llm/providers', { method: 'POST', body: JSON.stringify(body) }),
    updateProvider: (id: number, body: Record<string, unknown>) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteProvider: (id: number) =>
      request<{ status: string }>(`/api/llm/providers/${id}`, { method: 'DELETE' }),
    setDefault: (id: number) =>
      request<{ status: string }>(`/api/llm/providers/${id}/default`, { method: 'POST' }),
  },
```

## 4. Create LLMView.vue
Create file packages/frontend/src/views/LLMView.vue with:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type LLMProviderConfig } from '@/api'

// Tab state
const activeTab = ref<'chat' | 'embedding' | 'rerank'>('chat')
const tabs = [
  { key: 'chat' as const, label: '对话模型' },
  { key: 'embedding' as const, label: '嵌入模型' },
  { key: 'rerank' as const, label: '重排序模型' },
]

// Provider list
const providers = ref<LLMProviderConfig[]>([])
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null

function showSuccess(msg: string) {
  successMessage.value = msg
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => { successMessage.value = '' }, 3000)
}

async function loadProviders() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.llm.listProviders(activeTab.value)
    providers.value = res.providers
  } catch (e) {
    errorMessage.value = '加载失败: ' + (e as Error).message
  } finally {
    loading.value = false
  }
}

// Modal state
const showModal = ref(false)
const editingProvider = ref<LLMProviderConfig | null>(null)
const form = ref({
  name: '',
  provider_type: 'openai',
  api_base: '',
  api_key: '',
  model_name: '',
})

function resetForm() {
  form.value = { name: '', provider_type: 'openai', api_base: '', api_key: '', model_name: '' }
  editingProvider.value = null
}

function openAdd() {
  resetForm()
  showModal.value = true
}

function openEdit(p: LLMProviderConfig) {
  editingProvider.value = p
  form.value = {
    name: p.name,
    provider_type: p.provider_type,
    api_base: p.api_base,
    api_key: '',
    model_name: p.model_name,
  }
  showModal.value = true
}

async function saveProvider() {
  try {
    if (editingProvider.value) {
      const body: Record<string, unknown> = {
        name: form.value.name,
        provider_type: form.value.provider_type,
        api_base: form.value.api_base,
        api_key: form.value.api_key || editingProvider.value.api_key,
        model_name: form.value.model_name,
      }
      await api.llm.updateProvider(editingProvider.value.id, body)
      showSuccess('更新成功')
    } else {
      await api.llm.createProvider({
        name: form.value.name,
        provider_type: form.value.provider_type,
        api_base: form.value.api_base,
        api_key: form.value.api_key,
        model_name: form.value.model_name,
        enabled: true,
        is_default: false,
        category: activeTab.value,
        extra_config: {},
      })
      showSuccess('添加成功')
    }
    showModal.value = false
    await loadProviders()
  } catch (e) {
    errorMessage.value = '保存失败: ' + (e as Error).message
  }
}

async function deleteProvider(id: number) {
  if (!confirm('确定删除此 Provider？')) return
  try {
    await api.llm.deleteProvider(id)
    showSuccess('删除成功')
    await loadProviders()
  } catch (e) {
    errorMessage.value = '删除失败: ' + (e as Error).message
  }
}

async function setDefault(id: number) {
  try {
    await api.llm.setDefault(id)
    showSuccess('已设为当前使用')
    await loadProviders()
  } catch (e) {
    errorMessage.value = '设置失败: ' + (e as Error).message
  }
}

function switchTab(key: 'chat' | 'embedding' | 'rerank') {
  activeTab.value = key
  loadProviders()
}

onMounted(loadProviders)
</script>

<template>
  <div class="llm-page">
    <h1 class="page-title">模型管理</h1>

    <div v-if="errorMessage" class="msg error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="msg success">{{ successMessage }}</div>

    <!-- Tabs -->
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

    <!-- Add button -->
    <div class="toolbar">
      <button class="btn-primary" @click="openAdd">+ 添加 Provider</button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading">加载中...</div>

    <!-- Provider list -->
    <div v-else-if="providers.length === 0" class="empty">
      暂无 {{ activeTab === 'chat' ? '对话' : activeTab === 'embedding' ? '嵌入' : '重排序' }} 模型 Provider
    </div>

    <div v-else class="card-list">
      <div v-for="p in providers" :key="p.id" class="card">
        <div class="card-body">
          <div class="card-header">
            <span class="card-name">{{ p.name }}</span>
            <span v-if="p.is_default" class="badge-active">当前使用</span>
          </div>
          <div class="card-meta">
            <div class="meta-item">
              <span class="meta-label">类型</span>
              <span class="meta-value">{{ p.provider_type }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">接口</span>
              <span class="meta-value code">{{ p.api_base }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">模型</span>
              <span class="meta-value code">{{ p.model_name }}</span>
            </div>
          </div>
        </div>
        <div class="card-actions">
          <button v-if="!p.is_default" class="btn-outline btn-sm" @click="setDefault(p.id)">设为当前</button>
          <button class="btn-outline btn-sm" @click="openEdit(p)">编辑</button>
          <button class="btn-danger btn-sm" @click="deleteProvider(p.id)">删除</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <h2>{{ editingProvider ? '编辑 Provider' : '添加 Provider' }}</h2>
        <div class="form-group">
          <label>名称</label>
          <input v-model="form.name" placeholder="如: 硅基流动 DeepSeek" />
        </div>
        <div class="form-group">
          <label>类型</label>
          <select v-model="form.provider_type">
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="ollama">Ollama</option>
            <option value="mimo">Mimo</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div class="form-group">
          <label>接口地址</label>
          <input v-model="form.api_base" placeholder="https://api.openai.com/v1" />
        </div>
        <div class="form-group">
          <label>API Key</label>
          <input v-model="form.api_key" type="password" :placeholder="editingProvider ? '留空保持不变' : ''" />
        </div>
        <div class="form-group">
          <label>模型名称</label>
          <input v-model="form.model_name" placeholder="如: gpt-4o" />
        </div>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showModal = false">取消</button>
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
  font-size: 13px;
  font-weight: 500;
}
.msg.error {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.msg.success {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tab-btn {
  padding: 8px 20px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
}
.tab-btn:hover {
  border-color: #10b981;
  color: #10b981;
}
.tab-btn.active {
  background: rgba(16, 185, 129, 0.1);
  border-color: #10b981;
  color: #10b981;
  font-weight: 700;
}
.toolbar {
  margin-bottom: 16px;
}
.btn-primary {
  padding: 10px 24px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
}
.btn-primary:hover {
  background: #059669;
  transform: translateY(-1px);
}
.btn-outline {
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.btn-outline:hover {
  border-color: #10b981;
  color: #10b981;
}
.btn-danger {
  padding: 6px 14px;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  background: #fff;
  color: #dc2626;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.btn-danger:hover {
  background: #fef2f2;
  border-color: #dc2626;
}
.btn-sm { font-size: 12px; padding: 5px 12px; }
.loading, .empty {
  padding: 48px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card {
  background: var(--surface-color);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  transition: all 0.2s;
}
.card:hover {
  box-shadow: var(--shadow-sm);
  border-color: #d1d5db;
}
.card-body { flex: 1; }
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.card-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.badge-active {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 11px;
  font-weight: 700;
}
.card-meta {
  display: flex;
  gap: 24px;
  font-size: 13px;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-label {
  color: var(--text-tertiary);
  font-weight: 500;
}
.meta-value { color: var(--text-primary); }
.meta-value.code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--text-secondary);
}
.card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 16px;
}
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: var(--surface-color);
  border-radius: 16px;
  padding: 28px;
  width: 460px;
  max-width: 90vw;
  box-shadow: var(--shadow-lg);
}
.modal h2 {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 20px;
  color: var(--text-primary);
}
.form-group {
  margin-bottom: 14px;
}
.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.form-group input,
.form-group select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: #fff;
  outline: none;
  transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
.btn-cancel {
  padding: 9px 20px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--surface-color);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.btn-cancel:hover {
  background: #f3f4f6;
}
</style>
```

Please apply ALL of these changes now. After making the changes, run `cd packages/frontend && npx vue-tsc --noEmit` to check for type errors. Fix any errors you find.