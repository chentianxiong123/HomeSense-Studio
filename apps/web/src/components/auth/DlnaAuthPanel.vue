<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type UserDevice } from '@/api'
import { mediaApi } from '@/api/media'
import DlnaScanCandidates, { type DlnaCandidate } from './DlnaScanCandidates.vue'
import DlnaTargetDialog from './DlnaTargetDialog.vue'
import DlnaTargetList from './DlnaTargetList.vue'

type LabelFn = (zh: string, en: string) => string

const props = defineProps<{
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'count-change', value: number): void
  (event: 'error', value: string): void
  (event: 'success', value: string): void
}>()

const devices = ref<UserDevice[]>([])
const dlnaFormOpen = ref(false)
const editingDlnaDevice = ref<UserDevice | null>(null)
const formDlnaName = ref('')
const formDlnaLocation = ref('')
const formDlnaIp = ref('')
const formDlnaManufacturer = ref('')
const formDlnaModel = ref('')
const dlnaScanLoaded = ref(false)
const dlnaScanResults = ref<DlnaCandidate[]>([])
const dlnaTestResults = ref<Record<string, { ok: boolean; message: string }>>({})
const busy = ref<Record<string, boolean>>({})

const dlnaRows = computed(() => {
  return [...devices.value]
    .filter((device) => typeof device.props?.dlna_location === 'string' && (device.props.dlna_location as string).trim())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((device) => ({ device }))
})

const dlnaBoundCount = computed(() => dlnaRows.value.length)
const dlnaFormSaving = computed(() => isBusy('dlna-create') || (editingDlnaDevice.value ? isBusy(`dlna-edit-${editingDlnaDevice.value.id}`) : false))

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

async function refresh() {
  await loadDevices()
}

async function loadDevices() {
  setBusy('devices', true)
  try {
    const deviceResult = await api.userDevices.list()
    devices.value = deviceResult.devices ?? []
    emit('count-change', dlnaBoundCount.value)
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('devices', false)
  }
}

function openCreateDlnaDevice() {
  editingDlnaDevice.value = null
  formDlnaName.value = ''
  formDlnaLocation.value = ''
  formDlnaIp.value = ''
  formDlnaManufacturer.value = ''
  formDlnaModel.value = ''
  dlnaFormOpen.value = true
}

function openEditDlnaDevice(device: UserDevice) {
  editingDlnaDevice.value = device
  formDlnaName.value = device.name
  formDlnaLocation.value = getString(device.props?.dlna_location)
  formDlnaIp.value = getString(device.props?.ip_address)
  formDlnaManufacturer.value = getString(device.props?.manufacturer)
  formDlnaModel.value = getString(device.props?.model)
  dlnaFormOpen.value = true
}

function closeDlnaForm() {
  dlnaFormOpen.value = false
  editingDlnaDevice.value = null
}

async function submitDlnaDevice() {
  const name = formDlnaName.value.trim()
  const location = formDlnaLocation.value.trim()
  if (!name || !location) return
  const payload = {
    name,
    props: {
      ...(editingDlnaDevice.value?.props ?? {}),
      device_type: 'dlna_renderer',
      dlna_location: location,
      dlan: true,
      ...(formDlnaIp.value.trim() ? { ip_address: formDlnaIp.value.trim() } : {}),
      ...(formDlnaManufacturer.value.trim() ? { manufacturer: formDlnaManufacturer.value.trim() } : {}),
      ...(formDlnaModel.value.trim() ? { model: formDlnaModel.value.trim() } : {}),
    },
  }
  const key = editingDlnaDevice.value ? `dlna-edit-${editingDlnaDevice.value.id}` : 'dlna-create'
  setBusy(key, true)
  try {
    if (editingDlnaDevice.value) {
      await api.userDevices.update(editingDlnaDevice.value.id, payload)
      emit('success', label('DLNA 目标已更新', 'DLNA target updated'))
    } else {
      await api.userDevices.create(payload)
      emit('success', label('DLNA 目标已添加', 'DLNA target added'))
    }
    closeDlnaForm()
    await loadDevices()
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(key, false)
  }
}

async function deleteDlnaDevice(device: UserDevice) {
  if (!window.confirm(label(`删除 DLNA 目标「${device.name}」？`, `Delete DLNA target "${device.name}"?`))) return
  setBusy(`dlna-delete-${device.id}`, true)
  try {
    await api.userDevices.delete(device.id)
    await loadDevices()
    emit('success', label('DLNA 目标已删除', 'DLNA target deleted'))
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(`dlna-delete-${device.id}`, false)
  }
}

async function scanDlnaTargets() {
  setBusy('dlna-scan', true)
  dlnaScanLoaded.value = false
  try {
    dlnaScanResults.value = await mediaApi.listDlnaOutputs()
    dlnaScanLoaded.value = true
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('dlna-scan', false)
  }
}

