<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/api'

const props = defineProps<{ deviceId: number }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(false)
const apps = ref<Array<{ package: string; name: string }>>([])
const search = ref('')
const launching = ref('')
const errorMsg = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return apps.value
  return apps.value.filter(a =>
    a.name.toLowerCase().includes(q) || a.package.toLowerCase().includes(q)
  )
})

async function loadApps(refresh = false) {
  loading.value = true
  errorMsg.value = ''
  try {
    const r = await api.userDevices.listApps(props.deviceId, refresh)
    if (r.status === 'success' && r.data) {
      apps.value = r.data.apps ?? []
    } else {
      errorMsg.value = r.message || r.error || 'Failed to load apps'
    }
  } catch (e) {
    errorMsg.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
}

async function launch(pkg: string) {
  launching.value = pkg
  errorMsg.value = ''
  try {
    const r = await api.userDevices.launchApp(props.deviceId, pkg)
    if (r.status === 'success') {
      emit('close')
    } else {
      errorMsg.value = r.message || r.error || 'Launch failed'
    }
  } catch (e) {
    errorMsg.value = (e as Error).message || String(e)
  } finally {
    launching.value = ''
  }
}

// Load on mount
loadApps()
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal glass-panel">
      <div class="modal-head">
        <h2>应用列表 <span class="count">{{ apps.length }}</span></h2>
        <div class="modal-actions">
          <button class="refresh-btn" :disabled="loading" @click="loadApps(true)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            刷新
          </button>
          <button class="close-btn" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <div class="search-bar">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input v-model="search" type="text" placeholder="搜索应用…" class="search-input" />
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div v-if="loading && apps.length === 0" class="loading-state">
        正在获取已安装应用…
      </div>

      <div v-else-if="filtered.length === 0 && !loading" class="empty-state">
        {{ search ? '无匹配应用' : '未获取到应用列表' }}
      </div>

      <div v-else class="app-grid">
        <button
          v-for="app in filtered"
          :key="app.package"
          class="app-btn"
          :disabled="launching !== ''"
          :class="{ launching: launching === app.package }"
          @click="launch(app.package)"
        >
          <span class="app-icon">{{ app.name[0]?.toUpperCase() }}</span>
          <span class="app-name">{{ app.name }}</span>
          <span class="app-pkg">{{ app.package }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  width: 640px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  padding: 28px 32px;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.04em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count {
  font-size: 15px;
  font-weight: 700;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  padding: 2px 10px;
  border-radius: 99px;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  border-color: #ef4444;
  color: #ef4444;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  margin-bottom: 16px;
  color: var(--text-tertiary);
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.search-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.5;
}

.error-msg {
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  color: #ef4444;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-weight: 700;
  font-size: 16px;
  opacity: 0.6;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.app-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 10px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.app-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.06);
  border-color: rgba(99, 102, 241, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.1);
}

.app-btn.launching {
  opacity: 0.5;
  pointer-events: none;
}

.app-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.app-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  font-size: 18px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-pkg {
  font-size: 14px;
  color: var(--text-tertiary);
  opacity: 0.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
