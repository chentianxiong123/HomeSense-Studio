<script setup lang="ts">
import { ref, watch } from 'vue'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'
import RemoteFileBrowserPanel from '@/components/RemoteFileBrowserPanel.vue'

const props = defineProps<{
  targets: Array<{ id: string; label: string }>
  targetId: string
  list: RemoteWorkspaceFileList | null
  preview: RemoteWorkspaceFilePreview | null
  loading: boolean
  error: string
  rootFallback: string
  label: (zh: string, en: string) => string
  formatFileSize: (value: number | null) => string
}>()

const emit = defineEmits<{
  refresh: []
  parent: []
  openEntry: [entry: RemoteWorkspaceFileEntry]
  'update:targetId': [value: string]
}>()

const pathDraft = ref('')

watch(
  () => props.list?.path,
  (path) => {
    pathDraft.value = path || ''
  },
  { immediate: true },
)
</script>

<template>
  <RemoteFileBrowserPanel
    :title="label('本机文件系统', 'Local Filesystem')"
    :subtitle="list?.root || rootFallback || label('本机源码根目录', 'Local source root')"
    :targets="targets"
    :target-id="targetId"
    :list="list"
    :preview="preview"
    :loading="loading"
    :error="error"
    :path-input="pathDraft"
    :root-fallback="rootFallback"
    :empty-text="label('目录为空。', 'Directory is empty.')"
    :loading-text="label('正在读取真实文件树。这里不放虚构目录。', 'Loading the real file tree. No fabricated directories are shown here.')"
    :preview-hint="label('点开一个文件即可查看文本预览。', 'Click a file to view its text preview.')"
    :label="label"
    :format-file-size="formatFileSize"
    @refresh="emit('refresh')"
    @parent="emit('parent')"
    @open-entry="emit('openEntry', $event)"
    @open-path="emit('openEntry', { name: $event, path: $event, type: 'directory', size: null, modified_at: null })"
    @update:path-input="pathDraft = $event"
    @update:target-id="emit('update:targetId', $event)"
  />
</template>
