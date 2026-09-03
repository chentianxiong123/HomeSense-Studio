<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api'
import AdbFilesPanel from '@/components/adb/AdbFilesPanel.vue'
import { useAdbFiles } from '@/composables/useAdbFiles'
import { useLocale } from '@/composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale } = useLocale()

const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

const statusMessage = ref('')
const errorMessage = ref('')
const resolvedAdb = ref('')
const resolvedName = ref('')
const adbRootPath = '/sdcard/'

const adbDevice = computed(() => {
  const value = route.query.device
  return typeof value === 'string' ? value.trim() : ''
})

const deviceName = computed(() => {
  const value = route.query.name
  return typeof value === 'string' && value.trim() ? value.trim() : resolvedName.value || resolvedAdb.value || label('ADB 文件', 'ADB Files')
})

function returnPath() {
  const from = route.query.from
  return typeof from === 'string' && from.startsWith('/') ? from : '/devices'
}

async function resolveAdbDevice(): Promise<string> {
  if (adbDevice.value) return adbDevice.value
  if (resolvedAdb.value) return resolvedAdb.value
  const id = Number(route.query.target_device_id)
  if (!Number.isFinite(id)) return ''
  const result = await api.userDevices.get(id)
  const props = result.device?.props ?? {}
  resolvedName.value = result.device?.name ?? ''
  const value = props.adb_ip || props.adb_serial
  resolvedAdb.value = typeof value === 'string' ? value.trim() : ''
  return resolvedAdb.value
}

const {
  fileLoading,
  filePath,
  fileInputPath,
  fileParent,
  filePreview,
  adbFileList,
  loadFiles,
  openFile,
} = useAdbFiles({
  adbIp: () => resolvedAdb.value || adbDevice.value,
  deviceName: () => deviceName.value,
  label,
  statusMessage,
  errorMessage,
})

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

async function initialize() {
  errorMessage.value = ''
  statusMessage.value = label('正在读取 ADB 来源...', 'Resolving ADB source...')
  const device = await resolveAdbDevice()
  if (!device) {
    errorMessage.value = label('这个设备没有 ADB 来源。', 'This device has no ADB source.')
    statusMessage.value = ''
    return
  }
  resolvedAdb.value = device
  await loadFiles(fileInputPath.value)
}

function refreshFiles(path = filePath.value || fileInputPath.value) {
  void loadFiles(path)
}

function openParent(path = fileParent.value || adbRootPath) {
  if (!filePath.value || filePath.value === adbRootPath || filePath.value === adbRootPath.replace(/\/$/, '')) {
    void loadFiles(adbRootPath)
    return
  }
  void loadFiles(path)
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="adb-files-view">
    <header class="files-bar">
      <button class="bar-btn" @click="router.push(returnPath())">← {{ label('返回', 'Back') }}</button>
      <div class="files-title">
        <strong>{{ deviceName }}</strong>
        <span>{{ resolvedAdb || adbDevice || route.query.target_device_id || '-' }}</span>
      </div>
      <span v-if="statusMessage" class="status-text">{{ statusMessage }}</span>
      <span v-if="errorMessage" class="status-text error">{{ errorMessage }}</span>
      <button class="bar-btn" :disabled="fileLoading" @click="refreshFiles()">
        {{ label('刷新', 'Refresh') }}
      </button>
    </header>

    <main class="files-stage">
      <AdbFilesPanel
        v-model:path-input="fileInputPath"
        class="files-panel"
        :adb-ip="resolvedAdb || adbDevice"
        :current-path="filePath"
        :parent-path="fileParent"
        :list="adbFileList"
        :preview="filePreview"
        :loading="fileLoading"
        :error="errorMessage"
        :label="label"
        :format-bytes="formatBytes"
        @refresh="refreshFiles"
        @parent="openParent"
        @open-entry="openFile"
        @open-path="loadFiles"
      />
    </main>
  </div>
</template>

<style scoped>
.adb-files-view {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f8fafc;
  color: #0f172a;
}

.files-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
  font-size: 13px;
}

.files-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.files-title strong,
.files-title span,
.status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-title strong {
  font-size: 14px;
}

.files-title span {
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.status-text {
  max-width: 34vw;
  color: #2563eb;
  font-weight: 800;
}

.status-text.error {
  color: #dc2626;
}

.bar-btn {
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  padding: 5px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

.bar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.files-stage {
  min-height: 0;
  flex: 1;
  padding: 12px;
  overflow: hidden;
}

.files-panel {
  height: 100%;
}

.files-panel :deep(.files-panel-wrap),
.files-panel :deep(.remote-file-browser) {
  height: 100%;
  min-height: 0;
}

.files-panel :deep(.remote-file-browser) {
  display: flex;
  flex-direction: column;
}

.files-panel :deep(.browser-grid) {
  min-height: 0;
  flex: 1;
}

@media (max-width: 700px) {
  .files-bar {
    flex-wrap: wrap;
  }

  .status-text {
    order: 3;
    max-width: 100%;
    width: 100%;
  }

  .files-stage {
    padding: 8px;
  }
}
</style>
