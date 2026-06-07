<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice, type Room, type MiDeviceCandidate } from '@/api'
import { cliApi } from '@/api/cli'
import { useLocale } from '@/composables/useLocale'
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
const zoomedRoomId = ref<number | null>(null)
const isEditMode = ref(false)

type LayoutKey = 'desktop' | 'mobile'
// Room layout: canvas-pixel coordinates (x, y, w, h) on the floor plan.
type RoomLayoutDraft = { x?: number; y?: number; w?: number; h?: number }
type RoomPropsDraft = Record<string, unknown> & {
  desktop?: RoomLayoutDraft
  mobile?: RoomLayoutDraft
  bgColor?: string
}
// Device layout: 0..1 ratios relative to the parent room's width/height.
type DeviceRatio = { x?: number; y?: number }
type DevicePropsDraft = Record<string, unknown> & {
  desktop?: DeviceRatio
  mobile?: DeviceRatio
}

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

// Orientation Detection
const isMobilePortrait = ref(false)

function currentLayoutKey(): LayoutKey {
  return isMobilePortrait.value ? 'mobile' : 'desktop'
}

function roomPropsRecord(room: Room): RoomPropsDraft {
  if (!room.props || typeof room.props !== 'object') room.props = {}
  return room.props as RoomPropsDraft
}

function getRoomLayoutSource(room: Room): RoomLayoutDraft {
  const props = roomPropsRecord(room)
  const layout = props[currentLayoutKey()]
  if (layout && typeof layout === 'object') return layout
  return props as RoomLayoutDraft
}

function getRoomBackground(room: Room, fallback = 'rgba(255, 255, 255, 0.45)'): string {
  const background = roomPropsRecord(room).bgColor
  return typeof background === 'string' && background.trim()
    ? background
    : fallback
}

const selectedDevice = computed(() =>
  devices.value.find((d) => d.id === selectedDeviceId.value) || null
)

const activeRooms = computed(() => {
  return rooms.value.filter((room) => {
    const layout = getRoomLayoutSource(room)
    return (
      typeof layout.x === 'number' &&
      typeof layout.y === 'number' &&
      typeof layout.w === 'number' &&
      typeof layout.h === 'number'
    )
  })
})

function getRoomLayout(room: Room): { x: number; y: number; w: number; h: number } {
  const layout = getRoomLayoutSource(room)
  return {
    x: layout.x ?? 50,
    y: layout.y ?? 50,
    w: layout.w ?? 260,
    h: layout.h ?? 200,
  }
}

function ensureRoomLayout(room: Room): RoomLayoutDraft {
  const props = roomPropsRecord(room)
  const key = currentLayoutKey()
  const existing = props[key]
  if (!existing || typeof existing !== 'object') {
    const layout = getRoomLayout(room)
    props[key] = { x: layout.x, y: layout.y, w: layout.w, h: layout.h }
    room.props = props
  }
  return props[key] as RoomLayoutDraft
}

function getRoomCardStyle(room: Room) {
  if (zoomedRoomId.value === room.id) {
    return {
      width: `${viewportWidth.value - 40}px`,
      height: `${viewportHeight.value - 120}px`,
      background: getRoomBackground(room, 'rgba(255, 255, 255, 0.85)'),
    }
  }

  const layout = getRoomLayout(room)
  return {
    left: `${layout.x}px`,
    top: `${layout.y}px`,
    width: `${layout.w}px`,
    height: `${layout.h}px`,
    background: getRoomBackground(room),
  }
}

function getDeviceLayoutSource(device: UserDevice): DeviceRatio {
  const props = (device.props && typeof device.props === 'object'
    ? device.props
    : {}) as DevicePropsDraft
  if (props !== device.props) device.props = props
  const layout = props[currentLayoutKey()]
  if (layout && typeof layout === 'object') return layout
  return {} as DeviceRatio
}

function ensureDeviceLayout(device: UserDevice): DeviceRatio {
  const props = (device.props && typeof device.props === 'object'
    ? device.props
    : {}) as DevicePropsDraft
  if (props !== device.props) device.props = props
  const key = currentLayoutKey()
  const existing = props[key]
  if (!existing || typeof existing !== 'object') {
    props[key] = { x: 0.5, y: 0.5 }
    device.props = props
  }
  return props[key] as DeviceRatio
}

