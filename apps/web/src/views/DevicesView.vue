<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type UserDevice, type MiDeviceCandidate, type Room } from '@/api'
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
const editingIp = ref<Record<number, string>>({})
const savingIp = ref<Record<number, boolean>>({})
const showCreate = ref(false)
const showEdit = ref(false)
const editingDevice = ref<UserDevice | null>(null)

// Create form
const formName = ref('')
const formType = ref('other')
const formRoomId = ref<number | null>(null)
const rooms = ref<Room[]>([])
const showRoomsManager = ref(false)
const roomFormName = ref('')
const editingRoom = ref<Room | null>(null)
const savingRoom = ref(false)
const formMiDid = ref<string | null>(null)
const formAdbAddress = ref('')
const formIp = ref('')
const miCandidates = ref<MiDeviceCandidate[]>([])
const miCandidatesLoaded = ref(false)
const miCandidatesLoading = ref(false)
const roomsLoaded = ref(false)
const roomsLoading = ref(false)
const creating = ref(false)
const saving = ref(false)
const onlineStatus = ref<Record<number, boolean>>({})
let pingTimer: ReturnType<typeof setInterval> | null = null

const miBindingOptions = computed(() => {
  const rows = [...miCandidates.value]
  const currentDid = formMiDid.value
  if (currentDid && !rows.some((candidate) => candidate.did === currentDid)) {
    rows.unshift({
      did: currentDid,
      name: label('当前绑定', 'Current binding'),
      model: '',
      device_type: '',
      room_name: '',
      home_name: '',
    })
  }
  return rows
})

onMounted(() => {
  loadDevices()
  startPing()
})

onUnmounted(() => {
  if (pingTimer) clearInterval(pingTimer)
})

async function loadDevices() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await api.userDevices.list()
    devices.value = result.devices ?? []
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

async function openCreate() {
  showCreate.value = true
  formName.value = ''
  formType.value = 'other'
  formRoomId.value = null
  formMiDid.value = null
  formAdbAddress.value = ''
  formIp.value = ''
  void ensureEditLookupsLoaded()
}

async function submitCreate() {
  if (!formName.value.trim()) return
  creating.value = true
  try {
    await api.userDevices.create({
      name: formName.value.trim(),
      device_type: formType.value,
      room_id: formRoomId.value,
      mi_did: formMiDid.value || null,
      adb_ip: formAdbAddress.value,
      ip_address: formIp.value.trim(),
    })
    showCreate.value = false
    showSuccess(label('设备创建成功', 'Device created'))
    await loadDevices()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    creating.value = false
  }
}

function openEdit(device: UserDevice) {
  showEdit.value = true
  editingDevice.value = device
  formName.value = device.name
  formType.value = device.device_type
  formRoomId.value = device.room_id
  formMiDid.value = device.mi_did
  formAdbAddress.value = device.adb_ip
  formIp.value = device.ip_address
  void ensureEditLookupsLoaded()
}

async function ensureEditLookupsLoaded() {
  await Promise.allSettled([ensureMiCandidatesLoaded(), ensureRoomsLoaded()])
}

async function ensureMiCandidatesLoaded(force = false) {
  if (!force && (miCandidatesLoaded.value || miCandidatesLoading.value)) return
  miCandidatesLoading.value = true
  try {
    const result = await api.userDevices.miCandidates({ refresh: force })
    miCandidates.value = result.devices ?? []
    miCandidatesLoaded.value = true
  } catch {
    if (force) miCandidatesLoaded.value = false
  } finally {
    miCandidatesLoading.value = false
  }
}

async function ensureRoomsLoaded(force = false) {
  if (!force && (roomsLoaded.value || roomsLoading.value)) return
  roomsLoading.value = true
  try {
    const result = await api.rooms.list()
    rooms.value = result.rooms ?? []
    roomsLoaded.value = true
  } catch {
    if (force) roomsLoaded.value = false
  } finally {
    roomsLoading.value = false
  }
}

