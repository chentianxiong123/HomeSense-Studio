<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

defineProps<{
  busy: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'refresh'): void
}>()
</script>

<template>
  <header class="page-head">
    <div>
      <span class="eyebrow">{{ label('统一认证与授权', 'Unified Auth') }}</span>
      <h1>{{ label('授权中心', 'Authorization Center') }}</h1>
    </div>
    <div class="head-actions">
      <button class="plain-btn" :disabled="busy" @click="emit('refresh')">{{ label('刷新', 'Refresh') }}</button>
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

.plain-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 12px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f766e;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
