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
const zoomedRoomId = ref<number | null>(null)

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
  props.x = Math.max(10, Math.min(roomW - 54, event.clientX - dragDevOffsetX.value))
  props.y = Math.max(10, Math.min(roomH - 54, event.clientY - dragDevOffsetY.value))
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

function handleRoomDblClick(room: Room) {
  if (zoomedRoomId.value === room.id) {
    zoomedRoomId.value = null // Zoom out
  } else {
    zoomedRoomId.value = room.id // Zoom in
  }
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
  const roomDevices = devices.value.filter((d) => propNumber(d, 'room_id') === roomId)
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; id: string }> = []
  const processed = new Set<string>()

  for (const d of roomDevices) {
    const gid = d.props?.group_id
    if (!gid) continue
    const x1 = (d.props?.x as number) ?? 40
    const y1 = (d.props?.y as number) ?? 40

    const partners = roomDevices.filter((p) => p.id !== d.id && p.props?.group_id === gid)
    for (const p of partners) {
      const key = [d.id, p.id].sort().join('-')
      if (processed.has(key)) continue
      processed.add(key)

      const x2 = (p.props?.x as number) ?? 40
      const y2 = (p.props?.y as number) ?? 40
      lines.push({
        x1: x1 + 22, // Center of 44px node
        y1: y1 + 22,
        x2: x2 + 22,
        y2: y2 + 22,
        id: key,
      })
    }
  }
  return lines
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
          :class="{ 'zoomed-in': zoomedRoomId === room.id, 'zoomed-out': zoomedRoomId !== null && zoomedRoomId !== room.id }"
          :style="zoomedRoomId === room.id ? {} : {
            left: (room.props.x || 0) + 'px',
            top: (room.props.y || 0) + 'px',
            width: (room.props.w || 240) + 'px',
            height: (room.props.h || 180) + 'px',
          }"
          @pointerdown="zoomedRoomId === room.id ? null : startDragRoom($event, room)"
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

          <!-- Renders Devices bounded inside this Room -->
          <div
            v-for="dev in devices.filter((d) => propNumber(d, 'room_id') === room.id)"
            :key="dev.id"
            class="device-node"
            :class="{
              active: selectedDeviceId === dev.id,
              online: onlineStatus[dev.id] === true,
              offline: onlineStatus[dev.id] === false,
              'in-group': dev.props?.group_id,
            }"
            :style="{
              left: (dev.props.x ?? 40) + 'px',
              top: (dev.props.y ?? 40) + 'px',
            }"
            @pointerdown="startDragDevice($event, dev)"
            @click.stop="selectDevice(dev)"
            @dblclick.stop="router.push(`/devices/${dev.id}`)"
          >
            <div class="node-icon" :class="`icon-${deviceIcon(propString(dev, 'device_type'))}`">
              <svg v-if="deviceIcon(propString(dev, 'device_type')) === 'tv'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
              <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'speaker'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="2" width="16" height="20" rx="3"></rect><circle cx="12" cy="14" r="3"></circle><line x1="12" y1="7" x2="12" y2="9"></line></svg>
              <svg v-else-if="deviceIcon(propString(dev, 'device_type')) === 'phone'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="5" y="2" width="14" height="20" rx="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
              <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            </div>
            <span class="node-name">{{ dev.name }}</span>
            <span v-if="dev.props?.group_id" class="node-group-badge">⛓</span>
          </div>
        </div>
      </div>
    </main>

    <!-- Right Summary / Detail Panel -->
    <aside class="control-panel glass-panel">
      <!-- Group Details View -->
      <template v-if="selectedDevice && selectedDevice.props?.group_id">
        <header class="panel-head">
          <span class="meta-label">⛓ {{ selectedDevice.props.group_name }}</span>
          <h2>{{ selectedDevice.name }}</h2>
          <span class="status-indicator" :class="onlineStatus[selectedDevice.id] ? 'status-online' : 'status-offline'">
            {{ onlineStatus[selectedDevice.id] ? label('在线', 'Online') : label('离线', 'Offline') }}
          </span>
        </header>

        <section class="panel-body">
          <div class="props-list">
            <!-- Renders all devices inside this group as high-fidelity cards -->
            <div class="group-member-card-list">
              <span class="p-key">{{ label('组内关联设备', 'Grouped Devices') }}</span>
              <div
                v-for="d in devices.filter(x => x.props?.group_id === selectedDevice!.props.group_id)"
                :key="d.id"
                class="member-micro-card"
                @click="selectDevice(d)"
                :class="{ active: d.id === selectedDevice.id }"
              >
                <div class="member-head">
                  <span class="m-dot" :class="onlineStatus[d.id] ? 'online' : 'offline'"></span>
                  <strong>{{ d.name }}</strong>
                </div>
                <small class="m-sub">{{ typeLabel(propString(d, 'device_type') || 'other') }}</small>
              </div>
            </div>

            <!-- Simple actions -->
            <button class="disband-btn-heavy" @click="disbandGroup">
              {{ label('解除当前组合', 'Disband Group') }}
            </button>
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

      <!-- Single Device View -->
      <template v-else-if="selectedDevice">
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

            <!-- Group Management Block -->
            <div class="prop-item group-block" v-if="groupCandidates.length > 0">
              <span class="p-key">{{ label('创建设备组', 'Create Group') }}</span>
              <div class="group-bind-row">
                <select v-model="groupingWithId" class="group-select">
                  <option :value="null">{{ label('选择房间内同伴...', 'Select partner...') }}</option>
                  <option v-for="c in groupCandidates" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <button class="bind-btn-sm" :disabled="!groupingWithId" @click="bindGroupPartner">⛓</button>
              </div>
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
          <p>{{ label('在左侧点击设备查看控制和能力，双击进入控制详情页', 'Select a device node on the left twin canvas, dblclick to manage') }}</p>
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
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s, left 0.4s, top 0.4s, width 0.4s, height 0.4s;
}

