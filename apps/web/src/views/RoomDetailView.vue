<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type UserDevice, type Room } from '@/api'
import { useLocale } from '@/composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

const roomId = computed(() => {
  const raw = route.params.id
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) ? n : null
})

const loading = ref(true)
const errorMessage = ref('')
const room = ref<Room | null>(null)
const devices = ref<UserDevice[]>([])
const onlineStatus = ref<Record<number, boolean>>({})
let pingTimer: ReturnType<typeof setInterval> | null = null

const isEditMode = ref(false)
const isMobilePortrait = ref(false)
const draggingDeviceId = ref<number | null>(null)

type RoomLayoutDraft = { x?: number; y?: number; w?: number; h?: number }
type RoomPropsDraft = Record<string, unknown> & {
  desktop?: RoomLayoutDraft
  mobile?: RoomLayoutDraft
  bgColor?: string
}
type DevicePropsDraft = Record<string, unknown> & {
  desktop?: RoomLayoutDraft
  mobile?: RoomLayoutDraft
}

function currentLayoutKey(): 'desktop' | 'mobile' {
  return isMobilePortrait.value ? 'mobile' : 'desktop'
}

function roomPropsRecord(r: Room): RoomPropsDraft {
  if (!r.props || typeof r.props !== 'object') r.props = {}
  return r.props as RoomPropsDraft
}

function getRoomLayoutSource(r: Room): RoomLayoutDraft {
  const props = roomPropsRecord(r)
  const layout = props[currentLayoutKey()]
  if (layout && typeof layout === 'object') return layout
  return props as RoomLayoutDraft
}

function getRoomBackground(r: Room, fallback = 'rgba(255, 255, 255, 0.65)'): string {
  const bg = roomPropsRecord(r).bgColor
  return typeof bg === 'string' && bg.trim() ? bg : fallback
}

function getRoomLayout(r: Room) {
  const layout = getRoomLayoutSource(r)
  return {
    x: layout.x ?? 60,
    y: layout.y ?? 60,
    w: layout.w ?? MIN_ROOM_W,
    h: layout.h ?? MIN_ROOM_H,
  }
}

function getDeviceLayoutSource(d: UserDevice): RoomLayoutDraft {
  const props = (d.props && typeof d.props === 'object' ? d.props : {}) as DevicePropsDraft
  if (props !== d.props) d.props = props
  const layout = props[currentLayoutKey()]
  if (layout && typeof layout === 'object') return layout
  return props as RoomLayoutDraft
}

function ensureDeviceLayout(d: UserDevice): RoomLayoutDraft {
  const props = (d.props && typeof d.props === 'object' ? d.props : {}) as DevicePropsDraft
  if (props !== d.props) d.props = props
  const key = currentLayoutKey()
  const existing = props[key]
  if (!existing || typeof existing !== 'object') {
    const layout = getDeviceLayout(d)
    props[key] = { x: layout.x, y: layout.y }
    d.props = props
  }
  return props[key] as RoomLayoutDraft
}

function getDeviceLayout(d: UserDevice) {
  const layout = getDeviceLayoutSource(d)
  return { x: layout.x ?? 40, y: layout.y ?? 40 }
}

