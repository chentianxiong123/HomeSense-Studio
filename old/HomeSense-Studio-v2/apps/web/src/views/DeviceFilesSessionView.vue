<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AlistDriverEntry, AlistDriverListResult } from '@/api/alist'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList } from '@/api/remoteWorkspace'
import { storageApi } from '@/api/storage'
import RemoteFileBrowserPanel from '@/components/RemoteFileBrowserPanel.vue'
import { useLocale } from '@/composables/useLocale'
import { formatSize } from '@/utils/storageWorkbench'

const route = useRoute()
const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function formatFileSize(value: number | null) {
  return value == null ? '-' : formatSize(value)
}

const deviceId = computed(() => Number(route.query.target_device_id || route.query.device_id || 0))
const deviceName = computed(() => typeof route.query.name === 'string' ? route.query.name : label('设备文件', 'Device Files'))
const returnTo = computed(() => typeof route.query.from === 'string' && route.query.from.startsWith('/') ? route.query.from : '/devices')

const list = ref<AlistDriverListResult | null>(null)
const pathInput = ref('/')
const loading = ref(false)
const error = ref('')
const message = ref('')

const fileList = computed<RemoteWorkspaceFileList | null>(() => {
  if (!list.value) return null
  return {
    target_id: `device:${deviceId.value}`,
    label: deviceName.value,
    kind: 'storage',
    root: list.value.mount_path || '/',
    path: list.value.path,
    absolute_path: list.value.path,
    entries: list.value.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.is_dir ? 'directory' : 'file',
      size: entry.is_dir ? null : entry.size,
      modified_at: entry.modified ?? null,
    })),
    truncated: false,
  }
})

onMounted(async () => {
  await openDeviceRoot()
})

async function openDeviceRoot() {
  if (!deviceId.value) {
    error.value = label('缺少设备 ID', 'Missing device id')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const entry = await storageApi.deviceFilesEntry(deviceId.value)
    await openPath(entry.path)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function openPath(path: string) {
  if (!path.trim()) return
  loading.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.list(path)
    list.value = result
    pathInput.value = result.path
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function openEntry(entry: AlistDriverEntry | RemoteWorkspaceFileEntry) {
  if ('is_dir' in entry ? entry.is_dir : entry.type === 'directory') {
    void openPath(entry.path)
    return
  }
  void loadDetail(entry.path)
}

async function loadDetail(path: string) {
  loading.value = true
  error.value = ''
  try {
    const detail = await storageApi.get(path)
    message.value = detail.raw_url || label(`已读取文件: ${detail.name}`, `Loaded file: ${detail.name}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function goParent() {
  const current = pathInput.value.replace(/\/+$/, '') || '/'
  const index = current.lastIndexOf('/')
  const parent = index <= 0 ? '/' : current.slice(0, index)
  void openPath(parent)
}

function goBack() {
  router.push(returnTo.value)
}
</script>

<template>
  <div class="device-files-session">
    <header class="session-bar">
      <button class="bar-btn" @click="goBack">{{ label('返回', 'Back') }}</button>
      <div class="title">
        <strong>{{ deviceName }}</strong>
        <small>{{ label('SSH/SFTP 文件系统', 'SSH/SFTP Filesystem') }}</small>
      </div>
      <button class="bar-btn" :disabled="loading" @click="openDeviceRoot">{{ label('根目录', 'Root') }}</button>
    </header>
    <p v-if="message" class="message-line">{{ message }}</p>
    <RemoteFileBrowserPanel
      class="browser"
      :title="label('设备文件', 'Device Files')"
      :subtitle="deviceName"
      :list="fileList"
      :preview="null"
      :loading="loading"
      :error="error"
      :path-input="pathInput"
      root-fallback="/"
      :empty-text="label('空目录', 'Empty directory')"
      :loading-text="label('正在读取目录...', 'Loading directory...')"
      :preview-hint="label('点开文件会读取详情。', 'Click a file to load details.')"
      :label="label"
      :format-file-size="formatFileSize"
      @refresh="openPath(pathInput)"
      @parent="goParent"
      @open-entry="openEntry"
      @open-path="openPath"
      @update:path-input="pathInput = $event"
    />
  </div>
</template>

<style scoped>
.device-files-session {
  min-height: 100vh;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}

.session-bar {
  min-height: 58px;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title strong {
  color: #0f172a;
  font-size: 14px;
}

.title small {
  color: #64748b;
  font-size: 12px;
}

.bar-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  padding: 0 12px;
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
}

.bar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.message-line {
  margin: 10px 14px 0;
  color: #047857;
  font-size: 12px;
  font-weight: 800;
}

.browser {
  flex: 1;
  min-height: 0;
  margin: 14px;
}
</style>
