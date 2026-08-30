<script setup lang="ts">
import { ref } from 'vue'
import type { Room, UserDevice } from '@/api'
import DeviceNodeIcon from '@/components/devices/DeviceNodeIcon.vue'
import DevicesCanvasHeader from '@/components/devices/DevicesCanvasHeader.vue'
import RoomConnectionLines, { type RoomConnectionLine } from '@/components/devices/RoomConnectionLines.vue'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  rooms: Room[]
  devices: UserDevice[]
  editMode: boolean
  creatingRoom: boolean
  creatingDevice: boolean
  canCreateDevice: boolean
  hasViewportOffset: boolean
  scale: number
  panX: number
  panY: number
  resizingRoomId: number | null
  selectedDeviceId: number | null
  onlineStatus: Record<number, boolean>
  label: LabelFn
  getRoomCardStyle: (room: Room) => Record<string, string>
  getRoomConnections: (roomId: number) => RoomConnectionLine[]
  roomDevices: (room: Room) => UserDevice[]
  getDeviceStyle: (device: UserDevice) => Partial<Record<string, string>>
  deviceIcon: (type: string) => string
  propString: (device: UserDevice | null, key: string) => string
}>()

const emit = defineEmits<{
  createRoom: []
  createDevice: []
  toggleEdit: []
  resetView: []
  wheel: [event: WheelEvent]
  viewportPointerdown: [event: PointerEvent]
  viewportPointermove: [event: PointerEvent]
  viewportPointerup: [event: PointerEvent]
  viewportPointerleave: [event: PointerEvent]
  touchstart: [event: TouchEvent]
  touchmove: [event: TouchEvent]
  touchend: [event: TouchEvent]
  roomRef: [id: number, el: unknown]
  roomPointerdown: [event: PointerEvent, room: Room]
  roomDblclick: [room: Room]
  roomSettings: [room: Room]
  roomResizePointerdown: [event: PointerEvent, room: Room]
  deviceRef: [id: number, el: unknown]
  devicePointerdown: [event: PointerEvent, device: UserDevice]
  deviceSelect: [device: UserDevice]
  deviceOpen: [device: UserDevice]
}>()

const viewportRef = ref<HTMLElement | null>(null)
const transformWrapperRef = ref<HTMLElement | null>(null)

defineExpose({
  viewportEl: viewportRef,
  transformWrapperEl: transformWrapperRef,
})
</script>

<template>
  <main class="canvas-area glass-panel">
    <DevicesCanvasHeader
      :edit-mode="editMode"
      :creating-room="creatingRoom"
      :creating-device="creatingDevice"
      :can-create-device="canCreateDevice"
      :has-viewport-offset="hasViewportOffset"
      :label="label"
      @create-room="emit('createRoom')"
      @create-device="emit('createDevice')"
      @toggle-edit="emit('toggleEdit')"
      @reset-view="emit('resetView')"
    />

    <div
      ref="viewportRef"
      class="twin-viewport"
      @wheel="emit('wheel', $event)"
      @pointerdown="emit('viewportPointerdown', $event)"
      @pointermove="emit('viewportPointermove', $event)"
      @pointerup="emit('viewportPointerup', $event)"
      @pointerleave="emit('viewportPointerleave', $event)"
      @touchstart="emit('touchstart', $event)"
      @touchmove="emit('touchmove', $event)"
      @touchend="emit('touchend', $event)"
    >
      <div
        ref="transformWrapperRef"
        class="canvas-transform-wrapper"
        :style="{
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          transformOrigin: '0 0',
        }"
      >
        <div
          v-for="room in rooms"
          :key="room.id"
          :ref="(el) => emit('roomRef', room.id, el)"
          class="room-card"
          :class="{ editing: editMode, resizing: resizingRoomId === room.id }"
          :style="getRoomCardStyle(room)"
          @pointerdown="emit('roomPointerdown', $event, room)"
          @dblclick="emit('roomDblclick', room)"
        >
          <RoomConnectionLines :lines="getRoomConnections(room.id)" />

          <div class="room-title">
            <span class="room-dot"></span>
            <strong>{{ room.name }}</strong>
          </div>

          <button
            v-if="editMode"
            class="room-edit-gear"
            type="button"
            @pointerdown.stop.prevent
            @click.stop="emit('roomSettings', room)"
          >
            ...
          </button>

          <div
            v-if="editMode"
            class="room-resize-handle"
            @pointerdown="emit('roomResizePointerdown', $event, room)"
          ></div>

          <div
            v-for="dev in roomDevices(room)"
            :key="dev.id"
            :ref="(el) => emit('deviceRef', dev.id, el)"
            class="device-node"
            :class="{
              active: selectedDeviceId === dev.id,
              online: onlineStatus[dev.id] === true,
              offline: onlineStatus[dev.id] === false,
              'in-group': dev.props?.group_id,
            }"
            :style="getDeviceStyle(dev)"
            @pointerdown="emit('devicePointerdown', $event, dev)"
            @click.stop="editMode ? null : emit('deviceSelect', dev)"
            @dblclick.stop="editMode ? null : emit('deviceOpen', dev)"
          >
            <DeviceNodeIcon :icon="deviceIcon(propString(dev, 'device_type'))" />
            <span class="node-name">{{ dev.name }}</span>
            <span v-if="dev.props?.group_id" class="node-group-badge">#</span>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.canvas-area {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  padding: 32px;
  overflow: hidden;
  position: relative;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.twin-viewport {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: radial-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 24px;
  position: relative;
  overflow: hidden;
  margin: 0;
  cursor: grab;
}

