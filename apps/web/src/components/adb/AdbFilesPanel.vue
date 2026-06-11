<script setup lang="ts">
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'
import RemoteFileBrowserPanel from '@/components/RemoteFileBrowserPanel.vue'

defineProps<{
  adbIp: string
  list: RemoteWorkspaceFileList | null
  preview: RemoteWorkspaceFilePreview | null
  loading: boolean
  error: string
  pathInput: string
  currentPath: string
  parentPath: string
  label: (zh: string, en: string) => string
  formatBytes: (value?: number) => string
}>()

const emit = defineEmits<{
  refresh: [path: string]
  parent: [path: string]
  openEntry: [entry: RemoteWorkspaceFileEntry]
  openPath: [path: string]
  'update:pathInput': [value: string]
}>()
</script>

<template>
  <div class="files-panel-wrap">
    <RemoteFileBrowserPanel
      :title="label('ADB 文件系统', 'ADB Filesystem')"
      :subtitle="adbIp"
      :list="list"
      :preview="preview"
      :loading="loading"
      :error="error"
      :path-input="pathInput"
      root-fallback="/sdcard/"
      :empty-text="label('目录为空或无权限读取。', 'Directory is empty or not readable.')"
      :loading-text="label('正在读取设备目录...', 'Loading device directory...')"
      :preview-hint="label('点开一个文件即可查看只读预览。', 'Click a file to open a read-only preview.')"
      :label="label"
      :format-file-size="(value) => formatBytes(value ?? undefined)"
      @refresh="emit('refresh', currentPath)"
      @parent="emit('parent', parentPath)"
      @open-entry="emit('openEntry', $event)"
      @open-path="emit('openPath', $event)"
      @update:path-input="emit('update:pathInput', $event)"
    />
  </div>
</template>

<style scoped>
.files-panel-wrap {
  min-height: 430px;
}
</style>
