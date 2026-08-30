<script setup lang="ts">
import { computed, ref } from 'vue'
import { cliApi } from '@/api/cli'

const props = defineProps<{ deviceId: number; adbIp: string }>()
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
    const r = await cliApi.run<{ apps: Array<{ package: string; name: string }> }>('adb-cli', {
      action: 'list_packages',
      params: { device: props.adbIp },
      ttl_ms: 60_000,
      bypass_cache: refresh,
    })
    if (r.status === 'success' && r.data) {
      const raw = r.data.apps ?? []
      apps.value = raw.map((pkg: any) =>
        typeof pkg === 'string'
          ? { package: pkg, name: pkg.split('.').pop() ?? pkg }
          : { package: pkg.package, name: pkg.name ?? pkg.package.split('.').pop() ?? pkg.package }
      )
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
    const r = await cliApi.run('adb-cli', {
      action: 'launch_app',
      params: { device: props.adbIp, package: pkg },
      ttl_ms: 0,
      bypass_cache: true,
    })
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

loadApps()
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header class="head">
        <h2>已安装应用</h2>
        <button class="close-btn" @click="emit('close')">×</button>
      </header>
      <div class="toolbar">
        <input v-model="search" class="search" placeholder="搜索应用..." />
        <button class="reload-btn" :disabled="loading" @click="loadApps(true)">刷新</button>
      </div>
      <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
      <div v-else-if="loading" class="loading">加载中…</div>
      <div v-else-if="filtered.length === 0" class="empty">没有匹配的应用</div>
      <ul v-else class="app-list">
        <li v-for="app in filtered" :key="app.package" class="app-row">
          <div class="app-info">
            <strong>{{ app.name }}</strong>
            <code>{{ app.package }}</code>
          </div>
          <button class="launch-btn" :disabled="launching === app.package" @click="launch(app.package)">
            {{ launching === app.package ? '启动中…' : '启动' }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}
.modal {
  width: min(560px, 100%);
  max-height: 80vh;
  background: #fff;
  border-radius: 18px;
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.2);
}
.head { display: flex; justify-content: space-between; align-items: center; }
.head h2 { margin: 0; font-size: 20px; }
.close-btn { background: transparent; border: 0; font-size: 28px; cursor: pointer; color: #64748b; }
.toolbar { display: flex; gap: 8px; }
.search { flex: 1; padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 14px; }
.reload-btn { padding: 10px 18px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; cursor: pointer; font-weight: 700; }
.error { color: #ef4444; padding: 12px 0; }
.loading, .empty { padding: 32px 0; text-align: center; color: #64748b; }
.app-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; max-height: 50vh; }
.app-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
.app-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.app-info strong { font-size: 14px; }
.app-info code { font-size: 12px; color: #64748b; font-family: ui-monospace, monospace; }
.launch-btn { padding: 8px 16px; background: #6366f1; color: #fff; border: 0; border-radius: 10px; cursor: pointer; font-weight: 700; }
.launch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
