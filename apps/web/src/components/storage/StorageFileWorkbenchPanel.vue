<script setup lang="ts">
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList } from '@/api/remoteWorkspace'
import type { StorageTaskRecord } from '@/api/storage'
import RemoteFileBrowserPanel from '@/components/RemoteFileBrowserPanel.vue'
import StorageFileActionBar from '@/components/storage/StorageFileActionBar.vue'
import StorageTaskStrip from '@/components/storage/StorageTaskStrip.vue'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  copyTarget: string
  newFolderName: string
  selectedCount: number
  acting: boolean
  loading: boolean
  hasList: boolean
  tasks: StorageTaskRecord[]
  fileList: RemoteWorkspaceFileList | null
  providerLabel: string
  pathInput: string
  selected: Record<string, boolean>
  currentDir: string
  error: string
  label: LabelFn
  formatFileSize: (value: number | null) => string
}>()

const emit = defineEmits<{
  (event: 'update:copyTarget', value: string): void
  (event: 'update:newFolderName', value: string): void
  (event: 'update:pathInput', value: string): void
  (event: 'update:selected', value: Record<string, boolean>): void
  (event: 'copy'): void
  (event: 'copy-task'): void
  (event: 'download'): void
  (event: 'upload', value: Event): void
  (event: 'create-folder'): void
  (event: 'remove'): void
  (event: 'refresh-tasks'): void
  (event: 'refresh-path', value: string): void
  (event: 'parent'): void
  (event: 'open-entry', value: RemoteWorkspaceFileEntry): void
  (event: 'open-path', value: string): void
}>()
</script>

<template>
  <section class="file-workbench">
    <StorageFileActionBar
      :copy-target="copyTarget"
      :new-folder-name="newFolderName"
      :selected-count="selectedCount"
      :acting="acting"
      :has-list="hasList"
      :label="label"
      @update:copy-target="emit('update:copyTarget', $event)"
      @update:new-folder-name="emit('update:newFolderName', $event)"
      @copy="emit('copy')"
      @copy-task="emit('copy-task')"
      @download="emit('download')"
      @upload="emit('upload', $event)"
      @create-folder="emit('create-folder')"
      @remove="emit('remove')"
    />

    <StorageTaskStrip :tasks="tasks" :disabled="acting" :label="label" @refresh="emit('refresh-tasks')" />

    <RemoteFileBrowserPanel
      :title="label('统一文件浏览器', 'Unified File Browser')"
      :subtitle="providerLabel"
      :list="fileList"
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
      :format-file-size="formatFileSize"
      @refresh="emit('refresh-path', currentDir)"
      @parent="emit('parent')"
      @open-entry="emit('open-entry', $event)"
      @open-path="emit('open-path', $event)"
      @update:path-input="emit('update:pathInput', $event)"
      @update:selected="emit('update:selected', $event)"
    />
  </section>
</template>

<style scoped>
.file-workbench {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 18px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
