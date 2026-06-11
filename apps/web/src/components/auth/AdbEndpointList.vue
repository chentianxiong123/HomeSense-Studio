<script setup lang="ts">
import type { UserDevice } from '@/api'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  rows: Array<{ device: UserDevice }>
  testResults: Record<string, { ok: boolean; message: string }>
  label: LabelFn
  isBusy: (key: string) => boolean
}>()

const emit = defineEmits<{
  (event: 'test', address: string): void
  (event: 'edit', device: UserDevice): void
  (event: 'delete', device: UserDevice): void
}>()

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
</script>

<template>
  <div v-if="rows.length === 0" class="empty-line">
    {{ label('还没有 ADB 端点。', 'No ADB endpoints yet.') }}
  </div>

  <div v-else class="target-table">
    <div class="target-row header">
      <span>{{ label('名称', 'Name') }}</span>
      <span>{{ label('地址', 'Endpoint') }}</span>
      <span>{{ label('操作', 'Actions') }}</span>
    </div>
    <div v-for="row in rows" :key="row.device.id" class="target-row">
      <div class="device-cell">
        <strong>{{ row.device.name }}</strong>
      </div>
      <div class="endpoint-cell">
        <code>{{ row.device.props?.adb_ip }}</code>
        <small v-if="testResults[getString(row.device.props?.adb_ip)]" :class="['probe-result', testResults[getString(row.device.props?.adb_ip)].ok ? 'ok-text' : 'bad-text']">
          {{ testResults[getString(row.device.props?.adb_ip)].message }}
        </small>
      </div>
      <div class="row-actions">
        <button class="plain-btn compact" :disabled="isBusy(`adb-test-${row.device.props?.adb_ip}`)" @click="emit('test', getString(row.device.props?.adb_ip))">
          {{ label('测试', 'Test') }}
        </button>
        <button class="plain-btn compact" :disabled="isBusy(`adb-edit-${row.device.id}`)" @click="emit('edit', row.device)">
          {{ label('编辑', 'Edit') }}
        </button>
        <button class="danger-btn compact" :disabled="isBusy(`adb-delete-${row.device.id}`)" @click="emit('delete', row.device)">
          {{ label('删除', 'Delete') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.target-table,
.device-cell,
.endpoint-cell {
  display: grid;
  gap: 8px;
}

.target-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(160px, 1.4fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.target-row.header {
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.device-cell,
.endpoint-cell {
  min-width: 0;
}

.device-cell strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.endpoint-cell small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.empty-line {
  padding: 18px;
  text-align: center;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.ok-text { color: #047857; }
.bad-text { color: #b91c1c; }
.probe-result { display: block; }

.plain-btn,
.danger-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.danger-btn {
  border-color: #fecaca;
  color: #b91c1c;
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

@media (max-width: 760px) {
  .target-row,
  .target-row.header {
    grid-template-columns: 1fr;
  }

  .target-row.header {
    display: none;
  }
}
</style>
