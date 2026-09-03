<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { alistApi, type AlistDriverEntry, type AlistDriverHealthResult, type AlistDriverListResult, type AlistDriverProps } from '@/api/alist'

const props = defineProps<{
  deviceId: number
  deviceName: string
  alist: AlistDriverProps
  label: (zh: string, en: string) => string
}>()

const health = ref<AlistDriverHealthResult | null>(null)
const list = ref<AlistDriverListResult | null>(null)
const pathInput = ref('/')
const copyTarget = ref('')
const selected = ref<Record<string, boolean>>({})
const loading = ref(false)
const acting = ref(false)
const error = ref('')
const message = ref('')

const mounts = computed(() => props.alist.mounts ?? [])
const selectedNames = computed(() => Object.entries(selected.value).filter(([, value]) => value).map(([name]) => name))
const currentDir = computed(() => list.value?.path || pathInput.value || '/')

onMounted(async () => {
  pathInput.value = mounts.value[0]?.path || '/'
  await Promise.allSettled([loadHealth(), openPath(pathInput.value)])
})

async function loadHealth() {
  try {
    health.value = await alistApi.health(props.deviceId)
  } catch (err) {
    error.value = errorText(err)
  }
}

async function openPath(path: string) {
  loading.value = true
  error.value = ''
  message.value = ''
  selected.value = {}
  try {
    const result = await alistApi.list(props.deviceId, path)
    list.value = result
    pathInput.value = result.path
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

function openEntry(entry: AlistDriverEntry) {
  if (entry.is_dir) {
    void openPath(entry.path)
    return
  }
  void loadDetail(entry)
}

async function loadDetail(entry: AlistDriverEntry) {
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const detail = await alistApi.get(props.deviceId, entry.path)
    message.value = detail.raw_url
      ? props.label(`已获取直链: ${detail.raw_url}`, `Resolved link: ${detail.raw_url}`)
      : props.label(`已读取文件: ${detail.name}`, `Loaded file: ${detail.name}`)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function copySelected() {
  if (selectedNames.value.length === 0 || !copyTarget.value.trim()) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await alistApi.copy(props.deviceId, currentDir.value, copyTarget.value.trim(), selectedNames.value)
    message.value = props.label(`已复制 ${result.copied ?? selectedNames.value.length} 项`, `Copied ${result.copied ?? selectedNames.value.length} item(s)`)
    selected.value = {}
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function removeSelected() {
  if (selectedNames.value.length === 0) return
  if (!window.confirm(props.label(`删除 ${selectedNames.value.length} 项？`, `Delete ${selectedNames.value.length} item(s)?`))) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await alistApi.remove(props.deviceId, currentDir.value, selectedNames.value)
    message.value = props.label(`已删除 ${result.removed ?? selectedNames.value.length} 项`, `Removed ${result.removed ?? selectedNames.value.length} item(s)`)
    await openPath(currentDir.value)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

function goParent() {
  const current = pathInput.value.replace(/\/+$/, '') || '/'
  const index = current.lastIndexOf('/')
  const parent = index <= 0 ? '/' : current.slice(0, index)
  void openPath(parent)
}

function formatSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <section class="alist-panel">
    <header class="alist-head">
      <div>
        <h2>AList Driver</h2>
        <p>{{ deviceName }} · {{ health?.version || label('未探测', 'Not probed') }}</p>
      </div>
      <button class="alist-btn" :disabled="loading || acting" @click="loadHealth">
        {{ label('健康检查', 'Health') }}
      </button>
    </header>

    <div class="mount-strip">
      <button
        v-for="mount in mounts"
        :key="mount.path"
        class="mount-chip"
        :class="{ active: pathInput === mount.path || list?.mount_path === mount.path }"
        :disabled="loading || acting"
        @click="openPath(mount.path)"
      >
        <strong>{{ mount.label || mount.path }}</strong>
        <span>{{ mount.driver }}</span>
      </button>
      <span v-if="health" class="health-pill">{{ health.status }} · {{ health.drivers.join(', ') }}</span>
    </div>

    <div class="path-row">
      <button class="alist-btn" :disabled="loading || acting" @click="goParent">{{ label('上级', 'Up') }}</button>
      <input v-model="pathInput" :disabled="loading || acting" spellcheck="false" @keydown.enter="openPath(pathInput)" />
      <button class="alist-btn primary" :disabled="loading || acting" @click="openPath(pathInput)">
        {{ label('打开', 'Open') }}
      </button>
    </div>

    <p v-if="error" class="alist-error">{{ error }}</p>
    <p v-if="message" class="alist-message">{{ message }}</p>

    <div class="copy-row">
      <input v-model="copyTarget" :disabled="acting" spellcheck="false" :placeholder="label('复制到目标路径，例如 /本地/资料', 'Copy target path, e.g. /local/files')" />
      <button class="alist-btn" :disabled="acting || selectedNames.length === 0 || !copyTarget.trim()" @click="copySelected">
        {{ label('复制', 'Copy') }} {{ selectedNames.length || '' }}
      </button>
      <button class="alist-btn danger" :disabled="acting || selectedNames.length === 0" @click="removeSelected">
        {{ label('删除', 'Remove') }} {{ selectedNames.length || '' }}
      </button>
    </div>

    <div class="file-table">
      <div class="file-row table-head">
        <span></span>
        <span>{{ label('名称', 'Name') }}</span>
        <span>{{ label('大小', 'Size') }}</span>
        <span>{{ label('来源', 'Source') }}</span>
      </div>
      <button
        v-for="entry in list?.entries ?? []"
        :key="entry.path"
        class="file-row"
        @click="openEntry(entry)"
      >
        <input v-model="selected[entry.name]" type="checkbox" @click.stop />
        <strong>{{ entry.is_dir ? 'DIR' : 'FILE' }} · {{ entry.name }}</strong>
        <span>{{ entry.is_dir ? '-' : formatSize(entry.size) }}</span>
        <span>{{ entry.driver }} · {{ entry.mount_path }}</span>
      </button>
      <div v-if="loading" class="empty-line">{{ label('加载中...', 'Loading...') }}</div>
      <div v-else-if="list && list.entries.length === 0" class="empty-line">{{ label('空目录', 'Empty directory') }}</div>
      <div v-else-if="!list" class="empty-line">{{ label('选择一个 mount 开始浏览。', 'Choose a mount to browse.') }}</div>
    </div>
  </section>
</template>

<style scoped>
.alist-panel {
  padding: 28px 32px;
}

.alist-head,
.path-row,
.copy-row,
.mount-strip {
  display: flex;
  align-items: center;
  gap: 10px;
}

.alist-head {
  justify-content: space-between;
  margin-bottom: 18px;
}

.alist-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 22px;
  font-weight: 900;
}

.alist-head p {
  margin: 5px 0 0;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
}

.mount-strip {
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.mount-chip,
.alist-btn {
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
}

.mount-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 12px;
}

.mount-chip span,
.health-pill {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.mount-chip.active,
.alist-btn.primary,
.alist-btn:hover:not(:disabled) {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.alist-btn {
  padding: 0 12px;
}

.alist-btn.danger:hover:not(:disabled) {
  border-color: #dc2626;
  background: #fef2f2;
  color: #b91c1c;
}

.alist-btn:disabled,
.mount-chip:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.path-row,
.copy-row {
  margin-top: 12px;
}

.path-row input,
.copy-row input {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 11px;
  color: #0f172a;
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
}

.alist-error,
.alist-message {
  margin: 12px 0 0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 800;
}

.alist-error {
  background: #fef2f2;
  color: #b91c1c;
}

.alist-message {
  background: #ecfdf5;
  color: #047857;
  overflow-wrap: anywhere;
}

.file-table {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.file-row {
  width: 100%;
  min-height: 42px;
  border: 0;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 110px 180px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  color: #334155;
  text-align: left;
}

button.file-row {
  cursor: pointer;
}

button.file-row:hover {
  background: #f8fafc;
}

.file-row strong,
.file-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-head {
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.empty-line {
  padding: 24px;
  color: #64748b;
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

@media (max-width: 760px) {
  .alist-panel {
    padding: 20px;
  }

  .alist-head,
  .path-row,
  .copy-row {
    align-items: stretch;
    flex-direction: column;
  }

  .file-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .file-row span:nth-child(3),
  .file-row span:nth-child(4) {
    display: none;
  }
}
</style>
