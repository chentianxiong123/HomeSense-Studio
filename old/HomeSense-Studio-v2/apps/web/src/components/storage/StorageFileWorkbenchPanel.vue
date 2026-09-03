<script setup lang="ts">
import { ref } from 'vue'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList } from '@/api/remoteWorkspace'
import type { StorageMountRecord, StorageTaskRecord } from '@/api/storage'
import StorageTaskStrip from '@/components/storage/StorageTaskStrip.vue'
import { formatCommonDateTime } from '@/utils/chinaTime'

type LabelFn = (zh: string, en: string) => string
type PaneKey = 'left' | 'right'
type StorageSourceKind = 'local' | 'device' | 'cloud'

interface StoragePaneView {
  title: string
  subtitle: string
  pathInput: string
  selected: Record<string, boolean>
  selectedCount: number
  currentDir: string
  list: RemoteWorkspaceFileList | null
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

const paneKeys: PaneKey[] = ['left', 'right']

const props = defineProps<{
  activePane: PaneKey
  panes: Record<PaneKey, StoragePaneView>
  sourceGroups: StorageSourceGroup[]
  tasks: StorageTaskRecord[]
  acting: boolean
  label: LabelFn
  formatFileSize: (value: number | null) => string
}>()

const emit = defineEmits<{
  (event: 'update:activePane', value: PaneKey): void
  (event: 'update:pathInput', pane: PaneKey, value: string): void
  (event: 'update:selected', pane: PaneKey, value: Record<string, boolean>): void
  (event: 'open-path', pane: PaneKey, value: string): void
  (event: 'open-device', pane: PaneKey, deviceId: number): void
  (event: 'open-entry', pane: PaneKey, value: RemoteWorkspaceFileEntry): void
  (event: 'parent', pane: PaneKey): void
  (event: 'refresh-path', pane: PaneKey): void
  (event: 'copy-to-other', pane: PaneKey): void
  (event: 'copy-task-to-other', pane: PaneKey): void
  (event: 'move-to-other', pane: PaneKey): void
  (event: 'drag-transfer', sourcePane: PaneKey, targetPane: PaneKey, names: string[]): void
  (event: 'download', pane: PaneKey): void
  (event: 'upload', pane: PaneKey, value: Event): void
  (event: 'create-folder', pane: PaneKey, name: string): void
  (event: 'remove', pane: PaneKey): void
  (event: 'refresh-tasks'): void
}>()

const uploadInputs = ref<Record<PaneKey, HTMLInputElement | null>>({ left: null, right: null })
const folderNames = ref<Record<PaneKey, string>>({ left: '', right: '' })
const searchInputs = ref<Record<PaneKey, string>>({ left: '', right: '' })
const dragging = ref<{ pane: PaneKey; names: string[] } | null>(null)
const dragOverPane = ref<PaneKey | null>(null)

function sourceSelectValue(pane: PaneKey): string {
  const root = props.panes[pane].list?.root || ''
  const match = props.sourceGroups.flatMap((group) => group.mounts).find((mount) => mount.virtual_path === root)
  return match ? `mount:${match.virtual_path}` : ''
}

function selectSource(pane: PaneKey, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value.startsWith('mount:')) {
    emit('open-path', pane, value.slice('mount:'.length))
    return
  }
  if (value.startsWith('device:')) {
    const id = Number(value.slice('device:'.length))
    if (Number.isFinite(id) && id > 0) emit('open-device', pane, id)
  }
}

function oppositePane(pane: PaneKey): PaneKey {
  return pane === 'left' ? 'right' : 'left'
}

function entryKindLabel(entry: RemoteWorkspaceFileEntry) {
  if (entry.type === 'directory') return 'DIR'
  if (entry.type === 'symlink') return 'LNK'
  if (entry.type === 'file') return 'FILE'
  return 'OTHER'
}

function entryMeta(entry: RemoteWorkspaceFileEntry) {
  const parts: string[] = [entry.type]
  if (entry.size != null && entry.type !== 'directory') parts.push(props.formatFileSize(entry.size))
  const modifiedAt = formatCommonDateTime(entry.modified_at)
  if (modifiedAt) parts.push(modifiedAt)
  return parts.join(' · ')
}

function visibleEntries(pane: PaneKey): RemoteWorkspaceFileEntry[] {
  const entries = props.panes[pane].list?.entries ?? []
  const keyword = searchInputs.value[pane].trim().toLowerCase()
  if (!keyword) return entries
  return entries.filter((entry) => entry.name.toLowerCase().includes(keyword))
}

