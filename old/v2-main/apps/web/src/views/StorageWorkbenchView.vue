<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice } from '@/api'
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

type PaneKey = 'left' | 'right'
type StorageSourceKind = 'local' | 'device' | 'cloud'

interface StoragePaneState {
  list: AlistDriverListResult | null
  pathInput: string
  selected: Record<string, boolean>
  loading: boolean
  error: string
}

interface StorageSourceGroup {
  kind: StorageSourceKind
  title: string
  subtitle: string
  mounts: StorageMountRecord[]
  pendingDevices?: StorageDeviceSource[]
}

interface StorageDeviceSource {
  id: number
  name: string
  subtitle: string
}

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const authorizations = ref<AlistAuthorizationRecord[]>([])
const mounts = ref<StorageMountRecord[]>([])
const devices = ref<UserDevice[]>([])
const health = ref<AlistDriverHealthResult | null>(null)
const panes = ref<Record<PaneKey, StoragePaneState>>({
  left: { list: null, pathInput: '/', selected: {}, loading: false, error: '' },
  right: { list: null, pathInput: '/', selected: {}, loading: false, error: '' },
})
const activePane = ref<PaneKey>('left')
const acting = ref(false)
const error = ref('')
const message = ref('')
const tasks = ref<StorageTaskRecord[]>([])
const sourcesOpen = ref(false)

const mountFormOpen = ref(false)
const editingMountId = ref<number | null>(null)
const mountName = ref('')
const mountPath = ref('')
const mountAuthorizationId = ref<number | null>(null)
const mountReadonly = ref(false)
const transferConfirm = ref<{ sourcePane: PaneKey; targetPane: PaneKey; names: string[] } | null>(null)

const selectedAuthorization = computed(() => authorizations.value.find((item) => item.id === mountAuthorizationId.value) ?? null)
const mountFormSaving = computed(() => isBusy('mount-create') || (editingMountId.value ? isBusy(`mount-edit-${editingMountId.value}`) : false))
const activePathInput = computed(() => panes.value[activePane.value].pathInput)
const anyPaneLoading = computed(() => panes.value.left.loading || panes.value.right.loading)
const paneModels = computed(() => ({
  left: paneView('left'),
  right: paneView('right'),
}))
const sourceGroups = computed<StorageSourceGroup[]>(() => buildSourceGroups())

onMounted(async () => {
  await loadWorkbench()
})

function paneView(pane: PaneKey) {
  const state = panes.value[pane]
  return {
    title: pane === 'left' ? label('面板 A', 'Pane A') : label('面板 B', 'Pane B'),
    subtitle: state.list ? `${state.list.provider} · ${state.list.mount_path || '/'}` : label('未打开来源', 'No source opened'),
    pathInput: state.pathInput,
    selected: state.selected,
    selectedCount: selectedNames(pane).length,
    currentDir: currentDir(pane),
    list: storageFileList(pane),
    loading: state.loading,
    error: state.error,
  }
}

async function loadWorkbench() {
  error.value = ''
  await Promise.allSettled([loadAuthorizations(), loadMounts(), loadDevices(), loadHealth(), loadTasks()])
  await openDefaultPanes()
}

async function loadAuthorizations() {
  const result = await alistApi.listAuthorizations()
  authorizations.value = result.authorizations ?? []
}

async function loadMounts() {
  const result = await storageApi.listMounts()
  mounts.value = result.mounts ?? []
}

async function loadDevices() {
  try {
    const result = await api.userDevices.list()
    devices.value = result.devices ?? []
  } catch {
    devices.value = []
  }
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

async function openDefaultPanes() {
  panes.value.left = { ...panes.value.left, pathInput: panes.value.left.pathInput || '/', list: null, selected: {}, loading: false, error: '' }
  panes.value.right = { ...panes.value.right, pathInput: panes.value.right.pathInput || '/', list: null, selected: {}, loading: false, error: '' }
}

async function refreshAll() {
  await Promise.allSettled([loadAuthorizations(), loadMounts(), loadDevices(), loadHealth(), loadTasks()])
  await Promise.allSettled([
    panes.value.left.list ? openPath('left', currentDir('left')) : Promise.resolve(),
    panes.value.right.list ? openPath('right', currentDir('right')) : Promise.resolve(),
  ])
}

async function openPath(pane: PaneKey, path: string) {
  if (!path.trim()) return
  panes.value[pane] = { ...panes.value[pane], loading: true, error: '', selected: {} }
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.list(path)
    panes.value[pane] = {
      ...panes.value[pane],
      list: result,
      pathInput: result.path,
      selected: {},
      loading: false,
      error: '',
    }
  } catch (err) {
    panes.value[pane] = {
      ...panes.value[pane],
      loading: false,
      error: errorText(err),
    }
  }
}

