<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

defineProps<{
  open: boolean
  editing: boolean
  name: string
  location: string
  ip: string
  manufacturer: string
  model: string
  saving: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
  (event: 'update:name', value: string): void
  (event: 'update:location', value: string): void
  (event: 'update:ip', value: string): void
  (event: 'update:manufacturer', value: string): void
  (event: 'update:model', value: string): void
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click.self="emit('close')">
      <form class="dialog-panel" @submit.prevent="emit('submit')">
        <div class="dialog-head">
          <div>
            <span class="eyebrow">{{ label('DLNA 目标', 'DLNA Target') }}</span>
            <h2>{{ editing ? label('编辑目标', 'Edit Target') : label('新增目标', 'Add Target') }}</h2>
          </div>
          <button type="button" class="plain-btn compact" @click="emit('close')">{{ label('关闭', 'Close') }}</button>
        </div>

        <div class="form-grid">
          <label class="form-field">
            <span>{{ label('名称', 'Name') }}</span>
            <input :value="name" class="form-input" :placeholder="label('客厅音箱 DLNA', 'Living Room Speaker DLNA')" @input="emit('update:name', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="form-field full">
            <span>Location URL</span>
            <input :value="location" class="form-input" placeholder="http://192.168.31.20:8200/description.xml" @input="emit('update:location', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="form-field">
            <span>IP</span>
            <input :value="ip" class="form-input" placeholder="192.168.31.20" @input="emit('update:ip', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="form-field">
            <span>{{ label('厂商', 'Manufacturer') }}</span>
            <input :value="manufacturer" class="form-input" placeholder="Xiaomi" @input="emit('update:manufacturer', ($event.target as HTMLInputElement).value)" />
          </label>

          <label class="form-field full">
            <span>{{ label('型号', 'Model') }}</span>
            <input :value="model" class="form-input" placeholder="Renderer model" @input="emit('update:model', ($event.target as HTMLInputElement).value)" />
          </label>
        </div>

        <div class="dialog-actions">
          <button type="button" class="plain-btn" @click="emit('close')">{{ label('取消', 'Cancel') }}</button>
          <button type="submit" class="primary-btn" :disabled="!name.trim() || !location.trim() || saving">
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
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.38);
}

.dialog-panel {
  width: min(560px, 100%);
  border-radius: 8px;
  padding: 18px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
}

.dialog-head,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
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
  margin: 16px 0;
}

.form-field {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 900;
}

.form-field.full {
  grid-column: 1 / -1;
}

.form-input,
.plain-btn,
.primary-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 12px;
  font: inherit;
}

.plain-btn {
  background: #fff;
  color: #334155;
  font-weight: 800;
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
}
</style>
