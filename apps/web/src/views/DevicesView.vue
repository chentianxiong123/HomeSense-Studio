<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice, type Room, type MiDeviceCandidate } from '@/api'
import { cliApi } from '@/api/cli'
import { deviceTypeOptions, roomColorPresets } from '@/components/devices/deviceOptions'
import DeviceCreatorDialog from '@/components/devices/DeviceCreatorDialog.vue'
import DevicesFloorCanvas from '@/components/devices/DevicesFloorCanvas.vue'
import { type RoomConnectionLine } from '@/components/devices/RoomConnectionLines.vue'
import RoomSettingsDialog from '@/components/devices/RoomSettingsDialog.vue'
import { useLocale } from '@/composables/useLocale'
import { useDeviceGroups } from '@/composables/useDeviceGroups'
import { useDevicesCanvasInteraction } from '@/composables/useDevicesCanvasInteraction'
import { useDevicesEditor } from '@/composables/useDevicesEditor'
import {
  useDevicesLayout,
  type DevicePropsDraft,
  type DeviceRatio,
  type RoomPropsDraft,
} from '@/composables/useDevicesLayout'
import { pixelToRatio, looksLikeRatio, clampRatio } from '@/utils/roomCoords'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }
const router = useRouter()

const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null

function showSuccess(msg: string) {
  successMessage.value = msg
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => { successMessage.value = '' }, 3000)
}

const devices = ref<UserDevice[]>([])
const rooms = ref<Room[]>([])
const miCandidates = ref<MiDeviceCandidate[]>([])
const miCandidatesLoading = ref(false)
const onlineStatus = ref<Record<number, boolean>>({})
let pingTimer: ReturnType<typeof setInterval> | null = null

// 2D Layout & Zoom State
const isEditMode = ref(false)

const isMobilePortrait = ref(false)

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

const {
  activeRooms,
  currentLayoutKey,
  roomPropsRecord,
  getRoomLayout,
  ensureRoomLayout,
  getRoomCardStyle,
  ensureDeviceLayout,
  getDeviceLayout,
  findParentRoom,
  getDeviceStyle,
} = useDevicesLayout({
  rooms,
  devices,
  isMobilePortrait,
  propNumber,
})

const {
  canvasRef,
  selectedDeviceId,
  viewportWidth,
  viewportHeight,
  scale,
  panX,
  panY,
  resizingRoomId,
  getViewportEl,
  getTransformWrapperEl,
  setRoomElementRef,
  setDeviceElementRef,
  updateViewportSize,
  getCanvasDomScale,
  handleWheel,
  startPan,
  onPan,
  stopPan,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  resetZoom,
  startDragRoom,
  startResizeRoom,
  startDragDevice,
} = useDevicesCanvasInteraction({
  rooms,
  devices,
  isEditMode,
  getRoomLayout,
  ensureRoomLayout,
  getDeviceLayout,
  ensureDeviceLayout,
  findParentRoom,
  saveRoomLayout: async (room) => {
    await api.rooms.update(room.id, { props: room.props })
  },
  saveDeviceLayout: async (device) => {
    await api.userDevices.update(device.id, { props: device.props })
  },
})

const {
  creating,
  creatingDevice,
  saving,
  editingRoomName,
  editingRoomColor,
  editingRoomDeviceIds,
  editingRoom,
  roomDeviceOptions,
  deviceCreatorOpen,
  newDeviceName,
  newDeviceType,
  newDeviceRoomId,
  createRoomInView,
  openDeviceCreator,
  closeDeviceCreator,
  createDeviceFromDialog,
  roomNameForDevice,
  closeRoomSettings,
  openRoomSettings,
  saveRoomSettings,
  deleteEditingRoom,
} = useDevicesEditor({
  rooms,
  devices,
  activeRooms,
  isEditMode,
  errorMessage,
  currentLayoutKey,
  roomPropsRecord,
  propNumber,
  getRoomSpawnLayout,
  label,
  showSuccess,
})

