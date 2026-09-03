<script setup lang="ts">
import type { Room, UserDevice } from '@/api'

type LabelFn = (zh: string, en: string) => string
type RoomColorPreset = { value: string; preview: string; zh: string; en: string }

defineProps<{
  room: Room | null
  name: string
  color: string
  deviceIds: number[]
  devices: UserDevice[]
  colorPresets: RoomColorPreset[]
  saving: boolean
  creatingDevice: boolean
  isZh: boolean
  label: LabelFn
  typeLabel: (value: string) => string
  deviceRoomName: (device: UserDevice) => string
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'submit'): void
  (event: 'delete'): void
  (event: 'create-device'): void
  (event: 'update:name', value: string): void
  (event: 'update:color', value: string): void
  (event: 'update:deviceIds', value: number[]): void
}>()

function updateDeviceIds(current: number[], id: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)
  emit('update:deviceIds', next)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="room" class="dialog-overlay" @click="emit('close')">
      <form class="dialog-panel glass-panel" @click.stop @submit.prevent="emit('submit')">
        <header class="dialog-head">
          <div>
            <span class="dialog-kicker">{{ label('房间操作', 'Room Operations') }}</span>
            <h3>{{ room.name }}</h3>
          </div>
          <button class="dialog-close" type="button" @click="emit('close')">×</button>
        </header>

        <label class="form-field">
          <span>{{ label('房间名称', 'Room name') }}</span>
          <input :value="name" type="text" :placeholder="label('例如：客厅', 'e.g. Living Room')" @input="emit('update:name', ($event.target as HTMLInputElement).value)" />
        </label>

        <section class="color-section">
          <span>{{ label('背景颜色', 'Background color') }}</span>
          <div class="color-grid">
            <button
              v-for="preset in colorPresets"
              :key="preset.preview"
              class="color-chip"
              :class="{ active: color === preset.value }"
              :style="{ background: preset.preview }"
              type="button"
              @click="emit('update:color', preset.value)"
            >
              <span>{{ isZh ? preset.zh : preset.en }}</span>
            </button>
          </div>
        </section>

        <section class="device-section">
          <div class="device-head">
            <span>{{ label('房间设备', 'Room devices') }}</span>
            <small>{{ label('勾选后会把设备移动到这个房间', 'Checked devices move into this room') }}</small>
          </div>
          <button class="add-device-btn" type="button" :disabled="creatingDevice" @click="emit('create-device')">
            {{ creatingDevice ? label('创建中...', 'Creating...') : label('新增设备到此房间', 'Add Device to Room') }}
          </button>
          <div class="device-list">
            <label v-for="device in devices" :key="device.id" class="device-row">
              <input :checked="deviceIds.includes(device.id)" type="checkbox" :value="device.id" @change="updateDeviceIds(deviceIds, device.id, $event)" />
              <span class="device-main">
                <strong>{{ device.name }}</strong>
                <small>{{ typeLabel(String(device.props?.device_type || 'other')) }} · {{ deviceRoomName(device) }}</small>
              </span>
            </label>
          </div>
        </section>

        <footer class="dialog-actions">
          <button class="delete-btn" type="button" :disabled="saving" @click="emit('delete')">
            {{ label('删除房间', 'Delete Room') }}
          </button>
          <div class="dialog-save-group">
            <button class="cancel-btn" type="button" :disabled="saving" @click="emit('close')">
              {{ label('取消', 'Cancel') }}
            </button>
            <button class="save-btn" type="submit" :disabled="saving">
              {{ saving ? label('保存中...', 'Saving...') : label('保存', 'Save') }}
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
  animation: overlayFade 0.25s ease;
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

.form-field,
.color-section,
.device-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-field > span,
.color-section > span,
.device-head > span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.form-field input {
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

.form-field input:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 10px;
}

.color-chip {
  min-height: 48px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  padding: 8px 10px;
  color: #0f172a;
  box-shadow: inset 0 0 0 999px rgba(255, 255, 255, 0.22);
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  text-align: left;
}

.color-chip.active {
  border-color: #10b981;
  box-shadow: inset 0 0 0 999px rgba(255, 255, 255, 0.12), 0 0 0 3px rgba(16, 185, 129, 0.14);
}

.device-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.device-head small {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.add-device-btn {
  height: 40px;
  border: 1px solid rgba(37, 99, 235, 0.18);
  border-radius: 14px;
  background: #eff6ff;
  color: #2563eb;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.add-device-btn:hover:not(:disabled) {
  background: #dbeafe;
}

.device-list {
  max-height: 240px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.74);
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.device-row {
  border-bottom: 1px solid rgba(15, 23, 42, 0.05);
  padding: 12px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
}

.device-row:last-child {
  border-bottom: 0;
}

.device-row:hover {
  background: rgba(16, 185, 129, 0.06);
}

.device-row input {
  width: 16px;
  height: 16px;
  accent-color: #10b981;
}

.device-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.device-main strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.device-main small {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.dialog-actions {
  align-items: center;
  padding-top: 4px;
}

.dialog-save-group {
  display: flex;
  gap: 10px;
}

.delete-btn,
.cancel-btn,
.save-btn {
  min-height: 42px;
  border-radius: 12px;
  padding: 0 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.delete-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
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
</style>
