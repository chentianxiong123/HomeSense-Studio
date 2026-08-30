<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

defineProps<{
  editMode: boolean
  creatingRoom: boolean
  creatingDevice: boolean
  canCreateDevice: boolean
  hasViewportOffset: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'create-room'): void
  (event: 'create-device'): void
  (event: 'toggle-edit'): void
  (event: 'reset-view'): void
}>()
</script>

<template>
  <header class="canvas-head">
    <h2>{{ label('数字孪生 · 2D 房型布局', 'Digital Twin Canvas') }}</h2>
    <div class="canvas-head-actions">
      <span class="hint-pill">
        {{ editMode ? label('编辑模式：拖拽房间或设备调整位置，右下角拉伸', 'Edit mode: drag rooms or devices to reposition; resize from bottom-right') : label('使用鼠标滚轮或双指进行「无级缩放 / 画布拖拽」', 'Scroll wheel or pinch zoom to zoom & pan canvas') }}
      </span>
      <button v-if="editMode" class="add-room-btn" type="button" :disabled="creatingRoom" @click="emit('create-room')">
        {{ creatingRoom ? label('创建中...', 'Creating...') : label('新增房间', 'Add Room') }}
      </button>
      <button v-if="editMode" class="add-device-btn" type="button" :disabled="creatingDevice || !canCreateDevice" @click="emit('create-device')">
        {{ creatingDevice ? label('创建中...', 'Creating...') : label('新增设备', 'Add Device') }}
      </button>
      <button class="edit-mode-btn" :class="{ active: editMode }" type="button" @click="emit('toggle-edit')">
        {{ editMode ? label('退出编辑', 'Exit Edit') : label('编辑房间', 'Edit Rooms') }}
      </button>
      <button v-if="hasViewportOffset" class="reset-zoom-btn" type="button" @click="emit('reset-view')">
        {{ label('重置缩放', 'Reset View') }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.canvas-head {
  margin-bottom: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.canvas-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.canvas-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.hint-pill {
  display: inline-block;
  border-radius: 8px;
  padding: 4px 12px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 13px;
  font-weight: 700;
}

.reset-zoom-btn,
.add-room-btn,
.add-device-btn,
.edit-mode-btn {
  border-radius: 10px;
  padding: 8px 18px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-zoom-btn {
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #fff;
  color: var(--text-secondary);
  font-weight: 800;
}

.reset-zoom-btn:hover {
  border-color: #10b981;
  color: #10b981;
}

.add-room-btn,
.add-device-btn {
  border: 1px solid rgba(16, 185, 129, 0.24);
  background: #fff;
  color: #059669;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);
}

.add-device-btn {
  border-color: rgba(37, 99, 235, 0.22);
  color: #2563eb;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.1);
}

.add-room-btn:hover:not(:disabled),
.add-device-btn:hover:not(:disabled),
.edit-mode-btn:hover {
  transform: translateY(-1px);
}

.add-room-btn:hover:not(:disabled) {
  background: #ecfdf5;
}

.add-device-btn:hover:not(:disabled) {
  background: #eff6ff;
}

.add-room-btn:disabled,
.add-device-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.edit-mode-btn {
  border: 1px solid rgba(17, 24, 39, 0.08);
  background: #111827;
  color: #fff;
  box-shadow: 0 4px 14px rgba(17, 24, 39, 0.16);
}

.edit-mode-btn.active {
  border-color: #10b981;
  background: #10b981;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
}
</style>
