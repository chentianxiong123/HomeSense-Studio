<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type UserDevice } from '@/api'
import { cliApi } from '@/api/cli'
import AdbEndpointDialog from './AdbEndpointDialog.vue'
import AdbEndpointList from './AdbEndpointList.vue'
import AdbScanCandidates, { type AdbScanCandidate } from './AdbScanCandidates.vue'

type LabelFn = (zh: string, en: string) => string

type AdbScanData = {
  subnet: string
  ports: number[]
  scanned: number
  candidates: AdbScanCandidate[]
  count: number
}

const props = defineProps<{
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'count-change', value: number): void
  (event: 'error', value: string): void
  (event: 'success', value: string): void
}>()

const devices = ref<UserDevice[]>([])
const adbFormOpen = ref(false)
const editingAdbDevice = ref<UserDevice | null>(null)
const formName = ref('')
const formAdbAddress = ref('')
const adbScanSubnet = ref('')
const adbScanLoaded = ref(false)
const adbScanResults = ref<AdbScanCandidate[]>([])
const adbTestResults = ref<Record<string, { ok: boolean; message: string }>>({})
const busy = ref<Record<string, boolean>>({})

const adbRows = computed(() => {
  return [...devices.value]
    .filter((device) => typeof device.props?.adb_ip === 'string' && (device.props.adb_ip as string).trim())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((device) => ({ device }))
})

const adbBoundCount = computed(() => adbRows.value.length)

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

const adbFormSaving = computed(() => isBusy('adb-create') || (editingAdbDevice.value ? isBusy(`adb-edit-${editingAdbDevice.value.id}`) : false))

async function refresh() {
  await loadDevices()
}

async function loadDevices() {
  setBusy('devices', true)
  try {
    const deviceResult = await api.userDevices.list()
    devices.value = deviceResult.devices ?? []
    emit('count-change', adbBoundCount.value)
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('devices', false)
  }
}

function openCreateAdbDevice() {
  editingAdbDevice.value = null
  formName.value = ''
  formAdbAddress.value = ''
  adbFormOpen.value = true
}

function openEditAdbDevice(device: UserDevice) {
  editingAdbDevice.value = device
  formName.value = device.name
  formAdbAddress.value = getString(device.props?.adb_ip)
  adbFormOpen.value = true
}

function closeAdbForm() {
  adbFormOpen.value = false
  editingAdbDevice.value = null
}

async function submitAdbDevice() {
  const name = formName.value.trim()
  const adbAddress = normalizeAdbAddress(formAdbAddress.value)
  if (!name || !adbAddress) return
  const ipAddress = endpointHost(adbAddress)
  const payload: { name: string; props: Record<string, unknown> } = {
    name,
    props: {
      device_type: editingAdbDevice.value?.props?.device_type ?? 'other',
      adb_ip: adbAddress,
      ...(ipAddress ? { ip_address: ipAddress } : {}),
    },
  }
  if (editingAdbDevice.value?.props?.room_id != null) {
    payload.props.room_id = editingAdbDevice.value.props.room_id
  }

  const key = editingAdbDevice.value ? `adb-edit-${editingAdbDevice.value.id}` : 'adb-create'
  setBusy(key, true)
  try {
    if (editingAdbDevice.value) {
      await api.userDevices.update(editingAdbDevice.value.id, payload)
      emit('success', label('ADB 端点已更新', 'ADB endpoint updated'))
    } else {
      await api.userDevices.create(payload)
      emit('success', label('ADB 端点已添加', 'ADB endpoint added'))
    }
    closeAdbForm()
    await loadDevices()
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(key, false)
  }
}

async function deleteAdbDevice(device: UserDevice) {
  if (!window.confirm(label(`删除 ADB 端点「${device.name}」？`, `Delete ADB endpoint "${device.name}"?`))) return
  setBusy(`adb-delete-${device.id}`, true)
  try {
    await api.userDevices.delete(device.id)
    await loadDevices()
    emit('success', label('ADB 端点已删除', 'ADB endpoint deleted'))
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(`adb-delete-${device.id}`, false)
  }
}

