<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { alistApi, type AlistAuthorizationRecord, type AlistDriverEntry, type AlistDriverHealthResult, type AlistDriverListResult } from '@/api/alist'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList } from '@/api/remoteWorkspace'
import { storageApi, type StorageMountRecord, type StorageTaskRecord } from '@/api/storage'
import StorageFileWorkbenchPanel from '@/components/storage/StorageFileWorkbenchPanel.vue'
import StorageMountDialog from '@/components/storage/StorageMountDialog.vue'
import StorageMountList from '@/components/storage/StorageMountList.vue'
import StorageWorkbenchHeader from '@/components/storage/StorageWorkbenchHeader.vue'
import { useLocale } from '@/composables/useLocale'
import {
  authSummary,
  defaultMountPath,
  errorText,
  formatSize,
  joinVirtualPath,
  normalizeVirtualPath,
  propsSafeMessage,
} from '@/utils/storageWorkbench'

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
const mountFormSaving = computed(() => isBusy('mount-create') || (editingMountId.value ? isBusy(`mount-edit-${editingMountId.value}`) : false))
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

function authorizationName(id: number): string {
  const auth = authorizations.value.find((item) => item.id === id)
  return auth ? auth.name : `#${id}`
}
</script>

<template>
  <main class="storage-page">
    <StorageWorkbenchHeader
      :disabled="loading || acting"
      :can-create-mount="authorizations.length > 0"
      :label="label"
      @refresh="refreshAll"
      @open-authorizations="router.push('/authorizations')"
      @create-mount="openCreateMount()"
    />

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice success">{{ message }}</div>

    <StorageMountList
      :authorizations="authorizations"
      :mounts="mounts"
      :health="health"
      :active-mount-path="list?.mount_path"
      :path-input="pathInput"
      :disabled="loading || acting"
      :label="label"
      :authorization-name="authorizationName"
      :is-busy="isBusy"
      @create="openCreateMount()"
      @open="openPath"
      @edit="openEditMount"
      @delete="deleteMount"
    />

    <StorageFileWorkbenchPanel
      v-model:copy-target="copyTarget"
      v-model:new-folder-name="newFolderName"
      v-model:path-input="pathInput"
      v-model:selected="selected"
      :selected-count="selectedNames.length"
      :acting="acting"
      :loading="loading"
      :has-list="Boolean(list)"
      :tasks="tasks"
      :file-list="storageFileList"
      :provider-label="list ? `${list.provider} · ${list.mount_path || '/'}` : label('选择或创建一个系统挂载开始浏览。', 'Choose or create a system mount to browse.')"
      :current-dir="currentDir"
      :error="error"
      :label="label"
      :format-file-size="(value) => formatSize(value ?? 0)"
      @copy="copySelected"
      @copy-task="copySelectedTask"
      @download="downloadSelected"
      @upload="uploadSelectedFile"
      @create-folder="createFolder"
      @remove="removeSelected"
      @refresh-tasks="loadTasks"
      @refresh-path="openPath"
      @parent="goParent"
      @open-entry="openEntry"
      @open-path="openPath"
    />

    <StorageMountDialog
      :open="mountFormOpen"
      :editing="Boolean(editingMountId)"
      :authorizations="authorizations"
      :selected-authorization="selectedAuthorization"
      :authorization-id="mountAuthorizationId"
      :name="mountName"
      :path="mountPath"
      :readonly="mountReadonly"
      :saving="mountFormSaving"
      :label="label"
      :auth-summary="authSummary"
      @close="closeMountForm"
      @submit="submitMount"
      @update:authorization-id="mountAuthorizationId = $event"
      @update:name="mountName = $event"
      @update:path="mountPath = $event"
      @update:readonly="mountReadonly = $event"
    />
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

.notice {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
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

@media (max-width: 760px) {
  .storage-page {
    padding: 16px;
  }
}
</style>
