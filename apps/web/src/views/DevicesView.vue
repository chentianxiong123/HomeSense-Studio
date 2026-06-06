<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice, type Room, type MiDeviceCandidate } from '@/api'
import { cliApi } from '@/api/cli'
import { useLocale } from '@/composables/useLocale'

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
const saving = ref(false)
const onlineStatus = ref<Record<number, boolean>>({})
let pingTimer: ReturnType<typeof setInterval> | null = null

// 2D Layout State
const selectedDeviceId = ref<number | null>(null)
const canvasWidth = 800
const canvasHeight = 600

const selectedDevice = computed(() =>
  devices.value.find((d) => d.id === selectedDeviceId.value) || null
)

const activeRooms = computed(() => {
  return rooms.value.filter((r) => {
    const props = r.props ?? {}
    return (
      typeof props.x === 'number' &&
      typeof props.y === 'number' &&
      typeof props.w === 'number' &&
      typeof props.h === 'number'
    )
  })
})

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

onMounted(async () => {
  await loadData()
  startPing()
  void ensureMiNamesLoaded()
})

onUnmounted(() => {
  if (pingTimer) clearInterval(pingTimer)
})

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

    // Auto initialize dummy room positions if not present
    let changed = false
    for (const r of rooms.value) {
      if (!r.props || typeof r.props.x !== 'number') {
        r.props = {
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 300) + 50,
          w: 240,
          h: 180,
        }
        await api.rooms.update(r.id, { props: r.props })
        changed = true
      }
    }
    if (changed) {
      const roomRes2 = await api.rooms.list()
      rooms.value = roomRes2.rooms ?? []
    }
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
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

function startPing() {
  pingDevices()
  pingTimer = setInterval(pingDevices, 60000)
}

// Draggable room card implementation
const draggingRoomId = ref<number | null>(null)
const dragOffsetX = ref(0)
const dragOffsetY = ref(0)

function startDragRoom(event: PointerEvent, room: Room) {
  event.preventDefault()
  draggingRoomId.value = room.id
  const props = room.props as any
  dragOffsetX.value = event.clientX - (props.x ?? 0)
  dragOffsetY.value = event.clientY - (props.y ?? 0)
  document.addEventListener('pointermove', onDragRoom)
  document.addEventListener('pointerup', stopDragRoom)
}

function onDragRoom(event: PointerEvent) {
  if (draggingRoomId.value === null) return
  const room = rooms.value.find((r) => r.id === draggingRoomId.value)
  if (!room) return
  const props = room.props as any
  props.x = Math.max(0, Math.min(canvasWidth - (props.w ?? 200), event.clientX - dragOffsetX.value))
  props.y = Math.max(0, Math.min(canvasHeight - (props.h ?? 200), event.clientY - dragOffsetY.value))
}

async function stopDragRoom() {
  if (draggingRoomId.value === null) return
  const room = rooms.value.find((r) => r.id === draggingRoomId.value)
  if (room) {
    await api.rooms.update(room.id, { props: room.props })
  }
  draggingRoomId.value = null
  document.removeEventListener('pointermove', onDragRoom)
  document.removeEventListener('pointerup', stopDragRoom)
}

// Draggable Device Node implementation (relative inside room)
const draggingDeviceId = ref<number | null>(null)
const dragDevOffsetX = ref(0)
const dragDevOffsetY = ref(0)

function startDragDevice(event: PointerEvent, device: UserDevice) {
  event.stopPropagation()
  event.preventDefault()
  draggingDeviceId.value = device.id
  const props = device.props as any
  dragDevOffsetX.value = event.clientX - (props.x ?? 50)
  dragDevOffsetY.value = event.clientY - (props.y ?? 50)
  document.addEventListener('pointermove', onDragDevice)
  document.addEventListener('pointerup', stopDragDevice)
}

function onDragDevice(event: PointerEvent) {
  if (draggingDeviceId.value === null) return
  const device = devices.value.find((d) => d.id === draggingDeviceId.value)
  if (!device) return
  const props = device.props as any
  const roomId = propNumber(device, 'room_id')
  const room = rooms.value.find((r) => r.id === roomId)
  const roomW = (room?.props as any)?.w ?? 240
  const roomH = (room?.props as any)?.h ?? 180
  props.x = Math.max(10, Math.min(roomW - 50, event.clientX - dragDevOffsetX.value))
  props.y = Math.max(10, Math.min(roomH - 50, event.clientY - dragDevOffsetY.value))
}