onMounted(async () => {
  detectOrientation()
  await loadData()
  startPing()
  void ensureMiNamesLoaded()
  updateViewportSize()
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  if (pingTimer) clearInterval(pingTimer)
  window.removeEventListener('resize', onResize)
})

function onResize() {
  detectOrientation()
  updateViewportSize()
}

function detectOrientation() {
  isMobilePortrait.value = window.innerWidth <= 760 && window.innerHeight > window.innerWidth
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [devRes, roomRes] = await Promise.all([
      api.userDevices.list(),
      api.rooms.list(),
    ])
    devices.value = devRes.devices ?? []
    rooms.value = roomRes.rooms ?? []
    await groups.load()

    // Auto initialize room coordinates
    let roomChanged = false
    const key = currentLayoutKey()
    for (const room of rooms.value) {
      const props = roomPropsRecord(room)
      const layout = props[key]
      if (!layout || typeof layout !== 'object' || typeof layout.x !== 'number') {
        props[key] = {
          x: Math.floor(Math.random() * (isMobilePortrait.value ? 100 : 400)) + 30,
          y: Math.floor(Math.random() * (isMobilePortrait.value ? 150 : 300)) + 30,
          w: isMobilePortrait.value ? 200 : 260,
          h: isMobilePortrait.value ? 150 : 200,
        }
        room.props = props
        await api.rooms.update(room.id, { props: room.props })
        roomChanged = true
      }
    }
    if (roomChanged) {
      const roomRes2 = await api.rooms.list()
      rooms.value = roomRes2.rooms ?? []
    }

    // One-time migration: device position used to be canvas-pixel coordinates.
    // Convert any legacy pixel data to room-relative 0..1 ratios.
    await migrateLegacyDevicePositions()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    loading.value = false
  }
}

// Detects legacy pixel-coordinate data on devices and converts it to the
// new ratio system. Idempotent: ratio values are in [0..1] and pass
// `looksLikeRatio` so already-migrated records are left alone.
async function migrateLegacyDevicePositions() {
  const key = currentLayoutKey()
  for (const device of devices.value) {
    const roomId = propNumber(device, 'room_id')
    const room = roomId == null ? null : rooms.value.find((r) => r.id === roomId) ?? null
    if (!room) continue

    const roomLayout = getRoomLayout(room)
    if (roomLayout.w <= 0 || roomLayout.h <= 0) continue

    const props = (device.props && typeof device.props === 'object'
      ? device.props
      : {}) as DevicePropsDraft
    if (props !== device.props) device.props = props

    const current = props[key] as DeviceRatio | undefined
    // Source: prefer the named key, then fall back to legacy top-level x/y.
    const srcX = current?.x ?? (typeof (props as Record<string, unknown>).x === 'number' ? (props as Record<string, unknown>).x as number : undefined)
    const srcY = current?.y ?? (typeof (props as Record<string, unknown>).y === 'number' ? (props as Record<string, unknown>).y as number : undefined)
    if (typeof srcX !== 'number' || typeof srcY !== 'number') continue
    if (looksLikeRatio(srcX) && looksLikeRatio(srcY)) continue

    const ratio = pixelToRatio(srcX, srcY, roomLayout.x, roomLayout.y, roomLayout.w, roomLayout.h)
    const clamped = clampRatio(ratio.x, ratio.y)
    props[key] = { x: clamped.x, y: clamped.y }
    // Strip legacy top-level x/y so the device doesn't fall back to them.
    delete (props as Record<string, unknown>).x
    delete (props as Record<string, unknown>).y
    device.props = props
    await api.userDevices.update(device.id, { props })
  }
}

async function pingDevices() {
  try {
    const result = await api.userDevices.ping()
    onlineStatus.value = result.online
  } catch {}
}

function startPing() {
  pingDevices()
  pingTimer = setInterval(pingDevices, 60000)
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value
  if (isEditMode.value) {
    selectedDeviceId.value = null
  } else {
    closeRoomSettings()
    closeDeviceCreator()
  }
}

