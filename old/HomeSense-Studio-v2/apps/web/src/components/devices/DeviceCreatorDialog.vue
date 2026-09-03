<script setup lang="ts">
import type { Room } from '@/api'

type LabelFn = (zh: string, en: string) => string
type DeviceTypeOption = { value: string; zh: string; en: string }

defineProps<{
  open: boolean
  name: string
  type: string
  roomId: number | null
  rooms: Room[]
  deviceTypeOptions: DeviceTypeOption[]
  creating: boolean
  isZh: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
  (event: 'update:name', value: string): void
  (event: 'update:type', value: string): void
  (event: 'update:roomId', value: number | null): void
}>()

function readNullableNumber(event: Event): number | null {
  const value = (event.target as HTMLSelectElement).value
  return value === '' ? null : Number(value)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-overlay" @click="emit('close')">
      <form class="dialog-panel glass-panel" @click.stop @submit.prevent="emit('submit')">
        <header class="dialog-head">
          <div>
            <span class="dialog-kicker">{{ label('设备操作', 'Device Operations') }}</span>
            <h3>{{ label('新增设备', 'Add Device') }}</h3>
          </div>
          <button class="dialog-close" type="button" @click="emit('close')">×</button>
        </header>

        <label class="form-field">
          <span>{{ label('设备名称', 'Device name') }}</span>
          <input :value="name" type="text" :placeholder="label('例如：客厅电视', 'e.g. Living Room TV')" @input="emit('update:name', ($event.target as HTMLInputElement).value)" />
        </label>

        <label class="form-field">
          <span>{{ label('设备类型', 'Device type') }}</span>
          <select :value="type" @change="emit('update:type', ($event.target as HTMLSelectElement).value)">
            <option v-for="option in deviceTypeOptions" :key="option.value" :value="option.value">
              {{ isZh ? option.zh : option.en }}
            </option>
          </select>
        </label>

        <label class="form-field">
          <span>{{ label('所属房间', 'Room') }}</span>
          <select :value="roomId ?? ''" @change="emit('update:roomId', readNullableNumber($event))">
            <option value="">{{ label('请选择房间', 'Select a room') }}</option>
            <option v-for="room in rooms" :key="room.id" :value="room.id">
              {{ room.name }}
            </option>
          </select>
        </label>

        <footer class="dialog-actions">
          <span class="device-create-note">
            {{ label('创建后会出现在房间中心，可继续拖拽调整位置。', 'It will appear in the room center and can be dragged afterward.') }}
          </span>
          <div class="dialog-save-group">
            <button class="cancel-btn" type="button" :disabled="creating" @click="emit('close')">
              {{ label('取消', 'Cancel') }}
            </button>
            <button class="save-btn" type="submit" :disabled="creating">
              {{ creating ? label('创建中...', 'Creating...') : label('创建设备', 'Create Device') }}
            </button>
          </div>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  padding: 24px;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.dialog-panel {
  width: min(560px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  border: 1px solid rgba(229, 231, 235, 0.7);
  padding: 28px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.16);
  box-sizing: border-box;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.glass-panel {
  border-radius: 24px;
}

.dialog-head,
.dialog-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dialog-kicker {
  display: inline-flex;
  margin-bottom: 6px;
  color: #10b981;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dialog-head h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 0;
}

.dialog-close {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-field > span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.form-field input,
.form-field select {
  height: 44px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  padding: 0 14px;
  background: #fff;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  outline: none;
}

.form-field input:focus,
.form-field select:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.dialog-actions {
  align-items: center;
  padding-top: 4px;
}

.dialog-save-group {
  display: flex;
  gap: 10px;
}

.device-create-note {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}

.cancel-btn,
.save-btn {
  min-height: 42px;
  border-radius: 12px;
  padding: 0 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.cancel-btn {
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  color: var(--text-secondary);
}

.save-btn {
  border: 0;
  background: #10b981;
  color: #fff;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.24);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 680px) {
  .dialog-overlay {
    align-items: stretch;
    padding: 12px;
  }

  .dialog-panel {
    max-height: calc(100vh - 24px);
    padding: 22px;
  }

  .dialog-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-save-group {
    justify-content: flex-end;
  }
}
</style>