async function submitEdit() {
  if (!formName.value.trim() || !editingDevice.value) return
  saving.value = true
  try {
    await api.userDevices.update(editingDevice.value.id, {
      name: formName.value.trim(),
      device_type: formType.value,
      room_id: formRoomId.value,
      mi_did: formMiDid.value || null,
      adb_ip: formAdbAddress.value,
      ip_address: formIp.value.trim(),
    })
    showEdit.value = false
    editingDevice.value = null
    showSuccess(label('设备已保存', 'Device saved'))
    await loadDevices()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    saving.value = false
  }
}

async function deleteDevice(id: number) {
  if (!confirm(label('确定删除？', 'Delete this device?'))) return
  try {
    await api.userDevices.delete(id)
    devices.value = devices.value.filter(d => d.id !== id)
    showSuccess(label('设备已删除', 'Device deleted'))
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  }
}

async function loadRooms() {
  try {
    const result = await api.rooms.list()
    rooms.value = result.rooms ?? []
    roomsLoaded.value = true
  } catch {}
}

function openRoomsManager() {
  showRoomsManager.value = true
  roomFormName.value = ''
  editingRoom.value = null
  loadRooms()
}

async function saveRoom() {
  if (!roomFormName.value.trim()) return
  savingRoom.value = true
  try {
    if (editingRoom.value) {
      await api.rooms.update(editingRoom.value.id, { name: roomFormName.value.trim() })
    } else {
      await api.rooms.create({ name: roomFormName.value.trim() })
    }
    roomFormName.value = ''
    editingRoom.value = null
    await loadRooms()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    savingRoom.value = false
  }
}

function editRoom(room: Room) {
  editingRoom.value = room
  roomFormName.value = room.name
}

