<script setup lang="ts">
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'

defineProps<{
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
</script>

<template>
  <aside class="filesystem-shell local-filesystem-shell">
    <div class="shell-head">
      <div class="shell-title">
        <span>{{ label('本机文件系统', 'Local Filesystem') }}</span>
        <small>{{ list?.root || rootFallback || label('本机源码根目录', 'Local source root') }}</small>
      </div>
      <div class="runtime-actions">
        <select
          :value="targetId"
          class="target-select"
          @change="emit('update:targetId', ($event.target as HTMLSelectElement).value); emit('refresh')"
        >
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.label }}
          </option>
        </select>
        <button class="secondary-btn" :disabled="loading" @click="emit('parent')">
          {{ label('上级', 'Up') }}
        </button>
        <button class="secondary-btn" :disabled="loading" @click="emit('refresh')">
          {{ label('刷新', 'Refresh') }}
        </button>
      </div>
    </div>
    <div class="filesystem-pathline">
      <small>{{ list?.absolute_path || list?.root || '' }}</small>
    </div>
    <p v-if="error" class="error-line">{{ error }}</p>
    <div v-if="list" class="filesystem-grid">
      <div class="filesystem-tree">
        <button
          v-for="entry in list.entries"
          :key="entry.path"
          class="filesystem-entry"
          :class="entry.type"
          @click="emit('openEntry', entry)"
        >
          <span class="entry-name">{{ entry.name }}</span>
          <span class="entry-meta">
            {{ entry.type }}
            <template v-if="entry.size != null">· {{ formatFileSize(entry.size) }}</template>
            <template v-if="entry.modified_at">· {{ entry.modified_at }}</template>
          </span>
        </button>
        <div v-if="list.truncated" class="filesystem-hint">
          {{ label('目录条目已截断，先展示前面一部分。', 'Directory entries were truncated to the first slice.') }}
        </div>
      </div>
      <div class="filesystem-preview">
        <div class="preview-head">
          <strong>{{ preview?.name || label('文件预览', 'File Preview') }}</strong>
          <small v-if="preview">
            {{ preview.encoding }} · {{ formatFileSize(preview.size) }}
            <template v-if="preview.truncated">· {{ label('已截断', 'Truncated') }}</template>
          </small>
        </div>
        <pre v-if="preview" class="preview-body">{{ preview.encoding === 'binary' ? label('二进制文件，不显示文本预览。', 'Binary file, no text preview.') : preview.content }}</pre>
        <div v-else class="shell-body filesystem-note">
          <span class="prompt">/</span>
          <span>{{ label('点开一个文件即可查看文本预览。', 'Click a file to view its text preview.') }}</span>
        </div>
      </div>
    </div>
    <div v-else class="shell-body filesystem-note">
      <span class="prompt">/</span>
      <span>
        {{ label('正在读取真实文件树。这里不放虚构目录。', 'Loading the real file tree. No fabricated directories are shown here.') }}
      </span>
    </div>
  </aside>
</template>