.room-card:active {
  cursor: grabbing;
  border-color: #10b981;
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.04);
}

.room-card.zoomed-in {
  position: absolute !important;
  left: 10px !important;
  top: 10px !important;
  width: calc(100% - 20px) !important;
  height: calc(100% - 20px) !important;
  z-index: 100;
  background: rgba(255, 255, 255, 0.9) !important;
  border-color: #10b981 !important;
  cursor: default !important;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.15) !important;
}

.room-card.zoomed-out {
  opacity: 0.15;
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
  stroke: rgba(99, 102, 241, 0.4);
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

/* Grouping panel css */
.group-block {
  border-bottom: none;
  padding-bottom: 0;
}

.group-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(99, 102, 241, 0.05);
  border: 1px dashed rgba(99, 102, 241, 0.2);
  padding: 12px;
  border-radius: 12px;
  margin-top: 4px;
}

.group-tag {
  color: #6366f1;
  font-size: 14px;
}

.group-partner-names {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
  font-weight: 600;
}

.disband-btn-heavy {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  padding: 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  margin-top: 12px;
  width: 100%;
}

.disband-btn-heavy:hover {
  background: #fee2e2;
}

.group-member-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.member-micro-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.member-micro-card:hover {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.02);
}

.member-micro-card.active {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.05);
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
}

.member-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.member-head strong {
  font-size: 14px;
  color: var(--text-primary);
}

.m-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.m-dot.online { background: #10b981; }
.m-dot.offline { background: #ef4444; }

.m-sub {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 700;
}

.group-bind-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.group-select {
  flex: 1;
  padding: 6px 10px;
  border: 1.5px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  font-size: 13px;
  background: #fff;
}

.bind-btn-sm {
  width: 32px;
  height: 32px;
  background: #6366f1;
  color: #fff;
  border: 0;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}

.bind-btn-sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.empty-val {
  color: rgba(0,0,0,0.2) !important;
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

@media (max-width: 1024px) {
  .devices-page-2d {
    grid-template-columns: 1fr;
    overflow-y: auto;
    height: auto;
    min-height: 100%;
    padding: 16px;
    gap: 16px;
  }

  .canvas-area {
    padding: 16px;
    height: 520px;
    flex: none;
  }

  .twin-viewport {
    width: 100% !important;
    height: 400px !important;
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

  .control-panel {
    padding: 24px;
    min-height: 300px;
  }
}

@media (max-width: 640px) {
  .devices-page-2d {
    padding: 12px;
  }

  .canvas-area {
    height: 420px;
  }

  .twin-viewport {
    height: 300px !important;
  }

  .room-card {
    transform: scale(0.55) !important;
  }

  .room-card.zoomed-in {
    transform: none !important;
  }

  .control-panel {
    padding: 16px;
    border-radius: 20px;
  }
}
</style>