async function deleteRoom(id: number) {
  if (!confirm(label('确定删除此房间？', 'Delete this room?'))) return
  try {
    await api.rooms.delete(id)
    await loadRooms()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
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

function deviceIcon(t: string): string {
  if (t === 'television') return 'tv'
  if (t === 'stb') return 'stb'
  if (t === 'speaker') return 'speaker'
  if (t === 'router') return 'router'
  if (t === 'outlet') return 'outlet'
  if (t === 'phone') return 'phone'
  if (t === 'tv_box') return 'tv'
  if (t === 'tablet') return 'phone'
  if (t === 'computer') return 'computer'
  return 'device'
}

function sourceTags(device: UserDevice): string[] {
  const tags: string[] = []
  if (device.mi_did) tags.push('Mi')
  if (device.adb_ip) tags.push('ADB')
  return tags
}

function startEditIp(device: UserDevice) {
  editingIp.value[device.id] = device.ip_address || ''
}

function cancelEditIp(id: number) {
  const obj = { ...editingIp.value }
  delete obj[id]
  editingIp.value = obj
}

async function saveIp(device: UserDevice) {
  const ip = editingIp.value[device.id]?.trim() ?? ''
  savingIp.value[device.id] = true
  try {
    await api.userDevices.update(device.id, { ip_address: ip })
    device.ip_address = ip
    const obj = { ...editingIp.value }
    delete obj[device.id]
    editingIp.value = obj
  } catch (e) {
    console.error('Failed to save IP:', e)
  } finally {
    savingIp.value[device.id] = false
  }
}
</script>

<template>
  <div class="devices-page">
    <header class="page-head glass-panel">
      <div class="head-content">
        <span class="eyebrow">{{ label('设备', 'Devices') }}</span>
        <h1>{{ label('设备管理', 'Device Management') }}</h1>
        <p>{{ label('创建设备并绑定 Mi 或 ADB 能力。IP 仅用于在线检测。', 'Create devices and bind Mi or ADB capabilities. IP is only used for presence checks.') }}</p>
      </div>
      <div class="actions">
        <button class="refresh-btn" :disabled="loading" @click="loadDevices">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
          {{ label('刷新', 'Refresh') }}
        </button>
        <button class="create-btn" @click="openCreate">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          {{ label('添加设备', 'Add Device') }}
        </button>
        <button class="room-manage-btn" @click="openRoomsManager">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L3 8l9 5 9-5-9-5z"></path><path d="M3 13l9 5 9-5"></path><path d="M3 18l9 5 9-5"></path></svg>
          {{ label('管理房间', 'Rooms') }}
        </button>
      </div>
    </header>

    <div v-if="errorMessage" class="error-line glass-panel">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      {{ errorMessage }}
    </div>
    <div v-if="successMessage" class="success-line glass-panel">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      {{ successMessage }}
    </div>

    <div v-if="loading" class="empty-state">{{ label('加载中…', 'Loading…') }}</div>

    <div v-else-if="devices.length === 0" class="empty-state">{{ label('暂无设备，点击"添加设备"创建', 'No devices. Click "Add Device" to create one.') }}</div>

    <section v-else class="device-grid">
      <div v-for="device in devices" :key="device.id" class="device-card glass-panel">
        <!-- Icon -->
        <div class="card-icon" :class="`icon-${deviceIcon(device.device_type)}`">
          <svg v-if="deviceIcon(device.device_type) === 'tv'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'stb'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8" cy="12" r="1.5" fill="currentColor"></circle><circle cx="12" cy="12" r="1.5" fill="currentColor"></circle><circle cx="16" cy="12" r="1.5" fill="currentColor"></circle></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'speaker'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"></rect><circle cx="12" cy="14" r="3"></circle><line x1="12" y1="7" x2="12" y2="9"></line></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'router'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="20" height="8" rx="2"></rect><line x1="6" y1="12" x2="6.01" y2="12"></line><line x1="10" y1="12" x2="10.01" y2="12"></line><line x1="14" y1="12" x2="14.01" y2="12"></line><path d="M6 20v-4 M18 20v-4"></path></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'outlet'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"></rect><rect x="9" y="10" width="6" height="4" rx="1"></rect></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'phone'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          <svg v-else-if="deviceIcon(device.device_type) === 'computer'" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          <svg v-else viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
        </div>

        <!-- Body -->
        <div class="card-body" @click="router.push(`/devices/${device.id}`)" style="cursor: pointer;">
          <div class="card-top">
            <span class="status-dot" :class="onlineStatus[device.id] === undefined ? 'status-unknown' : onlineStatus[device.id] ? 'status-online' : 'status-offline'" />
            <strong class="device-name">{{ device.name }}</strong>
            <div class="source-tags">
              <span v-for="tag in sourceTags(device)" :key="tag" class="source-tag" :class="tag === 'ADB' ? 'tag-adb' : 'tag-mi'">{{ tag }}</span>
            </div>
          </div>

          <div class="card-meta">
            <span class="meta-chip">{{ typeLabel(device.device_type) }}</span>
            <span v-if="device.room_name" class="meta-chip">{{ device.room_name }}</span>
          </div>

          <div class="card-info">
            <span v-if="device.mi_did" class="info-line">Mi: {{ device.mi_did }}</span>
            <span v-if="device.adb_ip" class="info-line">ADB: {{ device.adb_ip }}</span>
          </div>

          <!-- IP row -->
          <div class="ip-row">
            <span class="ip-label">IP:</span>
            <template v-if="editingIp[device.id] !== undefined">
              <input v-model="editingIp[device.id]" class="ip-input" placeholder="192.168.1.x" @keyup.enter="saveIp(device)" @keyup.escape="cancelEditIp(device.id)" />
              <button class="ip-action ip-save" :disabled="savingIp[device.id]" @click="saveIp(device)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
              <button class="ip-action ip-cancel" @click="cancelEditIp(device.id)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </template>
            <template v-else>
              <span class="ip-value" :class="{ 'ip-empty': !device.ip_address }">
                {{ device.ip_address || '—' }}
              </span>
              <button class="ip-action ip-edit" @click="startEditIp(device)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </button>
            </template>
          </div>
        </div>

        <!-- Actions -->
        <div class="card-actions">
          <button class="action-btn action-edit" :title="label('编辑', 'Edit')" @click="openEdit(device)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="action-btn action-delete" :title="label('删除', 'Delete')" @click="deleteDevice(device.id)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    </section>

    <!-- Create dialog -->
    <Teleport to="body">
      <div v-if="showCreate" class="dialog-overlay" @click.self="showCreate = false">
        <div class="dialog glass-panel">
          <h2>{{ label('添加设备', 'Add Device') }}</h2>

          <div class="form-row">
            <label>{{ label('名称', 'Name') }} *</label>
            <input v-model="formName" class="form-input" :placeholder="label('如: 客厅电视', 'e.g. Living Room TV')" />
          </div>

          <div class="form-row">
            <label>{{ label('类型', 'Type') }}</label>
            <select v-model="formType" class="form-select">
              <option v-for="opt in deviceTypeOptions" :key="opt.value" :value="opt.value">{{ isZh ? opt.zh : opt.en }}</option>
            </select>
          </div>

          <div class="form-row">
            <label>{{ label('房间', 'Room') }}</label>
            <div class="room-select-row">
              <select v-model="formRoomId" class="form-select">
                <option :value="null">{{ label('无', 'None') }}</option>
                <option v-if="roomsLoading" disabled>{{ label('房间加载中...', 'Loading rooms...') }}</option>
                <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <button class="room-manage-btn-sm" :title="label('管理房间', 'Manage Rooms')" @click="openRoomsManager">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L3 8l9 5 9-5-9-5z"></path><path d="M3 13l9 5 9-5"></path><path d="M3 18l9 5 9-5"></path></svg>
              </button>
            </div>
          </div>

          <div class="form-row">
            <label>{{ label('Mi 绑定', 'Mi Binding') }}</label>
            <select v-model="formMiDid" class="form-select">
              <option :value="null">{{ label('不绑定', 'None') }}</option>
              <option v-if="miCandidatesLoading" disabled>{{ label('Mi 候选加载中...', 'Loading Mi candidates...') }}</option>
              <option v-for="c in miBindingOptions" :key="c.did" :value="c.did">
                {{ c.name || c.did }} ({{ c.model }}{{ c.room_name ? ' · ' + c.room_name : '' }})
              </option>
            </select>
          </div>

          <div class="form-row">
            <label>{{ label('ADB 绑定地址', 'ADB Binding Address') }}</label>
            <input v-model="formAdbAddress" class="form-input" placeholder="192.168.1.100:5555" />
            <div class="form-hint">{{ label('绑定 ADB 端点后，该设备才能获得 ADB 能力。', 'Bind an ADB endpoint to enable ADB capabilities for this device.') }}</div>
          </div>

          <div class="form-row">
            <label>{{ label('IP 地址', 'IP Address') }}</label>
            <input v-model="formIp" class="form-input" placeholder="192.168.1.100" />
          </div>

          <div class="dialog-actions">
            <button class="dialog-btn dialog-cancel" @click="showCreate = false">{{ label('取消', 'Cancel') }}</button>
            <button class="dialog-btn dialog-confirm" :disabled="!formName.trim() || creating" @click="submitCreate">
              {{ creating ? label('创建中…', 'Creating…') : label('创建', 'Create') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Edit dialog -->
    <Teleport to="body">
      <div v-if="showEdit" class="dialog-overlay" @click.self="showEdit = false">
        <div class="dialog glass-panel">
          <h2>{{ label('编辑设备', 'Edit Device') }}</h2>

          <div class="form-row">
            <label>{{ label('名称', 'Name') }} *</label>
            <input v-model="formName" class="form-input" :placeholder="label('如: 客厅电视', 'e.g. Living Room TV')" />
          </div>

          <div class="form-row">
            <label>{{ label('类型', 'Type') }}</label>
            <select v-model="formType" class="form-select">
              <option v-for="opt in deviceTypeOptions" :key="opt.value" :value="opt.value">{{ isZh ? opt.zh : opt.en }}</option>
            </select>
          </div>

          <div class="form-row">
            <label>{{ label('房间', 'Room') }}</label>
            <div class="room-select-row">
              <select v-model="formRoomId" class="form-select">
                <option :value="null">{{ label('无', 'None') }}</option>
                <option v-if="roomsLoading" disabled>{{ label('房间加载中...', 'Loading rooms...') }}</option>
                <option v-for="r in rooms" :key="r.id" :value="r.id">{{ r.name }}</option>
              </select>
              <button class="room-manage-btn-sm" :title="label('管理房间', 'Manage Rooms')" @click="openRoomsManager">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L3 8l9 5 9-5-9-5z"></path><path d="M3 13l9 5 9-5"></path><path d="M3 18l9 5 9-5"></path></svg>
              </button>
            </div>
          </div>

          <div class="form-row">
            <label>{{ label('Mi 绑定', 'Mi Binding') }}</label>
            <select v-model="formMiDid" class="form-select">
              <option :value="null">{{ label('不绑定', 'None') }}</option>
              <option v-if="miCandidatesLoading" disabled>{{ label('Mi 候选加载中...', 'Loading Mi candidates...') }}</option>
              <option v-for="c in miBindingOptions" :key="c.did" :value="c.did">
                {{ c.name || c.did }} ({{ c.model }}{{ c.room_name ? ' · ' + c.room_name : '' }})
              </option>
            </select>
          </div>

          <div class="form-row">
            <label>{{ label('ADB 绑定地址', 'ADB Binding Address') }}</label>
            <input v-model="formAdbAddress" class="form-input" placeholder="192.168.1.100:5555" />
            <div class="form-hint">{{ label('绑定 ADB 端点后，该设备才能获得 ADB 能力。', 'Bind an ADB endpoint to enable ADB capabilities for this device.') }}</div>
          </div>

          <div class="form-row">
            <label>{{ label('IP 地址', 'IP Address') }}</label>
            <input v-model="formIp" class="form-input" placeholder="192.168.1.100:5555" />
          </div>

          <div class="dialog-actions">
            <button class="dialog-btn dialog-cancel" @click="showEdit = false">{{ label('取消', 'Cancel') }}</button>
            <button class="dialog-btn dialog-confirm" :disabled="!formName.trim() || saving" @click="submitEdit">
              {{ saving ? label('保存中…', 'Saving…') : label('保存', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Rooms Manager dialog -->
    <Teleport to="body">
      <div v-if="showRoomsManager" class="dialog-overlay" @click.self="showRoomsManager = false">
        <div class="dialog glass-panel">
          <h2>{{ label('管理房间', 'Manage Rooms') }}</h2>

          <div class="form-row room-form-inline">
            <input v-model="roomFormName" class="form-input" :placeholder="label('房间名称', 'Room name')" @keyup.enter="saveRoom" />
            <button class="dialog-btn dialog-confirm room-save-btn" :disabled="!roomFormName.trim() || savingRoom" @click="saveRoom">
              {{ savingRoom ? '…' : editingRoom ? label('更新', 'Update') : label('添加', 'Add') }}
            </button>
            <button v-if="editingRoom" class="dialog-btn dialog-cancel" @click="editingRoom = null; roomFormName = ''">
              {{ label('取消', 'Cancel') }}
            </button>
          </div>

          <div v-if="rooms.length === 0" class="empty-rooms">
            {{ label('暂无房间', 'No rooms yet.') }}
          </div>
          <ul v-else class="room-list">
            <li v-for="r in rooms" :key="r.id" class="room-list-item">
              <span class="room-list-name">{{ r.name }}</span>
              <div class="room-list-actions">
                <button class="room-list-btn room-list-edit" :title="label('编辑', 'Edit')" @click="editRoom(r)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="room-list-btn room-list-delete" :title="label('删除', 'Delete')" @click="deleteRoom(r.id)">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </li>
          </ul>

          <div class="dialog-actions">
            <button class="dialog-btn dialog-cancel" @click="showRoomsManager = false">{{ label('关闭', 'Close') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.devices-page {
  height: 100%;
  overflow-y: auto;
  padding: 48px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 48px 56px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 16px;
  border-radius: 10px;
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.06em;
  color: var(--text-primary);
  line-height: 1;
}

.page-head p {
  margin-top: 16px;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1.6;
  font-weight: 600;
  max-width: 600px;
  opacity: 0.7;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.refresh-btn, .create-btn {
  min-height: 48px;
  padding: 0 24px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.refresh-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.12);
  transform: translateY(-2px);
}

.create-btn {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
}

.create-btn:hover {
  background: #059669;
  border-color: #059669;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2);
  transform: translateY(-2px);
}

.error-line {
  padding: 20px 32px;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(254, 242, 242, 0.8);
  color: #ef4444;
  font-size: 16px;
  font-weight: 900;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.08);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
  font-size: 16px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  opacity: 0.4;
}

/* ── device card grid ── */
.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 24px;
}

.device-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 28px 32px;
  cursor: default;
  border-radius: 28px;
}

.device-card:hover {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.06);
  transform: translateY(-4px);
}

/* ── icons ── */
.card-icon {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.icon-tv { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.icon-stb { background: rgba(99, 102, 241, 0.1); color: #6366f1; }
.icon-speaker { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.icon-router { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.icon-outlet { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
.icon-phone { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; }
.icon-computer { background: rgba(6, 182, 212, 0.1); color: #06b6d4; }

/* ── body ── */
.card-body {
  flex: 1;
  min-width: 0;
}

.card-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.device-name {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}

.status-online { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); }
.status-offline { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.4); }
.status-unknown { background: #d1d5db; }

.source-tags {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.source-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.tag-mi { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.tag-adb { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

.card-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.meta-chip {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-tertiary);
}

.card-info {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.info-line {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-tertiary);
  opacity: 0.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

/* ── IP row ── */
.ip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(229, 231, 235, 0.3);
}

.ip-label {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.ip-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.ip-value.ip-empty {
  color: rgba(0, 0, 0, 0.15);
  font-weight: 400;
}

.ip-input {
  flex: 1;
  min-width: 0;
  max-width: 160px;
  padding: 4px 10px;
  border: 1.5px solid #10b981;
  border-radius: 8px;
  font-size: 15px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 700;
  outline: none;
  background: #fff;
  transition: border-color 0.2s;
}

.ip-input:focus {
  border-color: #059669;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}

.ip-action {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}

.ip-action:hover { border-color: #10b981; color: #10b981; background: #fff; }
.ip-save:hover { border-color: #10b981; color: #10b981; }
.ip-cancel:hover { border-color: #ef4444; color: #ef4444; }
.ip-edit { opacity: 0; }
.device-card:hover .ip-edit { opacity: 1; }

/* ── card actions ── */
.card-actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  width: 44px;
  height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.action-delete:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fff;
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.12);
}

.action-edit:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.12);
}

/* ── dialog ── */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 40px;
  background: #fff;
}

.dialog h2 {
  margin: 0 0 28px;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.form-row {
  margin-bottom: 20px;
}

.form-row label {
  display: block;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-input, .form-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  outline: none;
  background: #fff;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus, .form-select:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
}

.dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 32px;
}

.dialog-btn {
  padding: 10px 24px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  border: 1px solid rgba(229, 231, 235, 0.8);
  transition: all 0.2s;
}

.dialog-cancel {
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
}

.dialog-confirm {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
}

.dialog-confirm:hover:not(:disabled) {
  background: #059669;
}

.dialog-confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── room select ── */
.room-select-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.room-select-row .form-select {
  flex: 1;
}

.room-manage-btn-sm {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}

.room-manage-btn-sm:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
}

/* ── rooms manager button in page head ── */
.room-manage-btn {
  min-height: 48px;
  padding: 0 24px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.room-manage-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.12);
  transform: translateY(-2px);
}

/* ── rooms manager dialog ── */
.room-form-inline {
  display: flex;
  gap: 8px;
  align-items: center;
}

.room-form-inline .form-input {
  flex: 1;
}

.room-save-btn {
  flex-shrink: 0;
}

.empty-rooms {
  text-align: center;
  padding: 32px 0;
  color: var(--text-tertiary);
  font-weight: 700;
  font-size: 16px;
  opacity: 0.5;
}

.room-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.room-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  transition: background 0.2s;
}

.room-list-item:last-child {
  border-bottom: none;
}

.room-list-item:hover {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 12px;
}

.room-list-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--text-primary);
}

.room-list-actions {
  display: flex;
  gap: 6px;
}

.room-list-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  padding: 0;
}

.room-list-edit:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
}

.room-list-delete:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fff;
}
</style>