async function openDeviceSource(pane: PaneKey, deviceId: number) {
  panes.value[pane] = { ...panes.value[pane], loading: true, error: '', selected: {} }
  error.value = ''
  message.value = ''
  try {
    const entry = await storageApi.deviceFilesEntry(deviceId)
    await loadMounts()
    await loadAuthorizations()
    await openPath(pane, entry.path)
  } catch (err) {
    panes.value[pane] = {
      ...panes.value[pane],
      loading: false,
      error: errorText(err),
    }
  }
}

function updatePanePathInput(pane: PaneKey, value: string) {
  panes.value[pane] = { ...panes.value[pane], pathInput: value }
}

function updatePaneSelected(pane: PaneKey, value: Record<string, boolean>) {
  panes.value[pane] = { ...panes.value[pane], selected: value }
}

function openEntry(pane: PaneKey, entry: AlistDriverEntry | RemoteWorkspaceFileEntry) {
  activePane.value = pane
  if ('is_dir' in entry ? entry.is_dir : entry.type === 'directory') {
    void openPath(pane, entry.path)
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

async function copySelectedToOther(sourcePane: PaneKey) {
  await copySelected(sourcePane, false)
}

async function copySelectedTaskToOther(sourcePane: PaneKey) {
  await copySelected(sourcePane, true)
}

async function copySelected(sourcePane: PaneKey, background: boolean) {
  const targetPane = oppositePane(sourcePane)
  const names = selectedNames(sourcePane)
  await copyNamesToPane(sourcePane, targetPane, names, background)
  updatePaneSelected(sourcePane, {})
}

async function moveSelectedToOther(sourcePane: PaneKey) {
  await moveNamesToOther(sourcePane, selectedNames(sourcePane), true)
}

function requestDragTransfer(sourcePane: PaneKey, targetPane: PaneKey, names: string[]) {
  if (sourcePane === targetPane || names.length === 0) return
  transferConfirm.value = { sourcePane, targetPane, names }
}

function closeTransferConfirm() {
  transferConfirm.value = null
}

async function confirmDragCopy() {
  const payload = transferConfirm.value
  if (!payload) return
  transferConfirm.value = null
  await copyNamesToPane(payload.sourcePane, payload.targetPane, payload.names, false)
}

async function confirmDragMove() {
  const payload = transferConfirm.value
  if (!payload) return
  transferConfirm.value = null
  await moveNamesToPane(payload.sourcePane, payload.targetPane, payload.names, false)
}

async function moveNamesToOther(sourcePane: PaneKey, names: string[], confirmMove: boolean) {
  const targetPane = oppositePane(sourcePane)
  await moveNamesToPane(sourcePane, targetPane, names, confirmMove)
}

async function moveNamesToPane(sourcePane: PaneKey, targetPane: PaneKey, names: string[], confirmMove: boolean) {
  const target = currentDir(targetPane)
  if (sourcePane === targetPane || names.length === 0 || !panes.value[targetPane].list || !target.trim()) return
  if (confirmMove && !window.confirm(label(`移动 ${names.length} 项到对侧？`, `Move ${names.length} item(s) to the other pane?`))) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.move(currentDir(sourcePane), target, names)
    message.value = label(`已移动 ${result.removed ?? names.length} 项`, `Moved ${result.removed ?? names.length} item(s)`)
    updatePaneSelected(sourcePane, {})
    await Promise.allSettled([openPath(sourcePane, currentDir(sourcePane)), openPath(targetPane, target)])
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function copyNamesToPane(sourcePane: PaneKey, targetPane: PaneKey, names: string[], background: boolean) {
  const target = currentDir(targetPane)
  if (sourcePane === targetPane || names.length === 0 || !panes.value[targetPane].list || !target.trim()) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    if (background) {
      const result = await storageApi.copyTask(currentDir(sourcePane), target, names)
      message.value = label(`后台任务已创建: ${result.task.id}`, `Background task created: ${result.task.id}`)
      await loadTasks()
    } else {
      const result = await storageApi.copy(currentDir(sourcePane), target, names)
      message.value = label(`已复制 ${result.copied ?? names.length} 项到对侧`, `Copied ${result.copied ?? names.length} item(s) to the other pane`)
      await openPath(targetPane, target)
    }
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function createFolder(pane: PaneKey, rawName: string) {
  const name = rawName.trim()
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    error.value = label('文件夹名称无效', 'Invalid folder name')
    return
  }
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    await storageApi.mkdir(joinVirtualPath(currentDir(pane), name))
    message.value = label('文件夹已创建', 'Folder created')
    await openPath(pane, currentDir(pane))
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

function downloadSelected(pane: PaneKey) {
  const name = selectedNames(pane)[0]
  if (!name) return
  window.open(storageApi.downloadUrl(joinVirtualPath(currentDir(pane), name)), '_blank', 'noopener,noreferrer')
}

async function uploadSelectedFile(pane: PaneKey, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    await storageApi.upload(joinVirtualPath(currentDir(pane), file.name), file)
    message.value = label('文件已上传', 'File uploaded')
    await openPath(pane, currentDir(pane))
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

async function removeSelected(pane: PaneKey) {
  const names = selectedNames(pane)
  if (names.length === 0) return
  if (!window.confirm(label(`删除 ${names.length} 项？`, `Delete ${names.length} item(s)?`))) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await storageApi.remove(currentDir(pane), names)
    message.value = label(`已删除 ${result.removed ?? names.length} 项`, `Removed ${result.removed ?? names.length} item(s)`)
    await openPath(pane, currentDir(pane))
  } catch (err) {
    error.value = errorText(err)
  } finally {
    acting.value = false
  }
}

function goParent(pane: PaneKey) {
  const current = panes.value[pane].pathInput.replace(/\/+$/, '') || '/'
  const index = current.lastIndexOf('/')
  const parent = index <= 0 ? '/' : current.slice(0, index)
  void openPath(pane, parent)
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
    props: {
      source: sourceKindForAuthorization(auth),
    },
  }

  const key = editingMountId.value ? `mount-edit-${editingMountId.value}` : 'mount-create'
  error.value = ''
  message.value = ''
  setBusy(key, true)
  try {
    if (editingMountId.value) {
      await storageApi.updateMount(editingMountId.value, body)
      message.value = label('来源已更新', 'Source updated')
    } else {
      await storageApi.createMount(body)
      message.value = label('来源已创建', 'Source created')
    }
    closeMountForm()
    await loadMounts()
    await loadHealth()
    await openPath(activePane.value, virtualPath)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    setBusy(key, false)
  }
}

async function deleteMount(mount: StorageMountRecord) {
  if (!window.confirm(label(`删除来源「${mount.name}」？`, `Delete source "${mount.name}"?`))) return
  const key = `mount-delete-${mount.id}`
  setBusy(key, true)
  error.value = ''
  message.value = ''
  try {
    await storageApi.removeMount(mount.id)
    await loadMounts()
    await loadHealth()
    for (const pane of ['left', 'right'] as PaneKey[]) {
      const state = panes.value[pane]
      if (state.list?.mount_path === mount.virtual_path || state.pathInput === mount.virtual_path || state.pathInput.startsWith(`${mount.virtual_path}/`)) {
        panes.value[pane] = {
          ...state,
          list: null,
          pathInput: mounts.value[0]?.virtual_path ?? '/',
          selected: {},
        }
      }
    }
    message.value = label('来源已删除', 'Source removed')
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

function authorizationName(id: number): string {
  const auth = authorizations.value.find((item) => item.id === id)
  return auth ? auth.name : `#${id}`
}

function selectedNames(pane: PaneKey) {
  return Object.entries(panes.value[pane].selected).filter(([, value]) => value).map(([name]) => name)
}

function currentDir(pane: PaneKey) {
  return panes.value[pane].list?.path || panes.value[pane].pathInput || '/'
}

function oppositePane(pane: PaneKey): PaneKey {
  return pane === 'left' ? 'right' : 'left'
}

function storageFileList(pane: PaneKey): RemoteWorkspaceFileList | null {
  const list = panes.value[pane].list
  if (!list) return null
  return {
    target_id: `storage:${pane}`,
    label: pane === 'left' ? label('文件面板 A', 'File Pane A') : label('文件面板 B', 'File Pane B'),
    kind: 'storage',
    root: list.mount_path || '/',
    path: list.path,
    absolute_path: list.path,
    entries: list.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.is_dir ? 'directory' : 'file',
      size: entry.is_dir ? null : entry.size,
      modified_at: entry.modified ?? null,
    })),
    truncated: false,
  }
}

function buildSourceGroups(): StorageSourceGroup[] {
  const groups: Record<StorageSourceKind, StorageMountRecord[]> = {
    local: [],
    device: [],
    cloud: [],
  }
  for (const mount of mounts.value) {
    groups[sourceKindForMount(mount)].push(mount)
  }
  return [
    {
      kind: 'local',
      title: label('本机', 'Local'),
      subtitle: label('当前 HomeSense 服务所在设备的目录。', 'Folders on the device running HomeSense.'),
      mounts: groups.local,
    },
    {
      kind: 'device',
      title: label('设备', 'Devices'),
      subtitle: label('已绑定设备的文件系统，例如 ADB 或 SSH/SFTP。', 'Bound device filesystems such as ADB or SSH/SFTP.'),
      mounts: groups.device,
      pendingDevices: pendingDeviceSources(groups.device),
    },
    {
      kind: 'cloud',
      title: label('网盘', 'Cloud Drives'),
      subtitle: label('WebDAV、NAS、网盘和网络存储。', 'WebDAV, NAS, cloud drives, and network storage.'),
      mounts: groups.cloud,
    },
  ]
}

function pendingDeviceSources(deviceMounts: StorageMountRecord[]): StorageDeviceSource[] {
  const mountedIds = new Set(deviceMounts.map((mount) => Number(mount.props?.device_id)).filter((id) => Number.isFinite(id) && id > 0))
  return devices.value
    .filter((device) => hasDeviceFileSource(device) && !mountedIds.has(device.id))
    .map((device) => ({
      id: device.id,
      name: device.name,
      subtitle: deviceFileSourceSubtitle(device),
    }))
}

function hasDeviceFileSource(device: UserDevice): boolean {
  return Boolean(
    propString(device, 'adb_serial') ||
    propString(device, 'adb_ip') ||
    propString(device, 'ssh_target_id') ||
    propString(device, 'ssh_authorization_id') ||
    (propString(device, 'ssh_host') && propString(device, 'ssh_user')),
  )
}

function deviceFileSourceSubtitle(device: UserDevice): string {
  const adb = propString(device, 'adb_serial') || propString(device, 'adb_ip')
  if (adb) return `ADB · ${adb}`
  const ssh = propString(device, 'ssh_host') || propString(device, 'ssh_target_id') || propString(device, 'ssh_authorization_id')
  return `SSH/SFTP · ${ssh || device.id}`
}

function sourceKindForMount(mount: StorageMountRecord): StorageSourceKind {
  const explicit = stringValue(mount.props?.source)
  if (explicit === 'local' || explicit === 'device' || explicit === 'cloud') return explicit
  if (mount.driver === 'local') return 'local'
  if (mount.driver === 'adb') return 'device'
  if (mount.virtual_path.startsWith('/devices/')) return 'device'
  if (mount.props?.device_id != null || mount.props?.ssh_target_id != null) return 'device'
  return 'cloud'
}

function sourceKindForAuthorization(auth: AlistAuthorizationRecord): StorageSourceKind {
  if (auth.driver === 'local') return 'local'
  if (auth.driver === 'adb') return 'device'
  const explicit = stringValue(auth.props?.source)
  if (explicit === 'local' || explicit === 'device' || explicit === 'cloud') return explicit
  return 'cloud'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function propString(device: UserDevice, key: string): string {
  const value = device.props?.[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}
</script>

<template>
  <main class="storage-page">
    <StorageWorkbenchHeader
      :disabled="anyPaneLoading || acting"
      :can-create-mount="authorizations.length > 0"
      :label="label"
      @refresh="refreshAll"
      @open-authorizations="router.push('/authorizations?external=cloud')"
      @toggle-sources="sourcesOpen = !sourcesOpen"
      @create-mount="openCreateMount()"
    />

    <div v-if="error" class="notice error">{{ error }}</div>
    <div v-if="message" class="notice success">{{ message }}</div>

    <StorageMountList
      v-if="sourcesOpen"
      :authorizations="authorizations"
      :source-groups="sourceGroups"
      :health="health"
      :active-mount-path="panes[activePane].list?.mount_path"
      :path-input="activePathInput"
      :disabled="anyPaneLoading || acting"
      :label="label"
      :authorization-name="authorizationName"
      :is-busy="isBusy"
      @create="openCreateMount()"
      @open="openPath(activePane, $event)"
      @open-device="openDeviceSource(activePane, $event)"
      @edit="openEditMount"
      @delete="deleteMount"
    />

    <StorageFileWorkbenchPanel
      v-model:active-pane="activePane"
      :panes="paneModels"
      :source-groups="sourceGroups"
      :tasks="tasks"
      :acting="acting"
      :label="label"
      :format-file-size="(value) => formatSize(value ?? 0)"
      @update:path-input="updatePanePathInput"
      @update:selected="updatePaneSelected"
      @open-path="openPath"
      @open-device="openDeviceSource"
      @open-entry="openEntry"
      @parent="goParent"
      @refresh-path="(pane) => openPath(pane, currentDir(pane))"
      @copy-to-other="copySelectedToOther"
      @copy-task-to-other="copySelectedTaskToOther"
      @move-to-other="moveSelectedToOther"
      @drag-transfer="requestDragTransfer"
      @download="downloadSelected"
      @upload="uploadSelectedFile"
      @create-folder="createFolder"
      @remove="removeSelected"
      @refresh-tasks="loadTasks"
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

    <div v-if="transferConfirm" class="modal-backdrop" @click.self="closeTransferConfirm">
      <section class="transfer-dialog">
        <header>
          <strong>{{ label('文件传输', 'File transfer') }}</strong>
          <button class="dialog-close" :disabled="acting" @click="closeTransferConfirm">×</button>
        </header>
        <p>
          {{
            label(
              `将 ${transferConfirm.names.length} 项从${transferConfirm.sourcePane === 'left' ? '面板 A' : '面板 B'}放到${transferConfirm.targetPane === 'left' ? '面板 A' : '面板 B'}？`,
              `Send ${transferConfirm.names.length} item(s) from ${transferConfirm.sourcePane === 'left' ? 'Pane A' : 'Pane B'} to ${transferConfirm.targetPane === 'left' ? 'Pane A' : 'Pane B'}?`,
            )
          }}
        </p>
        <div class="transfer-names">
          <span v-for="name in transferConfirm.names.slice(0, 6)" :key="name">{{ name }}</span>
          <small v-if="transferConfirm.names.length > 6">{{ label(`还有 ${transferConfirm.names.length - 6} 项`, `${transferConfirm.names.length - 6} more`) }}</small>
        </div>
        <footer>
          <button class="plain-btn" :disabled="acting" @click="closeTransferConfirm">{{ label('取消', 'Cancel') }}</button>
          <button class="plain-btn" :disabled="acting" @click="confirmDragCopy">{{ label('复制', 'Copy') }}</button>
          <button class="danger-soft-btn" :disabled="acting" @click="confirmDragMove">{{ label('移动', 'Move') }}</button>
        </footer>
      </section>
    </div>
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

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.36);
  display: grid;
  place-items: center;
  padding: 20px;
}

.transfer-dialog {
  width: min(480px, 100%);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.transfer-dialog header,
.transfer-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.transfer-dialog header strong {
  color: #0f172a;
  font-size: 16px;
  font-weight: 950;
}

.transfer-dialog p {
  margin: 0;
  color: #334155;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.6;
}

.dialog-close {
  width: 32px;
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: #fff;
  color: #334155;
  font-size: 18px;
  font-weight: 900;
  cursor: pointer;
}

.transfer-names {
  max-height: 142px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #f8fafc;
  padding: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.transfer-names span,
.transfer-names small {
  max-width: 100%;
  border: 1px solid #dbeafe;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  padding: 5px 7px;
  font-size: 12px;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-dialog footer {
  justify-content: flex-end;
}

.transfer-dialog .plain-btn,
.transfer-dialog .danger-soft-btn {
  min-height: 34px;
  border-radius: 7px;
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.transfer-dialog .plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
}

.transfer-dialog .danger-soft-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

:deep(.file-workbench) {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:deep(.transfer-bar) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

:deep(.pane-tabs),
:deep(.transfer-actions),
:deep(.pane-head-actions),
:deep(.pane-actions),
:deep(.pathbar) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

:deep(.pane-tab) {
  min-width: 118px;
  min-height: 42px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

:deep(.pane-tab small) {
  color: #64748b;
  font-size: 11px;
  font-weight: 750;
}

:deep(.pane-tab.active) {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

:deep(.transfer-actions) {
  justify-content: flex-end;
}

:deep(.pane-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

:deep(.file-pane) {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}

:deep(.file-pane.active) {
  border-color: #0f766e;
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.08);
}

:deep(.file-pane.drag-over) {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16);
}

:deep(.pane-head) {
  min-height: 58px;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

:deep(.pane-head > div:first-child) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

:deep(.pane-head strong) {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

:deep(.pane-head small),
:deep(.empty-hint) {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
  overflow-wrap: anywhere;
}

:deep(.pathbar),
:deep(.pane-actions) {
  padding: 10px 12px 0;
}

:deep(.pathbar input),
:deep(.folder-input),
:deep(.search-input),
:deep(.source-select) {
  min-width: 0;
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

:deep(.pathbar input) {
  flex: 1;
  padding: 0 10px;
}

:deep(.folder-input) {
  width: 132px;
  padding: 0 9px;
}

:deep(.search-input) {
  flex: 1;
  min-width: 160px;
  padding: 0 10px;
}

:deep(.source-select) {
  width: 190px;
  padding: 0 10px;
  font-family: inherit;
}

:deep(.file-workbench .plain-btn),
:deep(.danger-soft-btn),
:deep(.file-workbench .danger-btn),
:deep(.mini-btn),
:deep(.mount-chip) {
  min-height: 32px;
  border-radius: 7px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

:deep(.file-workbench .plain-btn),
:deep(.mini-btn),
:deep(.mount-chip) {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
}

:deep(.file-workbench .plain-btn:hover:not(:disabled)),
:deep(.mini-btn:hover:not(:disabled)),
:deep(.mount-chip:hover:not(:disabled)),
:deep(.mount-chip.active) {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

:deep(.mount-chip.pending) {
  border-style: dashed;
}

:deep(.mini-btn.primary) {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

:deep(.danger-soft-btn),
:deep(.file-workbench .danger-btn) {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

:deep(.hidden-file-input) {
  display: none;
}

:deep(.error-line) {
  margin: 10px 12px 0;
  padding: 9px 10px;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 850;
}

:deep(.pane-note) {
  min-height: 260px;
  margin: 12px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #64748b;
  font-size: 13px;
  font-weight: 800;
  display: grid;
  place-items: center;
  text-align: center;
}

:deep(.file-list) {
  min-height: 360px;
  max-height: 620px;
  overflow: auto;
  margin-top: 12px;
  padding: 8px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}

:deep(.file-entry) {
  display: grid;
  grid-template-columns: 18px 46px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  width: 100%;
  min-height: 52px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 8px 9px;
  text-align: left;
  cursor: pointer;
}

:deep(.file-entry:hover) {
  border-color: rgba(37, 99, 235, 0.18);
  background: #eff6ff;
}

:deep(.file-entry[draggable='true']) {
  cursor: grab;
}

:deep(.file-entry[draggable='true']:active) {
  cursor: grabbing;
}

:deep(.drop-hint) {
  position: absolute;
  inset: auto 16px 16px;
  z-index: 2;
  min-height: 40px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-radius: 7px;
  background: rgba(239, 246, 255, 0.96);
  color: #1d4ed8;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 900;
  pointer-events: none;
}

:deep(.entry-check) {
  width: 16px;
  height: 16px;
  accent-color: #0f766e;
}

:deep(.entry-kind) {
  color: #2563eb;
  font-size: 11px;
  font-weight: 950;
}

:deep(.entry-main) {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

:deep(.entry-main strong) {
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.entry-main small) {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.file-entry.directory .entry-main strong) {
  color: #1d4ed8;
}

:deep(.file-workbench .empty-line) {
  padding: 20px 10px;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
  text-align: center;
}

:deep(.file-workbench button:disabled),
:deep(.file-workbench input:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 1180px) {
  :deep(.transfer-bar) {
    align-items: stretch;
    flex-direction: column;
  }

  :deep(.transfer-actions) {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  :deep(.pane-grid) {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .storage-page {
    padding: 16px;
  }

  :deep(.pane-tabs),
  :deep(.transfer-actions),
  :deep(.pane-actions) {
    align-items: stretch;
    flex-direction: column;
  }

  :deep(.pane-tab),
  :deep(.transfer-actions > *),
  :deep(.pane-actions > *),
  :deep(.search-input),
  :deep(.folder-input) {
    width: 100%;
  }

  :deep(.pane-head) {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
