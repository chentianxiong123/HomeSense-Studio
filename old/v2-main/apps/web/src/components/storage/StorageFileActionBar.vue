<script setup lang="ts">
import { ref } from 'vue'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  copyTarget: string
  newFolderName: string
  selectedCount: number
  acting: boolean
  hasList: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'update:copyTarget', value: string): void
  (event: 'update:newFolderName', value: string): void
  (event: 'copy'): void
  (event: 'copy-task'): void
  (event: 'download'): void
  (event: 'upload', eventValue: Event): void
  (event: 'create-folder'): void
  (event: 'remove'): void
}>()

const uploadInput = ref<HTMLInputElement | null>(null)

function chooseUpload() {
  uploadInput.value?.click()
}
</script>

<template>
  <div class="copy-row">
    <input
      :value="copyTarget"
      :disabled="acting"
      spellcheck="false"
      :placeholder="label('复制到目标路径，例如 /资料/电影', 'Copy target path, e.g. /files/movies')"
      @input="emit('update:copyTarget', ($event.target as HTMLInputElement).value)"
    />
    <button class="plain-btn" :disabled="acting || selectedCount === 0 || !copyTarget.trim()" @click="emit('copy')">
      {{ label('复制', 'Copy') }} {{ selectedCount || '' }}
    </button>
    <button class="plain-btn" :disabled="acting || selectedCount === 0 || !copyTarget.trim()" @click="emit('copy-task')">
      {{ label('后台复制目录', 'Copy Tree') }} {{ selectedCount || '' }}
    </button>
    <button class="plain-btn" :disabled="acting || selectedCount === 0" @click="emit('download')">
      {{ label('下载', 'Download') }}
    </button>
    <button class="plain-btn" :disabled="acting || !hasList" @click="chooseUpload">
      {{ label('上传', 'Upload') }}
    </button>
    <input ref="uploadInput" class="hidden-file-input" type="file" @change="emit('upload', $event)" />
    <input
      :value="newFolderName"
      :disabled="acting || !hasList"
      spellcheck="false"
      :placeholder="label('新文件夹名称', 'New folder name')"
      @input="emit('update:newFolderName', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('create-folder')"
    />
    <button class="plain-btn" :disabled="acting || !hasList || !newFolderName.trim()" @click="emit('create-folder')">
      {{ label('新建文件夹', 'New Folder') }}
    </button>
    <button class="danger-btn" :disabled="acting || selectedCount === 0" @click="emit('remove')">
      {{ label('删除', 'Remove') }} {{ selectedCount || '' }}
    </button>
  </div>
</template>

<style scoped>
.copy-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

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

.hidden-file-input {
  display: none;
}

.plain-btn,
.danger-btn {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 12px;
  font: inherit;
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

.danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .copy-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