function updateSelected(pane: PaneKey, name: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = { ...props.panes[pane].selected }
  if (checked) next[name] = true
  else delete next[name]
  emit('update:selected', pane, next)
}

function chooseUpload(pane: PaneKey) {
  uploadInputs.value[pane]?.click()
}

function createFolder(pane: PaneKey) {
  const name = folderNames.value[pane].trim()
  if (!name) return
  emit('create-folder', pane, name)
  folderNames.value = { ...folderNames.value, [pane]: '' }
}

function setUploadInput(pane: PaneKey, element: HTMLInputElement | null) {
  uploadInputs.value[pane] = element
}

function selectedNames(pane: PaneKey): string[] {
  return Object.entries(props.panes[pane].selected).filter(([, selected]) => selected).map(([name]) => name)
}

function draggableNames(pane: PaneKey, entry: RemoteWorkspaceFileEntry): string[] {
  const selected = selectedNames(pane)
  return selected.includes(entry.name) ? selected : [entry.name]
}

function startDrag(pane: PaneKey, entry: RemoteWorkspaceFileEntry, event: DragEvent) {
  if (props.acting || !props.panes[oppositePane(pane)].list) return
  const names = draggableNames(pane, entry)
  dragging.value = { pane, names }
  event.dataTransfer?.setData('application/x-homesense-storage-drag', JSON.stringify({ pane, names }))
  event.dataTransfer?.setData('text/plain', names.join('\n'))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function readDrag(event: DragEvent): { pane: PaneKey; names: string[] } | null {
  if (dragging.value) return dragging.value
  const raw = event.dataTransfer?.getData('application/x-homesense-storage-drag')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { pane?: PaneKey; names?: string[] }
    if ((parsed.pane === 'left' || parsed.pane === 'right') && Array.isArray(parsed.names)) {
      const names = parsed.names.filter((name) => typeof name === 'string' && name.trim())
      return names.length > 0 ? { pane: parsed.pane, names } : null
    }
  } catch {}
  return null
}

function canDropOnPane(pane: PaneKey, event?: DragEvent): boolean {
  if (props.acting || !props.panes[pane].list) return false
  const payload = event ? readDrag(event) : dragging.value
  return Boolean(payload && payload.pane !== pane && payload.names.length > 0)
}

