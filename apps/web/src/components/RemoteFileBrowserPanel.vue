<script setup lang="ts">
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  targets?: Array<{ id: string; label: string }>
  targetId?: string
  list: RemoteWorkspaceFileList | null
  preview: RemoteWorkspaceFilePreview | null
  loading: boolean
  error: string
  pathInput: string
  rootFallback?: string
  emptyText: string
  loadingText: string
  previewHint: string
  label: (zh: string, en: string) => string
  formatFileSize: (value: number | null) => string
  selectable?: boolean
  selected?: Record<string, boolean>
}>(), {
  subtitle: '',
  targets: () => [],
  targetId: '',
  rootFallback: '',
  selectable: false,
  selected: () => ({}),
})

const emit = defineEmits<{
  refresh: []
  parent: []
  openEntry: [entry: RemoteWorkspaceFileEntry]
  openPath: [path: string]
  'update:pathInput': [value: string]
  'update:targetId': [value: string]
  'update:selected': [value: Record<string, boolean>]
}>()

function entryKindLabel(entry: RemoteWorkspaceFileEntry) {
  if (entry.type === 'directory') return 'DIR'
  if (entry.type === 'symlink') return 'LNK'
  if (entry.type === 'file') return 'FILE'
  return 'OTHER'
}

function entryMeta(entry: RemoteWorkspaceFileEntry) {
  const parts: string[] = [entry.type]
  if (entry.size != null && entry.type !== 'directory') parts.push(props.formatFileSize(entry.size))
  if (entry.modified_at) parts.push(entry.modified_at)
  return parts.join(' · ')
}

function updateTarget(event: Event) {
  emit('update:targetId', (event.target as HTMLSelectElement).value)
  emit('refresh')
}

function updatePath(event: Event) {
  emit('update:pathInput', (event.target as HTMLInputElement).value)
}

function updateSelected(name: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = { ...props.selected }
  if (checked) next[name] = true
  else delete next[name]
  emit('update:selected', next)
}
</script>

<template>
  <aside class="remote-file-browser">
    <header class="browser-head">
      <div class="browser-title">
        <span>{{ title }}</span>
        <small>{{ subtitle || list?.root || rootFallback }}</small>
      </div>
      <div class="browser-actions">
        <select
          v-if="targets.length > 0"
          :value="targetId"
          class="target-select"
          :disabled="loading"
          @change="updateTarget"
        >
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.label }}
          </option>
        </select>
        <button class="browser-btn" :disabled="loading" @click="emit('parent')">
          {{ label('上级', 'Up') }}
        </button>
        <button class="browser-btn" :disabled="loading" @click="emit('refresh')">
          {{ label('刷新', 'Refresh') }}
        </button>
      </div>
    </header>

    <div class="pathbar">
      <input
        :value="pathInput"
        :disabled="loading"
        spellcheck="false"
        @input="updatePath"
        @keydown.enter="emit('openPath', pathInput)"
      />
      <button class="browser-btn primary" :disabled="loading || !pathInput.trim()" @click="emit('openPath', pathInput)">
        {{ label('打开', 'Open') }}
      </button>
    </div>

    <div v-if="list?.absolute_path || list?.path || rootFallback" class="pathline">
      <small>{{ list?.absolute_path || list?.path || rootFallback }}</small>
    </div>

    <p v-if="error" class="error-line">{{ error }}</p>

    <div v-if="loading && !list" class="browser-note">
      <span class="prompt">/</span>
      <span>{{ loadingText }}</span>
    </div>

    <div v-else-if="list" class="browser-grid">
      <div class="file-list">
        <button
          v-for="entry in list.entries"
          :key="entry.path"
          class="file-entry"
          :class="[entry.type, { selectable }]"
          @click="emit('openEntry', entry)"
        >
          <input
            v-if="selectable"
            class="entry-check"
            type="checkbox"
            :checked="Boolean(selected[entry.name])"
            @click.stop
            @change.stop="updateSelected(entry.name, $event)"
          />
          <span class="entry-kind">{{ entryKindLabel(entry) }}</span>
          <span class="entry-main">
            <strong>{{ entry.name }}</strong>
            <small>{{ entryMeta(entry) }}</small>
          </span>
        </button>
        <div v-if="list.entries.length === 0" class="empty-line">
          {{ emptyText }}
        </div>
        <div v-if="list.truncated" class="hint-line">
          {{ label('目录条目已截断，先展示前面一部分。', 'Directory entries were truncated to the first slice.') }}
        </div>
      </div>

      <div class="preview-pane">
        <div class="preview-head">
          <strong>{{ preview?.name || label('文件预览', 'File Preview') }}</strong>
          <small v-if="preview">
            {{ preview.encoding }} · {{ formatFileSize(preview.size) }}
            <template v-if="preview.truncated"> · {{ label('已截断', 'Truncated') }}</template>
          </small>
        </div>
        <pre v-if="preview" class="preview-body">{{ preview.encoding === 'binary' ? label('二进制文件，不显示文本预览。', 'Binary file, no text preview.') : preview.content }}</pre>
        <div v-else class="browser-note preview-note">
          <span class="prompt">/</span>
          <span>{{ previewHint }}</span>
        </div>
      </div>
    </div>

    <div v-else class="browser-note">
      <span class="prompt">/</span>
      <span>{{ loadingText }}</span>
    </div>
  </aside>
