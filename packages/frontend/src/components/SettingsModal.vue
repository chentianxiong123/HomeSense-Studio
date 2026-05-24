<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import LoginPanel from './LoginPanel.vue'
import { api, type LLMModelSlot, type LLMProvider } from '../api'
import { useLocale } from '../composables/useLocale'
import { buildSlotSections } from '../features/settings/llmSlots'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'logged-in'): void }>()

const activeTab = ref<'login' | 'llm' | 'general'>('login')
const providers = ref<LLMProvider[]>([])
const slots = ref<LLMModelSlot[]>([])
const editingSlot = ref<LLMModelSlot | null>(null)
const editingProvider = ref<Partial<LLMProvider> | null>(null)
const isAdding = ref(false)
const { t } = useLocale()

const slotSections = computed(() => buildSlotSections((zh, en) => localeAware(zh, en)))

const providerTypes = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: t('settings.custom') },
]

const presetBases: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  ollama: 'http://localhost:11434/v1',
  custom: '',
}

async function loadProviders() {
  try {
    const result = await api.llm.listProviders()
    providers.value = result.providers || []
  } catch {}
}

async function loadSlots() {
  try {
    const result = await api.llm.listSlots()
    slots.value = result.slots || []
  } catch {}
}

function startAdd() {
  isAdding.value = true
  editingProvider.value = {
    name: '',
    provider_type: 'openai',
    api_base: presetBases.openai,
    api_key: '',
    model_name: '',
    enabled: true,
    is_default: providers.value.length === 0,
  }
}

function startEdit(provider: LLMProvider) {
  isAdding.value = false
  editingProvider.value = { ...provider }
}

function cancelEdit() {
  editingProvider.value = null
  editingSlot.value = null
}

function onTypeChange() {
  if (editingProvider.value && editingProvider.value.provider_type) {
    const preset = presetBases[editingProvider.value.provider_type]
    if (preset) {
      editingProvider.value.api_base = preset
    }
  }
}

async function saveProvider() {
  if (!editingProvider.value) return
  try {
    if (isAdding.value) {
      await api.llm.addProvider(editingProvider.value)
    } else if (editingProvider.value.id) {
      await api.llm.updateProvider(editingProvider.value.id, editingProvider.value)
    }
    editingProvider.value = null
    await loadProviders()
  } catch {}
}

async function deleteProvider(id: number) {
  try {
    await api.llm.deleteProvider(id)
    await loadProviders()
  } catch {}
}

async function setDefault(id: number) {
  try {
    await api.llm.setDefault(id)
    await loadProviders()
  } catch {}
}

function startEditSlot(slot: LLMModelSlot) {
  editingSlot.value = { ...slot, capabilities: [...slot.capabilities], extra_config: { ...slot.extra_config } }
  editingProvider.value = null
}

async function saveSlot() {
  if (!editingSlot.value) return
  try {
    await api.llm.updateSlot(editingSlot.value.slot_name, {
      provider_type: editingSlot.value.provider_type,
      api_base: editingSlot.value.api_base,
      api_key: editingSlot.value.api_key,
      model_name: editingSlot.value.model_name,
      enabled: editingSlot.value.enabled,
      dimensions: editingSlot.value.dimensions,
      capabilities: editingSlot.value.capabilities,
      extra_config: editingSlot.value.extra_config,
    })
    editingSlot.value = null
    await loadSlots()
  } catch {}
}

