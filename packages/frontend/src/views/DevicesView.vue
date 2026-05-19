<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, type DeviceInfo } from '@/api'
import { useLocale } from '@/composables/useLocale'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const loading = ref(false)
const errorMessage = ref('')
const devices = ref<DeviceInfo[]>([])
const selectedDid = ref('')
const selectedDetail = ref<Record<string, unknown> | null>(null)
const statusResult = ref<Record<string, unknown> | null>(null)
const filter = ref<'all' | 'wifi' | 'gateway' | 'ir' | 'bt'>('all')
const search = ref('')

const filteredDevices = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return devices.value.filter((device) => {
    if (filter.value !== 'all' && device.connection_type !== filter.value) return false
    if (!keyword) return true
    return [
      device.did,
      device.name,
      device.model,
      device.home_name,
      device.room_name,
      device.connection_type,
      device.device_type,
    ].join(' ').toLowerCase().includes(keyword)
  })
})

const selectedDevice = computed(() =>
  filteredDevices.value.find((device) => device.did === selectedDid.value)
  ?? devices.value.find((device) => device.did === selectedDid.value)
  ?? filteredDevices.value[0]
  ?? devices.value[0]
  ?? null,
)

const selectedDeviceDetail = computed(() => {
  const device = selectedDetail.value?.device
  return device && typeof device === 'object' ? device as Record<string, unknown> : null
})

const selectedCapabilityProfile = computed(() =>
  selectedDevice.value?.capability_profile
  ?? selectedDeviceDetail.value?.capability_profile_json
  ?? {},
)

const summary = computed(() => ({
  total: devices.value.length,
  entities: devices.value.reduce((count, device) => count + (device.entities?.length ?? 0), 0),
  homes: new Set(devices.value.map((device) => device.home_name || device.home_id).filter(Boolean)).size,
  gateways: devices.value.filter((device) => device.connection_type === 'gateway').length,
}))

watch(selectedDevice, async (device) => {
  if (!device || device.did === selectedDid.value && selectedDetail.value) return
  selectedDid.value = device.did
  await loadDetail(device.did)
})

onMounted(async () => {
  await loadDevices()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function loadDevices() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await api.devices.list()
    devices.value = result.devices ?? []
    if (result.error) errorMessage.value = result.message || result.error
    if (devices.value[0] && !selectedDid.value) selectedDid.value = devices.value[0].did
    if (selectedDid.value) await loadDetail(selectedDid.value)
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    loading.value = false
  }
}

async function discover() {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await api.devices.discover()
    devices.value = result.devices ?? []
    if (result.error) errorMessage.value = result.message || result.error
    selectedDid.value = devices.value[0]?.did ?? ''
    selectedDetail.value = null
    statusResult.value = null
    if (selectedDid.value) await loadDetail(selectedDid.value)
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    loading.value = false
  }
}

async function loadDetail(did: string) {
  try {
    selectedDetail.value = await api.devices.get(did)
    statusResult.value = await api.devices.status(did)
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  }
}

function selectDevice(device: DeviceInfo) {
  selectedDid.value = device.did
  selectedDetail.value = null
  statusResult.value = null
  void loadDetail(device.did)
}

function sourceLabel(device: DeviceInfo) {
  if (device.connection_type === 'gateway') return label('网关', 'Gateway')
  if (device.connection_type === 'bt') return label('蓝牙', 'Bluetooth')
  if (device.connection_type === 'ir') return label('红外', 'IR')
  return label('Wi-Fi / 云', 'Wi-Fi / Cloud')
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}
</script>

