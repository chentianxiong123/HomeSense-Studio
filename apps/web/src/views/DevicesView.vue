<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice, type Room, type MiDeviceCandidate } from '@/api'
import { cliApi } from '@/api/cli'
import DeviceCreatorDialog from '@/components/devices/DeviceCreatorDialog.vue'
import DevicesFloorCanvas from '@/components/devices/DevicesFloorCanvas.vue'
import { type RoomConnectionLine } from '@/components/devices/RoomConnectionLines.vue'
import RoomSettingsDialog from '@/components/devices/RoomSettingsDialog.vue'
import { useLocale } from '@/composables/useLocale'
import { useDeviceGroups } from '@/composables/useDeviceGroups'
import {
  useDevicesLayout,
  type DevicePropsDraft,
  type DeviceRatio,
  type RoomPropsDraft,
} from '@/composables/useDevicesLayout'
import { pixelToRatio, ratioToPixel, looksLikeRatio, clampRatio } from '@/utils/roomCoords'

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
const miCandidatesLoaded = ref(false)
const miCandidatesLoading = ref(false)
const roomsLoaded = ref(false)
const roomsLoading = ref(false)
const creating = ref(false)
const creatingDevice = ref(false)
const saving = ref(false)
const onlineStatus = ref<Record<number, boolean>>({})
let pingTimer: ReturnType<typeof setInterval> | null = null

// 2D Layout & Zoom State
const selectedDeviceId = ref<number | null>(null)
const viewportWidth = ref(1000)
const viewportHeight = ref(700)
const isEditMode = ref(false)

const roomColorPresets = [
  { value: '', preview: 'rgba(255, 255, 255, 0.45)', zh: '默认', en: 'Default' },
  { value: 'rgba(14, 165, 233, 0.14)', preview: 'rgba(14, 165, 233, 0.14)', zh: '天空蓝', en: 'Sky Blue' },
  { value: 'rgba(34, 197, 94, 0.14)', preview: 'rgba(34, 197, 94, 0.14)', zh: '草绿色', en: 'Soft Green' },
  { value: 'rgba(245, 158, 11, 0.16)', preview: 'rgba(245, 158, 11, 0.16)', zh: '暖橙色', en: 'Warm Amber' },
  { value: 'rgba(244, 114, 182, 0.16)', preview: 'rgba(244, 114, 182, 0.16)', zh: '雾粉色', en: 'Soft Pink' },
]

const editingRoomId = ref<number | null>(null)
const editingRoomName = ref('')
const editingRoomColor = ref('')
const editingRoomDeviceIds = ref<number[]>([])
const deviceCreatorOpen = ref(false)
const newDeviceName = ref('')
const newDeviceType = ref('other')
const newDeviceRoomId = ref<number | null>(null)
const editingRoom = computed(() =>
  rooms.value.find((room) => room.id === editingRoomId.value) || null
)
const roomDeviceOptions = computed(() =>
  [...devices.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
)

// Interactive Scale & Pan
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartRawX = ref(0)
const panStartRawY = ref(0)

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
  getRoomLayoutSource,
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

const canvasRef = ref<InstanceType<typeof DevicesFloorCanvas> | null>(null)
const roomElementRefs = new Map<number, HTMLElement>()
const deviceElementRefs = new Map<number, HTMLElement>()

function getViewportEl() {
  return canvasRef.value?.viewportEl ?? null
}

function getTransformWrapperEl() {
  return canvasRef.value?.transformWrapperEl ?? null
}

function setRoomElementRef(id: number, el: unknown) {
  if (el instanceof HTMLElement) roomElementRefs.set(id, el)
  else roomElementRefs.delete(id)
}

function setDeviceElementRef(id: number, el: unknown) {
  if (el instanceof HTMLElement) deviceElementRefs.set(id, el)
  else deviceElementRefs.delete(id)
}

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
  document.removeEventListener('pointermove', onDragRoom)
  document.removeEventListener('pointerup', stopDragRoom)
  document.removeEventListener('pointermove', onResizeRoom)
  document.removeEventListener('pointerup', stopResizeRoom)
  document.removeEventListener('pointermove', onDragDevice)
  document.removeEventListener('pointerup', stopDragDevice)
})

function onResize() {
  detectOrientation()
  updateViewportSize()
}

function detectOrientation() {
  isMobilePortrait.value = window.innerWidth <= 760 && window.innerHeight > window.innerWidth
}

function updateViewportSize() {
  const el = getViewportEl()
  if (el) {
    viewportWidth.value = el.clientWidth
    viewportHeight.value = el.clientHeight
  }
}