async function stopDragDevice() {
  if (draggingDeviceId.value === null) return
  const device = devices.value.find((d) => d.id === draggingDeviceId.value)
  if (device) {
    await api.userDevices.update(device.id, { props: device.props })
  }
  draggingDeviceId.value = null
  document.removeEventListener('pointermove', onDragDevice)
  document.removeEventListener('pointerup', stopDragDevice)
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
</script>

<template>
  <div class="devices-page-2d">
    <!-- Left interactive floor plan canvas -->
    <main class="canvas-area glass-panel">
      <header class="canvas-head">
        <h2>{{ label('数字孪生 · 2D 房型布局', 'Digital Twin Canvas') }}</h2>
        <span class="hint-pill">{{ label('按住房间卡片或设备图标自由拖动摆放', 'Drag rooms & devices to place') }}</span>
      </header>

      <div class="twin-viewport" :style="{ width: canvasWidth + 'px', height: canvasHeight + 'px' }">
        <!-- Renders Rooms -->
        <div
          v-for="room in activeRooms"
          :key="room.id"
          class="room-card"
          :style="{
            left: (room.props.x || 0) + 'px',
            top: (room.props.y || 0) + 'px',
            width: (room.props.w || 240) + 'px',
            height: (room.props.h || 180) + 'px',
          }"
          @pointerdown="startDragRoom($event, room)"
        >
          <div class="room-title">
            <span class="room-dot"></span>
            <strong>{{ room.name }}</strong>
          </div>

          <!-- Renders Devices bounded inside this Room -->
          <div
            v-for="dev in devices.filter((d) => propNumber(d, 'room_id') === room.id)"
            :key="dev.id"
            class="device-node"
            :class="{
              active: selectedDeviceId === dev.id,
              online: onlineStatus[dev.id] === true,
              offline: onlineStatus[dev.id] === false,
            }"
            :style="{
              left: (dev.props.x ?? 40) + 'px',
              top: (dev.props.y ?? 40) + 'px',
            }"
            @pointerdown="startDragDevice($event, dev)"
            @click.stop="selectDevice(dev)"
          >
            <div class="node-icon" :class="`icon-${deviceIcon(propString(dev, 'device_type'))}`">
              <svg v-if="deviceIcon(propString(dev, 'device_type')) === 'tv'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
              <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'speaker'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="2" width="16" height="20" rx="3"></rect><circle cx="12" cy="14" r="3"></circle><line x1="12" y1="7" x2="12" y2="9"></line></svg>
              <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'phone'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="2" width="14" height="20" rx="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
              <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            </div>
            <span class="node-name">{{ dev.name }}</span>
          </div>
        </div>
      </div>
    </main>

    <!-- Right Summary / Detail Panel -->
    <aside class="control-panel glass-panel">
      <template v-if="selectedDevice">
        <header class="panel-head">
          <span class="meta-label">{{ typeLabel(propString(selectedDevice, 'device_type') || 'other') }}</span>
          <h2>{{ selectedDevice.name }}</h2>
          <span class="status-indicator" :class="onlineStatus[selectedDevice.id] ? 'status-online' : 'status-offline'">
            {{ onlineStatus[selectedDevice.id] ? label('在线', 'Online') : label('离线', 'Offline') }}
          </span>
        </header>

        <section class="panel-body">
          <div class="props-list">
            <div v-if="propString(selectedDevice, 'mi_did')" class="prop-item">
              <span class="p-key">Mi Device</span>
              <strong class="p-val truncate">{{ miNameFor(propString(selectedDevice, 'mi_did')) }}</strong>
            </div>
            <div v-if="propString(selectedDevice, 'adb_ip')" class="prop-item">
              <span class="p-key">ADB IP</span>
              <strong class="p-val monospace">{{ propString(selectedDevice, 'adb_ip') }}</strong>
            </div>
            <div v-if="propString(selectedDevice, 'ip_address')" class="prop-item">
              <span class="p-key">Local IP</span>
              <strong class="p-val monospace">{{ propString(selectedDevice, 'ip_address') }}</strong>
            </div>
          </div>

          <div class="actions">
            <button class="primary-btn-sm" @click="router.push(`/devices/${selectedDevice.id}`)">
              {{ label('控制与详情', 'Manage & Control') }}
            </button>
            <button class="ghost-btn-sm" @click="selectedDeviceId = null">
              {{ label('取消选中', 'Deselect') }}
            </button>
          </div>
        </section>
      </template>

      <template v-else>
        <div class="panel-empty">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          <p>{{ label('在左侧点击设备查看控制和能力', 'Select a device node on the left twin canvas') }}</p>
          <button class="ghost-btn-sm" @click="router.push('/authorizations')">
            {{ label('进入授权中心', 'Unified Auth') }}
          </button>
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.devices-page-2d {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 24px;
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
}

.canvas-area {
  flex: 1;
  padding: 32px;
  overflow: hidden;
  position: relative;
}

.canvas-head {
  margin-bottom: 24px;
}

.canvas-head h2 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
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

/* 2D Viewport constraints */
.twin-viewport {
  flex: 1;
  background: radial-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 24px;
  position: relative;
  overflow: hidden;
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
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
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

/* Right Control Panel */
.control-panel {
  padding: 32px;
  justify-content: space-between;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.meta-label {
  font-size: 12px;
  font-weight: 900;
  color: #10b981;
  text-transform: uppercase;
  background: rgba(16, 185, 129, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
}

.panel-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.status-indicator {
  font-size: 13px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-indicator::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-online { color: #10b981; }
.status-online::before { background: #10b981; }
.status-offline { color: #ef4444; }
.status-offline::before { background: #ef4444; }

.panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  margin-top: 32px;
}

.props-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.prop-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.03);
  padding-bottom: 12px;
}

.p-key {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.p-val {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.monospace {
  font-family: ui-monospace, monospace;
}

.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 24px;
}

.primary-btn-sm, .ghost-btn-sm {
  width: 100%;
  height: 40px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn-sm {
  background: #10b981;
  color: #fff;
  border: 0;
}

.primary-btn-sm:hover { background: #059669; }

.ghost-btn-sm {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.ghost-btn-sm:hover { border-color: #10b981; color: #10b981; }

/* Empty state panel */
.panel-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 20px;
}

.empty-icon {
  color: var(--text-tertiary);
  opacity: 0.4;
}

.panel-empty p {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-tertiary);
  line-height: 1.6;
  max-width: 220px;
}
</style>