</template>

<style scoped>
.remote-file-browser {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.browser-head {
  min-height: 56px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.browser-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.browser-title span {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.browser-title small,
.pathline small {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.browser-actions,
.pathbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.browser-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.browser-btn,
.target-select,
.pathbar input {
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
}

.browser-btn {
  padding: 0 11px;
  cursor: pointer;
}

.browser-btn.primary,
.browser-btn:hover:not(:disabled) {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.browser-btn:disabled,
.target-select:disabled,
.pathbar input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.target-select {
  padding: 0 10px;
}

.pathbar {
  padding: 12px 16px 0;
}

.pathbar input {
  flex: 1;
  min-width: 0;
  padding: 0 11px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 650;
}

.pathline {
  padding: 8px 16px 0;
}

.error-line {
  margin: 12px 16px 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 13px;
  font-weight: 800;
}

.browser-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.96fr) minmax(0, 1.04fr);
  min-height: 430px;
  margin-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.file-list {
  min-width: 0;
  max-height: 560px;
  overflow: auto;
  border-right: 1px solid #e2e8f0;
  padding: 10px;
}

.file-entry {
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  width: 100%;
  min-height: 54px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}

.file-entry.selectable {
  grid-template-columns: 18px 50px minmax(0, 1fr);
}

.entry-check {
  width: 16px;
  height: 16px;
  accent-color: #0f766e;
}

.file-entry:hover {
  border-color: rgba(37, 99, 235, 0.18);
  background: #eff6ff;
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

.file-entry.symlink .entry-main strong {
  color: #7c3aed;
}

.preview-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #0f172a;
  color: #d1fae5;
}

.preview-head {
  min-height: 48px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}

.preview-head strong {
  min-width: 0;
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 900;
  overflow-wrap: anywhere;
}

.preview-head small {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 750;
  text-align: right;
}

.preview-body {
  flex: 1;
  margin: 0;
  padding: 15px;
  overflow: auto;
  color: #d1fae5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.browser-note {
  min-height: 220px;
  padding: 22px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #0f172a;
  color: #d1fae5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
}

.preview-note {
  flex: 1;
}

.prompt {
  color: #34d399;
  font-weight: 900;
}

.empty-line,
.hint-line {
  padding: 18px 10px;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
  text-align: center;
}

.hint-line {
  padding-top: 8px;
  color: #94a3b8;
}

@media (max-width: 900px) {
  .browser-head {
    align-items: stretch;
    flex-direction: column;
  }

  .browser-actions,
  .pathbar {
    align-items: stretch;
  }

  .browser-actions > *,
  .pathbar .browser-btn {
    flex: 1;
  }

  .browser-grid {
    grid-template-columns: 1fr;
  }

  .file-list {
    max-height: 320px;
    border-right: 0;
    border-bottom: 1px solid #e2e8f0;
  }
}
</style>