function getRoomSpawnLayout(): { x: number; y: number; w: number; h: number } {
  const w = isMobilePortrait.value ? 200 : 260
  const h = isMobilePortrait.value ? 150 : 200
  const viewport = getViewportEl()
  const wrapper = getTransformWrapperEl()
  const domScale = getCanvasDomScale() || 1

  if (viewport && wrapper) {
    const viewportRect = viewport.getBoundingClientRect()
    const wrapperRect = wrapper.getBoundingClientRect()
    const visibleLeft = (viewportRect.left - wrapperRect.left) / domScale
    const visibleTop = (viewportRect.top - wrapperRect.top) / domScale
    const visibleRight = (viewportRect.right - wrapperRect.left) / domScale
    const visibleBottom = (viewportRect.bottom - wrapperRect.top) / domScale
    const maxX = Math.max(visibleLeft, visibleRight - w)
    const maxY = Math.max(visibleTop, visibleBottom - h)
    const x = Math.min(Math.max(visibleLeft, (visibleLeft + visibleRight - w) / 2), maxX)
    const y = Math.min(Math.max(visibleTop, (visibleTop + visibleBottom - h) / 2), maxY)

    return { x: Math.round(x), y: Math.round(y), w, h }
  }

  return {
    x: Math.round((viewportWidth.value / 2 - panX.value) / scale.value - w / 2),
    y: Math.round((viewportHeight.value / 2 - panY.value) / scale.value - h / 2),
    w,
    h,
  }
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

function miNameFor(did: string): string {
  if (!did) return ''
  const c = miCandidates.value.find((x) => x.did === did)
  return c?.name || c?.model || did
}

async function ensureMiNamesLoaded() {
  if (miCandidates.value.length > 0 || miCandidatesLoading.value) return
  miCandidatesLoading.value = true
  try {
    const r = await cliApi.run<{ summary: Array<{ did: string; name?: string; model?: string }> }>('mi-cli', {
      action: 'discover',
      params: { summary_only: true },
      ttl_ms: 60_000,
    })
    if (r.status === 'success' && r.data?.summary) {
      miCandidates.value = r.data.summary.map((d) => ({
        did: d.did,
        name: d.name ?? '',
        model: d.model ?? '',
        device_type: '',
        room_name: '',
        home_name: '',
      }))
    }
  } catch {} finally {
    miCandidatesLoading.value = false
  }
}

function selectDevice(device: UserDevice) {
  selectedDeviceId.value = device.id
}

function roomDevices(room: Room) {
  return devices.value.filter((device) => propNumber(device, 'room_id') === room.id)
}

function openDeviceDetail(device: UserDevice) {
  router.push(`/devices/${device.id}?from=/devices`)
}

onMounted(async () => {
  detectOrientation()
  await loadData()
  startPing()
  void ensureMiNamesLoaded()
  updateViewportSize()
  window.addEventListener('resize', onResize)
})

function handleRoomDblClick(room: Room) {
  if (isEditMode.value) return
  router.push({ name: 'room-detail', params: { id: String(room.id) } })
}

function typeLabel(t: string) {
  const opt = deviceTypeOptions.find(o => o.value === t)
  return opt ? (isZh.value ? opt.zh : opt.en) : t
}

const groups = useDeviceGroups(devices)

// Generate connection lines inside room SVG
function getRoomConnections(roomId: number) {
  const room = rooms.value.find((r) => r.id === roomId)
  if (!room) return []
  const roomLayout = getRoomLayout(room)
  const roomDevices = devices.value.filter((d) => propNumber(d, 'room_id') === roomId)
  const lines: RoomConnectionLine[] = []
  const processed = new Set<string>()
  const nodeOffset = { x: 24, y: 24 }

  // SVG connection lines are rendered inside the room card, so the endpoints
  // are in the room's local coordinate system (relative to the room's origin).
  function toRoomXY(d: UserDevice) {
    const r = getDeviceLayout(d)
    return { x: r.x * roomLayout.w, y: r.y * roomLayout.h }
  }

  for (const d of roomDevices) {
    const gid = d.props?.group_id
    if (!gid) continue
    const a = toRoomXY(d)

    const partners = roomDevices.filter((p) => p.id !== d.id && p.props?.group_id === gid)
    for (const p of partners) {
      const key = [d.id, p.id].sort().join('-')
      if (processed.has(key)) continue
      processed.add(key)

      const b = toRoomXY(p)
      lines.push({
        x1: a.x + nodeOffset.x,
        y1: a.y + nodeOffset.y,
        x2: b.x + nodeOffset.x,
        y2: b.y + nodeOffset.y,
        id: key,
      })
    }
  }
  return lines
}
</script>

<template>
  <div class="devices-page-2d">
    <DevicesFloorCanvas
      ref="canvasRef"
      :rooms="activeRooms"
      :devices="devices"
      :edit-mode="isEditMode"
      :creating-room="creating"
      :creating-device="creatingDevice"
      :can-create-device="rooms.length > 0"
      :has-viewport-offset="scale !== 1 || panX !== 0 || panY !== 0"
      :scale="scale"
      :pan-x="panX"
      :pan-y="panY"
      :resizing-room-id="resizingRoomId"
      :selected-device-id="selectedDeviceId"
      :online-status="onlineStatus"
      :label="label"
      :get-room-card-style="getRoomCardStyle"
      :get-room-connections="getRoomConnections"
      :room-devices="roomDevices"
      :get-device-style="getDeviceStyle"
      :device-icon="deviceIcon"
      :prop-string="propString"
      @create-room="createRoomInView"
      @create-device="openDeviceCreator()"
      @toggle-edit="toggleEditMode"
      @reset-view="resetZoom"
      @wheel="handleWheel"
      @viewport-pointerdown="startPan"
      @viewport-pointermove="onPan"
      @viewport-pointerup="stopPan"
      @viewport-pointerleave="stopPan"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @room-ref="setRoomElementRef"
      @room-pointerdown="startDragRoom"
      @room-dblclick="handleRoomDblClick"
      @room-settings="openRoomSettings"
      @room-resize-pointerdown="startResizeRoom"
      @device-ref="setDeviceElementRef"
      @device-pointerdown="startDragDevice"
      @device-select="selectDevice"
      @device-open="openDeviceDetail"
    />

    <!-- (No device detail UI on the floor plan — see /devices/rooms/:id for per-room device controls.) -->

    <RoomSettingsDialog
      v-model:name="editingRoomName"
      v-model:color="editingRoomColor"
      v-model:device-ids="editingRoomDeviceIds"
      :room="editingRoom"
      :devices="roomDeviceOptions"
      :color-presets="roomColorPresets"
      :saving="saving"
      :creating-device="creatingDevice"
      :is-zh="isZh"
      :label="label"
      :type-label="typeLabel"
      :device-room-name="roomNameForDevice"
      @close="closeRoomSettings"
      @submit="saveRoomSettings"
      @delete="deleteEditingRoom"
      @create-device="openDeviceCreator(editingRoom)"
    />

    <DeviceCreatorDialog
      v-model:name="newDeviceName"
      v-model:type="newDeviceType"
      v-model:room-id="newDeviceRoomId"
      :open="deviceCreatorOpen"
      :rooms="activeRooms"
      :device-type-options="deviceTypeOptions"
      :creating="creatingDevice"
      :is-zh="isZh"
      :label="label"
      @close="closeDeviceCreator"
      @submit="createDeviceFromDialog"
    />
  </div>
</template>

<style scoped>
.devices-page-2d {
  height: 100%;
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  padding: 32px;
  background: #f7f9fa;
  overflow: hidden;
  box-sizing: border-box;
}

@media (max-width: 1024px) {
  .devices-page-2d {
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    min-width: 0;
    padding: 16px;
  }
}

@media (max-width: 640px) {
  .devices-page-2d {
    padding: 12px;
  }
}
</style>
