import { onUnmounted, ref, type Ref } from 'vue'
import type { Room, UserDevice } from '@/api'
import { clampRatio } from '@/utils/roomCoords'

type CanvasExpose = {
  viewportEl?: HTMLElement | null
  transformWrapperEl?: HTMLElement | null
}

type RoomLayout = { x: number; y: number; w: number; h: number }
type DeviceLayout = { x: number; y: number }
type MutableRoomLayout = { x?: number; y?: number; w?: number; h?: number }
type MutableDeviceLayout = { x?: number; y?: number }

type ElementMoveState = {
  layoutX: number
  layoutY: number
  clientX: number
  clientY: number
  elementRect: DOMRect
  boundaryRect: DOMRect
  scaleX: number
  scaleY: number
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

const MIN_ROOM_WIDTH = 180
const MIN_ROOM_HEIGHT = 140

export function useDevicesCanvasInteraction(options: {
  rooms: Ref<Room[]>
  devices: Ref<UserDevice[]>
  isEditMode: Ref<boolean>
  getRoomLayout: (room: Room) => RoomLayout
  ensureRoomLayout: (room: Room) => MutableRoomLayout
  getDeviceLayout: (device: UserDevice) => DeviceLayout
  ensureDeviceLayout: (device: UserDevice) => MutableDeviceLayout
  findParentRoom: (device: UserDevice) => Room | null
  saveRoomLayout: (room: Room) => Promise<void>
  saveDeviceLayout: (device: UserDevice) => Promise<void>
}) {
  const selectedDeviceId = ref<number | null>(null)
  const viewportWidth = ref(1000)
  const viewportHeight = ref(700)
  const scale = ref(1)
  const panX = ref(0)
  const panY = ref(0)
  const isPanning = ref(false)
  const panStartRawX = ref(0)
  const panStartRawY = ref(0)
  const initialTouchDistance = ref<number | null>(null)
  const initialScale = ref(1)
  const draggingRoomId = ref<number | null>(null)
  const resizingRoomId = ref<number | null>(null)
  const draggingDeviceId = ref<number | null>(null)

  const canvasRef = ref<CanvasExpose | null>(null)
  const roomElementRefs = new Map<number, HTMLElement>()
  const deviceElementRefs = new Map<number, HTMLElement>()

  let roomDragState: ElementMoveState | null = null
  let roomResizeState: ElementResizeState | null = null
  let deviceDragState: ElementMoveState | null = null

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

  function getRoomDomScale(room: Room, roomEl: HTMLElement) {
    const layout = options.getRoomLayout(room)
    const rect = roomEl.getBoundingClientRect()
    return {
      x: layout.w > 0 ? rect.width / layout.w : getCanvasDomScale(),
      y: layout.h > 0 ? rect.height / layout.h : getCanvasDomScale(),
    }
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

  function handleWheel(event: WheelEvent) {
    event.preventDefault()
    const zoomFactor = 0.08
    const nextScale = event.deltaY < 0 ? scale.value + zoomFactor : scale.value - zoomFactor
    scale.value = Math.max(0.4, Math.min(3, nextScale))
  }

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

  function startDragRoom(event: PointerEvent, room: Room) {
    if (!options.isEditMode.value) return
    const target = event.target as HTMLElement | null
    if (target?.closest?.('.device-node')) return
    const roomEl = roomElementRefs.get(room.id)
    const viewportEl = getViewportEl()
    if (!roomEl || !viewportEl) return
    event.preventDefault()
    event.stopPropagation()

    const layout = options.getRoomLayout(room)
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
    const room = options.rooms.value.find((r) => r.id === draggingRoomId.value)
    if (!room) return

    const state = roomDragState
    const roomLayout = options.ensureRoomLayout(room)
    const rawDx = event.clientX - state.clientX
    const rawDy = event.clientY - state.clientY
    const dx = clampVisualDelta(rawDx, state.elementRect.left, state.elementRect.right, state.boundaryRect.left, state.boundaryRect.right)
    const dy = clampVisualDelta(rawDy, state.elementRect.top, state.elementRect.bottom, state.boundaryRect.top, state.boundaryRect.bottom)

    roomLayout.x = state.layoutX + dx / state.scaleX
    roomLayout.y = state.layoutY + dy / state.scaleY
  }

  async function stopDragRoom() {
    if (draggingRoomId.value === null) return
    const room = options.rooms.value.find((r) => r.id === draggingRoomId.value)
    draggingRoomId.value = null
    roomDragState = null
    document.removeEventListener('pointermove', onDragRoom)
    document.removeEventListener('pointerup', stopDragRoom)
    if (room) {
      await options.saveRoomLayout(room)
    }
  }

  function startResizeRoom(event: PointerEvent, room: Room) {
    if (!options.isEditMode.value) return
    const roomEl = roomElementRefs.get(room.id)
    const viewportEl = getViewportEl()
    if (!roomEl || !viewportEl) return
    event.preventDefault()
    event.stopPropagation()

    const layout = options.getRoomLayout(room)
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
    const room = options.rooms.value.find((r) => r.id === resizingRoomId.value)
    if (!room) return

    const state = roomResizeState
    const roomLayout = options.ensureRoomLayout(room)
    const rawDx = event.clientX - state.clientX
    const rawDy = event.clientY - state.clientY
    const dx = clampResizeVisualDelta(rawDx, state.elementRect.width, MIN_ROOM_WIDTH * state.scaleX, state.boundaryRect.right - state.elementRect.right)
    const dy = clampResizeVisualDelta(rawDy, state.elementRect.height, MIN_ROOM_HEIGHT * state.scaleY, state.boundaryRect.bottom - state.elementRect.bottom)

    roomLayout.w = Math.max(MIN_ROOM_WIDTH, state.layoutW + dx / state.scaleX)
    roomLayout.h = Math.max(MIN_ROOM_HEIGHT, state.layoutH + dy / state.scaleY)
  }

  async function stopResizeRoom() {
    if (resizingRoomId.value === null) return
    const room = options.rooms.value.find((r) => r.id === resizingRoomId.value)
    resizingRoomId.value = null
    roomResizeState = null
    document.removeEventListener('pointermove', onResizeRoom)
    document.removeEventListener('pointerup', stopResizeRoom)
    if (room) {
      await options.saveRoomLayout(room)
    }
  }

  function startDragDevice(event: PointerEvent, device: UserDevice) {
    if (!options.isEditMode.value) return
    const deviceEl = deviceElementRefs.get(device.id)
    if (!deviceEl) return
    event.preventDefault()

    const room = options.findParentRoom(device)
    if (!room) return
    const roomEl = roomElementRefs.get(room.id) ?? null
    const boundaryEl = roomEl ?? getViewportEl()
    if (!boundaryEl) return

    const layout = options.getDeviceLayout(device)
    const roomLayout = options.getRoomLayout(room)
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
    const device = options.devices.value.find((d) => d.id === draggingDeviceId.value)
    if (!device) return

    const state = deviceDragState
    const rawDx = event.clientX - state.clientX
    const rawDy = event.clientY - state.clientY
    const dx = clampVisualDelta(rawDx, state.elementRect.left, state.elementRect.right, state.boundaryRect.left, state.boundaryRect.right)
    const dy = clampVisualDelta(rawDy, state.elementRect.top, state.elementRect.bottom, state.boundaryRect.top, state.boundaryRect.bottom)

    const deviceLayout = options.ensureDeviceLayout(device)
    if (state.roomW && state.roomH) {
      const next = clampRatio(
        state.layoutX + (dx / state.scaleX) / state.roomW,
        state.layoutY + (dy / state.scaleY) / state.roomH
      )
      deviceLayout.x = next.x
      deviceLayout.y = next.y
    } else {
      deviceLayout.x = 0.5
      deviceLayout.y = 0.5
    }
  }

  async function stopDragDevice() {
    if (draggingDeviceId.value === null) return
    const device = options.devices.value.find((d) => d.id === draggingDeviceId.value)
    draggingDeviceId.value = null
    deviceDragState = null
    document.removeEventListener('pointermove', onDragDevice)
    document.removeEventListener('pointerup', stopDragDevice)
    if (device) {
      await options.saveDeviceLayout(device)
    }
  }

  function cleanupDocumentListeners() {
    document.removeEventListener('pointermove', onDragRoom)
    document.removeEventListener('pointerup', stopDragRoom)
    document.removeEventListener('pointermove', onResizeRoom)
    document.removeEventListener('pointerup', stopResizeRoom)
    document.removeEventListener('pointermove', onDragDevice)
    document.removeEventListener('pointerup', stopDragDevice)
  }

  onUnmounted(cleanupDocumentListeners)

  return {
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
  }
}