function propString(d: UserDevice | null, key: string): string {
  if (!d) return ''
  const v = d.props?.[key]
  return typeof v === 'string' ? v : ''
}
function propNumber(d: UserDevice | null, key: string): number | null {
  if (!d) return null
  const v = d.props?.[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const deviceTypeOptions = [
  { value: 'television', zh: '电视', en: 'TV' },
  { value: 'stb', zh: '机顶盒', en: 'STB' },
  { value: 'speaker', zh: '音箱', en: 'Speaker' },
  { value: 'router', zh: '路由器', en: 'Router' },
  { value: 'outlet', zh: '插座', en: 'Outlet' },
  { value: 'phone', zh: '手机', en: 'Phone' },
  { value: 'tv_box', zh: '电视盒', en: 'TV Box' },
  { value: 'tablet', zh: '平板', en: 'Tablet' },
  { value: 'computer', zh: '电脑', en: 'Computer' },
  { value: 'other', zh: '其他', en: 'Other' },
]
function typeLabel(t: string) {
  const opt = deviceTypeOptions.find(o => o.value === t)
  return opt ? (isZh.value ? opt.zh : opt.en) : t
}
function deviceIcon(t: string): string {
  if (t === 'television' || t === 'tv_box') return 'tv'
  if (t === 'stb') return 'stb'
  if (t === 'speaker') return 'speaker'
  if (t === 'router') return 'router'
  if (t === 'outlet') return 'outlet'
  if (t === 'phone' || t === 'tablet') return 'phone'
  if (t === 'computer') return 'computer'
  return 'device'
}

const roomDevices = computed(() => {
  if (!room.value) return []
  const id = room.value.id
  return devices.value.filter(d => propNumber(d, 'room_id') === id)
})

const viewportEl = ref<HTMLElement | null>(null)
const roomEl = ref<HTMLElement | null>(null)
const viewportW = ref(1200)
const viewportH = ref(700)

function updateViewportSize() {
  if (viewportEl.value) {
    viewportW.value = viewportEl.value.clientWidth
    viewportH.value = viewportEl.value.clientHeight
  }
}

const roomStyle = computed(() => {
  if (!room.value) return {}
  // In the room detail view, expand the room to fill the available viewport
  // minus a small margin.
  return {
    left: '40px',
    top: '40px',
    width: `${Math.max(320, viewportW.value - 80)}px`,
    height: `${Math.max(240, viewportH.value - 80)}px`,
    background: getRoomBackground(room.value),
  }
})

function getDeviceStyle(d: UserDevice) {
  const layout = getDeviceLayout(d)
  return { left: `${layout.x}px`, top: `${layout.y}px` }
}

// Drag and resize — single-room context, so simpler than DevicesView
const deviceElementRefs = new Map<number, HTMLElement>()
function setDeviceElementRef(id: number, el: unknown) {
  if (el instanceof HTMLElement) deviceElementRefs.set(id, el)
  else deviceElementRefs.delete(id)
}

type DragState = { x: number; y: number; elRect: DOMRect; scale: number }
let deviceDragState: DragState | null = null

function getDeviceScale(d: UserDevice, el: HTMLElement) {
  const layout = getDeviceLayout(d)
  const r = el.getBoundingClientRect()
  return layout.x !== 0 || layout.y !== 0
    ? Math.max(0.0001, r.width / 60)
    : 1
}

function startDragDevice(event: PointerEvent, d: UserDevice) {
  if (!isEditMode.value) return
  const el = deviceElementRefs.get(d.id)
  if (!el) return
  event.preventDefault()
  event.stopPropagation()
  const layout = getDeviceLayout(d)
  deviceDragState = {
    x: layout.x,
    y: layout.y,
    elRect: el.getBoundingClientRect(),
    scale: getDeviceScale(d, el),
  }
  draggingDeviceId.value = d.id
  document.addEventListener('pointermove', onDragDevice)
  document.addEventListener('pointerup', stopDragDevice)
}
function onDragDevice(event: PointerEvent) {
  if (draggingDeviceId.value === null || !deviceDragState) return
  const d = devices.value.find(x => x.id === draggingDeviceId.value)
  if (!d) return
  const dx = event.clientX - deviceDragState.elRect.left
  const dy = event.clientY - deviceDragState.elRect.top
  const deviceLayout = ensureDeviceLayout(d)
  deviceLayout.x = Math.max(0, deviceDragState.x + (dx - deviceDragState.elRect.width / 2) / deviceDragState.scale)
  deviceLayout.y = Math.max(0, deviceDragState.y + (dy - deviceDragState.elRect.height / 2) / deviceDragState.scale)
}
async function stopDragDevice() {
  if (draggingDeviceId.value === null) return
  const d = devices.value.find(x => x.id === draggingDeviceId.value)
  draggingDeviceId.value = null
  deviceDragState = null
  document.removeEventListener('pointermove', onDragDevice)
  document.removeEventListener('pointerup', stopDragDevice)
  if (d) await api.userDevices.update(d.id, { props: d.props })
}

// Pan/zoom on the viewport
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)

function handleWheel(event: WheelEvent) {
  if (isEditMode.value) return
  event.preventDefault()
  const f = 0.08
  const next = event.deltaY < 0 ? scale.value + f : scale.value - f
  scale.value = Math.max(0.4, Math.min(3, next))
}

function startPan(event: PointerEvent) {
  if (isEditMode.value) return
  if (event.target !== event.currentTarget) return
  isPanning.value = true
  panStartX.value = event.clientX - panX.value
  panStartY.value = event.clientY - panY.value
  viewportEl.value?.setPointerCapture(event.pointerId)
}
function onPan(event: PointerEvent) {
  if (!isPanning.value) return
  panX.value = event.clientX - panStartX.value
  panY.value = event.clientY - panStartY.value
}
function stopPan(event: PointerEvent) {
  if (!isPanning.value) return
  isPanning.value = false
  viewportEl.value?.releasePointerCapture(event.pointerId)
}

function resetView() {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

function goBack() {
  router.push('/devices')
}

async function loadData() {
  if (roomId.value == null) {
    errorMessage.value = label('无效的房间 ID', 'Invalid room id')
    loading.value = false
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const [roomRes, devRes] = await Promise.all([
      api.rooms.list(),
      api.userDevices.list(),
    ])
    const all = (roomRes.rooms ?? []) as Room[]
    const found = all.find(r => r.id === roomId.value) ?? null
    if (!found) {
      errorMessage.value = label('未找到此房间', 'Room not found')
      room.value = null
    } else {
      room.value = found
    }
    devices.value = devRes.devices ?? []
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
}

async function pingDevices() {
  try {
    const result = await api.userDevices.ping()
    onlineStatus.value = result.online
  } catch {}
}

function detectOrientation() {
  isMobilePortrait.value = window.innerWidth <= 760 && window.innerHeight > window.innerWidth
}

function onResize() {
  detectOrientation()
  updateViewportSize()
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value
}

onMounted(async () => {
  detectOrientation()
  window.addEventListener('resize', onResize)
  await loadData()
  pingDevices()
  pingTimer = setInterval(pingDevices, 60000)
  updateViewportSize()
})
onBeforeUnmount(() => {
  if (pingTimer) clearInterval(pingTimer)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('pointermove', onDragDevice)
  document.removeEventListener('pointerup', stopDragDevice)
})

watch(() => route.params.id, async () => {
  await loadData()
})
</script>

<template>
  <div class="room-detail-page">
    <header class="rd-head">
      <button class="rd-back" type="button" @click="goBack">← {{ label('返回全屋户型图', 'Back to Floor Plan') }}</button>
      <div class="rd-title-block">
        <span class="rd-kicker">{{ label('房间视图', 'Room View') }}</span>
        <h2 v-if="room">{{ room.name }}</h2>
        <h2 v-else>—</h2>
      </div>
      <div class="rd-actions">
        <button
          class="rd-edit-btn"
          :class="{ active: isEditMode }"
          type="button"
          @click="toggleEditMode"
        >
          {{ isEditMode ? label('退出编辑', 'Exit Edit') : label('编辑房间', 'Edit Room') }}
        </button>
        <button class="rd-reset-btn" type="button" v-if="!isEditMode && (scale !== 1 || panX !== 0 || panY !== 0)" @click="resetView">
          {{ label('重置视图', 'Reset View') }}
        </button>
      </div>
    </header>

    <main class="rd-canvas">
      <div
        ref="viewportEl"
        class="rd-viewport"
        @wheel="handleWheel"
        @pointerdown="startPan"
        @pointermove="onPan"
        @pointerup="stopPan"
        @pointerleave="stopPan"
      >
        <div
          class="rd-transform-wrapper"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }"
        >
          <div
            v-if="room"
            ref="roomEl"
            class="rd-room"
            :class="{ editing: isEditMode }"
            :style="roomStyle"
          >
            <span class="rd-room-dot"></span>
            <strong class="rd-room-name">{{ room.name }}</strong>

            <div
              v-if="isEditMode"
              class="rd-room-drag-hint"
            >
              {{ label('拖动设备节点调整位置', 'Drag device nodes to reposition') }}
            </div>

            <div
              v-for="d in roomDevices"
              :key="d.id"
              :ref="(el) => setDeviceElementRef(d.id, el)"
              class="rd-device"
              :class="{
                online: onlineStatus[d.id] === true,
                offline: onlineStatus[d.id] === false,
                'in-group': d.props?.group_id,
                editing: isEditMode,
              }"
              :style="getDeviceStyle(d)"
              @pointerdown="startDragDevice($event, d)"
              @click.stop="isEditMode ? null : null"
            >
              <div class="rd-detailed">
                <div class="rd-detailed-head">
                  <span class="rd-d-dot" :class="onlineStatus[d.id] ? 'online' : 'offline'"></span>
                  <strong class="rd-d-title">{{ d.name }}</strong>
                </div>
                <p class="rd-d-type">{{ typeLabel(propString(d, 'device_type') || 'other') }}</p>
                <div class="rd-d-props" v-if="propString(d, 'ip_address') || propString(d, 'adb_ip')">
                  <span>{{ propString(d, 'ip_address') || propString(d, 'adb_ip').split(':')[0] }}</span>
                </div>
                <div class="rd-d-group" v-if="d.props?.group_id">
                  <span>⛓ {{ d.props.group_name }}</span>
                </div>
                <div class="rd-d-edit-hint" v-if="isEditMode">{{ label('拖动调整位置', 'Drag to reposition') }}</div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="loading" class="rd-status">
          {{ label('加载中...', 'Loading...') }}
        </div>
        <div v-else-if="errorMessage" class="rd-status rd-status-error">
          {{ errorMessage }}
        </div>
        <div v-else-if="!room" class="rd-status">
          {{ label('房间不存在', 'No such room') }}
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.room-detail-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #f7f9fa;
  z-index: 50;
}