function dragOver(pane: PaneKey, event: DragEvent) {
  if (!canDropOnPane(pane, event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverPane.value = pane
}

function dragLeave(pane: PaneKey, event: DragEvent) {
  const nextTarget = event.relatedTarget as Node | null
  if (nextTarget && (event.currentTarget as HTMLElement).contains(nextTarget)) return
  if (dragOverPane.value === pane) dragOverPane.value = null
}

function dropOnPane(pane: PaneKey, event: DragEvent) {
  const payload = readDrag(event)
  dragOverPane.value = null
  dragging.value = null
  if (!payload || payload.pane === pane || payload.names.length === 0) return
  event.preventDefault()
  emit('drag-transfer', payload.pane, pane, payload.names)
}

function endDrag() {
  dragging.value = null
  dragOverPane.value = null
}
</script>

<template>
  <section class="file-workbench">
    <div class="transfer-bar">
      <div class="pane-tabs">
        <button
          v-for="pane in paneKeys"
          :key="pane"
          class="pane-tab"
          :class="{ active: activePane === pane }"
          @click="emit('update:activePane', pane)"
        >
          {{ panes[pane].title }}
          <small>{{ panes[pane].selectedCount }} {{ label('项已选', 'selected') }}</small>
        </button>
      </div>

      <div class="transfer-actions">
        <button
          class="plain-btn"
          :disabled="acting || panes.left.selectedCount === 0 || !panes.right.list"
          @click="emit('copy-to-other', 'left')"
        >
          {{ label('复制 A -> B', 'Copy A -> B') }}
        </button>
        <button
          class="plain-btn"
          :disabled="acting || panes.left.selectedCount === 0 || !panes.right.list"
          @click="emit('copy-task-to-other', 'left')"
        >
          {{ label('后台复制 A -> B', 'Copy Tree A -> B') }}
        </button>
        <button
          class="plain-btn"
          :disabled="acting || panes.right.selectedCount === 0 || !panes.left.list"
          @click="emit('copy-to-other', 'right')"
        >
          {{ label('复制 B -> A', 'Copy B -> A') }}
        </button>
        <button
          class="plain-btn"
          :disabled="acting || panes.right.selectedCount === 0 || !panes.left.list"
          @click="emit('copy-task-to-other', 'right')"
        >
          {{ label('后台复制 B -> A', 'Copy Tree B -> A') }}
        </button>
        <button
          class="danger-soft-btn"
          :disabled="acting || panes[activePane].selectedCount === 0 || !panes[oppositePane(activePane)].list"
          @click="emit('move-to-other', activePane)"
        >
          {{ label('移动到对侧', 'Move to Other') }}
        </button>
      </div>
    </div>

    <StorageTaskStrip :tasks="tasks" :disabled="acting" :label="label" @refresh="emit('refresh-tasks')" />

    <div class="pane-grid">
      <article
        v-for="pane in paneKeys"
        :key="pane"
        class="file-pane"
        :class="{ active: activePane === pane, 'drag-over': dragOverPane === pane }"
        @click="emit('update:activePane', pane)"
        @dragover="dragOver(pane, $event)"
        @dragleave="dragLeave(pane, $event)"
        @drop="dropOnPane(pane, $event)"
      >
        <header class="pane-head">
          <div>
            <strong>{{ panes[pane].title }}</strong>
            <small>{{ panes[pane].subtitle }}</small>
          </div>
          <div class="pane-head-actions">
            <select class="source-select" :value="sourceSelectValue(pane)" :disabled="acting || panes[pane].loading" @change.stop="selectSource(pane, $event)" @click.stop>
              <option value="">{{ label('选择来源', 'Choose source') }}</option>
              <optgroup v-for="group in sourceGroups" :key="group.kind" :label="group.title">
                <option v-for="mount in group.mounts" :key="`mount-${mount.id}`" :value="`mount:${mount.virtual_path}`">
                  {{ mount.name }}
                </option>
                <option v-for="device in group.pendingDevices ?? []" :key="`device-${device.id}`" :value="`device:${device.id}`">
                  {{ device.name }}
                </option>
              </optgroup>
            </select>
            <button class="mini-btn" :disabled="acting || panes[pane].loading" @click.stop="emit('refresh-path', pane)">
              {{ label('刷新', 'Refresh') }}
            </button>
          </div>
        </header>

        <div class="pathbar">
          <button class="mini-btn" :disabled="acting || panes[pane].loading || !panes[pane].list" @click.stop="emit('parent', pane)">
            {{ label('上一级', 'Up') }}
          </button>
          <input
            :value="panes[pane].pathInput"
            :disabled="acting || panes[pane].loading"
            spellcheck="false"
            @input="emit('update:pathInput', pane, ($event.target as HTMLInputElement).value)"
            @keydown.enter="emit('open-path', pane, panes[pane].pathInput)"
            @click.stop
          />
          <button
            class="mini-btn primary"
            :disabled="acting || panes[pane].loading || !panes[pane].pathInput.trim()"
            @click.stop="emit('open-path', pane, panes[pane].pathInput)"
          >
            {{ label('打开', 'Open') }}
          </button>
        </div>

        <div class="pane-actions">
          <button class="mini-btn" :disabled="acting || !panes[pane].list" @click.stop="chooseUpload(pane)">
            {{ label('上传', 'Upload') }}
          </button>
          <input
            :ref="(el) => setUploadInput(pane, el as HTMLInputElement | null)"
            class="hidden-file-input"
            type="file"
            @change="emit('upload', pane, $event)"
          />
          <input
            :value="folderNames[pane]"
            :disabled="acting || !panes[pane].list"
            class="folder-input"
            spellcheck="false"
            :placeholder="label('新文件夹', 'New folder')"
            @input="folderNames = { ...folderNames, [pane]: ($event.target as HTMLInputElement).value }"
            @keydown.enter="createFolder(pane)"
            @click.stop
          />
          <button class="mini-btn" :disabled="acting || !folderNames[pane].trim() || !panes[pane].list" @click.stop="createFolder(pane)">
            {{ label('新建', 'Create') }}
          </button>
          <button class="mini-btn" :disabled="acting || panes[pane].selectedCount === 0" @click.stop="emit('download', pane)">
            {{ label('下载', 'Download') }}
          </button>
          <button class="danger-btn" :disabled="acting || panes[pane].selectedCount === 0" @click.stop="emit('remove', pane)">
            {{ label('删除', 'Remove') }}
          </button>
          <input
            v-model="searchInputs[pane]"
            :disabled="!panes[pane].list"
            class="search-input"
            spellcheck="false"
            :placeholder="label('搜索当前目录', 'Search current folder')"
            @click.stop
          />
        </div>

        <p v-if="panes[pane].error" class="error-line">{{ panes[pane].error }}</p>

        <div v-if="panes[pane].loading && !panes[pane].list" class="pane-note">
          {{ label('正在读取目录...', 'Loading directory...') }}
        </div>

        <div v-else-if="panes[pane].list" class="file-list">
          <button
            v-for="entry in visibleEntries(pane)"
            :key="entry.path"
            class="file-entry"
            :class="entry.type"
            draggable="true"
            @dragstart.stop="startDrag(pane, entry, $event)"
            @dragend="endDrag"
            @click.stop="emit('open-entry', pane, entry)"
          >
            <input
              class="entry-check"
              type="checkbox"
              :checked="Boolean(panes[pane].selected[entry.name])"
              @click.stop
              @change.stop="updateSelected(pane, entry.name, $event)"
            />
            <span class="entry-kind">{{ entryKindLabel(entry) }}</span>
            <span class="entry-main">
              <strong>{{ entry.name }}</strong>
              <small>{{ entryMeta(entry) }}</small>
            </span>
          </button>
          <div v-if="panes[pane].list.entries.length === 0" class="empty-line">
            {{ label('空目录', 'Empty directory') }}
          </div>
          <div v-else-if="visibleEntries(pane).length === 0" class="empty-line">
            {{ label('没有匹配文件', 'No matching files') }}
          </div>
        </div>

        <div v-else class="pane-note">
          {{ label('选择一个来源开始浏览。', 'Choose a source to browse.') }}
        </div>

        <div v-if="dragOverPane === pane" class="drop-hint">
          {{ label('松开移动到这里', 'Drop to move here') }}
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.file-workbench {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.transfer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pane-tabs,
.transfer-actions,
.pane-head-actions,
.pane-actions,
.pathbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pane-tab {
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

.pane-tab small {
  color: #64748b;
  font-size: 11px;
  font-weight: 750;
}

.pane-tab.active {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

.transfer-actions {
  justify-content: flex-end;
}

.pane-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.file-pane {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
}

.file-pane.active {
  border-color: #0f766e;
  box-shadow: 0 0 0 2px rgba(15, 118, 110, 0.08);
}

.file-pane.drag-over {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16);
}

.pane-head {
  min-height: 58px;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pane-head > div:first-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pane-head strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.pane-head small,
.empty-hint {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.pathbar,
.pane-actions {
  padding: 10px 12px 0;
}

.pathbar input,
.folder-input,
.search-input,
.source-select {
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

.pathbar input {
  flex: 1;
  padding: 0 10px;
}

.folder-input {
  width: 132px;
  padding: 0 9px;
}

.search-input {
  flex: 1;
  min-width: 160px;
  padding: 0 10px;
}

.source-select {
  width: 190px;
  padding: 0 10px;
  font-family: inherit;
}

.plain-btn,
.danger-soft-btn,
.danger-btn,
.mini-btn,
.mount-chip {
  min-height: 32px;
  border-radius: 7px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn,
.mini-btn,
.mount-chip {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
}

.plain-btn:hover:not(:disabled),
.mini-btn:hover:not(:disabled),
.mount-chip:hover:not(:disabled),
.mount-chip.active {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

.mount-chip.pending {
  border-style: dashed;
}

.mini-btn.primary {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.danger-soft-btn,
.danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.hidden-file-input {
  display: none;
}

.error-line {
  margin: 10px 12px 0;
  padding: 9px 10px;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
  font-weight: 850;
}

.pane-note {
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

.file-list {
  min-height: 360px;
  max-height: 620px;
  overflow: auto;
  margin-top: 12px;
  padding: 8px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}

.file-entry {
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

.file-entry:hover {
  border-color: rgba(37, 99, 235, 0.18);
  background: #eff6ff;
}

.file-entry[draggable='true'] {
  cursor: grab;
}

.file-entry[draggable='true']:active {
  cursor: grabbing;
}

.drop-hint {
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

.entry-check {
  width: 16px;
  height: 16px;
  accent-color: #0f766e;
}

.entry-kind {
  color: #2563eb;
  font-size: 11px;
  font-weight: 950;
}

.entry-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-main strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-main small {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-entry.directory .entry-main strong {
  color: #1d4ed8;
}

.empty-line {
  padding: 20px 10px;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
  text-align: center;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 1180px) {
  .transfer-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .transfer-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  .pane-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .file-workbench {
    padding: 12px;
  }

  .pane-tabs,
  .transfer-actions,
  .pane-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .pane-tab,
  .transfer-actions > *,
  .pane-actions > *,
  .search-input,
  .folder-input {
    width: 100%;
  }

  .pane-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