// Returns the device's position as a 0..1 ratio relative to its parent room.
function getDeviceLayout(device: UserDevice): { x: number; y: number } {
  const layout = getDeviceLayoutSource(device)
  return {
    x: typeof layout.x === 'number' ? layout.x : 0.5,
    y: typeof layout.y === 'number' ? layout.y : 0.5,
  }
}

// Find the parent room for a device, falling back to the active or first room.
function findParentRoom(device: UserDevice): Room | null {
  const explicit = propNumber(device, 'room_id')
  if (explicit != null) {
    const r = rooms.value.find((room) => room.id === explicit)
    if (r) return r
  }
  return activeRooms.value[0] ?? rooms.value[0] ?? null
}

// Returns the device's pixel position **inside its parent room** — the device
// is rendered as a descendant of the room card, so its CSS left/top are
// relative to the room's origin, not the canvas. Devices without a parent
// room are hidden (display: none).
function getDeviceStyle(device: UserDevice) {
  const room = findParentRoom(device)
  if (!room) return { display: 'none' }
  const roomLayout = getRoomLayout(room)
  const ratio = getDeviceLayout(device)
  return {
    left: `${ratio.x * roomLayout.w}px`,
    top: `${ratio.y * roomLayout.h}px`,
  }
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

const viewportRef = ref<HTMLElement | null>(null)
const transformWrapperRef = ref<HTMLElement | null>(null)
const roomElementRefs = new Map<number, HTMLElement>()
const deviceElementRefs = new Map<number, HTMLElement>()

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
  if (viewportRef.value) {
    viewportWidth.value = viewportRef.value.clientWidth
    viewportHeight.value = viewportRef.value.clientHeight
  }
}