<template>
  <div class="devices-page">
    <header class="page-head glass-panel">
      <div class="head-content">
        <span class="eyebrow">{{ label('HA 式设备底座', 'HA-style Device Registry') }}</span>
        <h1>{{ label('设备管理', 'Device Management') }}</h1>
        <p>{{ label('统一管理米家、ADB、电脑、蓝牙开机卡、未来 SSH/WOL 等来源的设备与实体。', 'A unified registry for Mi Home, ADB, computers, wake cards, and future SSH/WOL sources.') }}</p>
      </div>
      <div class="actions">
        <button class="icon-btn" @click="loadDevices" :disabled="loading" :title="label('刷新', 'Refresh')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
        <button class="primary large" @click="discover" :disabled="loading">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 12px">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          {{ label('发现设备', 'Discover') }}
        </button>
      </div>
    </header>

    <section class="summary-grid">
      <div class="summary-card">
        <label class="eyebrow">{{ label('设备总数', 'Devices') }}</label>
        <strong>{{ summary.total }}</strong>
      </div>
      <div class="summary-card">
        <label class="eyebrow">{{ label('实体映射', 'Entities') }}</label>
        <strong>{{ summary.entities }}</strong>
      </div>
      <div class="summary-card">
        <label class="eyebrow">{{ label('家庭区域', 'Homes') }}</label>
        <strong>{{ summary.homes }}</strong>
      </div>
      <div class="summary-card">
        <label class="eyebrow">{{ label('网关节点', 'Gateways') }}</label>
        <strong>{{ summary.gateways }}</strong>
      </div>
    </section>

    <div v-if="errorMessage" class="error-line">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      {{ errorMessage }}
    </div>

    <section class="content-grid">
      <aside class="registry-panel glass-panel">
        <div class="toolbar">
          <div class="select-wrapper">
            <select v-model="filter">
              <option value="all">{{ label('全部来源', 'All sources') }}</option>
              <option value="wifi">Wi-Fi</option>
              <option value="gateway">{{ label('网关', 'Gateway') }}</option>
              <option value="ir">{{ label('红外', 'IR') }}</option>
              <option value="bt">{{ label('蓝牙', 'Bluetooth') }}</option>
            </select>
          </div>
          <div class="search-wrapper">
            <input v-model="search" :placeholder="label('搜索设备、房间、型号', 'Search device, room, model')" />
          </div>
        </div>

        <div class="device-list-scroller">
          <div v-if="loading" class="empty-state">{{ label('加载中…', 'Loading…') }}</div>
          <div v-else-if="filteredDevices.length === 0" class="empty-state">{{ label('暂无设备', 'No devices found') }}</div>
          <button
            v-for="device in filteredDevices"
            :key="device.did"
            :class="['device-row', { active: selectedDevice?.did === device.did }]"
            @click="selectDevice(device)"
          >
            <div class="device-main">
              <strong>{{ device.name || device.model || device.did }}</strong>
              <span class="room-tag">{{ device.room_name || device.home_name || label('未分房间', 'No room') }}</span>
            </div>
            <div class="device-meta">
              <span class="source-badge">{{ sourceLabel(device) }}</span>
            </div>
          </button>
        </div>
      </aside>

      <main class="detail-panel">
        <template v-if="selectedDevice">
          <div class="detail-card glass-panel main-info">
            <div class="detail-head">
              <div class="head-left">
                <span class="source-pill">{{ sourceLabel(selectedDevice) }}</span>
                <h2>{{ selectedDevice.name || selectedDevice.model || selectedDevice.did }}</h2>
                <p class="model-text">{{ selectedDevice.model }} · {{ selectedDevice.did }}</p>
              </div>
              <button class="icon-btn" @click="loadDetail(selectedDevice.did)">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 4v6h-6"></path>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
              </button>
            </div>

            <div class="meta-row-grid">
              <div class="meta-item">
                <label>{{ label('Home', 'Home') }}</label>
                <span>{{ selectedDevice.home_name || selectedDevice.home_id || '-' }}</span>
              </div>
              <div class="meta-item">
                <label>{{ label('Room', 'Room') }}</label>
                <span>{{ selectedDevice.room_name || '-' }}</span>
              </div>
              <div class="meta-item">
                <label>{{ label('Type', 'Type') }}</label>
                <span>{{ selectedDevice.device_type || '-' }}</span>
              </div>
              <div class="meta-item">
                <label>{{ label('Parent', 'Parent') }}</label>
                <span class="mono">{{ selectedDevice.parent_id || '-' }}</span>
              </div>
            </div>
          </div>

          <div class="detail-card glass-panel section-box">
            <div class="section-head">
              <h3>{{ label('实体映射', 'Entity Mapping') }}</h3>
              <span class="count-badge">{{ selectedDevice.entities?.length ?? 0 }}</span>
            </div>
            <div v-if="!selectedDevice.entities?.length" class="empty-state compact">{{ label('暂无实体映射。', 'No entity mapping yet.') }}</div>
            <div v-else class="entity-grid">
              <div v-for="entity in selectedDevice.entities" :key="String(entity.entity_id)" class="entity-card">
                <div class="entity-top">
                  <strong>{{ entity.name || entity.entity_id }}</strong>
                  <span class="domain-tag">{{ entity.domain }}</span>
                </div>
                <div class="entity-mid">
                  <span>{{ entity.capability }}</span>
                </div>
                <div class="entity-bottom">
                  <code>{{ entity.entity_id }}</code>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-card glass-panel section-box">
            <div class="section-head">
              <h3>{{ label('能力画像', 'Capability Profile') }}</h3>
            </div>
            <pre class="json-block">{{ safeJson(selectedCapabilityProfile) }}</pre>
          </div>

          <div class="detail-card glass-panel section-box">
            <div class="section-head">
              <h3>{{ label('实时状态', 'Live State') }}</h3>
            </div>
            <pre class="json-block">{{ safeJson(statusResult) }}</pre>
          </div>
        </template>
        <div v-else class="empty-state glass-panel full-height">{{ label('选择一个设备查看详情。', 'Select a device to inspect details.') }}</div>
      </main>
    </section>
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
  gap: 40px;
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
  padding: 56px 64px;
}