function getCanvasDomScale() {
  const el = getTransformWrapperEl()
  if (!el || el.offsetWidth === 0) return scale.value
  return el.getBoundingClientRect().width / el.offsetWidth
}

function clampVisualDelta(delta: number, currentStart: number, currentEnd: number, boundaryStart: number, boundaryEnd: number) {
  if (delta < 0) return Math.max(delta, boundaryStart - currentStart)
  if (delta > 0) return Math.min(delta, boundaryEnd - currentEnd)
  return 0
}

function clampResizeVisualDelta(delta: number, currentSize: number, minSize: number, availableGrowth: number) {
  if (delta < 0) return Math.max(delta, minSize - currentSize)
  if (delta > 0) return Math.min(delta, availableGrowth)
  return 0
}

function getRoomVisualLayout(room: Room): { x: number; y: number; w: number; h: number } {
  return getRoomLayout(room)
}

function getRoomDomScale(room: Room, roomEl: HTMLElement) {
  const layout = getRoomVisualLayout(room)
  const rect = roomEl.getBoundingClientRect()
  return {
    x: layout.w > 0 ? rect.width / layout.w : getCanvasDomScale(),
    y: layout.h > 0 ? rect.height / layout.h : getCanvasDomScale(),
  }
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

function nextRoomName() {
  const baseName = label('新房间', 'New Room')
  const usedNames = new Set(rooms.value.map((room) => room.name.trim()))
  if (!usedNames.has(baseName)) return baseName

  let index = 2
  while (usedNames.has(`${baseName} ${index}`)) index += 1
  return `${baseName} ${index}`
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

async function createRoomInView() {
  if (!isEditMode.value || creating.value) return

  creating.value = true
  errorMessage.value = ''
  try {
    const key = currentLayoutKey()
    const props: RoomPropsDraft = {}
    props[key] = getRoomSpawnLayout()

    const result = await api.rooms.create({
      name: nextRoomName(),
      props,
    })
    const room = result.data.room
    rooms.value = [...rooms.value, room]
    openRoomSettings(room)
    showSuccess(label('房间已创建', 'Room created'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    creating.value = false
  }
}

function nextDeviceName() {
  const baseName = label('新设备', 'New Device')
  const usedNames = new Set(devices.value.map((device) => device.name.trim()))
  if (!usedNames.has(baseName)) return baseName

  let index = 2
  while (usedNames.has(`${baseName} ${index}`)) index += 1
  return `${baseName} ${index}`
}

function getDeviceSpawnLayout(room: Room | null): { x: number; y: number } {
  // Returns a ratio [0..1] so the device spawns at the room's center.
  if (!room) return { x: 0.5, y: 0.5 }
  return { x: 0.5, y: 0.5 }
}

function openDeviceCreator(room?: Room | null) {
  if (!isEditMode.value) return
  const targetRoom = room ?? editingRoom.value ?? activeRooms.value[0] ?? rooms.value[0] ?? null
  deviceCreatorOpen.value = true
  newDeviceName.value = nextDeviceName()
  newDeviceType.value = 'other'
  newDeviceRoomId.value = targetRoom?.id ?? null
  errorMessage.value = ''
}

function closeDeviceCreator() {
  deviceCreatorOpen.value = false
  newDeviceName.value = ''
  newDeviceType.value = 'other'
  newDeviceRoomId.value = null
}

async function createDeviceFromDialog() {
  if (creatingDevice.value) return

  const name = newDeviceName.value.trim()
  if (!name) {
    errorMessage.value = label('设备名不能为空', 'Device name is required')
    return
  }

  const roomId = newDeviceRoomId.value
  const room = roomId == null ? null : rooms.value.find((entry) => entry.id === Number(roomId)) ?? null
  if (!room) {
    errorMessage.value = label('请先选择房间', 'Please select a room first')
    return
  }

  creatingDevice.value = true
  errorMessage.value = ''
  try {
    const key = currentLayoutKey()
    const props: DevicePropsDraft = {
      device_type: newDeviceType.value,
      room_id: room.id,
    }
    props[key] = getDeviceSpawnLayout(room)

    const result = await api.userDevices.create({ name, props })
    const device = result.data.device
    devices.value = [...devices.value, device]
    if (editingRoomId.value === room.id && !editingRoomDeviceIds.value.includes(device.id)) {
      editingRoomDeviceIds.value = [...editingRoomDeviceIds.value, device.id]
    }
    closeDeviceCreator()
    showSuccess(label('设备已创建', 'Device created'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    creatingDevice.value = false
  }
}

function roomNameForDevice(device: UserDevice): string {
  const roomId = propNumber(device, 'room_id')
  if (!roomId) return label('未绑定房间', 'Unassigned')
  return rooms.value.find((room) => room.id === roomId)?.name ?? label('未知房间', 'Unknown room')
}

// Zoom & Pan Wheel handlers
function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const zoomFactor = 0.08
  const nextScale = event.deltaY < 0 ? scale.value + zoomFactor : scale.value - zoomFactor
  scale.value = Math.max(0.4, Math.min(3, nextScale))
}

// Pan Canvas
function startPan(event: PointerEvent) {
  if (event.target !== event.currentTarget) return
  isPanning.value = true
  panStartRawX.value = event.clientX - panX.value
  panStartRawY.value = event.clientY - panY.value
  getViewportEl()?.setPointerCapture(event.pointerId)
}

function onPan(event: PointerEvent) {
  if (!isPanning.value) return
  panX.value = event.clientX - panStartRawX.value
  panY.value = event.clientY - panStartRawY.value
}

function stopPan(event: PointerEvent) {
  if (!isPanning.value) return
  isPanning.value = false
  getViewportEl()?.releasePointerCapture(event.pointerId)
}

// Pinch zoom
const initialTouchDistance = ref<number | null>(null)
const initialScale = ref(1)

function handleTouchStart(event: TouchEvent) {
  if (event.touches.length === 2) {
    const t1 = event.touches[0]!
    const t2 = event.touches[1]!
    initialTouchDistance.value = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    initialScale.value = scale.value
  }
}

function handleTouchMove(event: TouchEvent) {
  if (event.touches.length === 2 && initialTouchDistance.value !== null) {
    event.preventDefault()
    const t1 = event.touches[0]!
    const t2 = event.touches[1]!
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const factor = dist / initialTouchDistance.value
    scale.value = Math.max(0.4, Math.min(3, initialScale.value * factor))
  }
}

function handleTouchEnd() {
  initialTouchDistance.value = null
}

function resetZoom() {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

// Draggable room card implementation
const draggingRoomId = ref<number | null>(null)
const resizingRoomId = ref<number | null>(null)
const MIN_ROOM_WIDTH = 180
const MIN_ROOM_HEIGHT = 140

type ElementMoveState = {
  layoutX: number
  layoutY: number
  clientX: number
  clientY: number
  elementRect: DOMRect
  boundaryRect: DOMRect
  scaleX: number
  scaleY: number
  // Only set when the dragged element is a device (in room-relative ratios).
  roomW?: number
  roomH?: number
}

type ElementResizeState = {
  layoutW: number
  layoutH: number
  clientX: number
  clientY: number
  elementRect: DOMRect
  boundaryRect: DOMRect
  scaleX: number
  scaleY: number
}

let roomDragState: ElementMoveState | null = null
let roomResizeState: ElementResizeState | null = null
let deviceDragState: ElementMoveState | null = null

function startDragRoom(event: PointerEvent, room: Room) {
  if (!isEditMode.value) return
  // If the pointerdown came from a child device, let the device handler own it.
  // Devices have their own drag (reposition within the room); the room only
  // moves when the user grabs the room's own background.
  const target = event.target as HTMLElement | null
  if (target?.closest?.('.device-node')) return
  const roomEl = roomElementRefs.get(room.id)
  const viewportEl = getViewportEl()
  if (!roomEl || !viewportEl) return
  event.preventDefault()
  event.stopPropagation()

  const layout = getRoomLayout(room)
  const domScale = getCanvasDomScale()
  draggingRoomId.value = room.id
  roomDragState = {
    layoutX: layout.x,
    layoutY: layout.y,
    clientX: event.clientX,
    clientY: event.clientY,
    elementRect: roomEl.getBoundingClientRect(),
    boundaryRect: viewportEl.getBoundingClientRect(),
    scaleX: domScale || 1,
    scaleY: domScale || 1,
  }
  document.addEventListener('pointermove', onDragRoom)
  document.addEventListener('pointerup', stopDragRoom)
}

function onDragRoom(event: PointerEvent) {
  if (draggingRoomId.value === null || !roomDragState) return
  const room = rooms.value.find((r) => r.id === draggingRoomId.value)
  if (!room) return

  const state = roomDragState
  const roomLayout = ensureRoomLayout(room)
  const rawDx = event.clientX - state.clientX
  const rawDy = event.clientY - state.clientY
  const dx = clampVisualDelta(rawDx, state.elementRect.left, state.elementRect.right, state.boundaryRect.left, state.boundaryRect.right)
  const dy = clampVisualDelta(rawDy, state.elementRect.top, state.elementRect.bottom, state.boundaryRect.top, state.boundaryRect.bottom)

  roomLayout.x = state.layoutX + dx / state.scaleX
  roomLayout.y = state.layoutY + dy / state.scaleY
}

async function stopDragRoom() {
  if (draggingRoomId.value === null) return
  const room = rooms.value.find((r) => r.id === draggingRoomId.value)
  draggingRoomId.value = null
  roomDragState = null
  document.removeEventListener('pointermove', onDragRoom)
  document.removeEventListener('pointerup', stopDragRoom)
  if (room) {
    await api.rooms.update(room.id, { props: room.props })
  }
}

function startResizeRoom(event: PointerEvent, room: Room) {
  if (!isEditMode.value) return
  const roomEl = roomElementRefs.get(room.id)
  const viewportEl = getViewportEl()
  if (!roomEl || !viewportEl) return
  event.preventDefault()
  event.stopPropagation()

  const layout = getRoomLayout(room)
  const domScale = getRoomDomScale(room, roomEl)
  resizingRoomId.value = room.id
  roomResizeState = {
    layoutW: layout.w,
    layoutH: layout.h,
    clientX: event.clientX,
    clientY: event.clientY,
    elementRect: roomEl.getBoundingClientRect(),
    boundaryRect: viewportEl.getBoundingClientRect(),
    scaleX: domScale.x || 1,
    scaleY: domScale.y || 1,
  }
  document.addEventListener('pointermove', onResizeRoom)
  document.addEventListener('pointerup', stopResizeRoom)
}

function onResizeRoom(event: PointerEvent) {
  if (resizingRoomId.value === null || !roomResizeState) return
  const room = rooms.value.find((r) => r.id === resizingRoomId.value)
  if (!room) return

  const state = roomResizeState
  const roomLayout = ensureRoomLayout(room)
  const rawDx = event.clientX - state.clientX
  const rawDy = event.clientY - state.clientY
  const dx = clampResizeVisualDelta(rawDx, state.elementRect.width, MIN_ROOM_WIDTH * state.scaleX, state.boundaryRect.right - state.elementRect.right)
  const dy = clampResizeVisualDelta(rawDy, state.elementRect.height, MIN_ROOM_HEIGHT * state.scaleY, state.boundaryRect.bottom - state.elementRect.bottom)

  roomLayout.w = Math.max(MIN_ROOM_WIDTH, state.layoutW + dx / state.scaleX)
  roomLayout.h = Math.max(MIN_ROOM_HEIGHT, state.layoutH + dy / state.scaleY)
}

async function stopResizeRoom() {
  if (resizingRoomId.value === null) return
  const room = rooms.value.find((r) => r.id === resizingRoomId.value)
  resizingRoomId.value = null
  roomResizeState = null
  document.removeEventListener('pointermove', onResizeRoom)
  document.removeEventListener('pointerup', stopResizeRoom)
  if (room) {
    await api.rooms.update(room.id, { props: room.props })
  }
}

// Draggable Device Node implementation
const draggingDeviceId = ref<number | null>(null)

function startDragDevice(event: PointerEvent, device: UserDevice) {
  if (!isEditMode.value) return
  const deviceEl = deviceElementRefs.get(device.id)
  if (!deviceEl) return
  // Don't stop propagation: the room's pointerdown will still bubble up to
  // the room card, but `startDragRoom` checks `event.target.closest('.device-node')`
  // and ignores device-originated pointerdowns, so the room won't try to drag.
  event.preventDefault()

  const room = findParentRoom(device)
  if (!room) return
  const roomEl = roomElementRefs.get(room.id) ?? null
  const boundaryEl = roomEl ?? getViewportEl()
  if (!boundaryEl) return

  const layout = getDeviceLayout(device)
  const roomLayout = getRoomLayout(room)
  const domScale = roomEl
    ? getRoomDomScale(room, roomEl)
    : { x: getCanvasDomScale(), y: getCanvasDomScale() }
  draggingDeviceId.value = device.id
  deviceDragState = {
    layoutX: layout.x,
    layoutY: layout.y,
    roomW: roomLayout.w,
    roomH: roomLayout.h,
    clientX: event.clientX,
    clientY: event.clientY,
    elementRect: deviceEl.getBoundingClientRect(),
    boundaryRect: boundaryEl.getBoundingClientRect(),
    scaleX: domScale.x || 1,
    scaleY: domScale.y || 1,
  }
  document.addEventListener('pointermove', onDragDevice)
  document.addEventListener('pointerup', stopDragDevice)
}

function onDragDevice(event: PointerEvent) {
  if (draggingDeviceId.value === null || !deviceDragState) return
  const device = devices.value.find((d) => d.id === draggingDeviceId.value)
  if (!device) return

  const state = deviceDragState
  const rawDx = event.clientX - state.clientX
  const rawDy = event.clientY - state.clientY
  const dx = clampVisualDelta(rawDx, state.elementRect.left, state.elementRect.right, state.boundaryRect.left, state.boundaryRect.right)
  const dy = clampVisualDelta(rawDy, state.elementRect.top, state.elementRect.bottom, state.boundaryRect.top, state.boundaryRect.bottom)

  // Convert canvas-pixel delta to ratio delta. Divide by room width/height,
  // not by canvas scale — the room's pixel size is the meaningful unit.
  const deviceLayout = ensureDeviceLayout(device)
  if (state.roomW && state.roomH) {
    const next = clampRatio(
      state.layoutX + (dx / state.scaleX) / state.roomW,
      state.layoutY + (dy / state.scaleY) / state.roomH
    )
    deviceLayout.x = next.x
    deviceLayout.y = next.y
  } else {
    // Fallback: write as ratio centered in the room.
    deviceLayout.x = 0.5
    deviceLayout.y = 0.5
  }
}

async function stopDragDevice() {
  if (draggingDeviceId.value === null) return
  const device = devices.value.find((d) => d.id === draggingDeviceId.value)
  draggingDeviceId.value = null
  deviceDragState = null
  document.removeEventListener('pointermove', onDragDevice)
  document.removeEventListener('pointerup', stopDragDevice)
  if (device) {
    await api.userDevices.update(device.id, { props: device.props })
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

function closeRoomSettings() {
  editingRoomId.value = null
  editingRoomName.value = ''
  editingRoomColor.value = ''
  editingRoomDeviceIds.value = []
}

function openRoomSettings(room: Room) {
  editingRoomId.value = room.id
  editingRoomName.value = room.name
  editingRoomColor.value = typeof roomPropsRecord(room).bgColor === 'string'
    ? String(roomPropsRecord(room).bgColor)
    : ''
  editingRoomDeviceIds.value = devices.value
    .filter((device) => propNumber(device, 'room_id') === room.id)
    .map((device) => device.id)
}

async function saveRoomSettings() {
  const room = editingRoom.value
  if (!room) return

  const name = editingRoomName.value.trim()
  if (!name) {
    errorMessage.value = label('房间名不能为空', 'Room name is required')
    return
  }

  saving.value = true
  errorMessage.value = ''
  try {
    const props = roomPropsRecord(room)
    room.name = name
    if (editingRoomColor.value) props.bgColor = editingRoomColor.value
    else delete props.bgColor
    room.props = props

    const selectedIds = new Set(editingRoomDeviceIds.value)
    const deviceUpdates: Array<Promise<unknown>> = []

    for (const device of devices.value) {
      const currentRoomId = propNumber(device, 'room_id')
      const shouldBeInRoom = selectedIds.has(device.id)

      if (shouldBeInRoom && currentRoomId !== room.id) {
        const nextProps = { ...device.props, room_id: room.id }
        device.props = nextProps
        deviceUpdates.push(api.userDevices.update(device.id, { props: nextProps }))
      } else if (!shouldBeInRoom && currentRoomId === room.id) {
        const nextProps = { ...device.props }
        delete nextProps.room_id
        device.props = nextProps
        deviceUpdates.push(api.userDevices.update(device.id, { props: nextProps }))
      }
    }

    await Promise.all([
      api.rooms.update(room.id, { name, props: room.props }),
      ...deviceUpdates,
    ])

    closeRoomSettings()
    showSuccess(label('房间已保存', 'Room saved'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    saving.value = false
  }
}

async function deleteEditingRoom() {
  const room = editingRoom.value
  if (!room) return
  if (!window.confirm(label(`确认删除房间「${room.name}」？`, `Delete room "${room.name}"?`))) return

  saving.value = true
  errorMessage.value = ''
  try {
    const deviceUpdates = devices.value
      .filter((device) => propNumber(device, 'room_id') === room.id)
      .map((device) => {
        const nextProps = { ...device.props }
        delete nextProps.room_id
        device.props = nextProps
        return api.userDevices.update(device.id, { props: nextProps })
      })

    await Promise.all(deviceUpdates)
    await api.rooms.delete(room.id)
    rooms.value = rooms.value.filter((entry) => entry.id !== room.id)
    closeRoomSettings()
    showSuccess(label('房间已删除', 'Room deleted'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    saving.value = false
  }
}

function handleRoomDblClick(room: Room) {
  if (isEditMode.value) return
  router.push({ name: 'room-detail', params: { id: String(room.id) } })
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
