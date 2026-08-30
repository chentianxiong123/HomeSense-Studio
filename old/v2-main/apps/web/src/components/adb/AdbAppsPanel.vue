<script setup lang="ts">
export interface AdbAppItem {
  package: string
  name: string
}

defineProps<{
  search: string
  apps: AdbAppItem[]
  busy: boolean
  loading: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  refresh: []
  launch: [packageName: string]
}>()
</script>

<template>
  <div class="surface full-surface">
    <div class="surface-head">
      <h3>{{ label('应用管理', 'Application Manager') }}</h3>
      <button class="ghost-btn" :disabled="busy" @click="emit('refresh')">{{ label('刷新', 'Refresh') }}</button>
    </div>
    <input
      :value="search"
      class="wide-input"
      :placeholder="label('搜索包名或应用名', 'Search package or app name')"
      @input="emit('update:search', ($event.target as HTMLInputElement).value)"
    />
    <div v-if="loading" class="empty-line">{{ label('正在加载应用...', 'Loading apps...') }}</div>
    <div v-else-if="apps.length === 0" class="empty-line">{{ label('没有应用数据', 'No app data') }}</div>
    <div v-else class="app-table">
      <div v-for="app in apps" :key="app.package" class="app-row">
        <div>
          <strong>{{ app.name }}</strong>
          <code>{{ app.package }}</code>
        </div>
        <button :disabled="busy" @click="emit('launch', app.package)">{{ label('启动', 'Launch') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.full-surface {
  min-height: 320px;
}

.surface-head,
.app-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.surface-head {
  margin-bottom: 14px;
}

h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  letter-spacing: 0;
}

.ghost-btn {
  padding: 7px 11px;
}

.ghost-btn:hover:not(:disabled),
.app-row button:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.wide-input {
  width: 100%;
  margin-bottom: 12px;
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  padding: 9px 11px;
  color: #0f172a;
  font: inherit;
  font-size: 14px;
}

.empty-line {
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

.app-table {
  display: flex;
  max-height: 420px;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.app-row {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
}

.app-row div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.app-row strong {
  color: #0f172a;
  font-size: 14px;
}

.app-row button {
  padding: 7px 12px;
}

@media (max-width: 900px) {
  .surface-head,
  .app-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