.twin-viewport:active {
  cursor: grabbing;
}

.canvas-transform-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
}

.canvas-transform-wrapper > * {
  pointer-events: auto;
}

.room-card {
  position: absolute;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.01);
  cursor: grab;
  touch-action: none;
  padding: 16px;
  box-sizing: border-box;
}

.room-card:active {
  cursor: grabbing;
  border-color: #10b981;
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.04);
}

.room-card.editing {
  cursor: move;
  border-style: dashed;
  border-color: rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.08), 0 10px 30px rgba(15, 23, 42, 0.06);
}

.room-card.resizing {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14), 0 14px 38px rgba(15, 23, 42, 0.08);
}

.room-edit-gear {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(16, 185, 129, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  color: #059669;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.room-edit-gear:hover {
  transform: translateY(-1px);
  background: #ecfdf5;
}

.room-resize-handle {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 5;
  width: 22px;
  height: 22px;
  border-radius: 8px;
  cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 0 45%, rgba(16, 185, 129, 0.9) 45% 55%, transparent 55%),
    linear-gradient(135deg, transparent 0 62%, rgba(16, 185, 129, 0.65) 62% 72%, transparent 72%);
  background-color: rgba(236, 253, 245, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.28);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.room-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  pointer-events: none;
}

.room-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
}

.room-title strong {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 900;
}

.device-node {
  position: absolute;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
  transition: width 0.3s, height 0.3s, border-radius 0.3s, box-shadow 0.3s;
}

.device-node:active {
  cursor: grabbing;
}

.device-node.active {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.device-node.online {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
}

.device-node.offline {
  background: rgba(239, 68, 68, 0.05);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.15);
}

.device-node.in-group {
  border-color: rgba(99, 102, 241, 0.3);
}

.node-name {
  position: absolute;
  bottom: -22px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.9);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.04);
  pointer-events: none;
}

.node-group-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  font-size: 10px;
  background: #fff;
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 50%;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

@media (max-width: 1024px) {
  .canvas-area {
    flex: 1 1 auto;
    min-height: 0;
    padding: 16px;
  }

  .twin-viewport {
    min-height: 420px;
  }

  .room-card {
    transform: scale(0.7) !important;
    transform-origin: top left !important;
  }
}

@media (max-width: 640px) {
  .canvas-area {
    padding: 12px;
  }

  .twin-viewport {
    min-height: 320px;
  }

  .room-card {
    transform: scale(0.55) !important;
  }
}
</style>
