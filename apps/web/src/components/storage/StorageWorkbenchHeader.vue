<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

defineProps<{
  disabled: boolean
  canCreateMount: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'refresh'): void
  (event: 'open-authorizations'): void
  (event: 'create-mount'): void
}>()
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">{{ label('中枢文件层', 'Hub Storage') }}</span>
      <h1>{{ label('文件工作台', 'Storage Workbench') }}</h1>
    </div>
    <div class="head-actions">
      <button class="plain-btn" :disabled="disabled" @click="emit('refresh')">{{ label('刷新', 'Refresh') }}</button>
      <button class="plain-btn" @click="emit('open-authorizations')">{{ label('授权中心', 'Authorizations') }}</button>
      <button class="primary-btn" :disabled="!canCreateMount" @click="emit('create-mount')">{{ label('新增挂载', 'Add Mount') }}</button>
    </div>
  </header>
</template>

<style scoped>
.page-head {
  min-height: 96px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px 24px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h1 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 0;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.plain-btn,
.primary-btn {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 12px;
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

.plain-btn:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f766e;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .page-head {
    align-items: stretch;
    flex-direction: column;
  }

  .head-actions {
    width: 100%;
  }
}
</style>
