<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { alistApi, type AlistAuthorizationRecord, type AlistDriverEntry, type AlistDriverHealthResult, type AlistDriverListResult } from '@/api/alist'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList } from '@/api/remoteWorkspace'
import { storageApi, type StorageMountRecord, type StorageTaskRecord } from '@/api/storage'
import RemoteFileBrowserPanel from '@/components/RemoteFileBrowserPanel.vue'
import { useLocale } from '@/composables/useLocale'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const authorizations = ref<AlistAuthorizationRecord[]>([])
const mounts = ref<StorageMountRecord[]>([])
const health = ref<AlistDriverHealthResult | null>(null)
const list = ref<AlistDriverListResult | null>(null)
const pathInput = ref('/')
const copyTarget = ref('')
const newFolderName = ref('')
const selected = ref<Record<string, boolean>>({})
const uploadInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const acting = ref(false)
const error = ref('')
const message = ref('')
const tasks = ref<StorageTaskRecord[]>([])

const mountFormOpen = ref(false)
const editingMountId = ref<number | null>(null)
const mountName = ref('')
const mountPath = ref('')
const mountAuthorizationId = ref<number | null>(null)
const mountReadonly = ref(false)

const selectedNames = computed(() => Object.entries(selected.value).filter(([, value]) => value).map(([name]) => name))
const currentDir = computed(() => list.value?.path || pathInput.value || '/')
const selectedAuthorization = computed(() => authorizations.value.find((item) => item.id === mountAuthorizationId.value) ?? null)
const storageFileList = computed<RemoteWorkspaceFileList | null>(() => {
  if (!list.value) return null
  return {
    target_id: 'storage:system',
    label: label('中枢文件层', 'Hub Storage'),
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
  await loadWorkbench()
})

async function loadWorkbench() {
  error.value = ''
  await Promise.allSettled([loadAuthorizations(), loadMounts(), loadHealth(), loadTasks()])
  if (!list.value && mounts.value.length > 0) {
    await openPath(mounts.value[0].virtual_path)
  }
}

async function loadAuthorizations() {
  const result = await alistApi.listAuthorizations()
  authorizations.value = result.authorizations ?? []
}

async function loadMounts() {
  const result = await storageApi.listMounts()
  mounts.value = result.mounts ?? []
}

async function loadHealth() {
  try {
    health.value = await storageApi.health()
  } catch {
    health.value = null
  }
}

async function loadTasks() {
  try {
    const result = await storageApi.tasks()
    tasks.value = result.tasks ?? []
  } catch {
    tasks.value = []
  }
}

async function refreshAll() {
  await loadWorkbench()
  if (list.value) await openPath(currentDir.value)
}

async function openPath(path: string) {
  if (!path.trim()) return
  loading.value = true
  error.value = ''
  message.value = ''
  selected.value = {}
  try {
    const result = await storageApi.list(path)
    list.value = result
    pathInput.value = result.path
  } catch (err) {
    error.value = errorText(err)
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

async function loadDetail(entryPath: string) {
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const detail = await storageApi.get(entryPath)
    message.value = detail.raw_url
      ? propsSafeMessage(label('已获取直链', 'Resolved link'), detail.raw_url)
      : label(`已读取文件: ${detail.name}`, `Loaded file: ${detail.name}`)
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
    const result = await storageApi.copy(currentDir.value, copyTarget.value.trim(), selectedNames.value)
    message.value = label(`已复制 ${result.copied ?? selectedNames.value.length} 项`, `Copied ${result.copied ?? selectedNames.value.length} item(s)`)
    selected.value = {}
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function copySelectedTask() {
  if (selectedNames.value.length === 0 || !copyTarget.value.trim()) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.copyTask(currentDir.value, copyTarget.value.trim(), selectedNames.value)
    message.value = label(`后台任务已创建: ${result.task.id}`, `Background task created: ${result.task.id}`)
    selected.value = {}
    await loadTasks()
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function createFolder() {
  const name = newFolderName.value.trim()
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    error.value = label('文件夹名称无效', 'Invalid folder name')
    return
  }
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    await storageApi.mkdir(joinVirtualPath(currentDir.value, name))
    newFolderName.value = ''
    message.value = label('文件夹已创建', 'Folder created')
    await openPath(currentDir.value)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

function downloadSelected() {
  const name = selectedNames.value[0]
  if (!name) return
  window.open(storageApi.downloadUrl(joinVirtualPath(currentDir.value, name)), '_blank', 'noopener,noreferrer')
}

function chooseUpload() {
  uploadInput.value?.click()
}

async function uploadSelectedFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    await storageApi.upload(joinVirtualPath(currentDir.value, file.name), file)
    message.value = label('文件已上传', 'File uploaded')
    await openPath(currentDir.value)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function removeSelected() {
  if (selectedNames.value.length === 0) return
  if (!window.confirm(label(`删除 ${selectedNames.value.length} 项？`, `Delete ${selectedNames.value.length} item(s)?`))) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.remove(currentDir.value, selectedNames.value)
    message.value = label(`已删除 ${result.removed ?? selectedNames.value.length} 项`, `Removed ${result.removed ?? selectedNames.value.length} item(s)`)
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

function openCreateMount(auth?: AlistAuthorizationRecord) {
  const target = auth ?? authorizations.value[0] ?? null
  editingMountId.value = null
  mountAuthorizationId.value = target?.id ?? null
  mountName.value = target?.name ?? ''
  mountPath.value = target ? defaultMountPath(target) : ''
  mountReadonly.value = false
  mountFormOpen.value = true
}

function openEditMount(mount: StorageMountRecord) {
  editingMountId.value = mount.id
  mountAuthorizationId.value = mount.authorization_id
  mountName.value = mount.name
  mountPath.value = mount.virtual_path
  mountReadonly.value = mount.readonly
  mountFormOpen.value = true
}

function closeMountForm() {
  mountFormOpen.value = false
  editingMountId.value = null
}

async function submitMount() {
  const auth = selectedAuthorization.value
  const name = mountName.value.trim()
  const virtualPath = normalizeVirtualPath(mountPath.value)
  if (!auth || !name || !virtualPath) return

  const body = {
    name,
    virtual_path: virtualPath,
    driver: auth.driver,
    authorization_id: auth.id,
    readonly: mountReadonly.value,
    props: {},
  }

  const key = editingMountId.value ? `mount-edit-${editingMountId.value}` : 'mount-create'
  setActingMessage('')
  setBusy(key, true)
  try {
    if (editingMountId.value) {
      await storageApi.updateMount(editingMountId.value, body)
      message.value = label('挂载已更新', 'Mount updated')
    } else {
      await storageApi.createMount(body)
      message.value = label('挂载已创建', 'Mount created')
    }
    closeMountForm()
    await loadMounts()
    await loadHealth()
    await openPath(virtualPath)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    setBusy(key, false)
  }
}

async function deleteMount(mount: StorageMountRecord) {
  if (!window.confirm(label(`删除挂载「${mount.name}」？`, `Delete mount "${mount.name}"?`))) return
  const key = `mount-delete-${mount.id}`
  setBusy(key, true)
  error.value = ''
  message.value = ''
  try {
    await storageApi.removeMount(mount.id)
    await loadMounts()
    await loadHealth()
    if (list.value?.mount_path === mount.virtual_path || pathInput.value.startsWith(`${mount.virtual_path}/`)) {
      list.value = null
      pathInput.value = mounts.value[0]?.virtual_path ?? '/'
    }
    message.value = label('挂载已删除', 'Mount removed')
  } catch (err) {
    error.value = errorText(err)
  } finally {
    setBusy(key, false)
  }
}

const busy = ref<Record<string, boolean>>({})

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

function setActingMessage(value: string) {
  error.value = ''
  message.value = value
}

function defaultMountPath(auth: AlistAuthorizationRecord): string {
  const base = auth.name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return `/${base || auth.driver || 'storage'}`
}

function normalizeVirtualPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized) return ''
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.replace(/\/+$/, '') || '/'
}

function joinVirtualPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '') || '/'}/${name}`.replace(/\/+/g, '/')
}

function authorizationName(id: number): string {
  const auth = authorizations.value.find((item) => item.id === id)
  return auth ? auth.name : `#${id}`
}

function authSummary(auth: AlistAuthorizationRecord): string {
  const rootPath = typeof auth.props?.root_path === 'string' ? auth.props.root_path : ''
  if (auth.driver === 'local') return rootPath || auth.endpoint
  return [auth.endpoint, rootPath].filter(Boolean).join(' · ')
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

function propsSafeMessage(prefix: string, value: string): string {
  return `${prefix}: ${value}`
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<template>
  <main class="storage-page">
    <header class="page-head">
      <div>
        <span class="eyebrow">{{ label('中枢文件层', 'Hub Storage') }}</span>
        <h1>{{ label('文件工作台', 'Storage Workbench') }}</h1>
      </div>
      <div class="head-actions">
        <button class="plain-btn" :disabled="loading || acting" @click="refreshAll">{{ label('刷新', 'Refresh') }}</button>
        <button class="plain-btn" @click="router.push('/authorizations')">{{ label('授权中心', 'Authorizations') }}</button>
        <button class="primary-btn" :disabled="authorizations.length === 0" @click="openCreateMount()">{{ label('新增挂载', 'Add Mount') }}</button>
      </div>
    </header>

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice success">{{ message }}</div>

    <section class="mount-band">
      <div class="mount-head">
        <div>
          <strong>{{ label('系统挂载', 'System Mounts') }}</strong>
          <small>{{ health ? `${health.status} · ${health.drivers.join(', ')}` : label('等待探测', 'Pending probe') }}</small>
        </div>
        <button class="plain-btn compact" :disabled="authorizations.length === 0" @click="openCreateMount()">{{ label('创建挂载', 'Create Mount') }}</button>
      </div>

      <div v-if="authorizations.length === 0" class="empty-line left">
        {{ label('还没有可用授权。先在授权中心保存 WebDAV 或本地目录凭据。', 'No authorization is available. Save a WebDAV or local folder credential first.') }}
      </div>

      <div v-else-if="mounts.length === 0" class="empty-line left">
        {{ label('已有授权，但还没有系统挂载。创建挂载后，这里会成为 HomeSense 的统一文件入口。', 'Authorizations exist, but no system mount is configured yet. Create a mount to make it available in HomeSense storage.') }}
      </div>

      <div v-else class="mount-grid">
        <article
          v-for="mount in mounts"
          :key="mount.id"
          class="mount-item"
          :class="{ active: list?.mount_path === mount.virtual_path || pathInput === mount.virtual_path }"
        >
          <button class="mount-main" :disabled="loading || acting" @click="openPath(mount.virtual_path)">
            <strong>{{ mount.name }}</strong>
            <code>{{ mount.virtual_path }}</code>
            <small>{{ mount.driver }} · {{ authorizationName(mount.authorization_id) }}{{ mount.readonly ? ` · ${label('只读', 'Readonly')}` : '' }}</small>
          </button>
          <div class="mount-actions">
            <button class="plain-btn compact" @click="openEditMount(mount)">{{ label('编辑', 'Edit') }}</button>
            <button class="danger-btn compact" :disabled="isBusy(`mount-delete-${mount.id}`)" @click="deleteMount(mount)">{{ label('删除', 'Delete') }}</button>
          </div>
        </article>
      </div>
    </section>

    <section class="file-workbench">
      <div class="copy-row">
        <input v-model="copyTarget" :disabled="acting" spellcheck="false" :placeholder="label('复制到目标路径，例如 /资料/电影', 'Copy target path, e.g. /files/movies')" />
        <button class="plain-btn" :disabled="acting || selectedNames.length === 0 || !copyTarget.trim()" @click="copySelected">
          {{ label('复制', 'Copy') }} {{ selectedNames.length || '' }}
        </button>
        <button class="plain-btn" :disabled="acting || selectedNames.length === 0 || !copyTarget.trim()" @click="copySelectedTask">
          {{ label('后台复制目录', 'Copy Tree') }} {{ selectedNames.length || '' }}
        </button>
        <button class="plain-btn" :disabled="acting || selectedNames.length === 0" @click="downloadSelected">
          {{ label('下载', 'Download') }}
        </button>
        <button class="plain-btn" :disabled="acting || !list" @click="chooseUpload">
          {{ label('上传', 'Upload') }}
        </button>
        <input ref="uploadInput" class="hidden-file-input" type="file" @change="uploadSelectedFile" />
        <input v-model="newFolderName" :disabled="acting || !list" spellcheck="false" :placeholder="label('新文件夹名称', 'New folder name')" @keydown.enter="createFolder" />
        <button class="plain-btn" :disabled="acting || !list || !newFolderName.trim()" @click="createFolder">
          {{ label('新建文件夹', 'New Folder') }}
        </button>
        <button class="danger-btn" :disabled="acting || selectedNames.length === 0" @click="removeSelected">
          {{ label('删除', 'Remove') }} {{ selectedNames.length || '' }}
        </button>
      </div>

      <div v-if="tasks.length > 0" class="task-strip">
        <button class="plain-btn compact" :disabled="acting" @click="loadTasks">{{ label('刷新任务', 'Refresh Tasks') }}</button>
        <div v-for="task in tasks.slice(0, 4)" :key="task.id" class="task-chip" :class="task.status">
          <strong>{{ task.kind }} · {{ task.status }}</strong>
          <small>{{ task.error || `${task.message || ''}${task.message ? ' · ' : ''}${task.progress}%` }}</small>
        </div>
      </div>

      <RemoteFileBrowserPanel
        :title="label('统一文件浏览器', 'Unified File Browser')"
        :subtitle="list ? `${list.provider} · ${list.mount_path || '/'}` : label('选择或创建一个系统挂载开始浏览。', 'Choose or create a system mount to browse.')"
        :list="storageFileList"
        :preview="null"
        :loading="loading || acting"
        :error="error"
        :path-input="pathInput"
        :selectable="true"
        :selected="selected"
        root-fallback="/"
        :empty-text="label('空目录', 'Empty directory')"
        :loading-text="label('正在读取目录...', 'Loading directory...')"
        :preview-hint="label('点开文件会读取详情；支持直链的来源会返回直链。', 'Click a file to load details; sources with direct links will return a URL.')"
        :label="label"
        :format-file-size="(value) => formatSize(value ?? 0)"
        @refresh="openPath(currentDir)"
        @parent="goParent"
        @open-entry="openEntry"
        @open-path="openPath"
        @update:path-input="pathInput = $event"
        @update:selected="selected = $event"
      />
    </section>

    <Teleport to="body">
      <div v-if="mountFormOpen" class="dialog-overlay" @click.self="closeMountForm">
        <form class="dialog-panel" @submit.prevent="submitMount">
          <div class="dialog-head">
            <div>
              <span class="eyebrow">{{ label('系统挂载', 'System Mount') }}</span>
              <h2>{{ editingMountId ? label('编辑挂载', 'Edit Mount') : label('新增挂载', 'Add Mount') }}</h2>
            </div>
            <button type="button" class="plain-btn compact" @click="closeMountForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field full">
              <span>{{ label('授权', 'Authorization') }}</span>
              <select v-model.number="mountAuthorizationId" class="form-input">
                <option v-for="auth in authorizations" :key="auth.id" :value="auth.id">
                  {{ auth.name }} · {{ auth.driver }}
                </option>
              </select>
              <small v-if="selectedAuthorization">{{ authSummary(selectedAuthorization) }}</small>
            </label>

            <label class="form-field">
              <span>{{ label('显示名称', 'Name') }}</span>
              <input v-model="mountName" class="form-input" :placeholder="label('家庭资料', 'Home Files')" />
            </label>

            <label class="form-field">
              <span>{{ label('虚拟路径', 'Virtual Path') }}</span>
              <input v-model="mountPath" class="form-input" placeholder="/资料" />
            </label>

            <label class="check-field full">
              <input v-model="mountReadonly" type="checkbox" />
              <span>{{ label('只读挂载', 'Readonly mount') }}</span>
            </label>
          </div>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeMountForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!selectedAuthorization || !mountName.trim() || !mountPath.trim() || isBusy('mount-create') || (editingMountId ? isBusy(`mount-edit-${editingMountId}`) : false)"
            >
              {{ editingMountId ? label('保存', 'Save') : label('创建', 'Create') }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.storage-page {
  min-height: 100%;
  overflow-y: auto;
  padding: 32px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page-head,
.mount-band,
.file-workbench,
.notice {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.page-head {
  min-height: 96px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h1,
h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-weight: 900;
  letter-spacing: 0;
}

h1 {
  font-size: 30px;
}

h2 {
  font-size: 24px;
}

.head-actions,
.mount-actions,
.dialog-actions,
.path-row,
.copy-row,
.task-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mount-band,
.file-workbench {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mount-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mount-head > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mount-head strong,
.mount-main strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.mount-head small,
.mount-main small,
.form-field small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.mount-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.mount-item {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 12px;
}

.mount-item.active {
  border-color: #14b8a6;
  background: #f0fdfa;
}

.mount-main {
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
}

.path-row input,
.copy-row input {
  flex: 1;
  min-width: 180px;
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

.task-strip {
  min-height: 44px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 8px;
}

.task-chip {
  min-width: 150px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-chip strong {
  color: #0f172a;
  font-size: 12px;
  font-weight: 900;
}

.task-chip small {
  color: #64748b;
  font-size: 11px;
  font-weight: 750;
}

.task-chip.success {
  border-color: rgba(15, 118, 110, 0.24);
  background: #f0fdfa;
}

.task-chip.error {
  border-color: #fecaca;
  background: #fef2f2;
}

.hidden-file-input {
  display: none;
}

.file-table {
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
  grid-template-columns: 34px minmax(0, 1fr) 110px 220px;
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
  padding: 18px;
  text-align: center;
}

.empty-line.left {
  text-align: left;
}

.notice {
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 800;
}

.notice.error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.notice.success {
  border-color: #bbf7d0;
  background: #ecfdf5;
  color: #047857;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
}

.plain-btn:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f766e;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.compact {
  min-height: 30px;
  padding: 0 9px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.dialog-panel {
  width: min(520px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-field,
.check-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field.full,
.check-field.full {
  grid-column: 1 / -1;
}

.form-field span,
.check-field span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.check-field {
  flex-direction: row;
  align-items: center;
}

.form-input {
  width: 100%;
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  outline: none;
  padding: 0 10px;
}

.form-input:focus {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
}

.dialog-actions {
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .storage-page {
    padding: 16px;
  }

  .page-head,
  .mount-head,
  .path-row,
  .copy-row {
    align-items: stretch;
    flex-direction: column;
  }

  .head-actions {
    width: 100%;
  }

  .mount-item {
    grid-template-columns: 1fr;
  }

  .mount-actions {
    justify-content: flex-start;
  }

  .file-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .file-row span:nth-child(3),
  .file-row span:nth-child(4) {
    display: none;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