function getCanvasDomScale() {
  const el = transformWrapperRef.value
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
  if (zoomedRoomId.value === room.id) {
    return {
      x: 20,
      y: 20,
      w: viewportWidth.value - 40,
      h: viewportHeight.value - 120,
    }
  }
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
    zoomedRoomId.value = null
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
  const viewportEl = viewportRef.value
  const wrapperEl = transformWrapperRef.value
  const domScale = getCanvasDomScale() || 1

  if (viewportEl && wrapperEl) {
    const viewportRect = viewportEl.getBoundingClientRect()
    const wrapperRect = wrapperEl.getBoundingClientRect()
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
  if (zoomedRoomId.value !== null) return
  event.preventDefault()
  const zoomFactor = 0.08
  const nextScale = event.deltaY < 0 ? scale.value + zoomFactor : scale.value - zoomFactor
  scale.value = Math.max(0.4, Math.min(3, nextScale))
}

// Pan Canvas
function startPan(event: PointerEvent) {
  if (zoomedRoomId.value !== null) return
  if (event.target !== event.currentTarget) return
  isPanning.value = true
  panStartRawX.value = event.clientX - panX.value
  panStartRawY.value = event.clientY - panY.value
  viewportRef.value?.setPointerCapture(event.pointerId)
}

function onPan(event: PointerEvent) {
  if (!isPanning.value) return
  panX.value = event.clientX - panStartRawX.value
  panY.value = event.clientY - panStartRawY.value
}

function stopPan(event: PointerEvent) {
  if (!isPanning.value) return
  isPanning.value = false
  viewportRef.value?.releasePointerCapture(event.pointerId)
}

// Pinch zoom
const initialTouchDistance = ref<number | null>(null)
const initialScale = ref(1)

function handleTouchStart(event: TouchEvent) {
  if (zoomedRoomId.value !== null) return
  if (event.touches.length === 2) {
    const t1 = event.touches[0]!
    const t2 = event.touches[1]!
    initialTouchDistance.value = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    initialScale.value = scale.value
  }
}

function handleTouchMove(event: TouchEvent) {
  if (zoomedRoomId.value !== null) return
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
  if (!isEditMode.value || zoomedRoomId.value === room.id) return
  const roomEl = roomElementRefs.get(room.id)
  const viewportEl = viewportRef.value
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
  if (!isEditMode.value || zoomedRoomId.value === room.id) return
  const roomEl = roomElementRefs.get(room.id)
  const viewportEl = viewportRef.value
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

// Drag-from-device: in edit mode, dragging a device node drags the room
// (the device is a child of the room, so grabbing it moves the whole room).
// To reposition a single device inside the room, hold Alt while dragging.
function startDragDevice(event: PointerEvent, device: UserDevice) {
  if (!isEditMode.value) return
  const room = findParentRoom(device)
  if (!room) return

  if (event.altKey) {
    // Alt-drag: reposition the device within the room.
    const deviceEl = deviceElementRefs.get(device.id)
    if (!deviceEl) return
    event.stopPropagation()
    event.preventDefault()

    const roomEl = roomElementRefs.get(room.id) ?? null
    const boundaryEl = roomEl ?? viewportRef.value
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
  } else {
    // Plain drag on a device: treat it as grabbing the room.
    startDragRoom(event, room)
  }
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
    if (zoomedRoomId.value === room.id) zoomedRoomId.value = null
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

// Simple dynamic grouping
const groupingWithId = ref<number | null>(null)

const groupCandidates = computed(() => {
  if (!selectedDevice.value) return []
  const currentRoomId = propNumber(selectedDevice.value, 'room_id')
  return devices.value.filter(
    (d) => d.id !== selectedDevice.value!.id && propNumber(d, 'room_id') === currentRoomId
  )
})

const currentGroupPartners = computed(() => {
  if (!selectedDevice.value) return []
  const gid = selectedDevice.value.props?.group_id
  if (!gid) return []
  return devices.value.filter(
    (d) => d.id !== selectedDevice.value!.id && d.props?.group_id === gid
  )
})

async function bindGroupPartner() {
  if (!selectedDevice.value || !groupingWithId.value) return
  const partner = devices.value.find((d) => d.id === groupingWithId.value)
  if (!partner) return

  const gid = selectedDevice.value.props?.group_id || Date.now()
  const name = selectedDevice.value.props?.group_name || '电视组合'

  selectedDevice.value.props = { ...selectedDevice.value.props, group_id: gid, group_name: name }
  partner.props = { ...partner.props, group_id: gid, group_name: name }

  await Promise.all([
    api.userDevices.update(selectedDevice.value.id, { props: selectedDevice.value.props }),
    api.userDevices.update(partner.id, { props: partner.props }),
  ])
  groupingWithId.value = null
  showSuccess(label('编组成功', 'Group bound'))
}

async function disbandGroup() {
  if (!selectedDevice.value) return
  const gid = selectedDevice.value.props?.group_id
  if (!gid) return

  const groupDevices = devices.value.filter((d) => d.props?.group_id === gid)
  await Promise.all(
    groupDevices.map((d) => {
      const p = { ...d.props }
      delete p.group_id
      delete p.group_name
      d.props = p
      return api.userDevices.update(d.id, { props: p })
    })
  )
  showSuccess(label('编组已拆除', 'Group disbanded'))
}

// Generate connection lines inside room SVG
function getRoomConnections(roomId: number) {
  const room = rooms.value.find((r) => r.id === roomId)
  if (!room) return []
  const roomLayout = getRoomLayout(room)
  const roomDevices = devices.value.filter((d) => propNumber(d, 'room_id') === roomId)
  const isZoomed = zoomedRoomId.value === roomId
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> = []
  const processed = new Set<string>()
  const nodeOffset = isZoomed ? { x: 77, y: 57 } : { x: 24, y: 24 }

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
    <!-- Left interactive floor plan canvas (Takes Full Width) -->
    <main class="canvas-area glass-panel" :class="{ 'room-focused': zoomedRoomId !== null }">
      <header class="canvas-head">
        <h2>{{ label('数字孪生 · 2D 房型布局', 'Digital Twin Canvas') }}</h2>
        <div class="canvas-head-actions">
          <span class="hint-pill" v-if="zoomedRoomId === null">
            {{ isEditMode ? label('编辑模式：拖拽房间或设备节点移动整个房间；按住 Alt 拖拽设备以调整位置；右下角拉伸', 'Edit mode: drag room or any device to move the room; hold Alt while dragging a device to reposition it; resize from bottom-right') : label('使用鼠标滚轮或双指进行「无级缩放 / 画布拖拽」', 'Scroll wheel or pinch zoom to zoom & pan canvas') }}
          </span>
          <button class="focus-back-btn" v-else @click="zoomedRoomId = null">
            {{ label('← 返回全局户型图', '← Back to Global View') }}
          </button>
          <button v-if="isEditMode" class="add-room-btn" type="button" :disabled="creating" @click="createRoomInView">
            {{ creating ? label('创建中...', 'Creating...') : label('新增房间', 'Add Room') }}
          </button>
          <button v-if="isEditMode" class="add-device-btn" type="button" :disabled="creatingDevice || rooms.length === 0" @click="openDeviceCreator()">
            {{ creatingDevice ? label('创建中...', 'Creating...') : label('新增设备', 'Add Device') }}
          </button>
          <button class="edit-mode-btn" :class="{ active: isEditMode }" type="button" @click="toggleEditMode">
            {{ isEditMode ? label('退出编辑', 'Exit Edit') : label('编辑房间', 'Edit Rooms') }}
          </button>
          <button class="reset-zoom-btn" v-if="zoomedRoomId === null && (scale !== 1 || panX !== 0 || panY !== 0)" @click="resetZoom">
            {{ label('重置缩放', 'Reset View') }}
          </button>
        </div>
      </header>

      <!-- Viewport capturing mouse pan/zoom/touch -->
      <div
        class="twin-viewport"
        ref="viewportRef"
        @wheel="handleWheel"
        @pointerdown="startPan"
        @pointermove="onPan"
        @pointerup="stopPan"
        @pointerleave="stopPan"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
      >
        <!-- The Infinite Pan/Zoom Grid Container -->
        <div
          ref="transformWrapperRef"
          class="canvas-transform-wrapper"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }"
        >
          <!-- Renders Rooms -->
          <div
            v-for="room in activeRooms"
            :key="room.id"
            :ref="(el) => setRoomElementRef(room.id, el)"
            class="room-card"
            :class="{
              'zoomed-in': zoomedRoomId === room.id,
              'zoomed-out': zoomedRoomId !== null && zoomedRoomId !== room.id,
              editing: isEditMode,
              resizing: resizingRoomId === room.id,
            }"
            :style="getRoomCardStyle(room)"
            @pointerdown="startDragRoom($event, room)"
            @dblclick="handleRoomDblClick(room)"
          >
            <!-- SVG Connector Lines for Groups inside Room -->
            <svg class="room-connections-svg">
              <line
                v-for="line in getRoomConnections(room.id)"
                :key="line.id"
                :x1="line.x1"
                :y1="line.y1"
                :x2="line.x2"
                :y2="line.y2"
                class="connection-line"
              />
            </svg>

            <div class="room-title">
              <span class="room-dot"></span>
              <strong>{{ room.name }}</strong>
            </div>

            <button
              v-if="isEditMode && zoomedRoomId !== room.id"
              class="room-edit-gear"
              type="button"
              @pointerdown.stop.prevent
              @click.stop="openRoomSettings(room)"
            >
              ⋯
            </button>

            <div
              v-if="isEditMode && zoomedRoomId !== room.id"
              class="room-resize-handle"
              @pointerdown="startResizeRoom($event, room)"
            ></div>

            <!-- Renders Devices bounded inside this Room -->
            <div
              v-for="dev in devices.filter((d) => propNumber(d, 'room_id') === room.id)"
              :key="dev.id"
              :ref="(el) => setDeviceElementRef(dev.id, el)"
              class="device-node"
              :class="{
                active: selectedDeviceId === dev.id,
                online: onlineStatus[dev.id] === true,
                offline: onlineStatus[dev.id] === false,
                'in-group': dev.props?.group_id,
                'zoomed-mode': zoomedRoomId === room.id
              }"
              :style="getDeviceStyle(dev)"
              @pointerdown="startDragDevice($event, dev)"
              @click.stop="isEditMode ? null : selectDevice(dev)"
              @dblclick.stop="isEditMode ? null : router.push(`/devices/${dev.id}`)"
            >
              <!-- Normal Mode Icon -->
              <div v-if="zoomedRoomId !== room.id" class="node-icon" :class="`icon-${deviceIcon(propString(dev, 'device_type'))}`">
                <svg v-if="deviceIcon(propString(dev, 'device_type')) === 'tv'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'speaker'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="2" width="16" height="20" rx="3"></rect><circle cx="12" cy="14" r="3"></circle><line x1="12" y1="7" x2="12" y2="9"></line></svg>
                <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'phone'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="2" width="14" height="20" rx="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
                <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
              </div>

              <!-- ZOOMED MODE: High fidelity Detail Card directly inside Room! -->
              <div v-else class="detailed-card-inside">
                <div class="detailed-head">
                  <span class="d-dot" :class="onlineStatus[dev.id] ? 'online' : 'offline'"></span>
                  <strong class="d-title">{{ dev.name }}</strong>
                </div>
                <p class="d-type">{{ typeLabel(propString(dev, 'device_type') || 'other') }}</p>
                <div class="d-props monospace" v-if="propString(dev, 'ip_address') || propString(dev, 'adb_ip')">
                  <span>{{ propString(dev, 'ip_address') || propString(dev, 'adb_ip').split(':')[0] }}</span>
                </div>
                <div class="d-group-indicator" v-if="dev.props?.group_id">
                  <span>⛓ {{ dev.props.group_name }}</span>
                </div>
                <div class="d-click-hint">{{ label('双击配置', 'Double-click') }}</div>
              </div>

              <span v-if="zoomedRoomId !== room.id" class="node-name">{{ dev.name }}</span>
              <span v-if="dev.props?.group_id && zoomedRoomId !== room.id" class="node-group-badge">⛓</span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Side controls sliding up when focused -->
    <Teleport to="body">
      <div v-if="selectedDevice" class="bottom-card-overlay" @click="selectedDeviceId = null">
        <div class="bottom-panel glass-panel" @click.stop>
          <header class="bp-head">
            <span class="bp-badge">{{ typeLabel(propString(selectedDevice, 'device_type') || 'other') }}</span>
            <h3>{{ selectedDevice.name }}</h3>
            <span class="bp-indicator" :class="onlineStatus[selectedDevice.id] ? 'online' : 'offline'">
              {{ onlineStatus[selectedDevice.id] ? label('在线', 'Online') : label('离线', 'Offline') }}
            </span>
          </header>

          <div class="bp-body">
            <div class="bp-props">
              <span v-if="propString(selectedDevice, 'mi_did')">Mi: {{ miNameFor(propString(selectedDevice, 'mi_did')) }}</span>
              <span v-if="propString(selectedDevice, 'adb_ip')">ADB: {{ propString(selectedDevice, 'adb_ip') }}</span>
              <span v-if="propString(selectedDevice, 'ip_address')">IP: {{ propString(selectedDevice, 'ip_address') }}</span>
              <span v-if="selectedDevice.props?.group_id">组: ⛓ {{ selectedDevice.props.group_name }}</span>
            </div>

            <div class="bp-group-mgmt" v-if="!selectedDevice.props?.group_id && groupCandidates.length > 0">
              <select v-model="groupingWithId" class="bp-select">
                <option :value="null">{{ label('绑定同伴...', 'Select partner...') }}</option>
                <option v-for="c in groupCandidates" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <button class="bp-bind-btn" :disabled="!groupingWithId" @click="bindGroupPartner">⛓</button>
            </div>
            <button v-else-if="selectedDevice.props?.group_id" class="bp-disband-btn" @click="disbandGroup">
              {{ label('解除编组', 'Disband') }}
            </button>
          </div>

          <footer class="bp-actions">
            <button class="bp-main-btn" @click="router.push(`/devices/${selectedDevice.id}`)">
              {{ label('控制与详情', 'Control & Details') }}
            </button>
            <button class="bp-close-btn" @click="selectedDeviceId = null">
              {{ label('关闭', 'Close') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="editingRoom" class="room-settings-overlay" @click="closeRoomSettings">
        <form class="room-settings-panel glass-panel" @click.stop @submit.prevent="saveRoomSettings">
          <header class="room-settings-head">
            <div>
              <span class="room-settings-kicker">{{ label('房间操作', 'Room Operations') }}</span>
              <h3>{{ editingRoom.name }}</h3>
            </div>
            <button class="room-settings-close" type="button" @click="closeRoomSettings">×</button>
          </header>

          <label class="room-form-field">
            <span>{{ label('房间名称', 'Room name') }}</span>
            <input v-model="editingRoomName" type="text" :placeholder="label('例如：客厅', 'e.g. Living Room')" />
          </label>

          <section class="room-color-section">
            <span>{{ label('背景颜色', 'Background color') }}</span>
            <div class="room-color-grid">
              <button
                v-for="preset in roomColorPresets"
                :key="preset.preview"
                class="room-color-chip"
                :class="{ active: editingRoomColor === preset.value }"
                :style="{ background: preset.preview }"
                type="button"
                @click="editingRoomColor = preset.value"
              >
                <span>{{ isZh ? preset.zh : preset.en }}</span>
              </button>
            </div>
          </section>

          <section class="room-device-section">
            <div class="room-device-head">
              <span>{{ label('房间设备', 'Room devices') }}</span>
              <small>{{ label('勾选后会把设备移动到这个房间', 'Checked devices move into this room') }}</small>
            </div>
            <button class="room-add-device-btn" type="button" :disabled="creatingDevice" @click="openDeviceCreator(editingRoom)">
              {{ creatingDevice ? label('创建中...', 'Creating...') : label('新增设备到此房间', 'Add Device to Room') }}
            </button>
            <div class="room-device-list">
              <label v-for="device in roomDeviceOptions" :key="device.id" class="room-device-row">
                <input v-model="editingRoomDeviceIds" type="checkbox" :value="device.id" />
                <span class="room-device-main">
                  <strong>{{ device.name }}</strong>
                  <small>{{ typeLabel(propString(device, 'device_type') || 'other') }} · {{ roomNameForDevice(device) }}</small>
                </span>
              </label>
            </div>
          </section>

          <footer class="room-settings-actions">
            <button class="room-delete-btn" type="button" :disabled="saving" @click="deleteEditingRoom">
              {{ label('删除房间', 'Delete Room') }}
            </button>
            <div class="room-settings-save-group">
              <button class="room-cancel-btn" type="button" :disabled="saving" @click="closeRoomSettings">
                {{ label('取消', 'Cancel') }}
              </button>
              <button class="room-save-btn" type="submit" :disabled="saving">
                {{ saving ? label('保存中...', 'Saving...') : label('保存', 'Save') }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="deviceCreatorOpen" class="room-settings-overlay" @click="closeDeviceCreator">
        <form class="room-settings-panel glass-panel" @click.stop @submit.prevent="createDeviceFromDialog">
          <header class="room-settings-head">
            <div>
              <span class="room-settings-kicker">{{ label('设备操作', 'Device Operations') }}</span>
              <h3>{{ label('新增设备', 'Add Device') }}</h3>
            </div>
            <button class="room-settings-close" type="button" @click="closeDeviceCreator">×</button>
          </header>

          <label class="room-form-field">
            <span>{{ label('设备名称', 'Device name') }}</span>
            <input v-model="newDeviceName" type="text" :placeholder="label('例如：客厅电视', 'e.g. Living Room TV')" />
          </label>

          <label class="room-form-field">
            <span>{{ label('设备类型', 'Device type') }}</span>
            <select v-model="newDeviceType">
              <option v-for="option in deviceTypeOptions" :key="option.value" :value="option.value">
                {{ isZh ? option.zh : option.en }}
              </option>
            </select>
          </label>

          <label class="room-form-field">
            <span>{{ label('所属房间', 'Room') }}</span>
            <select v-model="newDeviceRoomId">
              <option :value="null">{{ label('请选择房间', 'Select a room') }}</option>
              <option v-for="room in activeRooms" :key="room.id" :value="room.id">
                {{ room.name }}
              </option>
            </select>
          </label>

          <footer class="room-settings-actions">
            <span class="device-create-note">
              {{ label('创建后会出现在房间中心，可继续拖拽调整位置。', 'It will appear in the room center and can be dragged afterward.') }}
            </span>
            <div class="room-settings-save-group">
              <button class="room-cancel-btn" type="button" :disabled="creatingDevice" @click="closeDeviceCreator">
                {{ label('取消', 'Cancel') }}
              </button>
              <button class="room-save-btn" type="submit" :disabled="creatingDevice">
                {{ creatingDevice ? label('创建中...', 'Creating...') : label('创建设备', 'Create Device') }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Teleport>
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

.canvas-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 16px;
}

.canvas-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
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
  font-size: 13px;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
}

.focus-back-btn, .reset-zoom-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.focus-back-btn {
  background: #10b981;
  color: #fff;
  border: 0;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
}
.focus-back-btn:hover { background: #059669; transform: translateY(-1px); }

.reset-zoom-btn {
  background: #fff;
  color: var(--text-secondary);
  border: 1px solid rgba(0,0,0,0.08);
}
.reset-zoom-btn:hover { border-color: #10b981; color: #10b981; }

.add-room-btn,
.add-device-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.2s;
  background: #fff;
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.24);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);
}

.add-device-btn {
  color: #2563eb;
  border-color: rgba(37, 99, 235, 0.22);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.1);
}

.add-room-btn:hover:not(:disabled),
.add-device-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #ecfdf5;
}