.rd-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
}

.rd-back {
  height: 40px;
  padding: 0 18px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}
.rd-back:hover { color: #10b981; border-color: #10b981; }

.rd-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.rd-kicker {
  font-size: 11px;
  font-weight: 900;
  color: #10b981;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.rd-title-block h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rd-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rd-edit-btn {
  height: 40px;
  padding: 0 18px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 10px;
  background: #111827;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.2s;
}
.rd-edit-btn:hover { transform: translateY(-1px); }
.rd-edit-btn.active {
  background: #10b981;
  border-color: #10b981;
}

.rd-reset-btn {
  height: 40px;
  padding: 0 18px;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.rd-reset-btn:hover { color: #10b981; border-color: #10b981; }

.rd-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  padding: 24px;
  box-sizing: border-box;
}

.rd-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 24px;
  overflow: hidden;
  cursor: grab;
}
.rd-viewport:active { cursor: grabbing; }

.rd-transform-wrapper {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.rd-transform-wrapper > * { pointer-events: auto; }

.rd-room {
  position: absolute;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.06);
  box-sizing: border-box;
  padding: 24px;
}
.rd-room.editing {
  border-style: dashed;
  border-color: rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.08), 0 18px 48px rgba(15, 23, 42, 0.08);
}

.rd-room-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: #10b981;
  border-radius: 50%;
  margin-right: 10px;
  vertical-align: middle;
}
.rd-room-name {
  font-size: 22px;
  color: var(--text-primary);
  font-weight: 900;
  letter-spacing: -0.04em;
}