function updateSlotCapabilities(raw: string) {
  if (!editingSlot.value) return
  editingSlot.value.capabilities = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function localeAware(zh: string, en: string) {
  return t('app.lang.zh') === '中文' ? zh : en
}

onMounted(async () => {
  await loadProviders()
  await loadSlots()
})
</script>

<template>
  <div v-if="props.show" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <div class="header-left">
          <span class="eyebrow">{{ t('settings.title') }}</span>
          <h2>{{ activeTab === 'login' ? t('settings.login') : activeTab === 'llm' ? t('settings.llm') : t('settings.general') }}</h2>
        </div>
        <button class="close-btn" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="tab-bar">
          <button
            :class="['tab-btn', { active: activeTab === 'login' }]"
            @click="activeTab = 'login'"
          >
            {{ t('settings.login') }}
          </button>
          <button
            :class="['tab-btn', { active: activeTab === 'llm' }]"
            @click="activeTab = 'llm'; loadProviders(); loadSlots()"
          >
            {{ t('settings.llm') }}
          </button>
          <button
            :class="['tab-btn', { active: activeTab === 'general' }]"
            @click="activeTab = 'general'"
          >
            {{ t('settings.general') }}
          </button>
        </div>
        <div class="tab-content">
          <LoginPanel v-if="activeTab === 'login'" @logged-in="emit('logged-in')" />

          <div v-else-if="activeTab === 'llm'" class="llm-tab">
            <div v-if="!editingProvider && !editingSlot" class="provider-list">
              <div class="list-header">
                <h3>{{ t('settings.providers') }}</h3>
                <button class="primary" @click="startAdd">+ {{ t('settings.add') }}</button>
              </div>
              <div v-if="providers.length === 0" class="empty-hint">
                {{ t('settings.noProviders') }}
              </div>
              <div v-for="provider in providers" :key="provider.id" class="provider-item">
                <div class="provider-info">
                  <span class="provider-name">
                    {{ provider.name }}
                    <span v-if="provider.is_default" class="default-badge">{{ t('settings.default') }}</span>
                  </span>
                  <span class="provider-detail">{{ provider.provider_type }} · {{ provider.model_name }}</span>
                </div>
                <div class="provider-actions">
                  <button v-if="!provider.is_default" class="action-btn" @click="setDefault(provider.id)">{{ t('settings.setDefault') }}</button>
                  <button class="action-btn" @click="startEdit(provider)">{{ t('settings.edit') }}</button>
                  <button class="action-btn danger" @click="deleteProvider(provider.id)">{{ t('settings.delete') }}</button>
                </div>
              </div>

              <div class="slot-list">
                <div class="list-header secondary">
                  <h3>Model Slots</h3>
                </div>
                <div
                  v-for="section in slotSections"
                  :key="section.slot"
                  class="slot-item"
                >
                  <div class="provider-info">
                    <span class="provider-name">{{ section.title }}</span>
                    <span class="provider-detail">{{ section.description }}</span>
                    <span class="provider-detail">
                      <code>{{ slots.find((item) => item.slot_name === section.slot)?.provider_type || 'disabled' }}</code>
                      ·
                      <code>{{ slots.find((item) => item.slot_name === section.slot)?.model_name || 'unset' }}</code>
                    </span>
                  </div>
                  <div class="provider-actions">
                    <button
                      class="action-btn"
                      @click="startEditSlot(slots.find((item) => item.slot_name === section.slot) || {
                        slot_name: section.slot,
                        provider_type: 'openai',
                        api_base: '',
                        api_key: '',
                        model_name: '',
                        enabled: true,
                        dimensions: null,
                        capabilities: [],
                        extra_config: {},
                      })"
                    >
                      {{ t('settings.edit') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="provider-form">
              <template v-if="editingProvider">
                <div class="form-head">
                  <button class="back-link" @click="cancelEdit">← {{ t('settings.cancel') }}</button>
                  <h3>{{ isAdding ? t('settings.addProvider') : t('settings.editProvider') }}</h3>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label>{{ t('settings.name') }}</label>
                    <input v-model="editingProvider.name" placeholder="DeepSeek Chat" />
                  </div>
                  <div class="form-group">
                    <label>{{ t('settings.type') }}</label>
                    <select v-model="editingProvider.provider_type" @change="onTypeChange">
                      <option v-for="type in providerTypes" :key="type.value" :value="type.value">
                        {{ type.label }}
                      </option>
                    </select>
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.apiBase') }}</label>
                    <input v-model="editingProvider.api_base" placeholder="https://api.openai.com/v1" />
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.apiKey') }}</label>
                    <input v-model="editingProvider.api_key" type="password" placeholder="sk-..." />
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.modelName') }}</label>
                    <input v-model="editingProvider.model_name" placeholder="gpt-4o-mini, deepseek-chat" />
                  </div>
                  <div class="form-group checkbox span-2">
                    <label class="check-label">
                      <input v-model="editingProvider.enabled" type="checkbox" />
                      <span>{{ t('settings.enabled') }}</span>
                    </label>
                    <label class="check-label">
                      <input v-model="editingProvider.is_default" type="checkbox" />
                      <span>{{ t('settings.markDefault') }}</span>
                    </label>
                  </div>
                </div>
                <div class="form-actions">
                  <button class="primary large" @click="saveProvider">{{ t('settings.save') }}</button>
                  <button @click="cancelEdit">{{ t('settings.cancel') }}</button>
                </div>
              </template>

              <template v-else-if="editingSlot">
                <div class="form-head">
                  <button class="back-link" @click="cancelEdit">← {{ t('settings.cancel') }}</button>
                  <h3>{{ editingSlot.slot_name }} Slot</h3>
                </div>
                <div class="form-grid">
                  <div class="form-group">
                    <label>{{ t('settings.type') }}</label>
                    <select v-model="editingSlot.provider_type">
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="ollama">Ollama</option>
                      <option value="custom">{{ t('settings.custom') }}</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.apiBase') }}</label>
                    <input v-model="editingSlot.api_base" placeholder="https://api.pie-xian.com/v1" />
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.apiKey') }}</label>
                    <input v-model="editingSlot.api_key" type="password" placeholder="sk-..." />
                  </div>
                  <div class="form-group span-2">
                    <label>{{ t('settings.modelName') }}</label>
                    <input v-model="editingSlot.model_name" placeholder="deepseek-v4-flash / qwen3-embedding-8b" />
                  </div>
                  <div class="form-group" v-if="editingSlot.slot_name === 'embedding'">
                    <label>Dimensions</label>
                    <input
                      :value="editingSlot.dimensions ?? ''"
                      type="number"
                      @input="editingSlot.dimensions = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : null"
                    />
                  </div>
                  <div class="form-group span-2">
                    <label>Capabilities</label>
                    <input
                      :value="editingSlot.capabilities.join(', ')"
                      placeholder="chat, tools / vision / embedding / rerank"
                      @input="updateSlotCapabilities(($event.target as HTMLInputElement).value)"
                    />
                  </div>
                  <div class="form-group checkbox span-2">
                    <label class="check-label">
                      <input v-model="editingSlot.enabled" type="checkbox" />
                      <span>{{ t('settings.enabled') }}</span>
                    </label>
                  </div>
                </div>
                <div class="form-actions">
                  <button class="primary large" @click="saveSlot">{{ t('settings.save') }}</button>
                  <button @click="cancelEdit">{{ t('settings.cancel') }}</button>
                </div>
              </template>
            </div>
          </div>

          <div v-else class="placeholder-tab">
            <p>{{ t('settings.generalTodo') }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(48px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  width: 720px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 48px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 20px;
}

h2 {
  margin: 0;
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

h3 {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.close-btn {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 16px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-secondary, #64748b);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.close-btn:hover {
  background: #fff;
  color: #ef4444;
  box-shadow: 0 8px 20px rgba(239, 68, 68, 0.15);
  transform: rotate(90deg) scale(1.1);
}

.modal-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.tab-bar {
  display: flex;
  gap: 12px;
  padding: 0 48px 40px;
}

.tab-btn {
  padding: 10px 24px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tab-btn.active {
  background: #fff;
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.tab-content {
  padding: 0 48px 48px;
}

.llm-tab {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.list-header.secondary {
  margin-top: 24px;
}

button {
  min-height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  font-size: 12px;
  font-weight: 900;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
  color: var(--text-primary);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

button:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.12);
}

button.primary {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
}

button.primary:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-2px);
  box-shadow: 0 16px 40px rgba(16, 185, 129, 0.35);
  color: #fff;
}

button.large {
  min-height: 52px;
  padding: 0 32px;
}

.provider-item, .slot-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.5);
  margin-bottom: 16px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.provider-item:hover, .slot-item:hover {
  background: #fff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-name {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 16px;
  letter-spacing: -0.02em;
}

.default-badge {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.provider-detail {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 12px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 10px;
  border-radius: 8px;
  text-transform: none;
  letter-spacing: 0;
  opacity: 1;
  color: var(--text-primary);
  font-size: 11px;
}

.provider-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  min-height: 36px;
  padding: 0 16px;
  font-size: 10px;
  border-radius: 10px;
}

.action-btn.danger:hover {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.05);
  box-shadow: 0 8px 20px rgba(239, 68, 68, 0.1);
}

.provider-form {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.form-head {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.back-link {
  align-self: flex-start;
  min-height: auto;
  padding: 0;
  background: none;
  border: none;
  box-shadow: none;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: none;
  letter-spacing: 0;
}

.back-link:hover {
  background: none;
  transform: translateX(-4px);
  text-decoration: none;
  opacity: 0.8;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group.span-2 {
  grid-column: span 2;
}

.form-group label {
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
  padding-left: 4px;
}

input, select {
  width: 100%;
  min-height: 52px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 20px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

input:focus, select:focus {
  outline: none;
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
}

.form-group.checkbox {
  flex-direction: row;
  gap: 40px;
  padding: 12px 4px;
}

.check-label {
  display: flex !important;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  text-transform: none !important;
  font-size: 13px !important;
  font-weight: 900 !important;
  opacity: 1 !important;
  letter-spacing: 0 !important;
}

.check-label input {
  width: 22px;
  min-height: 22px;
  margin: 0;
  accent-color: #10b981;
}

.form-actions {
  display: flex;
  gap: 20px;
  margin-top: 24px;
}

.empty-hint {
  text-align: center;
  padding: 60px;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.4;
}

.placeholder-tab {
  padding: 100px 48px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.4;
}
</style>