.add-device-btn:hover:not(:disabled) {
  background: #eff6ff;
}

.add-room-btn:disabled,
.add-device-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.edit-mode-btn {
  padding: 8px 18px;
  border-radius: 10px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.2s;
  background: #111827;
  color: #fff;
  border: 1px solid rgba(17, 24, 39, 0.08);
  box-shadow: 0 4px 14px rgba(17, 24, 39, 0.16);
}

.edit-mode-btn.active {
  background: #10b981;
  border-color: #10b981;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
}

.edit-mode-btn:hover {
  transform: translateY(-1px);
}

/* 2D Viewport constraints - Dynamic size adaptation */
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

/* Infinite transform layer */
.canvas-transform-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none; /* Let pointer events drop to viewport background */
}

.canvas-transform-wrapper > * {
  pointer-events: auto; /* Re-enable pointer events for room cards & device nodes inside */
}

/* Draggable Rooms cards */
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

.room-card.zoomed-in {
  position: absolute !important;
  left: 20px !important;
  top: 20px !important;
  z-index: 100;
  border-color: #10b981 !important;
  cursor: default !important;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.1) !important;
  padding: 24px;
}

.room-card.zoomed-out {
  opacity: 0.05;
  pointer-events: none;
}

/* Room connection SVG */
.room-connections-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.connection-line {
  stroke: rgba(99, 102, 241, 0.35);
  stroke-width: 2.5;
  stroke-dasharray: 6, 4;
  animation: group-flow 2s linear infinite;
}