async function saveDlnaCandidate(candidate: DlnaCandidate) {
  const location = candidate.endpoint?.trim()
  if (!location) return
  if (isDlnaLocationSaved(location)) {
    emit('success', label('DLNA 目标已存在', 'DLNA target already exists'))
    return
  }
  const meta = candidate.meta ?? {}
  const ipAddress = getString(meta.ip)
  const port = typeof meta.port === 'number' ? meta.port : undefined
  setBusy(`dlna-save-candidate-${candidate.id}`, true)
  try {
    await api.userDevices.create({
      name: candidate.name || `DLNA ${ipAddress || location}`,
      props: {
        device_type: 'dlna_renderer',
        dlna_location: location,
        dlna_udn: getString(meta.udn),
        dlna_kind: meta.virtual ? 'virtual' : 'real',
        dlna_device_type: getString(meta.device_type),
        dlan: true,
        manufacturer: getString(meta.manufacturer),
        model: getString(meta.model),
        ...(ipAddress ? { ip_address: ipAddress } : {}),
        ...(port != null ? { port } : {}),
      },
    })
    await loadDevices()
    emit('success', label('DLNA 候选已保存', 'DLNA candidate saved'))
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy(`dlna-save-candidate-${candidate.id}`, false)
  }
}

async function testDlnaLocation(location: string) {
  const normalized = location.trim()
  if (!normalized) return
  setBusy(`dlna-test-${normalized}`, true)
  dlnaTestResults.value = { ...dlnaTestResults.value, [normalized]: { ok: false, message: label('测试中', 'Testing') } }
  try {
    const result = await mediaApi.getDlnaStatus(normalized)
    const state = result.data?.state || result.data?.transport_status || result.message || result.error || result.status
    dlnaTestResults.value = {
      ...dlnaTestResults.value,
      [normalized]: { ok: result.status === 'success', message: String(state) },
    }
  } catch (error) {
    dlnaTestResults.value = { ...dlnaTestResults.value, [normalized]: { ok: false, message: (error as Error).message || String(error) } }
  } finally {
    setBusy(`dlna-test-${normalized}`, false)
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isDlnaLocationSaved(location: string): boolean {
  const normalized = location.trim()
  return devices.value.some((device) => getString(device.props?.dlna_location).trim() === normalized)
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
        <h2>DLNA</h2>
      </div>
      <span :class="['pill', dlnaBoundCount > 0 ? 'ok' : 'muted']">
        {{ dlnaBoundCount }} {{ label('个目标', 'targets') }}
      </span>
    </div>

    <div class="list-toolbar">
      <div>
        <strong>{{ label('媒体渲染目标', 'Media Render Targets') }}</strong>
        <small>{{ label('真实 DLNA 与 HomeSense 虚拟 DLNA 都在这里统一保存。', 'Real DLNA and HomeSense virtual DLNA targets are saved here.') }}</small>
      </div>
      <div class="toolbar-actions">
        <button class="plain-btn" :disabled="isBusy('dlna-scan')" @click="scanDlnaTargets">
          {{ isBusy('dlna-scan') ? label('扫描中', 'Scanning') : label('扫描', 'Scan') }}
        </button>
        <button class="primary-btn" :disabled="isBusy('dlna-create')" @click="openCreateDlnaDevice">{{ label('新增目标', 'Add Target') }}</button>
        <button class="plain-btn" :disabled="isBusy('devices')" @click="loadDevices">{{ label('刷新', 'Refresh') }}</button>
      </div>
    </div>

    <DlnaScanCandidates
      :loaded="dlnaScanLoaded"
      :candidates="dlnaScanResults"
      :test-results="dlnaTestResults"
      :label="label"
      :is-busy="isBusy"
      :is-saved="isDlnaLocationSaved"
      @test="testDlnaLocation"
      @save="saveDlnaCandidate"
    />

    <DlnaTargetList
      :rows="dlnaRows"
      :test-results="dlnaTestResults"
      :label="label"
      :is-busy="isBusy"
      @test="testDlnaLocation"
      @edit="openEditDlnaDevice"
      @delete="deleteDlnaDevice"
    />

    <DlnaTargetDialog
      :open="dlnaFormOpen"
      :editing="Boolean(editingDlnaDevice)"
      :name="formDlnaName"
      :location="formDlnaLocation"
      :ip="formDlnaIp"
      :manufacturer="formDlnaManufacturer"
      :model="formDlnaModel"
      :saving="dlnaFormSaving"
      :label="label"
      @close="closeDlnaForm"
      @submit="submitDlnaDevice"
      @update:name="formDlnaName = $event"
      @update:location="formDlnaLocation = $event"
      @update:ip="formDlnaIp = $event"
      @update:manufacturer="formDlnaManufacturer = $event"
      @update:model="formDlnaModel = $event"
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
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
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
</style>
