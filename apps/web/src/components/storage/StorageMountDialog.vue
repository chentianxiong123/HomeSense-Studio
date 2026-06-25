<script setup lang="ts">
import type { AlistAuthorizationRecord } from '@/api/alist'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  open: boolean
  editing: boolean
  authorizations: AlistAuthorizationRecord[]
  selectedAuthorization: AlistAuthorizationRecord | null
  authorizationId: number | null
  name: string
  path: string
  readonly: boolean
  saving: boolean
  label: LabelFn
  authSummary: (auth: AlistAuthorizationRecord) => string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
  (event: 'update:authorizationId', value: number | null): void
  (event: 'update:name', value: string): void
  (event: 'update:path', value: string): void
  (event: 'update:readonly', value: boolean): void
}>()

function updateAuthorization(value: string) {
  const id = Number(value)
  emit('update:authorizationId', Number.isFinite(id) ? id : null)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click.self="emit('close')">
      <form class="dialog-panel" @submit.prevent="emit('submit')">
        <div class="dialog-head">
          <div>
            <span class="eyebrow">{{ label('文件来源', 'File Source') }}</span>
            <h2>{{ editing ? label('编辑来源', 'Edit Source') : label('新增来源', 'Add Source') }}</h2>
          </div>
          <button type="button" class="plain-btn compact" @click="emit('close')">{{ label('关闭', 'Close') }}</button>
        </div>

        <div class="form-grid">
          <label class="form-field full">
            <span>{{ label('授权', 'Authorization') }}</span>
            <select class="form-input" :value="authorizationId ?? ''" @change="updateAuthorization(($event.target as HTMLSelectElement).value)">
              <option v-for="auth in authorizations" :key="auth.id" :value="auth.id">
                {{ auth.name }} · {{ auth.driver }}
              </option>
            </select>
            <small v-if="selectedAuthorization">{{ authSummary(selectedAuthorization) }}</small>
          </label>

          <label class="form-field">
            <span>{{ label('来源名称', 'Source Name') }}</span>
            <input :value="name" class="form-input" :placeholder="label('家庭资料', 'Home Files')" @input="emit('update:name', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="form-field">
            <span>{{ label('入口路径', 'Entry Path') }}</span>
            <input :value="path" class="form-input" placeholder="/资料" @input="emit('update:path', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="check-field full">
            <input :checked="readonly" type="checkbox" @change="emit('update:readonly', ($event.target as HTMLInputElement).checked)" />
            <span>{{ label('只读来源', 'Readonly source') }}</span>
          </label>
        </div>

        <div class="dialog-actions">
          <button type="button" class="plain-btn" @click="emit('close')">{{ label('取消', 'Cancel') }}</button>
          <button type="submit" class="primary-btn" :disabled="!selectedAuthorization || !name.trim() || !path.trim() || saving">
            {{ editing ? label('保存', 'Save') : label('创建', 'Create') }}
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.32);
}

.dialog-panel {
  width: min(520px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dialog-head,
.dialog-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.dialog-actions {
  justify-content: flex-end;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-field,
.check-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field.full,
.check-field.full {
  grid-column: 1 / -1;
}

.form-field span,
.check-field span,
.form-field small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.check-field {
  flex-direction: row;
  align-items: center;
}

.form-input {
  width: 100%;
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
}

.plain-btn,
.primary-btn {
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
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
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
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-field.full,
  .check-field.full {
    grid-column: auto;
  }
}
</style>