.rd-room-drag-hint {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 800;
  color: #10b981;
  background: rgba(236, 253, 245, 0.95);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 999px;
  padding: 6px 16px;
  pointer-events: none;
  z-index: 4;
}

.rd-device {
  position: absolute;
  width: 154px;
  height: 114px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04);
  cursor: grab;
  touch-action: none;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.rd-device:active { cursor: grabbing; }
.rd-device.online {
  border-color: rgba(16, 185, 129, 0.45);
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.18), 0 10px 30px rgba(0, 0, 0, 0.04);
}
.rd-device.offline {
  border-color: rgba(239, 68, 68, 0.35);
}
.rd-device.in-group {
  border-color: rgba(99, 102, 241, 0.4);
}
.rd-device.editing {
  cursor: grab;
}

.rd-detailed {
  width: 100%;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: left;
  box-sizing: border-box;
  pointer-events: none;
}
.rd-detailed-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rd-d-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rd-d-dot.online { background: #10b981; }
.rd-d-dot.offline { background: #ef4444; }
.rd-d-title {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rd-d-type {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin: 2px 0 0;
}
.rd-d-props {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.8;
  margin-top: auto;
}
.rd-d-group {
  font-size: 10px;
  color: #6366f1;
  font-weight: 800;
  margin-top: 2px;
}
.rd-d-edit-hint {
  font-size: 9px;
  font-weight: 800;
  color: #10b981;
  opacity: 0.7;
  text-align: right;
  margin-top: 2px;
}

.rd-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-secondary);
  pointer-events: none;
}
.rd-status-error { color: #dc2626; }
</style>