@keyframes group-flow {
  from { stroke-dashoffset: 20; }
  to { stroke-dashoffset: 0; }
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

/* Draggable inside room device nodes */
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

.node-icon {
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
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

/* node text tooltip label on hover */
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

/* ZOOMED HIGH-FIDELITY MODE */
.device-node.zoomed-mode {
  width: 154px !important;
  height: 114px !important;
  border-radius: 18px !important;
  background: #fff !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04) !important;
  border: 1px solid rgba(0,0,0,0.06) !important;
  cursor: grab;
}

.device-node.zoomed-mode.active {
  border-color: #10b981 !important;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.15) !important;
}

.detailed-card-inside {
  width: 100%;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  pointer-events: none;
  text-align: left;
}

.detailed-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.d-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.d-dot.online { background: #10b981; }
.d-dot.offline { background: #ef4444; }

.d-title {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.d-type {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin: 2px 0 0;
}

.d-props {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.8;
  margin-top: auto;
}

.d-group-indicator {
  font-size: 10px;
  color: #6366f1;
  font-weight: 800;
  margin-top: 2px;
}

.d-click-hint {
  font-size: 9px;
  font-weight: 800;
  color: #10b981;
  opacity: 0.7;
  text-align: right;
  margin-top: 2px;
}

/* Floating Bottom Drawer Modal for Device Details */
.bottom-card-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.15);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: overlayFade 0.25s ease;
}

.bottom-panel {
  width: min(440px, 100%);
  border-radius: 32px 32px 0 0 !important;
  background: #fff;
  border: 1px solid rgba(229, 231, 235, 0.5);
  box-shadow: 0 -10px 48px rgba(15, 23, 42, 0.12);
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: panelSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-sizing: border-box;
}

.bp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  padding-bottom: 12px;
}

.bp-badge {
  font-size: 11px;
  font-weight: 900;
  color: #10b981;
  background: rgba(16, 185, 129, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
  text-transform: uppercase;
}

.bp-head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
}

.bp-indicator {
  font-size: 12px;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.bp-indicator::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.bp-indicator.online { color: #10b981; }
.bp-indicator.online::before { background: #10b981; }
.bp-indicator.offline { color: #ef4444; }
.bp-indicator.offline::before { background: #ef4444; }

.bp-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.bp-props {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
}

.bp-group-mgmt {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.bp-select {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 13px;
  background: #fff;
}

.bp-bind-btn {
  padding: 0 16px;
  background: #6366f1;
  color: #fff;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 900;
}

.bp-bind-btn:disabled { opacity: 0.4; }

.bp-disband-btn {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  padding: 10px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  margin-top: 8px;
}

.bp-actions {
  display: flex;
  gap: 10px;
}

.bp-main-btn, .bp-close-btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.bp-main-btn {
  background: #10b981;
  color: #fff;
  border: 0;
}
.bp-main-btn:hover { background: #059669; }

.bp-close-btn {
  background: #fff;
  border: 1px solid rgba(0,0,0,0.08);
  color: var(--text-secondary);
}
.bp-close-btn:hover { border-color: #10b981; color: #10b981; }

.room-settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(8px);
  animation: overlayFade 0.25s ease;
  box-sizing: border-box;
}

.room-settings-panel {
  width: min(560px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  padding: 28px;
  gap: 22px;
  overflow: auto;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(229, 231, 235, 0.7);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.16);
  box-sizing: border-box;
}

.room-settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.room-settings-kicker {
  display: inline-flex;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 900;
  color: #10b981;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.room-settings-head h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.room-settings-close {
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

.room-form-field,
.room-color-section,
.room-device-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.room-form-field > span,
.room-color-section > span,
.room-device-head > span {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.room-form-field input,
.room-form-field select {
  height: 44px;
  padding: 0 14px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  background: #fff;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  outline: none;
}

.room-form-field input:focus,
.room-form-field select:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.room-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 10px;
}

.room-color-chip {
  min-height: 48px;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  color: #0f172a;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  text-align: left;
  box-shadow: inset 0 0 0 999px rgba(255, 255, 255, 0.22);
}

.room-color-chip.active {
  border-color: #10b981;
  box-shadow: inset 0 0 0 999px rgba(255, 255, 255, 0.12), 0 0 0 3px rgba(16, 185, 129, 0.14);
}

.room-device-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.room-device-head small {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.room-add-device-btn {
  height: 40px;
  border: 1px solid rgba(37, 99, 235, 0.18);
  border-radius: 14px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.room-add-device-btn:hover:not(:disabled) {
  background: #dbeafe;
}

.room-add-device-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.room-device-list {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow: auto;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.74);
}

.room-device-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  border-bottom: 1px solid rgba(15, 23, 42, 0.05);
}

.room-device-row:last-child {
  border-bottom: 0;
}

.room-device-row:hover {
  background: rgba(16, 185, 129, 0.06);
}

.room-device-row input {
  width: 16px;
  height: 16px;
  accent-color: #10b981;
}

.room-device-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.room-device-main strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.room-device-main small {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.room-settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}

.room-settings-save-group {
  display: flex;
  gap: 10px;
}

.device-create-note {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}

.room-delete-btn,
.room-cancel-btn,
.room-save-btn {
  min-height: 42px;
  padding: 0 16px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
}

.room-delete-btn {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.room-cancel-btn {
  background: #fff;
  color: var(--text-secondary);
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.room-save-btn {
  background: #10b981;
  color: #fff;
  border: 0;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.24);
}

.room-delete-btn:disabled,
.room-cancel-btn:disabled,
.room-save-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@keyframes overlayFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes panelSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (max-width: 1024px) {
  .devices-page-2d {
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    min-width: 0;
    padding: 16px;
  }

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

  .room-card.zoomed-in {
    transform: none !important;
    width: calc(100% - 20px) !important;
    height: calc(100% - 20px) !important;
  }
}

@media (max-width: 640px) {
  .devices-page-2d {
    padding: 12px;
  }

  .canvas-area {
    padding: 12px;
  }

  .twin-viewport {
    min-height: 320px;
  }

  .room-card {
    transform: scale(0.55) !important;
  }

  .room-card.zoomed-in {
    transform: none !important;
  }
}
</style>