.page-head:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 16px;
  border-radius: 10px;
  margin-bottom: 24px;
}

h1 {
  margin: 0;
  font-size: 48px;
  font-weight: 900;
  letter-spacing: -0.06em;
  color: var(--text-primary);
  line-height: 1;
}

h2 {
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.05em;
  color: var(--text-primary);
  line-height: 1.1;
}

h3 {
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

p {
  margin-top: 20px;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1.7;
  font-weight: 700;
  max-width: 900px;
  letter-spacing: -0.015em;
  opacity: 0.8;
}

.actions {
  display: flex;
  gap: 20px;
  align-items: center;
}

button,
select,
input {
  min-height: 52px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 28px;
  font-size: 14px;
  font-weight: 900;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
  color: var(--text-primary);
}

button {
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  justify-content: center;
}

button:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.12);
}

button.primary {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
}

button.primary:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-4px);
  box-shadow: 0 20px 48px rgba(16, 185, 129, 0.35);
  color: #fff;
}

button.large {
  min-height: 60px;
  padding: 0 36px;
}

.icon-btn {
  width: 52px;
  padding: 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
}

.summary-card {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.summary-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.summary-card .eyebrow {
  margin-bottom: 20px;
  padding: 4px 12px;
}

.summary-card strong {
  display: block;
  font-size: 56px;
  font-weight: 900;
  letter-spacing: -0.06em;
  color: var(--text-primary);
  line-height: 1;
}

.error-line {
  padding: 24px 40px;
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 28px;
  background: rgba(254, 242, 242, 0.8);
  backdrop-filter: blur(24px);
  color: #ef4444;
  font-size: 16px;
  font-weight: 900;
  display: flex;
  align-items: center;
  gap: 20px;
  box-shadow: 0 12px 40px rgba(239, 68, 68, 0.1);
}

.content-grid {
  display: grid;
  grid-template-columns: 480px minmax(0, 1fr);
  gap: 40px;
}

.registry-panel {
  height: 900px;
  display: flex;
  flex-direction: column;
  padding: 48px;
}

.toolbar {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 20px;
  margin-bottom: 48px;
}

.select-wrapper, .search-wrapper {
  position: relative;
}

.device-list-scroller {
  flex: 1;
  overflow-y: auto;
  padding-right: 12px;
  margin-right: -12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.device-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 28px 36px;
  text-align: left;
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.device-row:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateX(12px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.05);
}

.device-row.active {
  background: #fff;
  border-color: #10b981;
  box-shadow: 0 20px 64px rgba(16, 185, 129, 0.18);
  transform: translateX(16px);
}

.device-main strong {
  display: block;
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  margin-bottom: 8px;
}

.room-tag {
  display: inline-block;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.7;
}

.source-badge {
  display: block;
  padding: 6px 16px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 99px;
  font-size: 9px;
  font-weight: 900;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.device-row.active .source-badge {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.detail-card {
  padding: 48px;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 32px;
  align-items: flex-start;
  margin-bottom: 48px;
}

.source-pill {
  display: inline-flex;
  height: 28px;
  align-items: center;
  padding: 0 18px;
  border-radius: 99px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 24px;
}

.model-text {
  margin-top: 16px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.meta-row-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.meta-item label {
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.meta-item span {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
}

.count-badge {
  background: rgba(16, 185, 129, 0.1);
  padding: 8px 20px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 900;
  color: #10b981;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.entity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 32px;
}

.entity-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  padding: 36px;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.entity-card:hover {
  background: #fff;
  border-color: #10b981;
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(16, 185, 129, 0.15);
}

.entity-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.entity-top strong {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.domain-tag {
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  color: #7c3aed;
  letter-spacing: 0.15em;
  background: rgba(124, 58, 237, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
}

.entity-mid span {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.8;
}

.entity-bottom code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.05);
  padding: 6px 14px;
  border-radius: 10px;
  display: inline-block;
  opacity: 0.7;
}

.json-block {
  margin: 0;
  padding: 40px;
  border-radius: 32px;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: auto;
  font-size: 14px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #e2e8f0;
  line-height: 1.8;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  text-align: center;
  font-size: 16px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  opacity: 0.4;
}

.empty-state.full-height {
  height: 900px;
}

.empty-state.compact {
  min-height: 240px;
}

@media (max-width: 1600px) {
  .content-grid { grid-template-columns: 440px minmax(0, 1fr); }
}

@media (max-width: 1400px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .content-grid { grid-template-columns: 1fr; }
  .registry-panel { height: auto; min-height: 600px; }
}

@media (max-width: 768px) {
  .page-head { flex-direction: column; padding: 48px; align-items: flex-start; }
  .actions { width: 100%; }
  .actions button { flex: 1; }
  .meta-row-grid { grid-template-columns: 1fr 1fr; }
}
</style>