async function scanAdbTargets() {
  setBusy('adb-scan', true)
  adbScanLoaded.value = false
  try {
    const params: Record<string, unknown> = { ports: [5555], timeout_ms: 350 }
    if (adbScanSubnet.value.trim()) params.subnet = adbScanSubnet.value.trim()
    const result = await cliApi.run<AdbScanData>('adb-cli', {
      action: 'scan_network',
      params,
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status !== 'success' || !result.data) {
      throw new Error(result.message || result.error || 'Failed to scan ADB targets')
    }
    adbScanResults.value = result.data.candidates ?? []
    if (!adbScanSubnet.value.trim()) adbScanSubnet.value = result.data.subnet
    adbScanLoaded.value = true
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('adb-scan', false)
  }
}

async function saveAdbCandidate(candidate: AdbScanCandidate) {
  const address = normalizeAdbAddress(candidate.address)
  if (!address) return
  if (isAdbAddressSaved(address)) {
    emit('success', label('ADB 端点已存在', 'ADB endpoint already exists'))
    return
  }
  const ipAddress = endpointHost(address)
  setBusy(`adb-save-candidate-${address}`, true)
  try {
    await api.userDevices.create({
      name: `ADB ${address}`,
      props: {
        device_type: 'other',
        adb_ip: address,
        ...(ipAddress ? { ip_address: ipAddress } : {}),
      },
    })
    await loadDevices()
    emit('success', label('ADB 候选已保存', 'ADB candidate saved'))
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(`adb-save-candidate-${address}`, false)
  }
}

async function testAdbAddress(address: string) {
  const normalized = normalizeAdbAddress(address)
  if (!normalized) return
  setBusy(`adb-test-${normalized}`, true)
  adbTestResults.value = { ...adbTestResults.value, [normalized]: { ok: false, message: label('测试中', 'Testing') } }
  try {
    const result = await cliApi.run<{ message?: string; address?: string }>('adb-cli', {
      action: 'connect',
      params: { device: normalized, max_attempts: 1, backoff_seconds: 1 },
      ttl_ms: 0,
      bypass_cache: true,
    })
    adbTestResults.value = {
      ...adbTestResults.value,
      [normalized]: {
        ok: result.status === 'success',
        message: result.data?.message || result.message || result.error || result.status,
      },
    }
  } catch (error) {
    adbTestResults.value = { ...adbTestResults.value, [normalized]: { ok: false, message: (error as Error).message || String(error) } }
  } finally {
    setBusy(`adb-test-${normalized}`, false)
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeAdbAddress(value: string): string {
  const address = value.trim()
  return address && !address.includes(':') ? `${address}:5555` : address
}

function endpointHost(value: string): string {
  return value.split(':')[0]?.trim() ?? ''
}

function isAdbAddressSaved(address: string): boolean {
  const normalized = normalizeAdbAddress(address)
  return devices.value.some((device) => normalizeAdbAddress(getString(device.props?.adb_ip)) === normalized)
}

onMounted(() => {
  void loadDevices()
})

defineExpose({ refresh })
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
        <h2>ADB</h2>
      </div>
      <span :class="['pill', adbBoundCount > 0 ? 'ok' : 'muted']">
        {{ adbBoundCount }} {{ label('个端点', 'endpoints') }}
      </span>
    </div>

    <div class="list-toolbar">
      <div>
        <strong>ADB CLI</strong>
        <small>{{ label('扫描候选只探测 5555 端口；保存后才进入设备授权。', 'Scan only probes port 5555; save a candidate to authorize it.') }}</small>
      </div>
      <div class="toolbar-actions">
        <input v-model="adbScanSubnet" class="toolbar-input" placeholder="192.168.31.0/24" />
        <button class="plain-btn" :disabled="isBusy('adb-scan')" @click="scanAdbTargets">
          {{ isBusy('adb-scan') ? label('扫描中', 'Scanning') : label('扫描', 'Scan') }}
        </button>
        <button class="primary-btn" :disabled="isBusy('adb-create')" @click="openCreateAdbDevice">{{ label('新增端点', 'Add Endpoint') }}</button>
        <button class="plain-btn" :disabled="isBusy('devices')" @click="loadDevices">{{ label('刷新', 'Refresh') }}</button>
      </div>
    </div>

    <AdbScanCandidates
      :loaded="adbScanLoaded"
      :candidates="adbScanResults"
      :test-results="adbTestResults"
      :label="label"
      :is-busy="isBusy"
      :is-saved="isAdbAddressSaved"
      @test="testAdbAddress"
      @save="saveAdbCandidate"
    />

    <AdbEndpointList
      :rows="adbRows"
      :test-results="adbTestResults"
      :label="label"
      :is-busy="isBusy"
      @test="testAdbAddress"
      @edit="openEditAdbDevice"
      @delete="deleteAdbDevice"
    />

    <AdbEndpointDialog
      :open="adbFormOpen"
      :editing="Boolean(editingAdbDevice)"
      :name="formName"
      :address="formAdbAddress"
      :saving="adbFormSaving"
      :label="label"
      @close="closeAdbForm"
      @submit="submitAdbDevice"
      @update:name="formName = $event"
      @update:address="formAdbAddress = $event"
    />
  </section>
</template>

<style scoped>
.detail-surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.detail-head,
.list-toolbar,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-head,
.list-toolbar {
  justify-content: space-between;
}

.detail-head {
  margin-bottom: 18px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.list-toolbar {
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.list-toolbar strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.list-toolbar small {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
}

.pill.ok { background: #dcfce7; color: #047857; }
.pill.muted { background: #f4f4f5; color: #71717a; }

.toolbar-input {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 10px;
  font: inherit;
}

.toolbar-input {
  width: 180px;
}

.plain-btn,
.primary-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .toolbar-input {
    width: 100%;
  }
}
</style>
