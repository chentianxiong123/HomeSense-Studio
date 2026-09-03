<script setup lang="ts">
import type { StorageTaskRecord } from '@/api/storage'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  tasks: StorageTaskRecord[]
  disabled: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'refresh'): void
}>()
</script>

<template>
  <div v-if="tasks.length > 0" class="task-strip">
    <button class="plain-btn compact" :disabled="disabled" @click="emit('refresh')">{{ label('刷新任务', 'Refresh Tasks') }}</button>
    <div v-for="task in tasks.slice(0, 4)" :key="task.id" class="task-chip" :class="task.status">
      <strong>{{ task.kind }} · {{ task.status }}</strong>
      <small>{{ task.error || `${task.message || ''}${task.message ? ' · ' : ''}${task.progress}%` }}</small>
    </div>
  </div>
</template>

<style scoped>
.task-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-chip {
  min-height: 40px;
  max-width: 260px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 7px 10px;
  background: #fff;
  display: grid;
  gap: 2px;
}

.task-chip strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.task-chip small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-chip.success {
  border-color: #bbf7d0;
  background: #ecfdf5;
}

.task-chip.error {
  border-color: #fecaca;
  background: #fef2f2;
}

.task-chip.running,
.task-chip.queued {
  border-color: #bae6fd;
  background: #f0f9ff;
}

.plain-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.compact {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
